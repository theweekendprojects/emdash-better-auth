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

import { Auth, AuthProvider, UserButton } from "@better-auth-ui/heroui";
import { themePlugin } from "@better-auth-ui/heroui/plugins/theme";
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

export interface AuthViewProps {
	/** Better Auth UI view path, e.g. "sign-in" | "sign-up". */
	path: string;
	/** Where to send the user after a successful auth. Defaults to "/". */
	redirectTo?: string;
	/** Social providers to show. Empty by default (email/password only). */
	socialProviders?: string[];
	/** Brand name shown in the header. */
	siteName?: string;
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
}

export default function AuthView({
	path,
	redirectTo = "/",
	socialProviders = [],
	siteName = "Home",
	requireEmailVerification = true,
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
					plugins={[themePlugin({ useTheme })]}
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
						<Auth path={path} />
						{path === "sign-in" && <EmDashLoginButton redirectTo={redirectTo} />}
					</main>

					<Toast.Provider />
				</AuthProvider>
			</ThemeProvider>
		</QueryClientProvider>
	);
}
