/**
 * Activity: where the user is signed in, and their recent sign-in history.
 *
 * Sessions come from Better Auth (always available: sign-in time, IP and browser
 * of every session). History comes from the audit log when it is switched on,
 * which also records failed attempts. Both lists are scoped to the signed-in
 * user by the server.
 */
import { Button, Chip } from "@heroui/react";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { authClient } from "../../client.js";
import { useAudit, useSessions } from "./data.js";
import { describeDevice } from "./device.js";
import { SkeletonRows } from "./skeletons.js";

// biome-ignore lint/suspicious/noExplicitAny: session client methods are typed per build.
const c = authClient as any;
const SHOWN = 8;
const when = (v?: string | Date | null) => {
	const d = v ? new Date(v) : null;
	return d && !Number.isNaN(d.getTime()) ? d.toLocaleString() : "—";
};
const device = (ua?: string | null) => {
	const d = describeDevice(ua);
	return `${d.browser} on ${d.os}`;
};

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
	return (
		<div className="overflow-x-auto rounded-2xl bg-surface p-4 shadow-md">
			<table className="w-full min-w-[34rem] text-left text-sm">
				<thead>
					<tr className="text-xs uppercase text-muted">
						{head.map((h, i) => (
							<th
								key={h}
								className={`bg-default px-3 py-3 font-semibold ${i === 0 ? "rounded-l-lg" : ""} ${i === head.length - 1 ? "rounded-r-lg" : ""}`}
							>
								{h === "Actions" ? <span className="sr-only">Actions</span> : h}
							</th>
						))}
					</tr>
				</thead>
				<tbody>{children}</tbody>
			</table>
		</div>
	);
}

function Sessions() {
	const qc = useQueryClient();
	const { data: current } = authClient.useSession();
	const sessions = useSessions();
	const [all, setAll] = React.useState(false);
	const [busy, setBusy] = React.useState("");
	const mine = (current as { session?: { token?: string } } | null)?.session?.token;
	const rows = [...(sessions.data ?? [])].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
	const shown = all ? rows : rows.slice(0, SHOWN);
	const revoke = async (token: string) => {
		setBusy(token);
		await c.revokeSession({ token });
		await qc.invalidateQueries({ queryKey: ["dash", "sessions"] });
		setBusy("");
	};
	return (
		<section className="flex flex-col gap-3">
			<div>
				<h2 className="text-lg font-semibold">Where you are signed in</h2>
				<p className="text-sm text-muted">Sign out any device you do not recognise.</p>
			</div>
			<Table head={["Device", "IP address", "Signed in", "Actions"]}>
				{sessions.isLoading ? <SkeletonRows cols={4} rows={4} /> : null}
				{!sessions.isLoading && rows.length === 0 ? (
					<tr>
						<td colSpan={4} className="px-3 py-6 text-center text-muted">
							No active sessions.
						</td>
					</tr>
				) : null}
				{shown.map((s) => (
					<tr key={s.token}>
						<td className="px-3 py-3 font-medium text-foreground">
							{device(s.userAgent)}
							{s.token === mine ? (
								<Chip size="sm" color="success" variant="soft" className="ml-2">
									<span className="text-xs">This device</span>
								</Chip>
							) : null}
						</td>
						<td className="px-3 py-3">{s.ipAddress || "—"}</td>
						<td className="px-3 py-3">{when(s.createdAt)}</td>
						<td className="px-3 py-3 text-right">
							{s.token === mine ? null : (
								<Button size="sm" variant="danger-soft" isDisabled={busy === s.token} onPress={() => revoke(s.token)}>
									Sign out
								</Button>
							)}
						</td>
					</tr>
				))}
			</Table>
			{rows.length > SHOWN ? (
				<div>
					<Button size="sm" variant="ghost" onPress={() => setAll((v) => !v)}>
						{all ? "Show fewer" : `Show all ${rows.length}`}
					</Button>
				</div>
			) : null}
		</section>
	);
}

const LABEL: Record<string, string> = {
	"sign-in:email": "Signed in with password",
	"sign-out": "Signed out",
	"sign-up:email": "Account created",
	"change-password": "Password changed",
	"reset-password": "Password reset",
	"change-email": "Email changed",
};
const label = (a: string) => LABEL[a] ?? a.replace(/[:_-]/g, " ").replace(/^./, (x) => x.toUpperCase());

function History() {
	const audit = useAudit(true, 100);
	const [all, setAll] = React.useState(false);
	const rows = audit.data ?? [];
	const shown = all ? rows : rows.slice(0, 15);
	return (
		<section className="flex flex-col gap-3">
			<div>
				<h2 className="text-lg font-semibold">Recent activity</h2>
				<p className="text-sm text-muted">Sign-ins, failed attempts and account changes.</p>
			</div>
			<Table head={["Event", "Status", "Device", "IP address", "When"]}>
				{audit.isLoading ? <SkeletonRows cols={5} rows={5} /> : null}
				{!audit.isLoading && rows.length === 0 ? (
					<tr>
						<td colSpan={5} className="px-3 py-6 text-center text-muted">
							{audit.isError ? "Activity history is not available." : "Nothing recorded yet."}
						</td>
					</tr>
				) : null}
				{shown.map((e) => (
					<tr key={e.id}>
						<td className="px-3 py-3 font-medium text-foreground">{label(e.action)}</td>
						<td className="px-3 py-3">
							<Chip size="sm" variant="soft" color={e.status === "failed" ? "danger" : "success"}>
								<span className="text-xs capitalize">{e.status}</span>
							</Chip>
						</td>
						<td className="px-3 py-3">{device(e.userAgent)}</td>
						<td className="px-3 py-3">{e.ipAddress || "—"}</td>
						<td className="px-3 py-3">{when(e.createdAt)}</td>
					</tr>
				))}
			</Table>
			{rows.length > 15 ? (
				<div>
					<Button size="sm" variant="ghost" onPress={() => setAll((v) => !v)}>
						{all ? "Show fewer" : `Show all ${rows.length}`}
					</Button>
				</div>
			) : null}
		</section>
	);
}

export function Activity({ auditLogEnabled }: { auditLogEnabled: boolean }) {
	return (
		<div className="flex flex-col gap-8">
			<Sessions />
			{auditLogEnabled ? (
				<History />
			) : (
				<p className="rounded-2xl bg-surface p-4 text-sm text-muted shadow-md">
					Sign-in history and failed attempts appear here once the site owner turns on the audit log.
				</p>
			)}
		</div>
	);
}
