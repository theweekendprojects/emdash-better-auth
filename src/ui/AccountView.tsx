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
}

export default function AccountView({
	path = "account",
	redirectTo = "/account",
	socialProviders = [],
	siteName = "Account",
	twoFactorEnabled = false,
	orgEnabled = false,
}: AccountViewProps) {
	const queryClient = getQueryClient();

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
								<h1 className="sm:text-base truncate font-semibold">{siteName}</h1>
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
						</div>
					</main>

					<Toast.Provider />
				</AuthProvider>
			</ThemeProvider>
		</QueryClientProvider>
	);
}
