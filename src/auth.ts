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
import type { Kysely } from "kysely";
import { emdashAdapter, type BetterAuthStorage } from "./emdash-adapter.js";

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
export type SocialProviderId = "google" | "github";

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
}

/**
 * Create a Better-Auth instance bound to the current request's EmDash
 * database and plugin storage.
 *
 * @param db      EmDash Kysely instance (from `locals.emdash.db`).
 * @param storage Plugin storage collections (from `getAuthProviderStorage`).
 * @param options Per-site configuration (baseURL, secret, optional Google, email pipeline).
 */
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
			...(options.twoFactorEnabled ? [twoFactor()] : []),
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
