# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.8.1] - 2026-10-04

### Fixed

Four bugs caught live-testing 0.8.0 on a real deployed Worker with the new
flags enabled (self-check and build alone hadn't exercised these paths):

- **OIDC: every auth request 500'd once the identity-provider flag was
  turned on.** The `jwt()` plugin (required alongside `oauthProvider()`)
  persists its signing keypairs in a `jwks` model that was never declared as
  a plugin-storage collection, so the adapter threw `No storage collection
  for model "jwks"` on `/api/auth/get-session` and everything else. Added the
  `jwks` collection + adapter routing.
- **Audit log: the account page blanked (500/empty) and the admin page
  looped back to the homepage.** Three compounding issues:
  - HeroUI v3's `<Table>` is a react-aria *collection* component
    (`TableRoot > TableContent > …` primitives); the flat `Table`/`Tabs` API
    used here threw `cannot be rendered outside a collection` on both SSR
    and the client. Replaced with a plain semantic `<table>` + a native
    `<select>` status filter + prev/next paging — a log table needs none of
    react-aria's selection/keyboard-nav machinery, so this is simpler and
    SSR-safe, not a workaround.
  - The list call used `authClient.auditLog.listAuditLogs(...)`; the audit
    plugin's client only declares raw `pathMethods` (no generated helper),
    so Better Auth derived the wrong path (`/audit-log/list-audit-logs`,
    404). Fixed by calling the real path directly via `authClient.$fetch`.
  - The admin page was a bare `/audit-log` route, but `Astro.locals.user` is
    only reliably populated on the auth-provider **catch-all** routes (the
    same reason `/account` and `/admin` are catch-alls with a redirecting
    alias) — so the admin gate saw no user and bounced to sign-in, which
    then bounced an already-logged-in admin to `/`. Restructured to
    `/audit-log/[...path]` + a bare `/audit-log` alias, matching the
    existing `/account`/`/admin` pattern.

## [0.8.0] - 2026-10-04

### Added

- **Audit logging.** Opt-in (`auditLogEnabled`, off by default) via the
  `better-auth-audit-logs` plugin: captures auth events (sign-in/up, password &
  email change, 2FA, admin ban/impersonate, …) with IP, user-agent, and
  inferred severity.
  - **No migration.** The package normally creates its own `auditLog` table via
    a Better Auth migration; instead we route it through a custom
    `AuditLogStorage` backend (`src/audit-log-storage.ts`) over a new
    `auditLogs` plugin-storage collection — consistent with the plugin's
    zero-migration design. `Date`/`metadata` are serialized to ISO string / JSON
    for D1 and parsed back on read.
  - **Non-blocking + privacy.** Writes are fire-and-forget (`nonBlocking`), so
    they never delay an auth response, and PII is hash-redacted
    (`piiRedaction: { strategy: "hash" }`) — raw request bodies/secrets are not
    stored; IP + user-agent are kept for forensics.
  - **Two views (HeroUI, reusing the existing table/query stack — no new UI
    deps):** an admin-only site-wide log at `/audit-log` (server-gated to
    EmDash admins, role ≥ 50), and a per-user "Recent activity" card in the
    account settings showing only the signed-in user's own events (the list
    endpoint scopes to the session user).
  - **Configurable retention.** `auditLogRetentionDays` setting, default **365**
    (the PCI DSS 12-month baseline; inside GDPR's practical 1–3yr range and
    bounds D1 growth). `0` = keep forever. Raise for HIPAA (~6y) / SOX (~7y).
    Old entries are swept in the background off auth traffic (never blocks a
    request). *Compliance figures are guidance — verify against your own
    obligations.*

## [0.7.0] - 2026-10-04

### Added

- **Magic-link sign-in.** Opt-in passwordless email-link sign-in
  (`magicLinkEnabled`, off by default) via the Better Auth `magicLink` plugin.
  Links are sent through the EmDash email pipeline and are single-use. UI wired
  on the auth island. No migration (uses the `verification` storage collection).
- **Email one-time codes (OTP).** Opt-in passwordless code-based sign-in, email
  verification, and password reset (`emailOtpEnabled`, off by default) via the
  Better Auth `emailOTP` plugin. Codes sent through the EmDash email pipeline;
  OTP change-email / verification wired into account settings. No migration.
- **Guest (anonymous) sessions.** Opt-in (`anonymousEnabled`, off by default)
  via the Better Auth `anonymous` plugin: a "Continue as guest" button creates
  an authenticated throwaway user that can be linked to a real account later.
  The `isAnonymous` flag rides `users.data` JSON — no migration. Guest users are
  created without a username (the username requirement is relaxed for them).
- **Multiple accounts per browser.** Opt-in (`multiSessionEnabled`, off by
  default) via the Better Auth `multiSession` plugin: a browser can hold several
  signed-in accounts and switch the active one from the user menu. The EmDash
  session bridge re-runs on account switch so server-rendered pages follow the
  active account. Also enables the OIDC `select-account` screen. Sessions use
  the existing `session` collection — no migration.
- **Extra OAuth / OIDC providers (Generic OAuth).** Opt-in
  (`genericOAuthEnabled`, off by default) via the Better Auth `genericOAuth`
  plugin. Providers (Keycloak, Okta, Auth0, Microsoft Entra, …) are configured
  from the `GENERIC_OAUTH_CONFIG` Worker env var (a JSON array) and render as
  normal social sign-in buttons; the toggle is inert until at least one provider
  is configured. Accounts use the existing `accounts` collection — no migration.
- **Breached-password rejection (Have I Been Pwned).** Opt-in (`hibpEnabled`,
  off by default) via the Better Auth `haveIBeenPwned` plugin: sign-up and
  password change reject passwords found in known breaches (k-anonymity range
  query — only the first 5 chars of the SHA-1 hash leave the Worker). No storage,
  no UI.

### Fixed

- **OIDC provider flag was never passed to the auth route.** `oidcProviderEnabled`
  resolved from settings but wasn't forwarded into the Better Auth options in
  `route.ts`, so the identity-provider plugin never actually registered at
  runtime. It is now wired through.

### Changed

- **Username is no longer hard-required for passwordless / guest sign-ups.** The
  create-time username guard now only applies to password-based, non-anonymous
  sign-ups (where the UI collects a username). Magic-link, email-OTP, and
  anonymous users are created without one and can claim a username later from
  account settings. (Email/password sign-up still requires a username.)
- Settings page gained grouped toggles for the new plugins plus a status banner
  when "Extra OAuth / OIDC providers" is on without any `GENERIC_OAUTH_CONFIG`
  entries.

## [0.6.0] - 2026-10-04

### Added

- **OIDC / OAuth 2.1 identity provider.** Opt-in support (via the
  `@better-auth/oauth-provider` plugin, with the core `jwt` plugin) that turns
  the site into an OpenID Connect provider: other applications can let users
  "Sign in with this site" through the authorization-code + PKCE flow, fetch
  UserInfo, and manage their own OAuth clients. Gated behind an
  `oidcProviderEnabled` setting (off by default). OpenID discovery is served at
  `/api/auth/.well-known/openid-configuration` and the endpoints under
  `/api/auth/oauth2/*`; JWKS at `/api/auth/jwks`. All client / token / consent /
  resource records persist to plugin storage through the EmDash adapter — **no
  database migration required** (new collections: `oauthClients`,
  `oauthAccessTokens`, `oauthRefreshTokens`, `oauthConsents`,
  `oauthClientAssertions`, `oauthClientResources`, `oauthResources`).
  - **UI.** The Better Auth UI oauth-provider plugin is wired on both islands:
    the auth island renders the consent view (`/auth/oauth-consent`) and the
    OAuth sign-up view (`/auth/oauth-sign-up`, for `prompt=create`); the account
    island adds a "Connected applications" security card (apps the user
    authorized, with a remove action) and an "OAuth clients" tab (create / edit /
    delete / rotate secret). Both match the backend flag.
  - The redirect screens reuse the plugin's existing pages — login at `/login`,
    consent/sign-up under `/auth/*` — so no new routes are injected.

### Changed

- **Settings page regrouped.** The Better Auth admin settings form now orders
  fields by concern (email verification → feature plugins → identity provider →
  billing → branding → signing secret) instead of an interleaved list, and adds
  status banners that flag an enabled-but-inert feature (billing on with no
  Stripe key; teams on with organizations off). A note records that username is
  always required (it has no toggle by design).
- **Version sync.** The companion settings plugin's reported version
  (`SETTINGS_PLUGIN_VERSION` and the descriptor `version`) now tracks the
  package version instead of a stale `0.1.0`.

## [0.5.0] - 2026-10-03

### Added

- **Organization (multi-tenancy) plugin.** Opt-in `organization` support via the
  Better Auth organization plugin: organizations, members, invitations, and
  optional teams. All models persist to plugin storage through the EmDash
  adapter — **no core database columns or migrations required**. Gated behind an
  `orgEnabled` setting (off by default); teams behind `teamsEnabled` (only
  meaningful when organizations are on). Adds an "Organizations" tab to the
  account settings and prebuilt `/organization` management pages
  (settings / people / teams) with an organization switcher.
- **Stripe subscription billing.** Opt-in per-user subscription billing via the
  Better Auth Stripe plugin, gated behind a `billingEnabled` setting (off by
  default). A Stripe customer is created on sign-up; the "Billing" tab (pricing,
  checkout, portal, cancel) appears in account settings when billing is enabled
  and at least one plan resolves a monthly price id. Plans are defined once in
  `billing-plans.ts`; price ids are operator config injected at runtime from env
  (`STRIPE_PRICE_<PLAN>_MONTH` / `_YEAR`). Subscriptions persist to a
  `subscriptions` plugin-storage collection — **no migration**. The user's
  `stripeCustomerId` rides `users.data` JSON.
- **Admin plugin.** Opt-in user management (create / ban / impersonate / list,
  string role) via the Better Auth admin plugin, gated behind an `adminEnabled`
  setting. Role / ban fields route to `users.data` JSON, never EmDash's numeric
  `users.role`. The `/admin` page is gated server-side to EmDash admins
  (role ≥ 50).
- **API key and passkey plugins.** Opt-in programmatic API keys
  (`apiKeyEnabled`) and passwordless WebAuthn passkeys (`passkeyEnabled`), each
  behind its own setting. Credentials persist to `apikey` / `passkey`
  plugin-storage collections — no migration. Passkey relying-party id/origin are
  derived from the canonical base URL.
- **Additional social providers.** Facebook, X/Twitter (`twitter`), and
  Cloudflare sign-in, data-driven from `SOCIAL_PROVIDERS` (Google and GitHub
  already supported). A provider is enabled only when both client id and secret
  resolve.
- **Configurable auth-page theming.** Accent color and site logo on the sign-in
  / sign-up pages.
- **Anti-flash login hint cookie.** Avoids a logged-out flash on authenticated
  navigations; the EmDash session is now bridged on all sign-in paths.

## [0.4.0] - 2026-09-14

### Added

- **TOTP two-factor authentication (2FA).** Users can enroll in TOTP via their
  account settings (scan QR code with an authenticator app), use TOTP codes on
  sign-in, and recover with backup codes. Two-factor authentication is a site
  feature flag (`twoFactorEnabled` setting) — disabled by default.
- **Plugin-storage `twoFactors` collection.** Per-user TOTP secrets and backup
  codes live in a dedicated plugin storage collection (`twoFactors`), **no core
  database columns or migrations required**. EmDash's `users` table is unchanged.
- **Adapter two-factor handling.** The EmDash adapter now:
  - routes the `twoFactor` model to the `twoFactors` storage collection;
  - stores `twoFactorEnabled` in the `users.data` JSON column (no migration);
  - surfaces `twoFactorEnabled` on user reads.
- **Admin setting toggle.** A new `twoFactorEnabled` boolean setting in the
  Better Auth settings page to turn the feature on/off for the whole site.
- **Two-factor plugin issuer.** The TOTP issuer is derived from the canonical
  site URL (hostname) so authenticator apps label entries with the site name.
- **Account + auth UI wiring.** The Better Auth UI `twoFactorPlugin` is
  registered on both the account island (Security tab enrollment card: QR +
  backup codes, disable) and the auth island (the TOTP challenge shown on
  sign-in). Both are gated on the same `twoFactorEnabled` site flag so the UI
  never diverges from the backend. The `/auth/[...path]` route guard explicitly
  allows the `two-factor` challenge segment when the flag is on (the base
  `viewPaths.auth` from `@better-auth-ui/core` only augments that path at the
  type level, not at runtime, so an unguarded challenge path would 404).
- **EmDash session bridge for 2FA sign-in.** The `two-factor/verify-totp` and
  `two-factor/verify-backup-code` endpoints now establish the EmDash Astro
  session, like `sign-in/email` does. For a 2FA user, `sign-in/email` only
  returns a challenge (no session yet); the session is created when the second
  factor is verified, so without bridging there the site's SSR (header,
  login-gated pages) would still treat the user as logged out.

## [0.3.0] - 2026-09-13

### Added

- **Subscriber profile editing.** Public, login-gated account settings at
  `/account` — a new `AccountView` island rendering Better Auth UI's `Settings`
  (account + security tabs), reusing the same auth client, HeroUI styling,
  theme plugin, and username plugin as the sign-in/up pages. Served via a
  `/account/[...path]` catch-all (Better Auth UI's `account`/`security` views)
  plus a friendly `/account` alias that forwards into it, mirroring `/login`
  → `/auth/*`. Login-gated: anonymous visitors are redirected to sign-in.
- **Editable fields:** name, username (from the username plugin), and **bio**.
  Bio is stored in EmDash's `users.data` JSON column (no migration); the adapter
  merges it in without clobbering other keys and surfaces it on user reads.
- **Avatar:** editable via Better Auth UI's built-in avatar control. With no
  custom upload handler configured, Better Auth UI resizes the image and stores
  a compact data URL directly in `user.image` (→ `users.avatar_url`), so avatar
  changes work with no backend. R2-backed avatar upload (via EmDash's media
  pipeline) is a planned follow-up.

Verified end-to-end (Playwright + live deploy): the account page renders
name/username/bio, the login-gate redirects anonymous visitors, and a saved
bio round-trips through `users.data`.

## [0.2.0] - 2026-09-12

### Added

- **Username support via Better Auth username plugin.** Users register with a
  required username and can sign in with it instead of email, giving a public
  identity that never exposes their email address.
- **Plugin-storage `usernames` collection.** Username records live in a
  dedicated plugin storage collection keyed by userId (`username` +
  `displayUsername`), **no core database columns or migrations required**.
  EmDash's `users` table is unchanged.
- **Adapter username handling.** The EmDash adapter now, for the user model:
  - stores/syncs the username record on create and update (a rename frees the
    old handle; a failed user insert rolls the claimed handle back);
  - resolves `username`/`displayUsername` where-clauses back to a user so
    **sign-in by username and duplicate detection work** (the plugin looks users
    up by username, which the `users` table has no column for);
  - augments user reads with `username`/`displayUsername`;
  - frees the handle on user delete, including bulk `deleteMany`/`updateMany`.
- **Client-side `usernameClient`** for sign-in by username and availability
  checks.

### Notes

- **Username is always required** (enforced in a `databaseHooks.user.create`
  hook); `displayUsername` is optional and derived from `username` when omitted.
- **Email remains required** for account recovery (never exposed publicly).
- **Uniqueness is enforced at the application level**, not by the database.
  EmDash 0.30 treats `uniqueIndexes` as regular (queryable) indexes with no
  uniqueness constraint, so a duplicate handle is rejected by Better Auth's own
  availability check and by the adapter's owner check. This is check-then-write,
  so a small race window exists under truly concurrent same-handle signups —
  negligible for the blog/community use case, and it becomes atomic
  automatically if EmDash begins enforcing `uniqueIndexes`.
- Usernames are normalized (lowercased) by the Better Auth plugin before the
  adapter, so uniqueness is case-insensitive.

### Fixed (review of the initial username implementation)

- Corrected plugin imports: `username` from `better-auth/plugins` and
  `usernameClient` from `better-auth/client/plugins` (the previous
  `better-auth` / `better-auth/react` imports broke the consuming-site build).
- Replaced a no-op `signUp.validate` (not a real Better Auth option) with a
  `databaseHooks.user.create.before` hook that actually enforces the required
  username.
- Removed a bogus `username: { modelName: "username" }` mapping (the plugin adds
  fields to the user model; there is no separate `username` model).
- Implemented the username→user reverse lookup and bulk-delete handle cleanup
  the initial pass was missing.
- Username is stored in plugin storage only, no migration needed. EmDash's
  `users` table columns remain unchanged.

## [0.1.0] - 2026-09-04

## [0.1.0] - 2026-09-04

Initial release. Email/password + social authentication for EmDash CMS,
powered by Better Auth with prebuilt Better Auth UI pages.

### Added

- **Email/password auth** with prebuilt, self-styled Better Auth UI pages at
  `/auth/*` plus `/login` and `/signup` aliases (sign-in, sign-up,
  forgot-password, reset-password, sign-out) and a light/dark/system theme
  toggle.
- **Real EmDash users.** Sign-ups create rows in EmDash's own `users` table via
  a custom Better Auth adapter — first-class users, governed by EmDash RBAC,
  with **no database migrations**. Sessions/accounts/verifications live in
  EmDash plugin storage (namespace `auth:better-auth`).
- **Session bridging** to EmDash's own session cookie, so one account works for
  both the public site and `/_emdash/admin` (subject to role). New sign-ups
  default to the lowest role (subscriber).
- **Mandatory email verification** by default: unverified users cannot sign in;
  the sign-in attempt is blocked and the verification link re-sent, the UI
  routes to `/auth/verify-email`, and clicking the link verifies and auto
  signs-in. Configurable (can be relaxed to "soft").
- **Password reset** wired to EmDash's email pipeline (`runtime.email`),
  provider-agnostic (works with any `email:deliver` provider, e.g. `emdash-smtp`).
- **Social sign-in — Google and GitHub.** Data-driven provider list; each turns
  on only when both its client ID and secret are configured (env vars or the
  admin UI). Auth-page buttons reflect exactly what the backend enables. Adding
  another provider is a two-line change (`SocialProviderId` union +
  `SOCIAL_PROVIDERS`).
- **Canonical base-URL resolution** for absolute links in verification/reset
  emails: `BETTER_AUTH_URL` env → Astro `site:` config → request origin.
- **Optional admin settings page** via the companion `betterAuthSettingsPlugin()`
  — verification toggles, canonical URL, the Better Auth secret, and per-provider
  social credentials (each provider shown as a card with its copyable callback
  URL). Values persist to plugin storage and are read at request time with
  env-var fallback (saved settings win per field).
- **"Continue with EmDash"** cross-link to EmDash's native passkey login, so
  passkey-only admins are never stranded.

### Security notes

- Secret fields entered in the admin UI are stored in the database (masked in
  the UI, **not encrypted at rest**), the same way `emdash-smtp` stores its API
  key. For the session signing key, prefer leaving the admin field blank and
  setting `BETTER_AUTH_SECRET` as a Worker secret. See the README security note.

[Unreleased]: https://github.com/theweekendprojects/emdash-better-auth/compare/v0.8.1...HEAD
[0.8.1]: https://github.com/theweekendprojects/emdash-better-auth/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/theweekendprojects/emdash-better-auth/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/theweekendprojects/emdash-better-auth/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/theweekendprojects/emdash-better-auth/compare/v0.5.0...v0.6.0
[0.3.0]: https://github.com/theweekendprojects/emdash-better-auth/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/theweekendprojects/emdash-better-auth/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/theweekendprojects/emdash-better-auth/releases/tag/v0.1.0
