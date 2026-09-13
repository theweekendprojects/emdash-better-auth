# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/theweekendprojects/emdash-better-auth/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/theweekendprojects/emdash-better-auth/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/theweekendprojects/emdash-better-auth/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/theweekendprojects/emdash-better-auth/releases/tag/v0.1.0
