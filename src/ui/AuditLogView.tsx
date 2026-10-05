/**
 * Audit-log viewer island.
 *
 * `better-auth-audit-logs` ships NO Better Auth UI component, so we render the
 * table ourselves. Data comes from the `/audit-log/list` endpoint the server
 * plugin registers (reached via `authClient.$fetch` — see the note on the fetch
 * call below for why we don't use a generated client method).
 *
 * Two modes, one component:
 *   - mode="admin": site-wide log for admins (the /audit-log page). The list
 *     endpoint returns every user's events for a caller with admin access.
 *   - mode="self": the signed-in user's OWN activity (the account "Recent
 *     activity" card). The endpoint defaults to the session user, so no userId
 *     is passed — a user can only ever see their own rows.
 *
 * ponytail: this renders a plain semantic <table> + a native <select> filter,
 * NOT HeroUI's <Table>/<Tabs>. HeroUI v3's table is a react-aria *collection*
 * component (TableRoot > TableContent > ... primitives); the flat Table API
 * throws "cannot be rendered outside a collection" both in SSR and on the
 * client. A log table needs none of react-aria's selection/keyboard-nav
 * machinery, so a plain table is smaller, SSR-safe, and has nothing to break.
 * Chip/Spinner (not collection components) are still HeroUI for visual parity.
 */

import "./auth.css";

import { AuthProvider, UserButton } from "@better-auth-ui/heroui";
import { multiSessionPlugin } from "@better-auth-ui/heroui/plugins/multi-session";
import { themePlugin } from "@better-auth-ui/heroui/plugins/theme";
import { usernamePlugin } from "@better-auth-ui/heroui/plugins/username";
import { Chip, Link, Spinner, buttonVariants } from "@heroui/react";
import {
	QueryClient,
	QueryClientProvider,
	keepPreviousData,
	useQuery,
} from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "next-themes";
import * as React from "react";

import { authClient } from "../client.js";
import { buildNavLinks } from "./nav-links.js";

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

/** One audit entry as returned by the list endpoint (dates arrive as strings). */
interface Entry {
	id: string;
	userId: string | null;
	action: string;
	status: "success" | "failed";
	severity: "low" | "medium" | "high" | "critical";
	ipAddress: string | null;
	createdAt: string;
}

const PAGE_SIZE = 25;

/** Severity → HeroUI Chip color. */
const SEVERITY_COLOR: Record<Entry["severity"], "default" | "warning" | "danger"> = {
	low: "default",
	medium: "default",
	high: "warning",
	critical: "danger",
};

function fmtTime(iso: string): string {
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * Shorten an address for the table cell: the full value is still available
 * via the `title` tooltip. An IPv6 address is long enough to blow out a
 * narrow column (e.g. the account page's compact width) and push the
 * Severity/IP headers into each other — truncating is a display choice, not
 * data loss (the full value isn't needed at a glance in a log table).
 */
function shortenIp(ip: string | null): string {
	if (!ip) return "—";
	return ip.length > 15 ? `${ip.slice(0, 15)}…` : ip;
}

interface AuditLogTableProps {
	/** "admin" shows every user's events; "self" the signed-in user's own. */
	mode: "admin" | "self";
	/** Rows per page. Defaults to 25 (admin); the self card passes a smaller n. */
	pageSize?: number;
	/** Hide the status filter (used by the compact self card). */
	hideFilter?: boolean;
}

function AuditLogTable({ mode, pageSize = PAGE_SIZE, hideFilter = false }: AuditLogTableProps) {
	const [page, setPage] = React.useState(1);
	const [status, setStatus] = React.useState<"all" | "success" | "failed">("all");

	const query = useQuery({
		queryKey: ["audit-log", mode, status, page, pageSize],
		placeholderData: keepPreviousData,
		queryFn: async () => {
			// Call the endpoint by its exact path. The audit-log client plugin
			// only declares pathMethods (no named helpers), and Better Auth would
			// otherwise derive a wrong path from a camelCase method name
			// (listAuditLogs -> /audit-log/list-audit-logs -> 404). `$fetch` hits
			// the real `/audit-log/list` route. The endpoint scopes to the session
			// user by default; the admin view relies on admin access returning all
			// rows (no userId passed either way).
			const params = new URLSearchParams({
				limit: String(pageSize),
				offset: String((page - 1) * pageSize),
			});
			if (status !== "all") params.set("status", status);
			const res = await authClient.$fetch(`/audit-log/list?${params.toString()}`, {
				method: "GET",
			});
			const data = (res as { data?: { entries?: Entry[]; total?: number } }).data;
			const rows: Entry[] = data?.entries ?? [];
			const total = typeof data?.total === "number" ? data.total : rows.length;
			return { rows, total };
		},
	});

	const rows = query.data?.rows ?? [];
	const total = query.data?.total ?? 0;
	const pages = Math.max(1, Math.ceil(total / pageSize));

	return (
		<div className="w-full flex flex-col gap-3">
			{!hideFilter && (
				<div className="flex items-center gap-2">
					<label htmlFor="audit-status" className="text-sm text-foreground-500">
						Status
					</label>
					<select
						id="audit-status"
						className="rounded-md border border-default-200 bg-content1 px-2 py-1 text-sm"
						value={status}
						onChange={(e) => {
							setStatus(e.target.value as "all" | "success" | "failed");
							setPage(1);
						}}
					>
						<option value="all">All</option>
						<option value="success">Success</option>
						<option value="failed">Failed</option>
					</select>
				</div>
			)}

			{/* Card boundary (rounded border + bg) so the table reads as one
			    section instead of floating directly on the page background —
			    matches the bordered-card look the rest of the account/admin
			    islands use. `table-fixed` + `<colgroup>` give every column a
			    committed width so Severity/IP never collide and Action truncates
			    instead of wrapping into the row below it. */}
			<div className="w-full overflow-x-auto rounded-lg border border-default-200 bg-content1">
				<table className="w-full table-fixed border-collapse text-sm">
					<colgroup>
						{/* Phones show When / Action / Status only; Severity + IP
						    return from the sm breakpoint. */}
						<col className="w-[34%] sm:w-[22%]" />
						<col className="w-[38%] sm:w-[30%]" />
						<col className="w-[28%] sm:w-[14%]" />
						<col className="hidden sm:table-column sm:w-[14%]" />
						<col className="hidden sm:table-column sm:w-[20%]" />
					</colgroup>
					<thead>
						<tr className="border-b border-default-200 text-left text-xs uppercase text-foreground-500">
							<th className="py-2 px-3 font-medium">When</th>
							<th className="py-2 px-3 font-medium">Action</th>
							<th className="py-2 px-3 font-medium">Status</th>
							<th className="hidden sm:table-cell py-2 px-3 font-medium">Severity</th>
							<th className="hidden sm:table-cell py-2 px-3 font-medium">IP</th>
						</tr>
					</thead>
					<tbody>
						{query.isLoading ? (
							<tr>
								<td colSpan={5} className="py-8 text-center">
									<Spinner label="Loading…" />
								</td>
							</tr>
						) : rows.length === 0 ? (
							<tr>
								<td colSpan={5} className="py-8 text-center text-foreground-500">
									No activity recorded yet.
								</td>
							</tr>
						) : (
							rows.map((row) => (
								<tr key={row.id} className="border-b border-default-100 last:border-b-0">
									<td className="py-2 px-3 sm:whitespace-nowrap text-xs">
										{fmtTime(row.createdAt)}
									</td>
									<td className="py-2 px-3 truncate font-mono text-xs" title={row.action}>
										{row.action}
									</td>
									<td className="py-2 px-3">
										<Chip
											size="sm"
											variant="flat"
											color={row.status === "failed" ? "danger" : "success"}
										>
											{row.status}
										</Chip>
									</td>
									<td className="hidden sm:table-cell py-2 px-3">
										<Chip size="sm" variant="flat" color={SEVERITY_COLOR[row.severity]}>
											{row.severity}
										</Chip>
									</td>
									<td
										className="hidden sm:table-cell py-2 px-3 truncate font-mono text-xs"
										title={row.ipAddress ?? undefined}
									>
										{shortenIp(row.ipAddress)}
									</td>
								</tr>
							))
						)}
					</tbody>
				</table>
			</div>

			{pages > 1 && (
				<div className="flex items-center justify-center gap-3 text-sm">
					<button
						type="button"
						className="rounded-md border border-default-200 px-3 py-1 disabled:opacity-40"
						disabled={page <= 1}
						onClick={() => setPage((p) => Math.max(1, p - 1))}
					>
						Previous
					</button>
					<span className="text-foreground-500">
						Page {page} of {pages}
					</span>
					<button
						type="button"
						className="rounded-md border border-default-200 px-3 py-1 disabled:opacity-40"
						disabled={page >= pages}
						onClick={() => setPage((p) => Math.min(pages, p + 1))}
					>
						Next
					</button>
				</div>
			)}
		</div>
	);
}

export interface AuditLogViewProps {
	mode?: "admin" | "self";
	pageSize?: number;
	hideFilter?: boolean;
	/** Brand name shown in the header (admin mode only). */
	siteName?: string;
	/** Site logo URL; when set, shown in the header instead of the site name. */
	logoUrl?: string | null;
	/** Where the header's back button goes (admin mode only). */
	backHref?: string;
	/** Back button text (admin mode only). */
	backLabel?: string;
	/** Admin user-management plugin on (adds the "Manage users" menu link). */
	adminEnabled?: boolean;
	/** Organizations on (adds the "Organization" menu link). */
	orgEnabled?: boolean;
	/** Multi-session on (adds the "Switch Account" menu item, as on /account). */
	multiSessionEnabled?: boolean;
}

/**
 * Standalone island wrapper (QueryClient + theme). Used by the admin
 * `/audit-log` page. The per-user card renders <AuditLogTable> directly inside
 * the account island, which already provides the QueryClient/theme context.
 *
 * In admin mode this also renders a header bar (site name/logo + the shared
 * avatar menu) — the same sticky-header pattern AdminView/AuthView use. The
 * page previously dropped straight into a bare table with no title or anchor;
 * this gives it the same visual frame every other plugin page already has.
 */
export default function AuditLogView({
	mode = "admin",
	pageSize,
	hideFilter,
	siteName = "Admin",
	logoUrl = null,
	backHref = "/admin",
	backLabel = "Back to admin",
	adminEnabled = false,
	orgEnabled = false,
	multiSessionEnabled = false,
}: AuditLogViewProps) {
	const queryClient = getQueryClient();
	// The admin page is only served to EmDash admins with audit logging on
	// (enforced server-side), so both are implied. Same links as every other page.
	const navLinks = buildNavLinks({
		isEmdashAdmin: true,
		adminEnabled,
		auditLogEnabled: true,
		orgEnabled,
	});
	return (
		<QueryClientProvider client={queryClient}>
			<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
				{mode === "admin" && (
					<header className="sticky top-0 z-10 bg-background border-b">
						<div className="py-3 px-4 md:px-6 mx-auto justify-between flex items-center gap-3">
							<Link href="/" className="no-underline text-foreground">
								{logoUrl ? (
									<img src={logoUrl} alt={siteName} className="h-7 w-auto max-w-40 object-contain" />
								) : (
									<h1 className="sm:text-base truncate font-semibold">{siteName}</h1>
								)}
							</Link>
							{/* Same avatar menu as the account/admin/organization pages. */}
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
									...(multiSessionEnabled ? [multiSessionPlugin()] : []),
								]}
								navigate={({ to, replace }: { to: string; replace?: boolean }) => {
									if (replace) window.location.replace(to);
									else window.location.href = to;
								}}
							>
								<UserButton size="icon" placement="bottom end" links={navLinks} />
							</AuthProvider>
						</div>
					</header>
				)}
				<main className="flex-1 flex flex-col items-center p-4 md:p-6">
					<div style={{ width: "100%", maxWidth: "64rem" }}>
						{mode === "admin" && (
							<div className="flex items-center justify-between gap-3 mb-4">
								<h2 className="text-xl font-semibold">Audit log</h2>
								{/* A real anchor styled as a button: keyboard/middle-click friendly. */}
								<a href={backHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
									<span aria-hidden="true">←</span> {backLabel}
								</a>
							</div>
						)}
						<AuditLogTable mode={mode} pageSize={pageSize} hideFilter={hideFilter} />
					</div>
				</main>
			</ThemeProvider>
		</QueryClientProvider>
	);
}

/** Named export so the account view can embed the table without a 2nd island. */
export { AuditLogTable };
