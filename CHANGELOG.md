# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/theweekendprojects/emdash-better-auth/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/theweekendprojects/emdash-better-auth/releases/tag/v0.1.0
