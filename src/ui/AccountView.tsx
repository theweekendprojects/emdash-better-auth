/**
 * Better Auth UI (HeroUI) island for subscriber profile editing.
 *
 * A self-contained React island that renders Better Auth UI's prebuilt
 * account settings views (Profile/AccountSettings, Security/ChangePassword,
 * Linked Accounts, etc.) styled with HeroUI, laid out to match Better Auth UI's
 * own HeroUI example.
 *
 * The island mirrors AuthView.tsx: it wraps Better Auth UI's Settings component
 * inside AuthProvider with the same authClient, HeroUI styling, themePlugin,
 * and usernamePlugin. The Settings view exposes name, avatar, username, bio
 * (from users.data), plus the security tab with password and linked accounts.
 *
 * Styling is self-contained (compiled by Tailwind v4, imported only here), so
 * the site's themed content pages never load these styles.
 *
 * `navigate` uses plain `window.location` since Astro islands have no client
 * router. `redirectTo` sends users to /account after auth (they're already
 * logged in, so we stay on the account page).
 *
 * Avatar: no custom upload handler is wired, so Better Auth UI stores a
 * resized data URL directly in `user.image` (→ `users.avatar_url`). This works
 * with no backend. An R2-backed upload (via EmDash's media pipeline) is a
 * future follow-up.
 */

// Self-contained styles for the auth UI. Compiled by @tailwindcss/vite.
import "./auth.css";

import { AuthProvider, Settings, UserButton } from "@better-auth-ui/heroui";
import { themePlugin } from "@better-auth-ui/heroui/plugins/theme";
import { usernamePlugin } from "@better-auth-ui/heroui/plugins/username";
import { twoFactorPlugin } from "@better-auth-ui/heroui/plugins/two-factor";
import { organizationPlugin } from "@better-auth-ui/heroui/plugins/organization";
import { apiKeyPlugin } from "@better-auth-ui/heroui/plugins/api-key";
import { passkeyPlugin } from "@better-auth-ui/heroui/plugins/passkey";
import { oauthProviderPlugin } from "@better-auth-ui/heroui/plugins/oauth-provider";
import { AuditLogTable } from "./AuditLogView.js";
import { emailOtpPlugin } from "@better-auth-ui/heroui/plugins/email-otp";
import { multiSessionPlugin } from "@better-auth-ui/heroui/plugins/multi-session";
import { billingPlugin } from "@better-auth-ui/heroui/plugins/billing";
import { createStripeBillingAdapter } from "@better-auth-ui/core/plugins/billing";
import { PLAN_DEFINITIONS, toBillingPlans, type PlanPriceIds } from "../billing-plans.js";
import { Link, Toast } from "@heroui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "next-themes";
import * as React from "react";

import { authClient } from "../client.js";

// One QueryClient per island mount.
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

export interface AccountViewProps {
	/** Better Auth UI settings view path, e.g. "account" | "security". */
	path?: string;
	/** Where to send the user after a successful auth. Defaults to "/account". */
	redirectTo?: string;
	/** Social providers to show. Empty by default (email/password only). */
	socialProviders?: string[];
	/** Brand name shown in the header. */
	siteName?: string;
	/** Site logo URL; when set, shown in the header instead of the site name. */
	logoUrl?: string | null;
	/**
	 * Whether two-factor authentication is enabled site-wide (mirrors the
	 * `twoFactorEnabled` admin setting the auth route reads). When true, the
	 * Better Auth UI two-factor plugin is registered so the Security tab shows
	 * the "enable 2FA" enrollment card (QR + backup codes). When false, no 2FA
	 * card renders — matching the backend, which only registers the server
	 * `twoFactor` plugin when the flag is on. Defaults to false.
	 */
	twoFactorEnabled?: boolean;
	/**
	 * Whether organizations are enabled site-wide (mirrors `orgEnabled`). When
	 * true, the org UI plugin adds an "Organizations" tab to Settings (list the
	 * user's orgs + pending invitations, create new ones). Defaults to false.
	 */
	orgEnabled?: boolean;
	/**
	 * Whether the API key plugin is enabled (mirrors `apiKeyEnabled`). When true,
	 * the API key UI plugin adds an "API Keys" card to the Security tab (create,
	 * copy, revoke). Defaults to false.
	 */
	apiKeyEnabled?: boolean;
	/**
	 * Whether passkeys are enabled (mirrors `passkeyEnabled`). When true, the
	 * passkey UI plugin adds a "Passkeys" card to the Security tab (register,
	 * rename, delete device passkeys). Defaults to false.
	 */
	passkeyEnabled?: boolean;
	/**
	 * Whether Stripe subscription billing is enabled (mirrors `billingEnabled`).
	 * When true AND at least one plan has a monthly price id, the billing UI
	 * plugin adds a "Billing" tab (pricing, checkout, portal, cancel). Defaults
	 * to false.
	 */
	billingEnabled?: boolean;
	/**
	 * Whether the OIDC / OAuth 2.1 identity provider is enabled (mirrors
	 * `oidcProviderEnabled`). When true, the oauth-provider UI plugin adds a
	 * "Connected applications" card to the Security tab (apps the user has
	 * authorized, with a remove action) and an "OAuth clients" tab for managing
	 * the user's own OAuth clients (create / edit / delete / rotate secret).
	 * Defaults to false.
	 */
	oidcProviderEnabled?: boolean;
	/**
	 * Whether audit logging is enabled (mirrors `auditLogEnabled`). When true, a
	 * read-only "Recent activity" card is shown below the settings, listing the
	 * signed-in user's OWN auth events (the list endpoint scopes to the session
	 * user, so a user never sees anyone else's). Defaults to false.
	 */
	auditLogEnabled?: boolean;
	/**
	 * Whether email-OTP is enabled (mirrors `emailOtpEnabled`). When true, the
	 * email-otp UI plugin wires OTP-based email change / verification into the
	 * account settings. Defaults to false.
	 */
	emailOtpEnabled?: boolean;
	/**
	 * Whether multi-session is enabled (mirrors `multiSessionEnabled`). When
	 * true, the multi-session UI plugin adds the account switcher to the
	 * UserButton and account management. Defaults to false.
	 */
	multiSessionEnabled?: boolean;
	/**
	 * Per-plan Stripe price ids keyed by plan id, e.g.
	 * `{ pro: { month: "price_...", year: "price_..." } }`. NOT secret (price
	 * ids are safe to expose client-side), so passed into the island. Plans
	 * without a monthly id are dropped from the pricing UI.
	 */
	planPriceIds?: Record<string, PlanPriceIds | undefined>;
}

export default function AccountView({
	path = "account",
	redirectTo = "/account",
	socialProviders = [],
	siteName = "Account",
	logoUrl = null,
	twoFactorEnabled = false,
	orgEnabled = false,
	apiKeyEnabled = false,
	passkeyEnabled = false,
	billingEnabled = false,
	oidcProviderEnabled = false,
	auditLogEnabled = false,
	emailOtpEnabled = false,
	multiSessionEnabled = false,
	planPriceIds = {},
}: AccountViewProps) {
	const queryClient = getQueryClient();

	// Build the billing adapter once per mount, only when billing is on and at
	// least one plan has a monthly price id. Memoized so the adapter identity is
	// stable across renders (the plugin keys queries off it).
	const billingAdapter = React.useMemo(() => {
		if (!billingEnabled) return null;
		const plans = toBillingPlans(PLAN_DEFINITIONS, planPriceIds);
		if (plans.length === 0) return null;
		return createStripeBillingAdapter(authClient, {
			plans,
			successUrl: "/account/billing?checkout=success",
			cancelUrl: "/account/billing?checkout=canceled",
			returnUrl: "/account/billing",
		});
	}, [billingEnabled, planPriceIds]);

	return (
		<QueryClientProvider client={queryClient}>
			<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
				<AuthProvider
					authClient={authClient}
					redirectTo={redirectTo}
					socialProviders={socialProviders}
					// IMPORTANT: Better Auth UI builds its internal links from
					// `basePaths`, whose `settings` default is "/settings". We mount
					// the account UI at /account, so without this override the
					// Settings component's tabs (e.g. Security) would link to
					// /settings/security → 404. Point `settings` at /account so the
					// tab links resolve to our real routes (/account/account,
					// /account/security). `auth` stays /auth to match the auth pages.
					basePaths={{
						auth: "/auth",
						settings: "/account",
						admin: "/admin",
						organization: "/organization",
					}}
					// The Settings view handles account editing (name, avatar,
					// username, bio) and security (password, linked accounts).
					// twoFactorPlugin contributes the "Two-Factor Authentication"
					// card to the Security tab (enroll via authenticator app → QR +
					// backup codes, and disable). Only registered when the site flag
					// is on, so the card matches the backend (which only registers the
					// server `twoFactor` plugin when enabled). TOTP-only for now —
					// email OTP is a deliberate follow-up.
					plugins={[
						themePlugin({ useTheme }),
						usernamePlugin({ displayUsername: false, isUsernameAvailable: true }),
						...(twoFactorEnabled
							? [twoFactorPlugin({ enrollmentMethods: ["totp"] })]
							: []),
						// Adds the "Organizations" tab to Settings (list orgs + pending
						// invitations + create). Only when org is on.
						...(orgEnabled ? [organizationPlugin()] : []),
						// Adds the "Passkeys" card to the Security tab (register /
						// rename / delete device passkeys). Only when the flag is on,
						// matching the backend `passkey()` plugin.
						...(passkeyEnabled ? [passkeyPlugin()] : []),
						// Adds the "API Keys" card to the Security tab (create / copy /
						// revoke). Only when the flag is on, matching the backend
						// `apiKey()` plugin.
						...(apiKeyEnabled ? [apiKeyPlugin()] : []),
						// Adds the "Connected applications" security card (apps the
						// user authorized via OIDC, with a remove action) and the
						// "OAuth clients" tab for the user to manage their own OAuth
						// clients (create / edit / delete / rotate secret) through
						// Better Auth's signed-in client endpoints. Only when the
						// identity-provider flag is on, matching the backend
						// `oauthProvider` plugin. `clientManagement: true` enables the
						// personal client tab.
						...(oidcProviderEnabled
							? [oauthProviderPlugin({ clientManagement: true })]
							: []),
						// Email-OTP: OTP-based email change / verification in account
						// settings. Multi-session: account switcher in the UserButton.
						// Each only when its site flag is on, matching the backend.
						...(emailOtpEnabled ? [emailOtpPlugin()] : []),
						...(multiSessionEnabled ? [multiSessionPlugin()] : []),
						// Adds the "Billing" tab (pricing, checkout, portal, cancel).
						// Personal (user) billing only — org billing is intentionally
						// off. Only when billing is on and plans resolved.
						...(billingAdapter
							? [billingPlugin({ adapter: billingAdapter, user: true })]
							: []),
					]}
					// `bio` is a profile-only field, stored in users.data by the
					// adapter (see emdash-adapter.ts). Declared here so Better Auth
					// UI renders a textarea for it on the account settings form.
					// `signUp: false` keeps it off the sign-up form.
					additionalFields={[
						{
							name: "bio",
							type: "string",
							label: "Bio",
							inputType: "textarea",
							placeholder: "Tell us a little about yourself",
							signUp: false,
							profile: true,
						},
					]}
					// Avatar: no `upload` handler is provided, so Better Auth UI
					// resizes the image and stores a compact data URL directly in
					// user.image (→ users.avatar_url via the adapter). This works
					// with zero backend wiring. R2-backed upload is a future
					// follow-up (would add `avatar={{ upload: ... }}` pointing at an
					// EmDash media endpoint).
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
						{/* Constrain the settings column so the Account tab matches
						    the compact, centered width the Security tab already uses.
						    Without this, Better Auth UI's account cards stretch the
						    full viewport width. Inline style (not a Tailwind class):
						    this island only emits utilities Tailwind finds via the
						    @source scan of the HeroUI / Better Auth UI packages (see
						    auth.css), so a max-w-* class used only here is purged and
						    silently no-ops — the inline style can't be. ~28rem ≈ the
						    Security panel's column width. */}
						<div style={{ width: "100%", maxWidth: "28rem" }}>
							<Settings path={path} />
							{/* Per-user "Recent activity": the user's own auth events.
							    Only on the account landing view (not security/billing
							    sub-views) to keep those focused. The list endpoint
							    scopes to the session user, so this never leaks other
							    users' rows. Compact: no status filter, small page. */}
							{auditLogEnabled && path === "account" && (
								<div className="mt-6">
									<h2 className="text-base font-semibold mb-2">Recent activity</h2>
									<AuditLogTable mode="self" pageSize={10} hideFilter />
								</div>
							)}
						</div>
					</main>

					<Toast.Provider />
				</AuthProvider>
			</ThemeProvider>
		</QueryClientProvider>
	);
}
