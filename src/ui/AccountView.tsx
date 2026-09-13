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
}

export default function AccountView({
	path = "account",
	redirectTo = "/account",
	socialProviders = [],
	siteName = "Account",
}: AccountViewProps) {
	const queryClient = getQueryClient();

	return (
		<QueryClientProvider client={queryClient}>
			<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
				<AuthProvider
					authClient={authClient}
					redirectTo={redirectTo}
					socialProviders={socialProviders}
					// The Settings view handles account editing (name, avatar,
					// username, bio) and security (password, linked accounts).
					plugins={[
						themePlugin({ useTheme }),
						usernamePlugin({ displayUsername: false, isUsernameAvailable: true }),
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
						<Settings path={path} />
					</main>

					<Toast.Provider />
				</AuthProvider>
			</ThemeProvider>
		</QueryClientProvider>
	);
}
