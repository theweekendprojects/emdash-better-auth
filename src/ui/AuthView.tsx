/**
 * Better Auth UI (HeroUI) island for EmDash sites.
 *
 * A self-contained React island that renders Better Auth UI's prebuilt
 * authentication views (sign-in, sign-up, password recovery, etc.) styled with
 * HeroUI, laid out to match Better Auth UI's own HeroUI example: a sticky
 * header (site name + UserButton) over a centered auth card on a themed surface.
 *
 * The UserButton's dropdown carries the System / Light / Dark theme switcher
 * (via `themePlugin`), so theming lives exactly where the official demo puts
 * it — no separate custom control. The whole thing must live in one island so
 * the header's UserButton shares the AuthProvider/QueryClient context with the
 * card.
 *
 * Styling is self-contained (compiled by Tailwind v4, imported only here), so
 * the site's themed content pages never load these styles.
 *
 * `navigate` uses plain `window.location` since Astro islands have no client
 * router. `redirectTo` sends users to the site root after auth (a fresh
 * sign-up is a subscriber-role EmDash user, so we don't send them to the admin
 * which would bounce them).
 */

// Self-contained styles for the auth UI. Compiled by @tailwindcss/vite.
import "./auth.css";
import extraUiPlugins from "emdash-better-auth/ui-plugins";

import { Auth, AuthProvider, UserButton } from "@better-auth-ui/heroui";
import { themePlugin } from "@better-auth-ui/heroui/plugins/theme";
import { usernamePlugin } from "@better-auth-ui/heroui/plugins/username";
import { twoFactorPlugin } from "@better-auth-ui/heroui/plugins/two-factor";
import { organizationPlugin } from "@better-auth-ui/heroui/plugins/organization";
import { passkeyPlugin } from "@better-auth-ui/heroui/plugins/passkey";
import { oauthProviderPlugin } from "@better-auth-ui/heroui/plugins/oauth-provider";
import { magicLinkPlugin } from "@better-auth-ui/heroui/plugins/magic-link";
import { emailOtpPlugin } from "@better-auth-ui/heroui/plugins/email-otp";
import { multiSessionPlugin } from "@better-auth-ui/heroui/plugins/multi-session";
import { Button, Link, Toast } from "@heroui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "next-themes";
import * as React from "react";

import { authClient } from "../client.js";

// One QueryClient per island mount. Auth pages are standalone, so a simple
// per-mount client is enough (no SSR hydration boundary needed here).
let browserQueryClient: QueryClient | undefined;
function getQueryClient(): QueryClient {
	if (typeof window === "undefined") {
		return new QueryClient({ defaultOptions: { queries: { staleTime: 5_000 } } });
	}
	browserQueryClient ??= new QueryClient({
		defaultOptions: { queries: { staleTime: 5_000 } },
	});
	return browserQueryClient;
}

/**
 * EmDash's brand mark (rounded square + minus). Uses `currentColor` like the
 * social-provider icons so it inherits the button's text color and renders
 * reliably inside a HeroUI Button's startContent slot.
 */
function EmDashIcon() {
	return (
		<svg
			width={18}
			height={18}
			viewBox="0 0 24 24"
			fill="none"
			role="img"
			aria-label="EmDash"
		>
			<rect
				x="2.5"
				y="2.5"
				width="19"
				height="19"
				rx="5"
				stroke="currentColor"
				strokeWidth="2"
			/>
			<rect x="7" y="11" width="10" height="2" rx="1" fill="currentColor" />
		</svg>
	);
}

/**
 * Cross-link to EmDash's native passkey login, styled to match Better Auth
 * UI's own social sign-in buttons (HeroUI tertiary button, full width, icon +
 * label). Shown only on the sign-in view. The two login doors (Better Auth
 * email/password here, EmDash passkey at /_emdash/admin/login) can then reach
 * each other, so passkey-only admins are never stranded. Carries the same
 * `?redirect=` target through.
 */
function EmDashLoginButton({ redirectTo }: { redirectTo: string }) {
	const href = `/_emdash/admin/login?redirect=${encodeURIComponent(redirectTo)}`;
	// HeroUI v3's `as="a"` doesn't reliably emit a working anchor href, so we
	// keep the Button purely for styling and navigate on press.
	const go = () => {
		window.location.href = href;
	};
	return (
		<div className="w-full max-w-sm mt-4">
			<Button variant="tertiary" fullWidth onPress={go} onClick={go}>
				<EmDashIcon />
				<span>Continue with EmDash</span>
			</Button>
		</div>
	);
}

/**
 * "Continue as guest" button (anonymous plugin). Styled like the social /
 * EmDash buttons. Calls `signIn.anonymous()` then sends the user to
 * `redirectTo`. Shown only on the sign-in view when the anonymous flag is on.
 * There's no Better Auth UI plugin for this — it's a single client call.
 */
function GuestButton({ redirectTo }: { redirectTo: string }) {
	const [busy, setBusy] = React.useState(false);
	const go = async () => {
		if (busy) return;
		setBusy(true);
		try {
			const res = await authClient.signIn.anonymous();
			// signIn.anonymous() errors if the current session is already an
			// anonymous user; surface nothing and just navigate on success.
			if (!(res as { error?: unknown })?.error) {
				window.location.href = redirectTo;
				return;
			}
		} catch {
			// Swallow — leave the user on the sign-in page to try another method.
		}
		setBusy(false);
	};
	return (
		<div className="w-full max-w-sm mt-2">
			<Button variant="tertiary" fullWidth isDisabled={busy} onPress={go} onClick={go}>
				<span>{busy ? "Starting guest session…" : "Continue as guest"}</span>
			</Button>
		</div>
	);
}

export interface AuthViewProps {
	/** Better Auth UI view path, e.g. "sign-in" | "sign-up". */
	path: string;
	/** Where to send the user after a successful auth. Defaults to "/". */
	redirectTo?: string;
	/** Social providers to show. Empty by default (email/password only). */
	socialProviders?: string[];
	/** Brand name shown in the header. */
	siteName?: string;
	/** Site logo URL; when set, shown in the header instead of the site name. */
	logoUrl?: string | null;
	/**
	 * Whether the server requires email verification before a session is
	 * created (mirrors `emailAndPassword.requireEmailVerification` in auth.ts).
	 *
	 * The UI needs its own copy of this flag: after a successful sign-up it
	 * only routes to the "check your email" verify page when this is true —
	 * otherwise it sends the user straight to `redirectTo`. If this doesn't
	 * match the server, a mandatory-verification signup would silently land on
	 * the home page with no "verify your email" prompt. Defaults to `true` to
	 * match the plugin's default server config.
	 */
	requireEmailVerification?: boolean;
	/**
	 * Whether two-factor authentication is enabled site-wide (mirrors the
	 * `twoFactorEnabled` admin setting). When true, the Better Auth UI
	 * two-factor plugin is registered so the sign-in flow can render the TOTP
	 * challenge view (at `/auth/two-factor`) for users who have 2FA enabled.
	 * Must match the backend — the server only issues a two-factor challenge
	 * when its `twoFactor` plugin is registered (same flag). Defaults to false.
	 */
	twoFactorEnabled?: boolean;
	/**
	 * Whether organizations are enabled site-wide (mirrors the `orgEnabled`
	 * admin setting). When true, the Better Auth UI organization plugin is
	 * registered so the invitation-acceptance view (`/auth/accept-invitation`)
	 * renders. Must match the backend. Defaults to false.
	 */
	orgEnabled?: boolean;
	/**
	 * Whether passkey (WebAuthn) sign-in is enabled site-wide (mirrors the
	 * `passkeyEnabled` admin setting). When true, the Better Auth UI passkey
	 * plugin is registered so the sign-in view shows a "Sign in with a passkey"
	 * button. Must match the backend — the server only accepts a passkey
	 * assertion when its `passkey` plugin is registered (same flag). Defaults to
	 * false.
	 */
	passkeyEnabled?: boolean;
	/**
	 * Whether the OIDC / OAuth 2.1 identity provider is enabled site-wide
	 * (mirrors the `oidcProviderEnabled` admin setting). When true, the Better
	 * Auth UI oauth-provider plugin is registered so the authorization-flow
	 * redirect screens render: the consent view (`/auth/oauth-consent`) and the
	 * OAuth sign-up view (`/auth/oauth-sign-up`, used for `prompt=create`). Must
	 * match the backend — the server only drives these redirects when its
	 * `oauthProvider` plugin is registered (same flag). Defaults to false.
	 */
	oidcProviderEnabled?: boolean;
	/**
	 * Whether magic-link sign-in is enabled (mirrors `magicLinkEnabled`). When
	 * true, the Better Auth UI magic-link plugin is registered so the sign-in
	 * view shows a "Sign in with email link" option. Defaults to false.
	 */
	magicLinkEnabled?: boolean;
	/**
	 * Whether email-OTP sign-in is enabled (mirrors `emailOtpEnabled`). When
	 * true, the Better Auth UI email-otp plugin is registered so the sign-in
	 * view shows a code-based email sign-in option and the verification /
	 * password-reset flows use OTP codes. Defaults to false.
	 */
	emailOtpEnabled?: boolean;
	/**
	 * Whether anonymous (guest) sign-in is enabled (mirrors `anonymousEnabled`).
	 * When true, a "Continue as guest" button is shown on the sign-in view.
	 * There is no dedicated Better Auth UI plugin for anonymous — it's a single
	 * `signIn.anonymous()` call. Defaults to false.
	 */
	anonymousEnabled?: boolean;
	/**
	 * Whether multi-session is enabled (mirrors `multiSessionEnabled`). When
	 * true, the Better Auth UI multi-session plugin is registered so the
	 * UserButton dropdown shows an account switcher. Also enables the
	 * select-account view for the OIDC flow. Defaults to false.
	 */
	multiSessionEnabled?: boolean;
}

export default function AuthView({
	path,
	redirectTo = "/",
	socialProviders = [],
	siteName = "Home",
	logoUrl = null,
	requireEmailVerification = true,
	twoFactorEnabled = false,
	orgEnabled = false,
	passkeyEnabled = false,
	oidcProviderEnabled = false,
	magicLinkEnabled = false,
	emailOtpEnabled = false,
	anonymousEnabled = false,
	multiSessionEnabled = false,
}: AuthViewProps) {
	const queryClient = getQueryClient();

	return (
		<QueryClientProvider client={queryClient}>
			<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
				<AuthProvider
					authClient={authClient}
					redirectTo={redirectTo}
					socialProviders={socialProviders}
					emailAndPassword={{ requireEmailVerification }}
					// Point the `settings` base path at /account so the UserButton
					// dropdown's "Settings" link (and any settings link from the auth
					// flow) resolves to our mounted account page, not the default
					// "/settings" (which would 404). Keep `auth` at /auth.
					basePaths={{
						auth: "/auth",
						settings: "/account",
						admin: "/admin",
						organization: "/organization",
					}}
					// usernamePlugin() makes the UI render a required username field on
					// sign-up (and username-or-email on sign-in). Without it the auth
					// client accepts usernames but the form never collects one, so
					// signup would fail server-side validation. `displayUsername` is
					// derived from `username`, so we don't render a separate field.
					// twoFactorPlugin registers the TOTP challenge view so a user
					// with 2FA enabled is prompted for their authenticator code after
					// their password. Only added when the site flag is on, matching
					// the backend (which only issues a challenge when its `twoFactor`
					// plugin is registered). TOTP-only for now.
					plugins={[
						themePlugin({ useTheme }),
						usernamePlugin({ displayUsername: false, isUsernameAvailable: true }),
						...(twoFactorEnabled
							? [twoFactorPlugin({ enrollmentMethods: ["totp"] })]
							: []),
						// Adds the "Sign in with a passkey" button to the sign-in view.
						// Only when the site flag is on, matching the backend (which
						// only accepts a passkey assertion when its `passkey` plugin is
						// registered).
						...(passkeyEnabled ? [passkeyPlugin()] : []),
						// Registers the invitation-acceptance view so an invite link
						// (/auth/accept-invitation) renders. Only when org is on.
						...(orgEnabled ? [organizationPlugin()] : []),
						// Registers the OAuth authorization-flow redirect screens:
						// the consent view (/auth/oauth-consent) and the OAuth
						// sign-up view (/auth/oauth-sign-up, for prompt=create). Only
						// when the identity-provider flag is on, matching the backend
						// `oauthProvider` plugin. The signed authorization query is
						// forwarded by oauthProviderClient() (see client.ts).
						...(oidcProviderEnabled ? [oauthProviderPlugin()] : []),
						// Passwordless sign-in options on the auth views. Each only
						// when its site flag is on, matching the backend plugin.
						//   - magic-link: "email me a sign-in link"
						//   - email-otp:  code-based email sign-in + OTP verify/reset
						//   - multi-session: account switcher in the UserButton (also
						//     drives the OIDC select-account screen)
						...(magicLinkEnabled ? [magicLinkPlugin()] : []),
						...(emailOtpEnabled ? [emailOtpPlugin()] : []),
						...(multiSessionEnabled ? [multiSessionPlugin()] : []),
						...extraUiPlugins,
					]}
					navigate={({ to, replace }: { to: string; replace?: boolean }) => {
						if (replace) window.location.replace(to);
						else window.location.href = to;
					}}
				>
					<header className="sticky top-0 z-10 bg-background border-b">
						<div className="py-3 px-4 md:px-6 mx-auto justify-between flex items-center">
							<Link href="/" className="no-underline text-foreground">
								{logoUrl ? (
									<img src={logoUrl} alt={siteName} className="h-7 w-auto max-w-40 object-contain" />
								) : (
									<h1 className="sm:text-base truncate font-semibold">{siteName}</h1>
								)}
							</Link>
							<UserButton size="icon" placement="bottom end" />
						</div>
					</header>

					<main className="flex-1 flex flex-col items-center my-auto p-4 md:p-6">
						<Auth path={path} />
						{path === "sign-in" && <EmDashLoginButton redirectTo={redirectTo} />}
						{path === "sign-in" && anonymousEnabled && (
							<GuestButton redirectTo={redirectTo} />
						)}
					</main>

					<Toast.Provider />
				</AuthProvider>
			</ThemeProvider>
		</QueryClientProvider>
	);
}
