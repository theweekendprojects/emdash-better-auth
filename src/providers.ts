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

import { getPluginSettings } from "emdash";
import { env } from "cloudflare:workers";

import {
	SETTINGS_PLUGIN_ID,
	SOCIAL_PROVIDERS,
	resolveSettings,
	type AuthEnvFallback,
} from "./settings.js";

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
