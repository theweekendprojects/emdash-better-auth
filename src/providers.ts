/**
 * Server-only helper: which social providers are enabled at runtime.
 *
 * Returns the provider ids (e.g. `["google", "github"]`) whose credentials are
 * fully configured, so the auth pages show a button only for enabled
 * providers. This mirrors EXACTLY what the auth route enables — same source of
 * truth (`resolveSettings` over `SOCIAL_PROVIDERS`), same precedence (saved
 * admin settings > Worker env), same both-credentials guard — so the buttons
 * never disagree with the backend.
 *
 * Kept in its own module (importing `cloudflare:workers`) so the client island
 * never pulls in the Worker env binding.
 */

import { getPluginSettings, getSiteSettings } from "emdash";
import { env } from "cloudflare:workers";

import {
	SETTINGS_PLUGIN_ID,
	SOCIAL_PROVIDERS,
	resolveSettings,
	type AuthEnvFallback,
} from "./settings.js";
import { PLAN_DEFINITIONS } from "./billing-plans.js";

/**
 * Build the per-provider env-credentials fallback map, keyed by provider id,
 * from `<PREFIX>_CLIENT_ID` / `<PREFIX>_CLIENT_SECRET` — the same shape the
 * auth route assembles.
 */
function readSocialEnv(): AuthEnvFallback["social"] {
	const workerEnv = env as Record<string, string | undefined>;
	const social: AuthEnvFallback["social"] = {};
	for (const provider of SOCIAL_PROVIDERS) {
		social[provider.id] = {
			clientId: workerEnv[`${provider.envPrefix}_CLIENT_ID`],
			clientSecret: workerEnv[`${provider.envPrefix}_CLIENT_SECRET`],
		};
	}
	return social;
}

/**
 * Parse the GENERIC_OAUTH_CONFIG env var — a JSON array of provider configs —
 * into a typed list. Operator config (not a toggle), supplied as a single env
 * var so multiple providers can be added without code changes. Malformed JSON
 * or a non-array degrades to an empty list (the plugin then stays inert) rather
 * than throwing. Shared by this module and route.ts via the same env name.
 */
function readGenericOAuthEnv(): import("./settings.js").GenericOAuthProviderConfig[] {
	const raw = (env as Record<string, string | undefined>).GENERIC_OAUTH_CONFIG;
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

/**
 * Returns the ids of social providers with valid credentials configured
 * (admin settings or env), for the auth UI's `socialProviders` prop.
 *
 * Async because it reads the saved admin settings. Never throws — a settings
 * read failure degrades to env-only so the auth page always renders.
 */
export async function configuredSocialProviders(): Promise<string[]> {
	let saved: Record<string, unknown> = {};
	try {
		saved = await getPluginSettings(SETTINGS_PLUGIN_ID);
	} catch {
		// No DB / settings unavailable — fall back to env-only resolution.
	}
	const settings = resolveSettings(saved, { social: readSocialEnv() });
	return Object.keys(settings.socialProviders);
}

/**
 * Whether two-factor authentication (TOTP) is enabled site-wide, for the auth
 * UI's `twoFactorPlugin` gating. Uses the SAME source of truth and precedence
 * as the auth route (`resolveSettings` over saved admin settings > env >
 * default-false), so the account page's 2FA card and the login challenge only
 * render when the backend actually registers the `twoFactor` plugin. Never
 * throws — a settings read failure degrades to the default (off).
 */
export async function twoFactorEnabled(): Promise<boolean> {
	let saved: Record<string, unknown> = {};
	try {
		saved = await getPluginSettings(SETTINGS_PLUGIN_ID);
	} catch {
		// No DB / settings unavailable — fall back to the built-in default (off).
	}
	return resolveSettings(saved, {}).twoFactorEnabled;
}

/**
 * Whether the API key plugin is enabled site-wide, for the account UI's
 * `apiKeyPlugin` gating. Same source of truth and precedence as the auth route,
 * so the account "API Keys" card only renders when the backend `apiKey()`
 * plugin is actually registered. Never throws — degrades to the default (off).
 */
export async function apiKeyEnabled(): Promise<boolean> {
	let saved: Record<string, unknown> = {};
	try {
		saved = await getPluginSettings(SETTINGS_PLUGIN_ID);
	} catch {
		// Settings unavailable — default off.
	}
	return resolveSettings(saved, {}).apiKeyEnabled;
}

/**
 * Whether the passkey (WebAuthn) plugin is enabled site-wide, for the auth +
 * account UI's `passkeyPlugin` gating. Same source of truth and precedence as
 * the auth route, so the login page's "Sign in with a passkey" button and the
 * account "Passkeys" card only render when the backend `passkey()` plugin is
 * registered. Never throws — degrades to the default (off).
 */
export async function passkeyEnabled(): Promise<boolean> {
	let saved: Record<string, unknown> = {};
	try {
		saved = await getPluginSettings(SETTINGS_PLUGIN_ID);
	} catch {
		// Settings unavailable — default off.
	}
	return resolveSettings(saved, {}).passkeyEnabled;
}

/**
 * Whether the admin user-management plugin is enabled site-wide. Same source of
 * truth and precedence as the auth route, so the admin UI pages only render
 * (and only register the UI `adminPlugin`) when the backend `admin()` plugin is
 * actually registered. Never throws — degrades to the default (off).
 */
export async function adminEnabled(): Promise<boolean> {
	let saved: Record<string, unknown> = {};
	try {
		saved = await getPluginSettings(SETTINGS_PLUGIN_ID);
	} catch {
		// Settings unavailable — default off.
	}
	return resolveSettings(saved, {}).adminEnabled;
}

/**
 * Whether the organization (multi-tenancy) plugin is enabled site-wide. Same
 * source of truth/precedence as the auth route, so the org UI pages and
 * switcher only render when the backend `organization()` plugin is registered.
 * Never throws — degrades to the default (off).
 */
export async function orgEnabled(): Promise<boolean> {
	let saved: Record<string, unknown> = {};
	try {
		saved = await getPluginSettings(SETTINGS_PLUGIN_ID);
	} catch {
		// Settings unavailable — default off.
	}
	return resolveSettings(saved, {}).orgEnabled;
}

/**
 * Whether organization teams are enabled site-wide. `resolveSettings` already
 * forces this false unless organizations are on, so it mirrors exactly what the
 * auth route registers. Gates the Teams tab in the org UI. Never throws.
 */
export async function teamsEnabled(): Promise<boolean> {
	let saved: Record<string, unknown> = {};
	try {
		saved = await getPluginSettings(SETTINGS_PLUGIN_ID);
	} catch {
		// Settings unavailable — default off.
	}
	return resolveSettings(saved, {}).teamsEnabled;
}

/**
 * Whether the OIDC / OAuth 2.1 provider is enabled site-wide. Same source of
 * truth/precedence as the auth route, so the OAuth UI (consent / sign-up views
 * and the "Connected applications" + client-management cards) only renders when
 * the backend `oauthProvider()` plugin is registered. Never throws — default off.
 */
export async function oidcProviderEnabled(): Promise<boolean> {
	let saved: Record<string, unknown> = {};
	try {
		saved = await getPluginSettings(SETTINGS_PLUGIN_ID);
	} catch {
		// Settings unavailable — default off.
	}
	return resolveSettings(saved, {}).oidcProviderEnabled;
}

/**
 * Whether magic-link sign-in is enabled site-wide. Gates the Better Auth UI
 * magic-link plugin on the auth island so the "email me a link" view matches
 * the backend. Never throws — default off.
 */
export async function magicLinkEnabled(): Promise<boolean> {
	let saved: Record<string, unknown> = {};
	try {
		saved = await getPluginSettings(SETTINGS_PLUGIN_ID);
	} catch {
		// Settings unavailable — default off.
	}
	return resolveSettings(saved, {}).magicLinkEnabled;
}

/**
 * Whether email-OTP (passwordless emailed code) is enabled site-wide. Gates the
 * Better Auth UI email-otp plugin on the auth island. Never throws — default off.
 */
export async function emailOtpEnabled(): Promise<boolean> {
	let saved: Record<string, unknown> = {};
	try {
		saved = await getPluginSettings(SETTINGS_PLUGIN_ID);
	} catch {
		// Settings unavailable — default off.
	}
	return resolveSettings(saved, {}).emailOtpEnabled;
}

/**
 * Whether anonymous (guest) sign-in is enabled site-wide. Gates the "Continue
 * as guest" button on the auth island. Never throws — default off.
 */
export async function anonymousEnabled(): Promise<boolean> {
	let saved: Record<string, unknown> = {};
	try {
		saved = await getPluginSettings(SETTINGS_PLUGIN_ID);
	} catch {
		// Settings unavailable — default off.
	}
	return resolveSettings(saved, {}).anonymousEnabled;
}

/**
 * Whether multi-session (multiple concurrent accounts per browser) is enabled
 * site-wide. Gates the Better Auth UI multi-session plugin on both islands (the
 * account switcher in the UserButton). Never throws — default off.
 */
export async function multiSessionEnabled(): Promise<boolean> {
	let saved: Record<string, unknown> = {};
	try {
		saved = await getPluginSettings(SETTINGS_PLUGIN_ID);
	} catch {
		// Settings unavailable — default off.
	}
	return resolveSettings(saved, {}).multiSessionEnabled;
}

/**
 * Generic OAuth provider ids that are enabled (flag on AND the provider config
 * resolves). Fed into the auth UI's `socialProviders` list alongside the
 * built-in social ids, so each extra provider renders a sign-in button. Never
 * throws — degrades to an empty list.
 */
export async function genericOAuthProviderIds(): Promise<string[]> {
	let saved: Record<string, unknown> = {};
	try {
		saved = await getPluginSettings(SETTINGS_PLUGIN_ID);
	} catch {
		// Settings unavailable — env-only resolution still works.
	}
	const settings = resolveSettings(saved, { genericOAuthConfig: readGenericOAuthEnv() });
	return settings.genericOAuthEnabled
		? settings.genericOAuthConfig.map((c) => c.providerId)
		: [];
}

/**
 * Whether audit logging is enabled site-wide. Gates the admin audit-log page
 * and the per-user "Recent activity" card so they only render when the backend
 * `auditLog()` plugin is registered. Never throws — default off.
 */
export async function auditLogEnabled(): Promise<boolean> {
	let saved: Record<string, unknown> = {};
	try {
		saved = await getPluginSettings(SETTINGS_PLUGIN_ID);
	} catch {
		// Settings unavailable — default off.
	}
	return resolveSettings(saved, {}).auditLogEnabled;
}

/**
 * Whether Stripe subscription billing is enabled site-wide. Same source of
 * truth/precedence as the auth route, so the Billing tab only renders when the
 * backend Stripe plugin is actually registered. Never throws — default off.
 */
export async function billingEnabled(): Promise<boolean> {
	let saved: Record<string, unknown> = {};
	try {
		saved = await getPluginSettings(SETTINGS_PLUGIN_ID);
	} catch {
		// Settings unavailable — default off.
	}
	return resolveSettings(saved, {}).billingEnabled;
}

/** Default accent when the operator hasn't set one — a neutral, legible blue. */
export const DEFAULT_ACCENT_COLOR = "#0066cc";

/**
 * The accent color used to theme the HeroUI auth/account/admin/org pages.
 * Operator-configurable (admin settings); falls back to {@link DEFAULT_ACCENT_COLOR}.
 * EmDash exposes no site brand color, so this is the plugin's own setting.
 * Never throws — a settings read failure degrades to the default.
 */
export async function accentColor(): Promise<string> {
	let saved: Record<string, unknown> = {};
	try {
		saved = await getPluginSettings(SETTINGS_PLUGIN_ID);
	} catch {
		// Settings unavailable — use the default.
	}
	return resolveSettings(saved, {}).accentColor ?? DEFAULT_ACCENT_COLOR;
}

/**
 * The site's logo URL for the auth-page header, or null when none is set.
 * Reads EmDash's site settings (the one brand asset EmDash does expose). Never
 * throws — a read failure just means no logo (the text site name is the
 * fallback in the island).
 */
export async function siteLogoUrl(): Promise<string | null> {
	try {
		const settings = await getSiteSettings();
		return settings?.logo?.url ?? null;
	} catch {
		return null;
	}
}

/**
 * Resolve each plan's Stripe price ids from env, keyed by plan id. Mirrors
 * `readPlanPriceIds` in route.ts (same `STRIPE_PRICE_<PLAN>_MONTH/_YEAR`
 * convention) so the account page's Billing tab shows exactly the plans the
 * server will accept at checkout. Price ids are NOT secret, so it's safe to
 * forward these to the client island.
 */
export function planPriceIds(): Record<string, { month: string; year?: string } | undefined> {
	const workerEnv = env as Record<string, string | undefined>;
	const out: Record<string, { month: string; year?: string } | undefined> = {};
	for (const def of PLAN_DEFINITIONS) {
		const key = def.id.toUpperCase();
		const month = workerEnv[`STRIPE_PRICE_${key}_MONTH`];
		const year = workerEnv[`STRIPE_PRICE_${key}_YEAR`];
		if (month) out[def.id] = year ? { month, year } : { month };
	}
	return out;
}
