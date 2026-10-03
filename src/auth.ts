/**
 * Better-Auth instance factory for EmDash.
 *
 * Wires Better-Auth to the EmDash custom adapter (users table + plugin
 * storage) and maps Better-Auth's `user` model onto EmDash's `users` columns
 * so a Better-Auth account IS an EmDash user.
 */

import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import { twoFactor } from "better-auth/plugins";
import { admin } from "better-auth/plugins";
import { organization } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { passkey } from "@better-auth/passkey";
import { stripe as stripePlugin } from "@better-auth/stripe";
import Stripe from "stripe";
import type { Kysely } from "kysely";
import { emdashAdapter, type BetterAuthStorage } from "./emdash-adapter.js";
import { PLAN_DEFINITIONS, toStripePlans, type PlanPriceIds } from "./billing-plans.js";

/**
 * EmDash email pipeline interface, loosely typed to avoid importing emdash internals.
 * Only the methods we use (send, isConfigured) are declared.
 */
export interface EmailPipeline {
	send(message: { to: string; subject: string; text: string; html?: string }, source: string): Promise<void>;
	isConfigured?(): Promise<boolean>;
}

/**
 * Error type for when a plugin hook blocks an action (used by sendResetPassword).
 * Not imported directly to avoid coupling to emdash internals.
 */
interface EmailNotConfiguredError extends Error {
	name: "EmailNotConfiguredError";
}

/**
 * EmDash's default role levels. New self-service sign-ups get SUBSCRIBER —
 * the lowest level — so hitting /signup never grants CMS admin access. A
 * user can be promoted to a higher role later via the EmDash admin UI, at
 * which point they can also sign in to /_emdash/admin (same users table).
 */
export const ROLE_SUBSCRIBER = 10;

/**
 * OAuth social providers this plugin wires up. Better Auth supports many more
 * (Apple, Discord, Microsoft, GitLab, X, Facebook, …); to add one, extend this
 * union, the `SOCIAL_PROVIDERS` list in settings.ts, and the mapping in
 * `createBetterAuth` below.
 */
export type SocialProviderId =
	| "google"
	| "github"
	| "facebook"
	| "twitter"
	| "cloudflare";

/**
 * Two-factor authentication methods. Currently only TOTP is supported.
 * Email OTP is a deliberate follow-up.
 */
export type TwoFactorMethod = "totp";

export interface BetterAuthOptions {
	/**
	 * Public origin of the site, e.g. "https://example.workers.dev".
	 * Required by Better-Auth for cookie/redirect URL construction.
	 */
	baseURL: string;
	/**
	 * Secret used to sign tokens/cookies. Should come from an environment
	 * secret (e.g. `env.BETTER_AUTH_SECRET`). A stable per-site value.
	 */
	secret: string;
	/**
	 * OAuth social providers to enable, keyed by Better Auth's provider id
	 * (`google`, `github`). Only include a provider when BOTH its clientId and
	 * clientSecret are present; omit/leave empty to disable social sign-in.
	 * Adding a provider later is just another key here (and a field in the
	 * admin settings) — Better Auth supports many more natively.
	 */
	socialProviders?: Partial<
		Record<SocialProviderId, { clientId: string; clientSecret: string }>
	>;
	/** Extra trusted origins for CSRF/redirect validation. */
	trustedOrigins?: string[];
	/**
	 * Email-verification behavior. Admin-configurable (see settings.ts) and
	 * resolved per-request in route.ts, with these defaults when unset:
	 *   - requireEmailVerification: true  (unverified users can't sign in)
	 *   - sendOnSignIn: true              (re-send link on blocked sign-in)
	 *   - autoSignInAfterVerification: true
	 */
	requireEmailVerification?: boolean;
	sendOnSignIn?: boolean;
	autoSignInAfterVerification?: boolean;
	/**
	 * Optional EmDash email pipeline for sending auth emails (password reset,
	 * email verification). When absent, password reset and email verification
	 * are disabled gracefully (users see a friendly message).
	 */
	email?: EmailPipeline | null;
	/**
	 * Whether two-factor authentication (TOTP) is enabled for the site.
	 * Default is false (opt-in per-user). When true, the twoFactor plugin
	 * is registered and users can enroll in TOTP 2FA.
	 */
	twoFactorEnabled?: boolean;
	/**
	 * Whether the admin plugin is enabled. Default false. When true, the
	 * `admin()` plugin is registered, adding user-management APIs (create user,
	 * ban/unban, impersonate, list/filter users, set string role). The admin
	 * `role`/ban fields are stored in the EmDash users.data JSON blob by the
	 * adapter — they do NOT touch EmDash's numeric `users.role` RBAC column.
	 */
	adminEnabled?: boolean;
	/**
	 * Whether the API key plugin is enabled. Default false. When true, the
	 * `apiKey()` plugin is registered, adding create/list/verify/revoke API-key
	 * endpoints and an account "API Keys" card. Keys are stored (hashed) in the
	 * `apikey` plugin-storage collection via the adapter — no site table, no
	 * migration.
	 */
	apiKeyEnabled?: boolean;
	/**
	 * Whether the passkey (WebAuthn) plugin is enabled. Default false. When
	 * true, the `passkey()` plugin is registered, adding passwordless
	 * registration/sign-in and a "Passkeys" account card. Credentials persist to
	 * the `passkey` plugin-storage collection via the adapter — no migration.
	 */
	passkeyEnabled?: boolean;
	/**
	 * Whether the organization plugin (multi-tenancy) is enabled. Default false.
	 * When true, `organization()` is registered, adding organizations, members,
	 * invitations, and (optionally) teams. All of it persists to plugin storage
	 * via the adapter — no site tables, no migration.
	 */
	orgEnabled?: boolean;
	/**
	 * Whether organization teams are enabled. Only meaningful when
	 * `orgEnabled` is true. Default false. Adds team / teamMember collections
	 * and the active-team session field.
	 */
	teamsEnabled?: boolean;
	/**
	 * Whether Stripe subscription billing is enabled. Default false. The
	 * `stripe()` plugin is only registered when this is true AND a secret key is
	 * present AND at least one plan resolves a monthly price id — otherwise it's
	 * a no-op (no billing endpoints, no customer creation).
	 */
	billingEnabled?: boolean;
	/** Stripe secret key (`sk_...`). Required for billing. */
	stripeSecretKey?: string;
	/** Stripe webhook signing secret (`whsec_...`). Required for billing. */
	stripeWebhookSecret?: string;
	/**
	 * Per-plan Stripe price ids, keyed by plan id (see PLAN_DEFINITIONS), e.g.
	 * `{ pro: { month: "price_...", year: "price_..." } }`. These are operator
	 * config (per Stripe account, differ test/live), so they're injected at
	 * runtime rather than hardcoded. A plan with no monthly price id is skipped.
	 */
	planPriceIds?: Record<string, PlanPriceIds | undefined>;
}

/**
 * Create a Better-Auth instance bound to the current request's EmDash
 * database and plugin storage.
 *
 * @param db      EmDash Kysely instance (from `locals.emdash.db`).
 * @param storage Plugin storage collections (from `getAuthProviderStorage`).
 * @param options Per-site configuration (baseURL, secret, optional Google, email pipeline).
 */
/**
 * Build the Stripe plugin array for the current request, or `[]` when billing
 * is off / unconfigured. Separated out so `createBetterAuth` stays readable and
 * the "when do we actually enable billing" rule lives in one place.
 *
 * Enabled only when: the flag is on AND a secret key + webhook secret are set
 * AND at least one plan resolves a monthly price id. Any missing piece → `[]`
 * (no billing endpoints), so a half-configured site degrades cleanly instead
 * of throwing at request time.
 *
 * The Stripe client uses the FETCH http client: workerd has no Node `http`
 * module, so the SDK's default (Node) client would throw on Cloudflare. This is
 * the one Workers-specific line and must not be removed.
 */
function buildStripePlugins(options: BetterAuthOptions): ReturnType<typeof stripePlugin>[] {
	if (!options.billingEnabled) return [];
	if (!options.stripeSecretKey || !options.stripeWebhookSecret) return [];

	const plans = toStripePlans(PLAN_DEFINITIONS, options.planPriceIds ?? {});
	if (plans.length === 0) return [];

	const stripeClient = new Stripe(options.stripeSecretKey, {
		// Workers runtime: use fetch, not Node http.
		httpClient: Stripe.createFetchHttpClient(),
	});

	return [
		stripePlugin({
			stripeClient,
			stripeWebhookSecret: options.stripeWebhookSecret,
			// A Stripe customer is created on sign-up and linked via the user's
			// stripeCustomerId (stored in users.data JSON by the adapter).
			createCustomerOnSignUp: true,
			subscription: {
				enabled: true,
				plans,
			},
		}),
	];
}

export function createBetterAuth(
	db: Kysely<{ users: Record<string, unknown> }>,
	storage: BetterAuthStorage,
	options: BetterAuthOptions,
) {
	const emailPipeline = options.email || null;

	// Verification behavior — admin-configurable, defaulting to the mandatory
	// (bot-blocking) posture when unset.
	const requireEmailVerification = options.requireEmailVerification ?? true;
	const sendOnSignIn = options.sendOnSignIn ?? true;
	const autoSignInAfterVerification = options.autoSignInAfterVerification ?? true;

	// Build Better Auth's socialProviders block from whichever providers have
	// both credentials. Keys map 1:1 to Better Auth's native provider ids
	// (`google`, `github`), so this is just a filtered copy. Empty when none
	// are configured, which disables social sign-in entirely.
	const socialProviders: Record<string, { clientId: string; clientSecret: string }> =
		{};
	for (const [id, creds] of Object.entries(options.socialProviders ?? {})) {
		if (creds?.clientId && creds?.clientSecret) {
			socialProviders[id] = {
				clientId: creds.clientId,
				clientSecret: creds.clientSecret,
			};
		}
	}

	// Extract just the host from the baseURL to use as the TOTP issuer.
	// Better Auth uses this to label entries in authenticator apps.
	const issuer = (() => {
		try {
			return new URL(options.baseURL).hostname;
		} catch {
			return "EmDash";
		}
	})();

	// WebAuthn relying-party config for the passkey plugin, derived from the
	// canonical base URL. `rpID` is the registrable domain (hostname, no port) —
	// a passkey is bound to it, so it MUST match the host the user authenticates
	// on; `origin` is the full scheme+host+port with no trailing slash. We pass
	// the hostname as rpID (valid for localhost and real domains alike) and the
	// baseURL's origin as origin, so passkeys work on the same host the rest of
	// auth uses. Only consumed when the passkey plugin is enabled.
	const passkeyRp = (() => {
		try {
			const url = new URL(options.baseURL);
			return { rpID: url.hostname, origin: url.origin, rpName: issuer };
		} catch {
			return { rpID: "localhost", origin: options.baseURL, rpName: issuer };
		}
	})();

	return betterAuth({
		baseURL: options.baseURL,
		secret: options.secret,
		trustedOrigins: options.trustedOrigins,
		// The app name is used as the TOTP issuer when the plugin doesn't
		// specify its own. We also set it for general app identification.
		appName: issuer,
		// Our adapter routes user -> users table, others -> plugin storage.
		database: emdashAdapter(db as unknown as Kysely<{ users: never }>, storage),
		// Username is always required (no toggle): a mix of users with and
		// without a handle would make bylines/comments/public identity
		// inconsistent. The Better Auth `username` plugin makes the field
		// OPTIONAL (schema `required: false`) and only validates a username when
		// one is supplied, so we enforce presence ourselves in a create hook
		// that runs before the user row is written. `displayUsername` is NOT
		// required — the plugin derives it from `username` when omitted.
		databaseHooks: {
			user: {
				create: {
					before: async (user: Record<string, unknown>) => {
						const username =
							typeof user.username === "string" ? user.username.trim() : "";
						if (!username) {
							throw new Error("Username is required");
						}
						return { data: user };
					},
				},
			},
		},
		emailAndPassword: {
			enabled: true,
			// Mandatory email verification: an unverified user cannot sign in.
			// Better Auth rejects the sign-in with EMAIL_NOT_VERIFIED and (with
			// sendOnSignIn below) re-sends the verification email. This blocks
			// bot-created accounts from becoming usable until the address is
			// confirmed. Admin-configurable (defaults to true).
			requireEmailVerification,
			sendResetPassword: async ({ user, url, token }, request) => {
				// Graceful degradation: if no email pipeline is configured,
				// log and return without throwing. The Better Auth UI will show
				// a generic "check your email" message but the user will never
				// receive one. This is the safest default.
				if (!emailPipeline) {
					console.warn(
						`[better-auth] Password reset requested for ${user.email}, but no email provider is configured.`,
					);
					return;
				}

				const subject = "Reset your password";
				const text = `Click the link below to reset your password.\n\n${url}\n\nIf you didn't request this, you can safely ignore this email.`;
				const html = `<p>Click the link below to reset your password.</p><p><a href="${url}">${url}</a></p><p>If you didn't request this, you can safely ignore this email.</p>`;

				try {
					await emailPipeline.send({ to: user.email, subject, text, html }, "system");
				} catch (err) {
					// Never break auth due to email failure. Log the error for admin
					// visibility, but return successfully so the user flow continues.
					// The UI already shows a generic success message ("check your email"),
					// so a silent failure is acceptable.
					console.error(
						`[better-auth] Failed to send password reset email to ${user.email}:`,
						err instanceof Error ? err.message : String(err),
					);
				}
			},
		},
		// Email verification (mandatory — see requireEmailVerification above).
		// - sendOnSignUp: email the verification link when the account is created.
		// - sendOnSignIn: if an unverified user tries to log in, re-send the
		//   link so they don't have to hunt for the original email.
		// - autoSignInAfterVerification: once they click the link, they're
		//   logged in immediately (no separate login step).
		emailVerification: {
			sendOnSignUp: true,
			sendOnSignIn,
			autoSignInAfterVerification,
			sendVerificationEmail: async ({ user, url }) => {
				if (!emailPipeline) {
					console.warn(
						`[better-auth] Verification email requested for ${user.email}, but no email provider is configured.`,
					);
					return;
				}

				const subject = "Verify your email";
				const text = `Confirm your email address by clicking the link below.\n\n${url}\n\nIf you didn't create an account, you can safely ignore this email.`;
				const html = `<p>Confirm your email address by clicking the link below.</p><p><a href="${url}">${url}</a></p><p>If you didn't create an account, you can safely ignore this email.</p>`;

				try {
					await emailPipeline.send({ to: user.email, subject, text, html }, "system");
				} catch (err) {
					// Never break sign-up because a verification email failed.
					console.error(
						`[better-auth] Failed to send verification email to ${user.email}:`,
						err instanceof Error ? err.message : String(err),
					);
				}
			},
		},
		...(Object.keys(socialProviders).length > 0 ? { socialProviders } : {}),
		// Map Better-Auth's `user` model onto EmDash's `users` columns. The
		// adapter's field-name mapping (via the factory) turns these logical
		// field names into physical column names before any SQL is built.
		// - `name`, `email`, `emailVerified`, `image` (→ `avatar_url`) map to
		//   real columns via the factory.
		// - `bio` is stored in the users.data JSON column (handled by the adapter).
		// - `username`/`displayUsername` live in the usernames collection (handled by adapter).
		user: {
			modelName: "users",
			fields: {
				name: "name",
				email: "email",
				emailVerified: "email_verified",
				image: "avatar_url",
				createdAt: "created_at",
				updatedAt: "updated_at",
			},
			// `bio` is an extra profile field with no real `users` column; the
			// adapter persists it inside the users.data JSON blob (see
			// emdash-adapter.ts) and surfaces it on user reads. Declared here so
			// Better Auth accepts/passes it through. `username`/`displayUsername`
			// are NOT listed — the username plugin owns those fields.
			additionalFields: {
				bio: { type: "string", required: false, input: true },
			},
		},
		// account / session / verification live in schemaless plugin storage,
		// so we keep Better-Auth's native field names (no column mapping) and
		// just point each model at its own storage collection via modelName.
		account: { modelName: "account" },
		session: { modelName: "session" },
		verification: { modelName: "verification" },
		// The `username` plugin adds `username`/`displayUsername` to the USER
		// model (there is no separate "username" model). EmDash's users table
		// has no such columns, so our adapter persists them in the `usernames`
		// plugin-storage collection (unique index on `username`) and augments
		// user reads with them. See emdash-adapter.ts.
		// The `twoFactor` plugin adds per-user TOTP secret + backup codes to
		// plugin storage (`twoFactors` collection) and `twoFactorEnabled` to
		// the user model (stored in users.data JSON). Only enabled when the
		// admin feature flag is set.
		plugins: [
			...buildStripePlugins(options),
			...(options.twoFactorEnabled ? [twoFactor()] : []),
			// Admin plugin: user management (create/ban/impersonate/list, string
			// role). It OWNS the user fields role/banned/banReason/banExpires
			// (we don't declare them as additionalFields); the adapter routes
			// them to the users.data JSON blob, never the numeric users.role.
			...(options.adminEnabled ? [admin()] : []),
			// API key plugin: programmatic API keys (create/list/verify/revoke).
			// Keys are stored hashed in the `apikey` plugin-storage collection via
			// the adapter. Only enabled when the admin feature flag is set.
			...(options.apiKeyEnabled ? [apiKey()] : []),
			// Passkey plugin: passwordless WebAuthn sign-in + registration. The
			// relying-party id/origin are derived from the canonical base URL (see
			// passkeyRp above) so credentials bind to the host users authenticate
			// on. Credentials persist to the `passkey` plugin-storage collection
			// via the adapter. Only enabled when the feature flag is set.
			...(options.passkeyEnabled
				? [
						passkey({
							rpID: passkeyRp.rpID,
							rpName: passkeyRp.rpName,
							origin: passkeyRp.origin,
						}),
					]
				: []),
			// Organization plugin: multi-tenancy. Teams are opt-in and must match
			// the client plugin's teams flag. All models persist to plugin
			// storage via the adapter (no migration).
			...(options.orgEnabled
				? [organization(options.teamsEnabled ? { teams: { enabled: true } } : {})]
				: []),
			username(),
		],
		advanced: {
			// D1 has no native joins config need; keep defaults. Ensure we don't
			// try to use database-generated ids (our adapter makes ULIDs).
			database: {
				generateId: false,
			},
		},
	});
}

export type BetterAuthInstance = ReturnType<typeof createBetterAuth>;
