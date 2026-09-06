# AGENTS.md — emdash-better-auth

Context for AI agents (Claude Code, Cursor, Kiro, etc.) working on this package.
Read this before making changes. The README is for *users*; this file captures
the *why*, the architecture, and the non-obvious gotchas so you don't rediscover
them the hard way.

## What this is

An EmDash CMS auth plugin: email/password + social (Google, GitHub) auth via
[Better Auth](https://better-auth.com), with prebuilt [Better Auth UI](https://better-auth-ui.com)
(HeroUI) pages, mandatory email verification, and an admin settings page.
Published to npm as **`emdash-better-auth`** (unscoped). Target runtime:
EmDash on Astro + Cloudflare Workers (D1 + R2).

## The two-part registration (most important thing to understand)

EmDash has **two separate extension systems**, and this package uses BOTH:

1. **`betterAuthProvider()` → `AuthProviderDescriptor`**, registered in
   `emdash({ authProviders: [...] })`. This is the auth engine: it injects the
   `.astro` routes (`/auth/[...path]`, `/login`, `/signup`) and the `/api/auth`
   catch-all, and declares plugin storage. **The auth-provider system has NO
   admin-settings surface** — that's the whole reason for the second piece.
2. **`betterAuthSettingsPlugin()` → `PluginDescriptor` (`format: "native"`)**,
   registered in `emdash({ plugins: [...] })`. A tiny companion plugin whose
   only job is the admin settings page + its storage. It is otherwise inert.

Both must be registered by the consuming site. They share settings via plugin
storage (see "Settings storage" below).

## File map

| File | Role | Runs where |
| --- | --- | --- |
| `src/index.ts` | Both descriptor factories + `PACKAGE_NAME` constant | Vite (build time) |
| `src/route.ts` | `/api/auth/[...all]` handler; assembles auth options per-request | Server (request) |
| `src/auth.ts` | `createBetterAuth()` — Better Auth instance + `BetterAuthOptions` | Server |
| `src/emdash-adapter.ts` | Custom Better Auth DB adapter → EmDash `users` table + plugin storage | Server |
| `src/settings.ts` | Single source of truth: `SOCIAL_PROVIDERS`, setting keys, `resolveSettings`, kv read/write | Server |
| `src/settings-plugin-entry.ts` | Native plugin: admin page (Block Kit) + `routes.admin` handler | Server |
| `src/providers.ts` | Which social buttons to show (reuses `resolveSettings`) | Server (`cloudflare:workers`) |
| `src/pages/*.astro` | Injected auth routes (document shells around the island) | Astro SSR (consuming site compiles) |
| `src/ui/AuthView.tsx` + `auth.css` | The Better Auth UI React island + its Tailwind styles | Browser island |
| `src/admin.tsx` | "Continue with EmDash" button on EmDash's native login page | Browser |
| `src/client.ts` | Better Auth client (origin-relative) | Browser |

## Non-obvious architecture decisions

- **No database migrations.** The custom adapter (`emdash-adapter.ts`) maps
  Better Auth's `user` model onto EmDash's existing `users` table (with field
  remapping: `emailVerified`→`email_verified`, `image`→`avatar_url`, etc.), and
  routes `account`/`session`/`verification` into EmDash plugin storage
  (`getAuthProviderStorage`, namespace `auth:better-auth`). So a Better Auth
  signup is a first-class EmDash user. This couples us to EmDash's `users`
  column names — if EmDash renames them, update `UsersTable` in the adapter +
  the `fields` map in `auth.ts`.
- **`supportsBooleans/Dates/JSON: false`** in the adapter factory: D1/SQLite has
  no native booleans/dates/JSON, so Better Auth coerces to primitives before
  our adapter sees them (that's why `email_verified` is 0/1, dates are ISO
  strings, and there's no serialization code).
- **Canonical base URL** resolves in `route.ts`: `BETTER_AUTH_URL` env → Astro
  `site:` config → request origin. This matters because verification/reset
  **email links must be absolute** (opened later from a mail client, no
  "current origin"). Multi-domain sites (custom domain + workers.dev) MUST set
  tier 1 or 2 or links leak the wrong host.
- **Client is origin-relative** (`client.ts` resolves from `window.location`),
  so the browser side needs no base-URL config.

## Admin settings: why adminPages, NOT settingsSchema

EmDash's declarative `admin.settingsSchema` (auto-rendered form) would be the
natural choice, and we built it that way first. **It doesn't work on this EmDash
version**: the auto-form only surfaces inside the admin "Plugins manager" page,
whose `/_emdash/api/admin/plugins` list endpoint **500s** (a pre-existing EmDash
core bug — `buildPluginInfo` throws, unrelated to this plugin; verified by
removing the plugin entirely and the 500 persists). So the form never displayed.

Fix: we render our own page the way `emdash-smtp` does — `adminPages` (its own
sidebar link + route) + a `routes.admin` handler returning **Block Kit** JSON.
This has its own URL and never touches the broken list endpoint. If EmDash fixes
that bug, this could be simplified back to `settingsSchema`.

Block Kit page blocks used: `header`, `divider`, `context`, `banner` (titled
card), `form` (with `fields: [toggle|text_input|secret_input]` + `submit`).
There is **no image element** for content blocks (only sidebar `adminPages`
take a named `icon`), so real brand logos aren't possible — we tried emoji
glyphs, the user rejected them, they're removed. Don't re-add icons to card
titles.

## Settings storage & the single source of truth

- `settings.ts` `SOCIAL_PROVIDERS` (`{id,label,envPrefix}`) is **data-driven**.
  To add a provider (Apple, Discord, Facebook, …): extend `SocialProviderId` in
  `auth.ts` + add one entry here. The kv keys, env fallback names, admin card,
  and callback URL are all derived. (Facebook was deliberately deferred.)
- **kv key layout:** each field is `settings:<field>` written via `ctx.kv`,
  which persists to the options table as `plugin:better-auth-settings:settings:<field>`
  — exactly the prefix `getPluginSettings("better-auth-settings")` reads. That's
  why `route.ts` and the admin page agree with zero translation. Don't change
  one side's key scheme without the other.
- **`resolveSettings(saved, env)`** is the ONE merge function: saved admin
  settings > env vars > built-in defaults, per field, with a both-credentials
  guard for social providers (a provider with only an id, or only a secret, is
  excluded). `route.ts`, `providers.ts`, and the admin page all go through it.
- **`writeKvSettings` only touches keys present in the submitted `values`.** The
  admin UI has multiple forms (core + one per provider); each submits only its
  own fields. If you make it write all keys unconditionally, a provider save
  will wipe the toggles/other providers. This was a real bug — keep the
  `if (!(key in values)) continue` guards.

## GOTCHA: browser autofill on secret fields

Password managers silently autofill the "Better Auth secret" and provider
client-id/secret fields with saved site credentials. Clicking **Save** then
persists junk — and for the signing key, rotates every session; for a provider,
enables it with bad creds. We hit this twice during testing. The
secret-preserving logic (blank = keep existing) does NOT save you, because
autofill makes the field non-blank. If you write/verify settings via the admin
UI, clear the fields first. To remove a wrongly-saved secret, delete the row
directly: `DELETE FROM options WHERE name = 'plugin:better-auth-settings:settings:betterAuthSecret';`

## SECURITY tradeoff (documented, accepted)

Secret fields entered in the admin UI are stored in the DB **as plaintext** —
`secret_input` only masks the UI, EmDash has no encryption-at-rest for settings
(confirmed: no crypto in EmDash settings persistence). Same as how `emdash-smtp`
stores its API key. For the session signing key, prefer leaving the admin field
blank and using the `BETTER_AUTH_SECRET` Worker secret. There's an open EmDash
feature request for encrypted secret storage; migrate to it when available.

## Packaging / publishing model (verified)

- **Ships SOURCE, not a dist build.** `package.json` `exports` point at
  `./src/*` (`.ts`/`.tsx`/`.astro`/`.css`). This is required: EmDash injects the
  `.astro` routes via Astro `injectRoute` at the **consuming site's build time**
  (verified in emdash core `injectAuthProviderRoutes`), and Tailwind/HeroUI CSS
  is compiled by the consuming site's `@tailwindcss/vite`. You cannot pre-build
  `.astro` + Tailwind into a normal dist. (Contrast emdash-smtp, which is pure
  TS and ships `dist/*.mjs` via tsdown — we can't, because of the .astro/CSS.)
- **`PACKAGE_NAME` constant in `index.ts` is load-bearing.** All descriptor
  `entrypoint`/`adminEntry` strings are module specifiers EmDash resolves via
  the package's exports map at the consuming site's build. They MUST equal the
  published `package.json` "name". To rename/fork: change ONLY `PACKAGE_NAME` +
  `package.json` name (keep identical); everything else derives from it.
- `files` allowlist controls the tarball (NO `.npmignore` — `files` wins and is
  the safer allowlist). `tailwindcss` is a **peerDependency** (consuming site
  compiles the CSS). `emdash`/`react`/`react-dom` are peers.
- **Clean-install test passed** (before first publish): packed to `.tgz`,
  installed into a real EmDash site as `emdash-better-auth` (not workspace
  link), built and deployed — all subpath exports resolved, all routes worked
  live (`/auth/*` 200, `/login|/signup` 302, `/api/auth/get-session` 200, admin
  settings 302). Re-run this test after any packaging/exports change.

## Consuming-site requirements (for the README / support)

`@astrojs/react` + `@tailwindcss/vite` (in `vite.plugins`) are **required** —
the auth pages are React islands and HeroUI ships Tailwind v4 source that must
be compiled. `BETTER_AUTH_SECRET` Worker secret required. Email verification is
mandatory by default → a working `email:deliver` provider (e.g. `emdash-smtp`)
is required or new users can't complete signup.

## Verification workflow

There is no meaningful standalone build/typecheck (source is compiled by the
consuming Astro site; `tsc` alone chokes on `.astro`/`cloudflare:workers`). The
real gate is: build inside a consuming EmDash site, deploy to a Worker, and
smoke-test the routes. During development the reference site was
`theweekendprojects-landing-page` (workspace-linked). `wrangler tail` +
temporary `console.log` diagnostics (then removed) were used to verify runtime
settings resolution, since the admin is passkey-gated and hard to script.

## History / provenance

Extracted from the `theweekendprojects-landing-page` monorepo
(`packages/better-auth/`, internal name `@theweekendprojects/better-auth`) and
renamed to `emdash-better-auth` for standalone publish. Comments feature was
intentionally dropped. Facebook social login deferred. First release: 0.1.0.
