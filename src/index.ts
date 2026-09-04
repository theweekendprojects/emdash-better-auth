/**
 * Better-Auth plugin for EmDash CMS.
 *
 * Registers Better-Auth as an EmDash `AuthProviderDescriptor`. Sign-ups and
 * sign-ins create real EmDash users (in the `users` table), so a Better-Auth
 * account is a first-class EmDash user visible in the admin and governed by
 * EmDash RBAC. Better-Auth's own session/account/verification state lives in
 * EmDash plugin storage (`getAuthProviderStorage`), so the plugin is portable
 * across EmDash sites with no hand-written database migrations.
 *
 * @example
 * ```ts
 * // astro.config.mjs
 * import { betterAuthProvider } from "emdash-better-auth";
 *
 * emdash({
 *   authProviders: [betterAuthProvider()],
 * });
 * ```
 *
 * Worker env vars / secrets (all optional except the secret; each can also be
 * set from the admin settings page when `betterAuthSettingsPlugin()` is used):
 *   - BETTER_AUTH_SECRET                       (required; `openssl rand -base64 32`)
 *   - GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET  (enables Google sign-in)
 *   - GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET  (enables GitHub sign-in)
 *   - BETTER_AUTH_URL                          (canonical origin; else Astro `site:` or request origin)
 */

import type { AuthProviderDescriptor, PluginDescriptor, PluginStorageConfig } from "emdash";

import { SETTINGS_ADMIN_PAGE_PATH, SETTINGS_PLUGIN_ID } from "./settings.js";

export { createBetterAuth, type BetterAuthOptions, ROLE_SUBSCRIBER } from "./auth.js";
export { emdashAdapter, type BetterAuthStorage } from "./emdash-adapter.js";
export {
	SETTINGS_PLUGIN_ID,
	SETTINGS_KEYS,
	SETTINGS_DEFAULTS,
	resolveSettings,
	type ResolvedAuthSettings,
} from "./settings.js";

/** Provider id — also the storage namespace (`auth:better-auth`). */
export const PROVIDER_ID = "better-auth";

/**
 * The published npm package name. EmDash resolves the descriptor's route
 * `entrypoint` / `adminEntry` strings as module specifiers at the consuming
 * site's build time (Astro `injectRoute` → Vite), so they MUST equal this
 * package's real name. Deriving them all from one constant keeps them in sync
 * and makes renaming the package a one-line change.
 *
 * IMPORTANT: if you fork/rename this package, update ONLY this constant (and
 * `package.json` "name") — everything else is built from it.
 */
export const PACKAGE_NAME = "emdash-better-auth";

/**
 * Storage collections Better-Auth needs beyond the users table.
 * Indexes mirror the fields Better-Auth queries by so lookups stay fast:
 *   - accounts:      by userId (list a user's accounts) and by
 *                    provider+accountId (credential lookup on sign-in).
 *   - sessions:      by userId (revoke all) and token (session lookup).
 *   - verifications: by identifier (email verification / reset lookups).
 */
export const BETTER_AUTH_STORAGE_CONFIG = {
	accounts: {
		indexes: ["userId", "providerId", "accountId"] as const,
	},
	sessions: {
		indexes: ["userId", "token", "expiresAt"] as const,
	},
	verifications: {
		indexes: ["identifier", "expiresAt"] as const,
	},
} satisfies PluginStorageConfig;

/**
 * Register Better-Auth with EmDash.
 *
 * Returns an `AuthProviderDescriptor` that:
 *   - injects the catch-all Better-Auth route at `/api/auth/[...all]`
 *     (Better-Auth's default basePath), resolved from this package's exports;
 *   - declares the plugin storage collections it uses;
 *   - contributes a login button to the admin login page via `adminEntry`.
 */
export function betterAuthProvider(): AuthProviderDescriptor {
	return {
		id: PROVIDER_ID,
		label: "Better Auth",
		adminEntry: `${PACKAGE_NAME}/admin`,
		routes: [
			{
				pattern: "/api/auth/[...all]",
				entrypoint: `${PACKAGE_NAME}/route`,
			},
			// Prebuilt Better Auth UI (HeroUI) auth views, shipped with the
			// plugin so any EmDash site gets them without hand-writing auth
			// pages. Self-styled — they don't touch the site's theme. The
			// catch-all under /auth serves sign-in, sign-up, forgot-password,
			// reset-password, sign-out, etc. (Better Auth UI's default paths),
			// so the library's own cross-links resolve. /login and /signup are
			// friendly aliases that redirect into it.
			{
				pattern: "/auth/[...path]",
				entrypoint: `${PACKAGE_NAME}/pages/auth`,
			},
			{
				pattern: "/login",
				entrypoint: `${PACKAGE_NAME}/pages/login`,
			},
			{
				pattern: "/signup",
				entrypoint: `${PACKAGE_NAME}/pages/signup`,
			},
		],
		storage: BETTER_AUTH_STORAGE_CONFIG,
	};
}

/**
 * Companion settings plugin for Better Auth.
 *
 * Better Auth registers as an `AuthProviderDescriptor` (via `betterAuthProvider()`
 * in `authProviders: [...]`), and that path has NO admin settings surface. To
 * make Better Auth's configuration editable from the EmDash admin UI, register
 * THIS descriptor in `plugins: [...]` as well:
 *
 * @example
 * ```ts
 * // astro.config.mjs
 * import { betterAuthProvider, betterAuthSettingsPlugin } from "emdash-better-auth";
 *
 * emdash({
 *   authProviders: [betterAuthProvider()],
 *   plugins: [betterAuthSettingsPlugin()],
 * });
 * ```
 *
 * It contributes a custom admin page (its own sidebar link at
 * `/_emdash/admin/plugins/better-auth-settings/settings`) that renders a Block
 * Kit form — toggles for verification behavior, canonical URL, Google
 * credentials, and the Better Auth secret. Values persist to plugin kv; the
 * auth route reads them back at request time with env-var fallback (see
 * `resolveSettings`).
 *
 * Why a custom page rather than the declarative `settingsSchema` auto-render:
 * that form only surfaces through the admin "Plugins" manager, which is broken
 * by a pre-existing EmDash core bug (the plugin-list endpoint 500s). The custom
 * page has its own route and sidebar link, so it works regardless. Mirrors how
 * `emdash-smtp` builds its provider settings page.
 *
 * SECURITY: secret fields are stored in the database (masked in the UI, not
 * encrypted at rest), the same way `emdash-smtp` stores its API key. Leave the
 * "Better Auth secret" field blank to keep using the `BETTER_AUTH_SECRET`
 * Worker secret, which is the stronger option for the session signing key.
 */
export function betterAuthSettingsPlugin(): PluginDescriptor {
	return {
		id: SETTINGS_PLUGIN_ID,
		version: "0.1.0",
		format: "native",
		entrypoint: `${PACKAGE_NAME}/settings-plugin`,
		// Its own admin sidebar page (not the auto-rendered settingsSchema path).
		adminPages: [{ path: SETTINGS_ADMIN_PAGE_PATH, label: "Better Auth", icon: "shield" }],
	};
}
