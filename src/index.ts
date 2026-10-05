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
export type { TwoFactorMethod } from "./auth.js";

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
 *   - usernames:     by username (unique, for sign-in lookup) and userId (list user's profile).
 *   - twoFactors:    by userId (list a user's 2FA config).
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
	// NOTE: EmDash 0.30 treats `uniqueIndexes` as regular indexes (no DB-level
	// uniqueness constraint); it makes `username` queryable. Handle uniqueness
	// is enforced in the adapter at the application level. We keep the
	// `uniqueIndexes` declaration so the intent is recorded and uniqueness
	// becomes atomic automatically if EmDash starts enforcing it.
	usernames: {
		indexes: ["username", "userId"] as const,
		uniqueIndexes: ["username"] as const,
	},
	twoFactors: {
		indexes: ["userId"] as const,
	},
	// API key plugin (programmatic keys). The `apikey` model routes here via the
	// adapter — no site table, no migration. Indexes mirror the fields the
	// plugin queries by:
	//   - referenceId: list a user's keys (reference = userId by default).
	//   - key:         verify an incoming key (lookup by its hashed value).
	// Empty until the apiKey flag is enabled, so declaring it always is free.
	apikeys: {
		indexes: ["referenceId", "key"] as const,
	},
	// Passkey plugin (WebAuthn). The `passkey` model routes here via the
	// adapter — no site table, no migration. Indexes mirror the fields the
	// plugin queries by:
	//   - userId:       list / delete a user's passkeys.
	//   - credentialID: resolve a credential during an authentication assertion.
	// Empty until the passkey flag is enabled, so declaring it always is free.
	passkeys: {
		indexes: ["userId", "credentialID"] as const,
	},
	// Organization plugin (multi-tenancy). All models route to plugin storage
	// via the adapter — no site tables, no migration. Indexes mirror the
	// fields Better Auth queries by:
	//   - organizations: by slug (checkSlug / lookup).
	//   - members:       by organizationId (list members) and userId (a user's orgs).
	//   - invitations:   by organizationId (list) and email (accept lookup).
	//   - teams:         by organizationId (list a org's teams).
	//   - teamMembers:   by teamId (list) and userId (a user's teams).
	//   - organizationRoles: by organizationId (dynamic access control roles).
	// Collections are declared unconditionally; they stay empty until the
	// organization plugin is enabled (settings flag), so there's no cost.
	organizations: {
		indexes: ["slug"] as const,
		uniqueIndexes: ["slug"] as const,
	},
	members: {
		indexes: ["organizationId", "userId"] as const,
	},
	invitations: {
		indexes: ["organizationId", "email"] as const,
	},
	teams: {
		indexes: ["organizationId"] as const,
	},
	teamMembers: {
		indexes: ["teamId", "userId"] as const,
	},
	organizationRoles: {
		indexes: ["organizationId"] as const,
	},
	// Stripe plugin (subscription billing). The subscription model routes to
	// plugin storage via the adapter — no site table, no migration. The user's
	// `stripeCustomerId` is a user field, stored in users.data JSON (see
	// ADDITIONAL_DATA_FIELDS in emdash-adapter.ts), not here. Indexes mirror the
	// fields the plugin queries by:
	//   - referenceId:          list a user's (or org's) subscriptions.
	//   - stripeSubscriptionId: webhook lookups (subscription.updated/deleted).
	//   - stripeCustomerId:     resolve the owner from a customer-scoped event.
	// Empty until the billing flag is enabled, so declaring it always is free.
	subscriptions: {
		indexes: ["referenceId", "stripeSubscriptionId", "stripeCustomerId"] as const,
	},
	// OIDC / OAuth 2.1 provider plugin (@better-auth/oauth-provider). All of its
	// models route to plugin storage via the adapter — no site tables, no
	// migration. Collections are declared unconditionally; they stay empty until
	// the oidcProvider feature flag is enabled, so there's no cost. Indexes
	// mirror the fields the provider queries by (see the plugin's schema):
	//   - oauthClients:    by clientId (resolve a client on authorize/token) and
	//                      userId (list clients a user owns, for the client-mgmt UI).
	//   - oauthAccessTokens: by token (introspect/userinfo lookup), refreshId
	//                      (revoke the family on refresh), userId/clientId (revoke
	//                      on sign-out / per client).
	//   - oauthRefreshTokens: by token (refresh-grant lookup) and userId (revoke all).
	//   - oauthConsents:   by userId (list a user's authorized apps) and clientId.
	//   - oauthClientAssertions: by id only (replay tombstone — the row id IS the jti digest).
	//   - oauthClientResources / oauthResources: by clientId / identifier
	//      (resource-bound tokens; empty unless `resources` are configured).
	oauthClients: {
		indexes: ["clientId", "userId"] as const,
		uniqueIndexes: ["clientId"] as const,
	},
	oauthAccessTokens: {
		indexes: ["token", "refreshId", "userId", "clientId"] as const,
	},
	oauthRefreshTokens: {
		indexes: ["token", "userId", "clientId"] as const,
	},
	oauthConsents: {
		indexes: ["userId", "clientId"] as const,
	},
	oauthClientAssertions: {
		indexes: ["expiresAt"] as const,
	},
	oauthClientResources: {
		indexes: ["clientId", "resourceId"] as const,
	},
	oauthResources: {
		indexes: ["identifier"] as const,
		uniqueIndexes: ["identifier"] as const,
	},
	// JWKS signing keys for the `jwt` plugin (registered alongside the OIDC
	// provider). The plugin persists its ID/access-token signing keypairs in a
	// `jwks` model; it reads the whole set (or by id) to sign/verify, so no
	// secondary index beyond the storage primary key is needed. Routed to plugin
	// storage via the adapter — no migration. Empty until the OIDC flag is on.
	// REQUIRED whenever oidcProviderEnabled: without it, the adapter throws
	// "No storage collection for model jwks" and every auth request 500s.
	jwks: {
		indexes: [] as const,
	},
	// Audit log (better-auth-audit-logs via a custom storage backend). The
	// package normally creates its own `auditLog` DB table through a migration;
	// we can't migrate on D1 + our custom adapter, so we route it here instead
	// (see audit-log-storage.ts). Indexes mirror the fields the list/retention
	// queries filter by: userId (a user's own activity), action, and createdAt
	// (sort + retention cutoff). Empty until the auditLog flag is on.
	auditLogs: {
		indexes: ["userId", "action", "createdAt"] as const,
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
			// Subscriber profile editing. Public, login-gated route that mirrors
			// the /auth pattern: a catch-all at /account/[...path] (Better Auth's
			// account settings views: /account, /account/settings, etc.) plus a
			// friendly /account alias. The island is an AuthView wrapper around
			// Better Auth UI's Account component (Settings/AccountSettings view).
			{
				pattern: "/account/[...path]",
				entrypoint: `${PACKAGE_NAME}/pages/account`,
			},
			{
				pattern: "/account",
				entrypoint: `${PACKAGE_NAME}/pages/account/index`,
			},
			// Admin user management (Better Auth UI <Admin> view). Catch-all at
			// /admin/[...path] (/admin/users) + a friendly /admin alias. Both the
			// page and the alias are inert unless the admin feature flag is on —
			// the catch-all 404s when disabled, so mounting the route always is
			// safe. Authorization is enforced by Better Auth's admin permission
			// API that the UI calls, not by the route itself.
			{
				pattern: "/admin/[...path]",
				entrypoint: `${PACKAGE_NAME}/pages/admin`,
			},
			{
				pattern: "/admin",
				entrypoint: `${PACKAGE_NAME}/pages/admin/index`,
			},
			// Audit log (admin-only HeroUI island). Catch-all + bare alias, same
			// shape as /account and /admin — a bare route sees a null
			// `locals.user`, so gating must live on the catch-all. Inert unless the
			// auditLog flag is on (404 when disabled); admin authorization enforced
			// server-side (role >= 50).
			{
				pattern: "/audit-log/[...path]",
				entrypoint: `${PACKAGE_NAME}/pages/audit-log`,
			},
			{
				pattern: "/audit-log",
				entrypoint: `${PACKAGE_NAME}/pages/audit-log/index`,
			},
			// Organization (multi-tenancy) management (Better Auth UI
			// <Organization> shell: settings/people/teams tabs). Catch-all at
			// /organization/[...path] + a friendly /organization alias. Inert
			// unless the organization feature flag is on (catch-all 404s when
			// disabled). Per-org authorization is enforced by Better Auth.
			{
				pattern: "/organization/[...path]",
				entrypoint: `${PACKAGE_NAME}/pages/organization`,
			},
			{
				pattern: "/organization",
				entrypoint: `${PACKAGE_NAME}/pages/organization/index`,
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
		// Keep in sync with SETTINGS_PLUGIN_VERSION (settings-plugin-entry.ts)
		// and the package version.
		version: "0.8.2",
		format: "native",
		entrypoint: `${PACKAGE_NAME}/settings-plugin`,
		// Its own admin sidebar page (not the auto-rendered settingsSchema path).
		adminPages: [{ path: SETTINGS_ADMIN_PAGE_PATH, label: "Better Auth", icon: "shield" }],
	};
}
