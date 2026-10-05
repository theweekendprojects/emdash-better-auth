/**
 * Better Auth UI (HeroUI) island for admin user management.
 *
 * Renders Better Auth UI's prebuilt `<Admin>` view (the /admin/users page +
 * user-detail drawer): create users, update name/role, set password, ban/unban,
 * impersonate, delete, and revoke sessions. The UI checks the matching Admin
 * client permission before enabling each action, so authorization is enforced
 * by Better Auth, not by this shell.
 *
 * Mirrors AuthView/AccountView: one self-contained island wrapping Better Auth
 * UI inside AuthProvider with the shared authClient, HeroUI styling, and the
 * theme + username plugins. The `adminPlugin()` UI plugin is what makes the
 * <Admin> view and the "Stop impersonating" UserButton action work.
 *
 * Self-styled (auth.css, Tailwind v4) so the site's themed pages never load
 * these styles. `navigate` uses plain window.location (Astro islands have no
 * client router).
 */

// Self-contained styles for the auth UI. Compiled by @tailwindcss/vite.
import "./auth.css";

import { Admin, AuthProvider, UserButton, type UserButtonLink } from "@better-auth-ui/heroui";
import { adminPlugin } from "@better-auth-ui/heroui/plugins";
import { themePlugin } from "@better-auth-ui/heroui/plugins/theme";
import { usernamePlugin } from "@better-auth-ui/heroui/plugins/username";
import { Link, Toast } from "@heroui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "next-themes";
import * as React from "react";
import { multiSessionPlugin } from "@better-auth-ui/heroui/plugins/multi-session";
import { buildNavLinks } from "./nav-links.js";

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

export interface AdminViewProps {
	/** Better Auth UI admin view path. Currently only "users". */
	path?: string;
	/** Brand name shown in the header. */
	siteName?: string;
	/** Site logo URL; when set, shown in the header instead of the site name. */
	logoUrl?: string | null;
	/** Audit logging on (adds an "Audit log" menu link). */
	auditLogEnabled?: boolean;
	/** Organizations on (adds an "Organization" menu link). */
	orgEnabled?: boolean;
	/** Multi-session on (adds the "Switch Account" menu item, as on /account). */
	multiSessionEnabled?: boolean;
}


export default function AdminView({
	path = "users",
	siteName = "Admin",
	logoUrl = null,
	auditLogEnabled = false,
	orgEnabled = false,
	multiSessionEnabled = false,
}: AdminViewProps) {
	const queryClient = getQueryClient();
	// Reaching this island at all requires EmDash admin and the admin plugin
	// (enforced server-side in admin/[...path].astro), so both are implied; the
	// menu lists every link, this page's own included, like all other pages.
	const adminLinks: UserButtonLink[] = buildNavLinks({
		isEmdashAdmin: true,
		adminEnabled: true,
		auditLogEnabled,
		orgEnabled,
	});

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
						adminPlugin(),
						...(multiSessionEnabled ? [multiSessionPlugin()] : []),
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
							<UserButton size="icon" placement="bottom end" links={adminLinks} />
						</div>
					</header>

					<main className="admin-view flex-1 flex flex-col items-center my-auto p-4 md:p-6">
						<div style={{ width: "100%", maxWidth: "64rem" }}>
							<Admin view={path} />
						</div>
					</main>

					<Toast.Provider />
				</AuthProvider>
			</ThemeProvider>
		</QueryClientProvider>
	);
}
