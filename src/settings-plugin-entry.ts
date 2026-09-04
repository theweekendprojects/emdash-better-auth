/**
 * Runtime entrypoint for the Better Auth settings companion plugin.
 *
 * This is the module the `format: "native"` descriptor (in index.ts) points at
 * via `entrypoint`. EmDash imports it and calls `createPlugin()` to instantiate
 * the plugin in-process.
 *
 * WHY A CUSTOM ADMIN PAGE (not `settingsSchema`):
 * EmDash's declarative `admin.settingsSchema` auto-renders a form, but that form
 * is only surfaced through the admin "Plugins" manager page, which first calls
 * the `/_emdash/api/admin/plugins` list endpoint. On this EmDash version that
 * endpoint 500s (a pre-existing core bug unrelated to this plugin — it throws
 * before our plugin is even reached), so a `settingsSchema` form never displays.
 *
 * So we use the same mechanism `emdash-smtp` uses instead: declare an
 * `admin.pages` entry (its own sidebar link + route) and a `routes.admin`
 * handler that renders a Block Kit form and persists values via `ctx.kv`. That
 * path has its own URL and never touches the broken list endpoint, so it works
 * today. The auth provider reads the saved values back at request time via
 * `getPluginSettings(SETTINGS_PLUGIN_ID)` (see route.ts + settings.ts).
 *
 * STORAGE LAYOUT: we write each field as its own kv key `settings:<field>`.
 * `ctx.kv.set("settings:x", v)` persists to the options table under
 * `plugin:<id>:settings:x` — exactly the prefix `getPluginSettings(<id>)` reads
 * back — so the admin page and the auth route agree on the same values with no
 * translation. (Verified against EmDash's createKVAccess + getPluginSettings.)
 *
 * SECURITY: secret fields are stored in the database (masked in the UI via
 * `secret_input`/`has_value`, not encrypted at rest), the same way emdash-smtp
 * stores its API key. See settings.ts for the full tradeoff note.
 */

import { definePlugin } from "emdash";

import {
	SETTINGS_ADMIN_PAGE_PATH,
	SETTINGS_KEYS,
	SETTINGS_PLUGIN_ID,
	SOCIAL_PROVIDERS,
	providerClientIdKey,
	providerClientSecretKey,
	readKvSettings,
	writeKvSettings,
} from "./settings.js";

// Keep in sync with the version reported by the descriptor factory.
export const SETTINGS_PLUGIN_VERSION = "0.1.0";

/** Block Kit form submit action ids. */
const SAVE_ACTION_ID = "save_auth";
/** One save action per social provider form, e.g. `save_social:google`. */
function socialSaveActionId(providerId: string): string {
	return `save_social:${providerId}`;
}

/** Minimal shape of the admin interaction payload we care about. */
interface AdminInteraction {
	type?: string;
	action_id?: string;
	values?: Record<string, unknown>;
}

/** A rendered admin page: Block Kit elements + optional toast. */
interface AdminPage {
	blocks: unknown[];
	toast?: { message: string; type: "info" | "success" | "error" };
}

/**
 * Build the settings page from the current saved values. Secret fields render
 * with `has_value` (never the value itself) so the UI shows "configured"
 * without exposing the secret.
 */
function buildSettingsPage(
	saved: Record<string, unknown>,
	toast?: AdminPage["toast"],
): AdminPage {
	const bool = (v: unknown) => v === true || v === "true" || v === "1" || v === "on";
	const str = (v: unknown) => (typeof v === "string" ? v : "");
	const hasVal = (v: unknown) => typeof v === "string" && v.trim() !== "";

	const blocks: unknown[] = [
		{ type: "header", text: "Better Auth" },
		{
			type: "context",
			text: "Configure Better Auth without redeploying. Blank fields fall back to the matching Worker env var (e.g. BETTER_AUTH_SECRET, BETTER_AUTH_URL, and per-provider <PROVIDER>_CLIENT_ID/SECRET), then to built-in defaults.",
		},
		{ type: "divider" },
		{
			type: "form",
			block_id: "better-auth-settings",
			fields: [
				{
					type: "toggle",
					action_id: SETTINGS_KEYS.requireEmailVerification,
					label: "Require email verification",
					description:
						"Block unverified accounts from signing in. Needs a working email provider (Settings → Email).",
					initial_value: bool(saved[SETTINGS_KEYS.requireEmailVerification]),
				},
				{
					type: "toggle",
					action_id: SETTINGS_KEYS.sendOnSignIn,
					label: "Re-send verification on sign-in",
					description: "Re-send the link when an unverified user tries to log in.",
					initial_value: bool(saved[SETTINGS_KEYS.sendOnSignIn]),
				},
				{
					type: "toggle",
					action_id: SETTINGS_KEYS.autoSignInAfterVerification,
					label: "Auto sign-in after verification",
					description: "Log the user in immediately when they click the verification link.",
					initial_value: bool(saved[SETTINGS_KEYS.autoSignInAfterVerification]),
				},
				{
					type: "text_input",
					action_id: SETTINGS_KEYS.baseUrl,
					label: "Canonical site URL",
					placeholder: "https://example.com",
					initial_value: str(saved[SETTINGS_KEYS.baseUrl]),
				},
				{
					type: "secret_input",
					action_id: SETTINGS_KEYS.betterAuthSecret,
					label: "Better Auth secret",
					has_value: hasVal(saved[SETTINGS_KEYS.betterAuthSecret]),
				},
			],
			submit: { label: "Save settings", action_id: SAVE_ACTION_ID },
		},
		{
			type: "context",
			text: "Security: secret fields are stored in the database (masked here, not encrypted at rest) — the same as other EmDash plugins. For the strongest posture on the session signing key, leave 'Better Auth secret' blank and keep BETTER_AUTH_SECRET as a Worker secret.",
		},
	];

	// --- Social sign-in providers (one stacked section each) ------------------
	// Callback/redirect URLs are built from the canonical base URL. If none is
	// saved yet, show a {your-site} placeholder so the operator still sees the
	// shape of the URL to register with the provider.
	const baseForCallback = str(saved[SETTINGS_KEYS.baseUrl]).replace(/\/+$/, "");
	const callbackBase = baseForCallback || "https://<your-site>";

	blocks.push({ type: "divider" });
	blocks.push({ type: "header", text: "Social sign-in" });
	blocks.push({
		type: "banner",
		title: "How social sign-in works",
		description:
			"Each provider turns on only when BOTH its client ID and secret are set (here, or via the matching env vars). Register the callback URL shown on each card in that provider's developer console.",
		variant: "default",
	});

	for (const provider of SOCIAL_PROVIDERS) {
		const idKey = providerClientIdKey(provider.id);
		const secretKey = providerClientSecretKey(provider.id);
		const callbackUrl = `${callbackBase}/api/auth/callback/${provider.id}`;
		const enabled = hasVal(saved[idKey]) && hasVal(saved[secretKey]);

		blocks.push({ type: "divider" });
		// A banner acts as a titled card grouping each provider.
		blocks.push({
			type: "banner",
			title: `${provider.label}${enabled ? " · enabled" : ""}`,
			description: `Authorized redirect URI (register this in the ${provider.label} console):\n${callbackUrl}`,
			variant: "default",
		});
		blocks.push({
			type: "form",
			block_id: `social-${provider.id}`,
			fields: [
				{
					type: "text_input",
					action_id: idKey,
					label: `${provider.label} client ID`,
					initial_value: str(saved[idKey]),
				},
				{
					type: "secret_input",
					action_id: secretKey,
					label: `${provider.label} client secret`,
					has_value: hasVal(saved[secretKey]),
				},
			],
			submit: {
				label: `Save ${provider.label}`,
				action_id: socialSaveActionId(provider.id),
			},
		});
	}

	return toast ? { blocks, toast } : { blocks };
}

/**
 * Native-format factory. EmDash calls this and expects a `ResolvedPlugin`.
 * Declares the sidebar admin page and the interaction handler backing it.
 */
export function createPlugin() {
	return definePlugin({
		id: SETTINGS_PLUGIN_ID,
		version: SETTINGS_PLUGIN_VERSION,
		admin: {
			pages: [{ path: SETTINGS_ADMIN_PAGE_PATH, label: "Better Auth", icon: "shield" }],
		},
		routes: {
			admin: {
				handler: async (routeCtx: {
					input?: AdminInteraction;
					kv: import("emdash").KVAccess;
				}): Promise<AdminPage> => {
					const interaction: AdminInteraction = routeCtx.input ?? {
						type: "page_load",
						// path echoed for parity with emdash-smtp; unused (single page).
					};

					// Any of our forms submitting persists via writeKvSettings, which
					// only touches the keys present in `values` (each form sends its
					// own subset), so a per-provider save doesn't disturb the others.
					const isCoreSave =
						interaction.type === "form_submit" &&
						interaction.action_id === SAVE_ACTION_ID;
					const isSocialSave =
						interaction.type === "form_submit" &&
						typeof interaction.action_id === "string" &&
						interaction.action_id.startsWith("save_social:");

					if (isCoreSave || isSocialSave) {
						await writeKvSettings(routeCtx.kv, interaction.values ?? {});
						const saved = await readKvSettings(routeCtx.kv);
						const label = isSocialSave
							? `${interaction.action_id!.split(":")[1]} settings saved.`
							: "Settings saved.";
						return buildSettingsPage(saved, { message: label, type: "success" });
					}

					// page_load (and any other interaction) -> render current state.
					const saved = await readKvSettings(routeCtx.kv);
					return buildSettingsPage(saved);
				},
			},
		},
	});
}

export default createPlugin;
