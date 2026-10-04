/**
 * Audit-log viewer island (HeroUI).
 *
 * `better-auth-audit-logs` ships NO Better Auth UI component, so we render the
 * table ourselves — reusing the HeroUI + react-query stack the other islands
 * already use (no new deps). Data comes from `authClient.auditLog.listAuditLogs`
 * (the `/audit-log/list` endpoint the server plugin registers).
 *
 * Two modes, one component:
 *   - mode="admin": site-wide log for admins (the /audit-log page). The list
 *     endpoint returns every user's events for a caller with admin access.
 *   - mode="self": the signed-in user's OWN activity (the account "Recent
 *     activity" card). The endpoint defaults to the session user, so no userId
 *     is passed — a user can only ever see their own rows.
 *
 * Self-styled (auth.css). `navigate` is unused here (no cross-view links), so
 * the island is a plain QueryClient + HeroUI table; it does not need the full
 * AuthProvider the auth/account views use.
 */

import "./auth.css";

import {
	Chip,
	Pagination,
	Spinner,
	Table,
	TableBody,
	TableCell,
	TableColumn,
	TableHeader,
	TableRow,
	Tab,
	Tabs,
} from "@heroui/react";
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
	/** Hide the status filter tabs (used by the compact self card). */
	hideFilter?: boolean;
}

function AuditLogTable({ mode, pageSize = PAGE_SIZE, hideFilter = false }: AuditLogTableProps) {
	const [page, setPage] = React.useState(1);
	const [status, setStatus] = React.useState<"all" | "success" | "failed">("all");

	const query = useQuery({
		queryKey: ["audit-log", mode, status, page, pageSize],
		placeholderData: keepPreviousData,
		queryFn: async () => {
			// The endpoint scopes to the session user by default; for the admin
			// view we don't pass a userId (admin access returns all users' rows).
			const res = await authClient.auditLog.listAuditLogs({
				query: {
					limit: pageSize,
					offset: (page - 1) * pageSize,
					...(status !== "all" ? { status } : {}),
				},
			});
			// Better Auth client returns { data, error }; the /audit-log/list
			// endpoint responds with { entries, total }.
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
				<Tabs
					aria-label="Filter by status"
					selectedKey={status}
					onSelectionChange={(k) => {
						setStatus(k as "all" | "success" | "failed");
						setPage(1);
					}}
					size="sm"
				>
					<Tab key="all" title="All" />
					<Tab key="success" title="Success" />
					<Tab key="failed" title="Failed" />
				</Tabs>
			)}

			<Table
				aria-label={mode === "admin" ? "Audit log" : "Your recent activity"}
				removeWrapper={hideFilter}
			>
				<TableHeader>
					<TableColumn>WHEN</TableColumn>
					<TableColumn>ACTION</TableColumn>
					<TableColumn>STATUS</TableColumn>
					<TableColumn>SEVERITY</TableColumn>
					<TableColumn>IP</TableColumn>
				</TableHeader>
				<TableBody
					emptyContent={query.isLoading ? " " : "No activity recorded yet."}
					isLoading={query.isLoading}
					loadingContent={<Spinner label="Loading…" />}
					items={rows}
				>
					{(row: Entry) => (
						<TableRow key={row.id}>
							<TableCell>{fmtTime(row.createdAt)}</TableCell>
							<TableCell className="font-mono text-xs">{row.action}</TableCell>
							<TableCell>
								<Chip
									size="sm"
									variant="flat"
									color={row.status === "failed" ? "danger" : "success"}
								>
									{row.status}
								</Chip>
							</TableCell>
							<TableCell>
								<Chip size="sm" variant="flat" color={SEVERITY_COLOR[row.severity]}>
									{row.severity}
								</Chip>
							</TableCell>
							<TableCell className="font-mono text-xs">{row.ipAddress ?? "—"}</TableCell>
						</TableRow>
					)}
				</TableBody>
			</Table>

			{pages > 1 && (
				<div className="flex justify-center">
					<Pagination page={page} total={pages} onChange={setPage} size="sm" showControls />
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
