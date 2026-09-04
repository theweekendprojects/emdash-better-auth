/**
 * Better Auth admin-configurable settings.
 *
 * Single source of truth for the settings the companion EmDash plugin exposes
 * in the admin UI (a custom Block Kit page — see settings-plugin-entry.ts) and
 * that the auth route reads back at request time (via {@link resolveSettings}).
 *
 * WHY A COMPANION PLUGIN: Better Auth registers with EmDash as an
 * `AuthProviderDescriptor`, and that path has NO admin settings surface. Only
 * the full plugin system (`plugins: [...]` / `definePlugin`) can add admin UI.
 * So we ship a tiny second registration — a native plugin whose only job is to
 * own the settings page + storage. The auth provider reads those saved values
 * at runtime.
 *
 * WHY A CUSTOM PAGE (not `settingsSchema`): the declarative auto-rendered form
 * only shows in the admin "Plugins" manager, which is broken by a pre-existing
 * core bug (the plugin-list endpoint 500s). So we render our own Block Kit page
 * via `admin.pages` + `routes.admin`, like `emdash-smtp` does — its own sidebar
 * link + route, which sidesteps the broken list endpoint.
 *
 * STORAGE LAYOUT: each field is stored as its own kv key `settings:<field>`
 * (via `ctx.kv` in the admin page). `ctx.kv` persists to the options table
 * under `plugin:<id>:settings:<field>` — the exact prefix
 * `getPluginSettings(<id>)` reads back — so the admin page and the auth route
 * see the same flat `{ field: value }` map with no translation.
 *
 * PRECEDENCE: saved admin settings win over Worker env vars, which win over
 * built-in defaults. Env vars remain a working fallback so the site keeps
 * functioning before anything is saved.
 *
 * SECRETS TRADEOFF: secret values (incl. `betterAuthSecret`,
 * `googleClientSecret`) are stored in the DB as plaintext — the masked
 * `secret_input` field only hides them in the UI, it does not encrypt at rest.
 * Same as how `emdash-smtp` stores its API key. `betterAuthSecret` is the
 * session signing key; if the database leaks, sessions can be forged. Accepted
 * tradeoff pending an EmDash feature for encrypted secrets — until then,
 * keeping `BETTER_AUTH_SECRET` as a Worker secret (leave the admin field blank)
 * is the stronger posture.
 */

import type { KVAccess } from "emdash";

/** Plugin id that owns the settings form + storage namespace. */
export const SETTINGS_PLUGIN_ID = "better-auth-settings";

/**
 * Relative path for the settings admin page. Becomes the sidebar link
 * `/_emdash/admin/plugins/better-auth-settings/settings`.
 */
export const SETTINGS_ADMIN_PAGE_PATH = "/settings";

/**
 * OAuth social providers this plugin exposes in the admin UI, in display
 * order. Data-driven so adding a provider is a one-line change here (plus the
 * `SocialProviderId` union + mapping in auth.ts). Each provider contributes two
 * settings keys — `<id>ClientId` and `<id>ClientSecret` — and reads env
 * fallbacks `<ENV>_CLIENT_ID` / `<ENV>_CLIENT_SECRET`.
 *
 * `id` must match Better Auth's native provider id (it's also the OAuth
 * callback path segment: `/api/auth/callback/<id>`).
 */
export const SOCIAL_PROVIDERS = [
	{ id: "google", label: "Google", envPrefix: "GOOGLE" },
	{ id: "github", label: "GitHub", envPrefix: "GITHUB" },
] as const;

export type SocialProviderId = (typeof SOCIAL_PROVIDERS)[number]["id"];

/** kv/setting key for a provider's client id, e.g. `googleClientId`. */
export function providerClientIdKey(id: string): string {
	return `${id}ClientId`;
}
/** kv/setting key for a provider's client secret, e.g. `googleClientSecret`. */
export function providerClientSecretKey(id: string): string {
	return `${id}ClientSecret`;
}

/**
 * Non-social setting keys. Social keys are derived from SOCIAL_PROVIDERS.
 * Kept as a const object so callers reference the same string literals.
 */
export const SETTINGS_KEYS = {
	requireEmailVerification: "requireEmailVerification",
	sendOnSignIn: "sendOnSignIn",
	autoSignInAfterVerification: "autoSignInAfterVerification",
	baseUrl: "baseUrl",
	betterAuthSecret: "betterAuthSecret",
} as const;

/**
 * Built-in defaults, applied when neither a saved setting nor an env var is
 * present. Must be applied in code: `getPluginSetting` returns `undefined` for
 * unset keys.
 */
export const SETTINGS_DEFAULTS = {
	requireEmailVerification: true,
	sendOnSignIn: true,
	autoSignInAfterVerification: true,
} as const;

/** Boolean-typed setting keys (rendered as toggles, coerced on read). */
const BOOLEAN_KEYS = [
	SETTINGS_KEYS.requireEmailVerification,
	SETTINGS_KEYS.sendOnSignIn,
	SETTINGS_KEYS.autoSignInAfterVerification,
] as const;

/** Secret-typed setting keys (masked in UI; preserved on save when blank). */
const SECRET_KEYS: readonly string[] = [
	SETTINGS_KEYS.betterAuthSecret,
	...SOCIAL_PROVIDERS.map((p) => providerClientSecretKey(p.id)),
];

/** Plain-text setting keys. */
const TEXT_KEYS: readonly string[] = [
	SETTINGS_KEYS.baseUrl,
	...SOCIAL_PROVIDERS.map((p) => providerClientIdKey(p.id)),
];

/**
 * Read every saved setting from plugin kv into a flat `{ field: value }` map.
 * Each field is its own kv key `settings:<field>`, matching the layout
 * `getPluginSettings(SETTINGS_PLUGIN_ID)` reads (so the auth route sees the
 * same values). Missing keys are simply absent from the map.
 */
export async function readKvSettings(kv: KVAccess): Promise<Record<string, unknown>> {
	const allKeys = [...BOOLEAN_KEYS, ...SECRET_KEYS, ...TEXT_KEYS];
	const out: Record<string, unknown> = {};
	for (const key of allKeys) {
		const value = await kv.get<unknown>(`settings:${key}`);
		if (value !== null && value !== undefined) out[key] = value;
	}
	return out;
}

/**
 * Persist submitted form values to plugin kv.
 *
 * IMPORTANT: only keys ACTUALLY PRESENT in `values` are touched. The admin UI
 * has multiple forms (core settings + one per social provider), and each form
 * submits only its own fields — so a provider save must not reset the toggles
 * or another provider's keys just because they're absent from this payload.
 *
 * Per key type (when present):
 * - Booleans: coerced and written.
 * - Text: write trimmed value, or delete the key when explicitly cleared.
 * - Secrets: only overwrite when a new value was typed; a blank/absent secret
 *   leaves the stored value untouched (the masked input sends nothing when the
 *   operator didn't change it). Mirrors emdash-smtp.
 */
export async function writeKvSettings(
	kv: KVAccess,
	values: Record<string, unknown>,
): Promise<void> {
	for (const key of BOOLEAN_KEYS) {
		if (!(key in values)) continue;
		await kv.set(`settings:${key}`, coerceBool(values[key], false));
	}
	for (const key of TEXT_KEYS) {
		if (!(key in values)) continue;
		const next = trimOrUndefined(values[key]);
		if (next !== undefined) await kv.set(`settings:${key}`, next);
		else await kv.delete(`settings:${key}`);
	}
	for (const key of SECRET_KEYS) {
		if (!(key in values)) continue;
		const next = trimOrUndefined(values[key]);
		// Only update when a new secret was entered; blank = keep existing.
		if (next !== undefined) await kv.set(`settings:${key}`, next);
	}
}

/** A single provider's resolved credentials. */
export interface ResolvedProviderCreds {
	clientId: string;
	clientSecret: string;
}

/** Resolved, typed Better Auth configuration after merging all sources. */
export interface ResolvedAuthSettings {
	requireEmailVerification: boolean;
	sendOnSignIn: boolean;
	autoSignInAfterVerification: boolean;
	/** Canonical origin override, or undefined to let the route resolve it. */
	baseUrl?: string;
	/** Session signing secret, or undefined to fall back to env. */
	secret?: string;
	/**
	 * Configured social providers (only those with BOTH id + secret present),
	 * keyed by provider id. Empty when none are configured.
	 */
	socialProviders: Partial<Record<SocialProviderId, ResolvedProviderCreds>>;
}

/** Raw env values the resolver may fall back to (all optional). */
export interface AuthEnvFallback {
	secret?: string;
	baseUrl?: string;
	/**
	 * Per-provider env credentials, keyed by provider id, e.g.
	 * `{ google: { clientId, clientSecret }, github: {...} }`. Assembled by the
	 * caller from `<PREFIX>_CLIENT_ID` / `<PREFIX>_CLIENT_SECRET` env vars.
	 */
	social?: Partial<Record<SocialProviderId, Partial<ResolvedProviderCreds>>>;
}

/** Placeholder secret value from the template — treated as "not set". */
const PLACEHOLDER_SECRET = "PASTE_YOUR_CLIENT_SECRET_HERE";

function trimOrUndefined(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Coerce a stored/env setting into a boolean, tolerating the string values
 * EmDash's form persistence may produce ("true"/"false"/"1"/"0").
 */
function coerceBool(value: unknown, fallback: boolean): boolean {
	if (typeof value === "boolean") return value;
	if (typeof value === "string") {
		const v = value.trim().toLowerCase();
		if (v === "true" || v === "1" || v === "on" || v === "yes") return true;
		if (v === "false" || v === "0" || v === "off" || v === "no") return false;
	}
	if (typeof value === "number") return value !== 0;
	return fallback;
}

/**
 * Merge saved admin settings over env fallbacks over built-in defaults into a
 * single typed config. Pure and synchronous so it's trivial to unit-test; the
 * async DB read (`getPluginSettings`) happens in the caller (the auth route).
 *
 * For each social provider, credentials resolve saved-over-env per field, and
 * the provider is only included when BOTH resolved id and secret are present.
 * A placeholder secret (the template's PASTE_YOUR_... value) is treated as
 * "not set" so a provider stays disabled until real credentials exist.
 */
export function resolveSettings(
	saved: Record<string, unknown>,
	env: AuthEnvFallback,
): ResolvedAuthSettings {
	const requireEmailVerification = coerceBool(
		saved[SETTINGS_KEYS.requireEmailVerification],
		SETTINGS_DEFAULTS.requireEmailVerification,
	);
	const sendOnSignIn = coerceBool(
		saved[SETTINGS_KEYS.sendOnSignIn],
		SETTINGS_DEFAULTS.sendOnSignIn,
	);
	const autoSignInAfterVerification = coerceBool(
		saved[SETTINGS_KEYS.autoSignInAfterVerification],
		SETTINGS_DEFAULTS.autoSignInAfterVerification,
	);

	const baseUrl =
		trimOrUndefined(saved[SETTINGS_KEYS.baseUrl]) ?? trimOrUndefined(env.baseUrl);

	const secret =
		trimOrUndefined(saved[SETTINGS_KEYS.betterAuthSecret]) ??
		trimOrUndefined(env.secret);

	const socialProviders: Partial<Record<SocialProviderId, ResolvedProviderCreds>> = {};
	for (const provider of SOCIAL_PROVIDERS) {
		const envCreds = env.social?.[provider.id];
		const clientId =
			trimOrUndefined(saved[providerClientIdKey(provider.id)]) ??
			trimOrUndefined(envCreds?.clientId);
		let clientSecret =
			trimOrUndefined(saved[providerClientSecretKey(provider.id)]) ??
			trimOrUndefined(envCreds?.clientSecret);
		if (clientSecret === PLACEHOLDER_SECRET) clientSecret = undefined;
		if (clientId && clientSecret) {
			socialProviders[provider.id] = { clientId, clientSecret };
		}
	}

	return {
		requireEmailVerification,
		sendOnSignIn,
		autoSignInAfterVerification,
		baseUrl,
		secret,
		socialProviders,
	};
}
