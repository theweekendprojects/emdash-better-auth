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

import { Chip, Spinner } from "@heroui/react";
import {
	QueryClient,
	QueryClientProvider,
	keepPreviousData,
	useQuery,
} from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import * as React from "react";

import { authClient } from "../client.js";

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

			<div className="w-full overflow-x-auto">
				<table className="w-full border-collapse text-sm">
					<thead>
						<tr className="border-b border-default-200 text-left text-xs uppercase text-foreground-500">
							<th className="py-2 pr-3 font-medium">When</th>
							<th className="py-2 pr-3 font-medium">Action</th>
							<th className="py-2 pr-3 font-medium">Status</th>
							<th className="py-2 pr-3 font-medium">Severity</th>
							<th className="py-2 pr-3 font-medium">IP</th>
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
								<tr key={row.id} className="border-b border-default-100">
									<td className="py-2 pr-3 whitespace-nowrap">{fmtTime(row.createdAt)}</td>
									<td className="py-2 pr-3 font-mono text-xs">{row.action}</td>
									<td className="py-2 pr-3">
										<Chip
											size="sm"
											variant="flat"
											color={row.status === "failed" ? "danger" : "success"}
										>
											{row.status}
										</Chip>
									</td>
									<td className="py-2 pr-3">
										<Chip size="sm" variant="flat" color={SEVERITY_COLOR[row.severity]}>
											{row.severity}
										</Chip>
									</td>
									<td className="py-2 pr-3 font-mono text-xs">{row.ipAddress ?? "—"}</td>
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
}

/**
 * Standalone island wrapper (QueryClient + theme). Used by the admin
 * `/audit-log` page. The per-user card renders <AuditLogTable> directly inside
 * the account island, which already provides the QueryClient/theme context.
 */
export default function AuditLogView({
	mode = "admin",
	pageSize,
	hideFilter,
}: AuditLogViewProps) {
	const queryClient = getQueryClient();
	return (
		<QueryClientProvider client={queryClient}>
			<ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
				<main className="flex-1 flex flex-col items-center p-4 md:p-6">
					<div style={{ width: "100%", maxWidth: "64rem" }}>
						<AuditLogTable mode={mode} pageSize={pageSize} hideFilter={hideFilter} />
					</div>
				</main>
			</ThemeProvider>
		</QueryClientProvider>
	);
}

/** Named export so the account view can embed the table without a 2nd island. */
export { AuditLogTable };
