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
import extraUiPlugins from "emdash-better-auth/ui-plugins";

import { AuthProvider, UserButton, type UserButtonLink } from "@better-auth-ui/heroui";
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

/**
 * Upstream race condition in @better-auth-ui/heroui (verified through 1.7.26):
 * the members / invitations tables add a leading checkbox COLUMN once the
 * "can delete" permission query resolves, but their loading placeholder row
 * always renders one cell fewer. If the permission answers BEFORE the list
 * does, HeroUI's Table throws "Cell count must match column count. Found 3
 * cells and 4 columns." and the whole page goes blank. Which request wins is
 * network timing, so it is intermittent in the wild (deterministic for us).
 *
 * Primary fix: client.ts orders the permission response after its sibling
 * requests so the race cannot happen. This boundary is only a safety net: it
 * catches exactly that error, remounts a few times, then shows a Reload button.
 * (Retrying alone is NOT enough - unmounting the table makes react-query abort
 * the in-flight member requests, so the data never lands.) Any OTHER error is
 * surfaced, not retried. Delete this once upstream fixes the skeleton row.
 */
const TRANSIENT_TABLE_ERROR = /Cell count must match column count/;

interface RetryBoundaryProps {
	children: React.ReactNode;
	/** Max remounts per failure streak (delay * retries = total patience). */
	maxRetries?: number;
	delayMs?: number;
}
interface RetryBoundaryState {
	failed: boolean;
	attempt: number;
	gaveUp: boolean;
	message: string;
}

class TableRaceBoundary extends React.Component<RetryBoundaryProps, RetryBoundaryState> {
	state: RetryBoundaryState = { failed: false, attempt: 0, gaveUp: false, message: "" };
	private retryTimer: ReturnType<typeof setTimeout> | undefined;
	private stableTimer: ReturnType<typeof setTimeout> | undefined;

	static getDerivedStateFromError(error: Error): Partial<RetryBoundaryState> {
		return { failed: true, message: error?.message ?? "" };
	}

	componentDidCatch(error: Error) {
		clearTimeout(this.stableTimer);
		// Safety net only: the request-ordering fix in client.ts prevents the race.
		// If it ever slips through, retry a few times then offer a Reload button
		// (a long retry loop would just keep aborting the in-flight requests).
		const { maxRetries = 3, delayMs = 600 } = this.props;
		const transient = TRANSIENT_TABLE_ERROR.test(error?.message ?? "");
		if (!transient || this.state.attempt >= maxRetries) {
			this.setState({ gaveUp: true });
			return;
		}
		this.retryTimer = setTimeout(
			() => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 })),
			delayMs,
		);
	}

	componentDidUpdate() {
		// Rendered without throwing and stayed up: the race is over, so reset the
		// streak (a later org switch gets a fresh retry budget).
		if (!this.state.failed && this.state.attempt > 0) {
			clearTimeout(this.stableTimer);
			this.stableTimer = setTimeout(() => this.setState({ attempt: 0 }), 3000);
		}
	}

	componentWillUnmount() {
		clearTimeout(this.retryTimer);
		clearTimeout(this.stableTimer);
	}

	render() {
		if (this.state.failed) {
			if (this.state.gaveUp) {
				return (
					<div role="alert" className="text-center space-y-3">
						<p>Something went wrong loading this page.</p>
						<button type="button" className="underline" onClick={() => window.location.reload()}>
							Reload
						</button>
					</div>
				);
			}
			return (
				<p role="status" className="text-center text-muted">
					Loading…
				</p>
			);
		}
		// `key` forces a full remount on each retry so the table rebuilds.
		return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
	}
}

export interface OrganizationViewProps {
	/** Better Auth UI organization view path: "settings" | "people" | "teams". */
	path?: string;
	/** Brand name shown in the header. */
	siteName?: string;
	/** Site logo URL; when set, shown in the header instead of the site name. */
	logoUrl?: string | null;
	/**
	 * Whether organization teams are enabled site-wide (mirrors the backend
	 * `teams` flag). When true, the Teams tab is added to the org shell. Must
	 * match the server, which only registers team models when teams are on.
	 */
	teamsEnabled?: boolean;
	/**
	 * Whether the signed-in user is an EmDash admin (role >= 50). When true,
	 * adds an "EmDash Admin" entry to the UserButton dropdown. Unlike
	 * AdminView, this page is reached by any org member, not just admins, so
	 * the link is conditional here (same pattern as AccountView).
	 */
	isEmdashAdmin?: boolean;
	/** Admin user-management plugin on (adds a "Manage users" menu link). */
	adminEnabled?: boolean;
	/** Audit logging on (adds an "Audit log" menu link). */
	auditLogEnabled?: boolean;
	/** Multi-session on (adds the "Switch Account" menu item, as on /account). */
	multiSessionEnabled?: boolean;
}

export default function OrganizationView({
	path = "settings",
	siteName = "Organization",
	logoUrl = null,
	teamsEnabled = false,
	isEmdashAdmin = false,
	adminEnabled = false,
	auditLogEnabled = false,
	multiSessionEnabled = false,
}: OrganizationViewProps) {
	const queryClient = getQueryClient();
	const adminLinks: UserButtonLink[] = buildNavLinks({
		isEmdashAdmin,
		adminEnabled,
		auditLogEnabled,
		// This IS the organization page, so orgEnabled is implied.
		orgEnabled: true,
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
						organizationPlugin(teamsEnabled ? { teams: { enabled: true } } : {}),
						...(multiSessionEnabled ? [multiSessionPlugin()] : []),
						...extraUiPlugins,
					]}
					navigate={({ to, replace }: { to: string; replace?: boolean }) => {
						if (replace) window.location.replace(to);
						else window.location.href = to;
					}}
				>
					<header className="sticky top-0 z-10 bg-background border-b">
						<div className="py-3 px-4 md:px-6 mx-auto justify-between flex items-center gap-3">
							<Link href="/" className="no-underline text-foreground">
								{logoUrl ? (
									<img src={logoUrl} alt={siteName} className="h-7 w-auto max-w-40 object-contain" />
								) : (
									<h1 className="sm:text-base truncate font-semibold">{siteName}</h1>
								)}
							</Link>
							<div className="flex items-center gap-3">
								<OrganizationSwitcher placement="bottom end" />
								<UserButton size="icon" placement="bottom end" links={adminLinks} />
							</div>
						</div>
					</header>

					<main className="flex-1 flex flex-col items-center my-auto p-4 md:p-6">
						{/* People shows tables (needs width); settings/teams are
						    single-column forms, so match AccountView's 28rem for a
						    consistent look across the auth surfaces. */}
						<div
							style={{ width: "100%", maxWidth: path === "people" ? "48rem" : "28rem" }}
						>
							<TableRaceBoundary>
								<Organization view={path} />
							</TableRaceBoundary>
						</div>
					</main>

					<Toast.Provider />
				</AuthProvider>
			</ThemeProvider>
		</QueryClientProvider>
	);
}
