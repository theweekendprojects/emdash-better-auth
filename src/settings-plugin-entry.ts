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
 * SECURITY (authorization): the `routes.admin` handler below reads/writes the
 * Better Auth secret and OAuth credentials, so it is declared with
 * `permission: "plugins:manage"` (= Role.ADMIN). EmDash enforces that at the
 * `/_emdash/api/plugins/<id>/admin` API layer via `requirePerm`, so only admins
 * can read or change these values; lower roles get 403. The admin page shell is
 * only login-gated, but no sensitive data is exposed there — every read/write
 * goes through the guarded route. See the route declaration for the full note.
 *
 * SECURITY (at rest): secret fields are stored in the database (masked in the
 * UI via `secret_input`/`has_value`, not encrypted at rest), the same way
 * emdash-smtp stores its API key. See settings.ts for the full tradeoff note.
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

// Keep in sync with the version reported by the descriptor factory
// (betterAuthSettingsPlugin in index.ts) and the package version.
export const SETTINGS_PLUGIN_VERSION = "0.7.0";

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
			// Fields are grouped by concern for readability: email verification
			// first, then feature-plugin toggles, then billing (toggle + keys),
			// then the identity-provider toggle, then branding, then the signing
			// secret last. This is a single form (one Save) — Block Kit forms hold
			// only inputs, so the grouping is by order; the identity + username
			// status cues live in the context blocks after the form.
			fields: [
				// --- Email verification -------------------------------------------
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
				// --- Feature plugins ----------------------------------------------
				{
					type: "toggle",
					action_id: SETTINGS_KEYS.twoFactorEnabled,
					label: "Enable two-factor authentication (TOTP)",
					description:
						"Allow users to enable TOTP 2FA via their account settings. When enabled, users can enroll with an authenticator app and use backup codes for recovery.",
					initial_value: bool(saved[SETTINGS_KEYS.twoFactorEnabled]),
				},
				{
					type: "toggle",
					action_id: SETTINGS_KEYS.passkeyEnabled,
					label: "Enable passkey sign-in (WebAuthn)",
					description:
						"Allow passwordless sign-in with device biometrics or security keys (Touch ID, Face ID, Windows Hello). Users register and manage passkeys from their account settings; the login page shows a 'Sign in with a passkey' button.",
					initial_value: bool(saved[SETTINGS_KEYS.passkeyEnabled]),
				},
				{
					type: "toggle",
					action_id: SETTINGS_KEYS.apiKeyEnabled,
					label: "Enable API keys",
					description:
						"Let users create, copy, and revoke programmatic API keys from an account security card. Keys are stored hashed; the raw key is shown only once at creation.",
					initial_value: bool(saved[SETTINGS_KEYS.apiKeyEnabled]),
				},
				{
					type: "toggle",
					action_id: SETTINGS_KEYS.adminEnabled,
					label: "Enable admin user management",
					description:
						"Registers the Better Auth admin plugin: create users, ban/unban, impersonate, and assign an auth role. Stored alongside each EmDash user; does not change EmDash's own role levels.",
					initial_value: bool(saved[SETTINGS_KEYS.adminEnabled]),
				},
				{
					type: "toggle",
					action_id: SETTINGS_KEYS.orgEnabled,
					label: "Enable organizations (multi-tenancy)",
					description:
						"Registers the Better Auth organization plugin: users can create organizations, invite members, and switch between them. No database migration required.",
					initial_value: bool(saved[SETTINGS_KEYS.orgEnabled]),
				},
				{
					type: "toggle",
					action_id: SETTINGS_KEYS.teamsEnabled,
					label: "Enable organization teams",
					description:
						"Adds teams within each organization. Only takes effect when 'Enable organizations' is on — it has no effect otherwise.",
					initial_value: bool(saved[SETTINGS_KEYS.teamsEnabled]),
				},
				// --- Identity provider (OIDC / OAuth 2.1) -------------------------
				{
					type: "toggle",
					action_id: SETTINGS_KEYS.oidcProviderEnabled,
					label: "Enable OIDC / OAuth 2.1 identity provider",
					description:
						"Turn this site into an OpenID Connect provider so other applications can let users 'Sign in with " +
						"this site'. Registers the JWT + OAuth provider plugins; discovery is served at /api/auth/.well-known/openid-configuration. " +
						"Users manage authorized apps from their account; OAuth clients are created from the account 'OAuth clients' tab.",
					initial_value: bool(saved[SETTINGS_KEYS.oidcProviderEnabled]),
				},
				// --- Passwordless sign-in -----------------------------------------
				{
					type: "toggle",
					action_id: SETTINGS_KEYS.magicLinkEnabled,
					label: "Enable magic-link sign-in",
					description:
						"Passwordless sign-in: the user enters their email and receives a one-click sign-in link. Needs a working email provider (Settings → Email).",
					initial_value: bool(saved[SETTINGS_KEYS.magicLinkEnabled]),
				},
				{
					type: "toggle",
					action_id: SETTINGS_KEYS.emailOtpEnabled,
					label: "Enable email one-time codes (OTP)",
					description:
						"Passwordless sign-in, email verification, and password reset via a short code emailed to the user. Needs a working email provider (Settings → Email).",
					initial_value: bool(saved[SETTINGS_KEYS.emailOtpEnabled]),
				},
				{
					type: "toggle",
					action_id: SETTINGS_KEYS.anonymousEnabled,
					label: "Enable guest (anonymous) sessions",
					description:
						"Show a 'Continue as guest' button so visitors can get an authenticated session without signing up, then link a real account later. Guest users have no username until they claim one.",
					initial_value: bool(saved[SETTINGS_KEYS.anonymousEnabled]),
				},
				// --- Sessions -----------------------------------------------------
				{
					type: "toggle",
					action_id: SETTINGS_KEYS.multiSessionEnabled,
					label: "Enable multiple accounts per browser",
					description:
						"Let a browser stay signed in to several accounts at once and switch between them from the user menu. The admin session always follows the active account.",
					initial_value: bool(saved[SETTINGS_KEYS.multiSessionEnabled]),
				},
				// --- Security -----------------------------------------------------
				{
					type: "toggle",
					action_id: SETTINGS_KEYS.hibpEnabled,
					label: "Reject breached passwords (Have I Been Pwned)",
					description:
						"Block passwords found in known data breaches at sign-up and password change. Only the first 5 characters of the password's SHA-1 hash are sent to the HIBP range API — the password itself never leaves the server.",
					initial_value: bool(saved[SETTINGS_KEYS.hibpEnabled]),
				},
				{
					type: "toggle",
					action_id: SETTINGS_KEYS.genericOAuthEnabled,
					label: "Enable extra OAuth / OIDC providers",
					description:
						"Register additional sign-in providers (Keycloak, Okta, Auth0, Microsoft Entra, …) defined in the GENERIC_OAUTH_CONFIG Worker env var (a JSON array). Has no effect until at least one provider is configured there.",
					initial_value: bool(saved[SETTINGS_KEYS.genericOAuthEnabled]),
				},
				// --- Subscription billing (Stripe) --------------------------------
				{
					type: "toggle",
					action_id: SETTINGS_KEYS.billingEnabled,
					label: "Enable subscription billing (Stripe)",
					description:
						"Registers the Better Auth Stripe plugin and adds a Billing tab to each user's account. Requires the Stripe secret key and webhook secret below, plus plans configured in the site's auth config.",
					initial_value: bool(saved[SETTINGS_KEYS.billingEnabled]),
				},
				{
					type: "secret_input",
					action_id: SETTINGS_KEYS.stripeSecretKey,
					label: "Stripe secret key",
					has_value: hasVal(saved[SETTINGS_KEYS.stripeSecretKey]),
				},
				{
					type: "secret_input",
					action_id: SETTINGS_KEYS.stripeWebhookSecret,
					label: "Stripe webhook signing secret",
					has_value: hasVal(saved[SETTINGS_KEYS.stripeWebhookSecret]),
				},
				{
					type: "text_input",
					action_id: SETTINGS_KEYS.baseUrl,
					label: "Canonical site URL",
					placeholder: "https://example.com",
					initial_value: str(saved[SETTINGS_KEYS.baseUrl]),
				},
				{
					type: "text_input",
					action_id: SETTINGS_KEYS.accentColor,
					label: "Accent color",
					placeholder: "#0066cc",
					description:
						"Any CSS color (hex, rgb, oklch). Themes the login, account, admin, and organization pages to match your brand. Leave blank for the default blue.",
					initial_value: str(saved[SETTINGS_KEYS.accentColor]),
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
		{
			type: "context",
			// Username is always on (no toggle) — recorded here so it's visible.
			text: "Always on: every account has a required username (public identity used for bylines and username sign-in). Email stays required for recovery and is never shown publicly.",
		},
		{
			type: "context",
			text: `Billing (Stripe): after enabling, register a webhook in your Stripe dashboard pointing at ${str(saved[SETTINGS_KEYS.baseUrl]).replace(/\/+$/, "") || "https://<your-site>"}/api/auth/stripe/webhook for the events checkout.session.completed, customer.subscription.created, .updated, and .deleted — then paste its signing secret above. Plans (price IDs) are set in the site's auth config.`,
		},
		{
			type: "context",
			text: `Identity provider (OIDC): when enabled, discovery is at ${str(saved[SETTINGS_KEYS.baseUrl]).replace(/\/+$/, "") || "https://<your-site>"}/api/auth/.well-known/openid-configuration and the OAuth endpoints under /api/auth/oauth2/*. Register client redirect URIs from the account 'OAuth clients' tab. Leaving the "Better Auth secret" blank (Worker secret) is strongly recommended here — it signs the ID tokens.`,
		},
	];

	// --- Status hints: flag a toggle that's ON but inert (missing deps) -------
	// A feature can be enabled yet do nothing because a prerequisite is missing
	// (billing needs Stripe keys + plan price ids; teams need orgs). The toggle
	// shows ON but the feature stays off, which is confusing. Surface the gap.
	const statusWarnings: string[] = [];
	if (bool(saved[SETTINGS_KEYS.billingEnabled]) && !hasVal(saved[SETTINGS_KEYS.stripeSecretKey])) {
		statusWarnings.push(
			"Billing is enabled but no Stripe secret key is set (here or via STRIPE_SECRET_KEY) — billing stays inactive until it is, plus a webhook secret and at least one plan price id.",
		);
	}
	if (bool(saved[SETTINGS_KEYS.teamsEnabled]) && !bool(saved[SETTINGS_KEYS.orgEnabled])) {
		statusWarnings.push(
			"Organization teams is enabled but organizations is off — teams has no effect until you also enable organizations.",
		);
	}
	if (bool(saved[SETTINGS_KEYS.genericOAuthEnabled])) {
		statusWarnings.push(
			"Extra OAuth / OIDC providers is enabled — it does nothing until the GENERIC_OAUTH_CONFIG Worker env var contains at least one provider (a JSON array with providerId + clientId).",
		);
	}

	for (const text of statusWarnings) {
		blocks.push({ type: "banner", title: "Heads up", description: text, variant: "warning" });
	}

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
				// ADMIN-ONLY GATE. This handler reads and writes the Better Auth
				// secret + OAuth client credentials, so it must never be reachable
				// by lower-privilege roles (subscriber/contributor/author/editor).
				//
				// EmDash gates a private plugin route at the API layer: the
				// `/_emdash/api/plugins/<id>/admin` catch-all runs
				// `requirePerm(user, route.permission ?? "plugins:manage")` before
				// this handler. `plugins:manage` = Role.ADMIN (50), so non-admins
				// get 403 and can neither read nor change these values. (The admin
				// *page shell* is only login-gated, but nothing sensitive happens
				// there — all reads/writes go through this guarded route.)
				//
				// We set `permission` EXPLICITLY rather than relying on the default
				// so the admin-only intent is self-documenting and survives any
				// future change to EmDash's default. Do NOT add `public: true` or
				// lower this permission, and do NOT move credential logic into an
				// SSR page render — either would bypass the RBAC gate.
				permission: "plugins:manage",
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
