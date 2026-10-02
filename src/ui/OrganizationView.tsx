/**
 * Better Auth UI (HeroUI) island for organization (multi-tenancy) management.
 *
 * Renders Better Auth UI's prebuilt `<Organization>` shell mounted at
 * /organization/<path>: the settings tab (profile + danger zone) and the people
 * tab (members + invitations) for the ACTIVE organization. The active org is
 * whatever the user picked in the header's <OrganizationSwitcher> (persisted on
 * the server session via setActive).
 *
 * Mirrors AuthView/AccountView: one self-contained island wrapping Better Auth
 * UI inside AuthProvider with the shared authClient, HeroUI styling, and the
 * theme + username plugins. `organizationPlugin()` is what mounts the shell,
 * the switcher, and the org endpoints' hooks. `teamsEnabled` adds the Teams tab
 * — it must match the backend (the server only registers team models when the
 * `teams` flag is on).
 *
 * Self-styled (auth.css, Tailwind v4). `navigate` uses window.location.
 */

// Self-contained styles for the auth UI. Compiled by @tailwindcss/vite.
import "./auth.css";

import { AuthProvider, UserButton } from "@better-auth-ui/heroui";
import {
	Organization,
	OrganizationSwitcher,
	organizationPlugin,
} from "@better-auth-ui/heroui/plugins/organization";
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

export interface OrganizationViewProps {
	/** Better Auth UI organization view path: "settings" | "people" | "teams". */
	path?: string;
	/** Brand name shown in the header. */
	siteName?: string;
	/**
	 * Whether organization teams are enabled site-wide (mirrors the backend
	 * `teams` flag). When true, the Teams tab is added to the org shell. Must
	 * match the server, which only registers team models when teams are on.
	 */
	teamsEnabled?: boolean;
}

export default function OrganizationView({
	path = "settings",
	siteName = "Organization",
	teamsEnabled = false,
}: OrganizationViewProps) {
	const queryClient = getQueryClient();

	return (
		<QueryClientProvider client={queryClient}>
			<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
				<AuthProvider
					authClient={authClient}
					basePaths={{
						auth: "/auth",
						settings: "/account",
						admin: "/admin",
						organization: "/organization",
					}}
					plugins={[
						themePlugin({ useTheme }),
						usernamePlugin({ displayUsername: false, isUsernameAvailable: true }),
						organizationPlugin(teamsEnabled ? { teams: { enabled: true } } : {}),
					]}
					navigate={({ to, replace }: { to: string; replace?: boolean }) => {
						if (replace) window.location.replace(to);
						else window.location.href = to;
					}}
				>
					<header className="sticky top-0 z-10 bg-background border-b">
						<div className="py-3 px-4 md:px-6 mx-auto justify-between flex items-center gap-3">
							<Link href="/" className="no-underline text-foreground">
								<h1 className="sm:text-base truncate font-semibold">{siteName}</h1>
							</Link>
							<div className="flex items-center gap-3">
								<OrganizationSwitcher placement="bottom end" />
								<UserButton size="icon" placement="bottom end" />
							</div>
						</div>
					</header>

					<main className="flex-1 flex flex-col items-center my-auto p-4 md:p-6">
						<div style={{ width: "100%", maxWidth: "48rem" }}>
							<Organization view={path} />
						</div>
					</main>

					<Toast.Provider />
				</AuthProvider>
			</ThemeProvider>
		</QueryClientProvider>
	);
}
