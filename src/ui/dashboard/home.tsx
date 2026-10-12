/**
 * Home: cards, statistics, side cards and the latest users table.
 * Port of the nextui-dashboard-template home page (MIT) to HeroUI v3, with the
 * demo numbers replaced by data from the Better Auth client.
 */
import { Avatar, AvatarGroup, Card, Skeleton } from "@heroui/react";
import { authClient } from "../../client.js";
import * as React from "react";
import { Steam } from "./chart.js";
import { type Entry, useAccounts, useAudit, useInvites, useOrgs, useSessions, useUsers } from "./data.js";
import { Community } from "./icons/community.js";
import { StatCardSkeleton } from "./skeletons.js";
import { UsersTable } from "./users.js";

export interface HomeFlags {
	orgEnabled: boolean;
	auditLogEnabled: boolean;
	isAdmin: boolean;
}

type Tone = "primary" | "default" | "success";
const TONE: Record<Tone, { card: string; text: string; muted: string }> = {
	primary: { card: "bg-accent", text: "text-white", muted: "text-white" },
	default: { card: "bg-surface", text: "text-foreground", muted: "text-foreground" },
	success: { card: "bg-success", text: "text-white", muted: "text-white" },
};

interface Stat {
	symbol: string;
	value: string | number;
	label: string;
	symbolClass?: string;
}

function StatCard(props: { tone: Tone; title: string; subtitle: string; value: string | number; note?: string; noteClass?: string; stats: Stat[] }) {
	const t = TONE[props.tone];
	return (
		<Card className={`w-full rounded-xl px-3 shadow-md xl:max-w-sm ${t.card}`}>
			<Card.Content className="overflow-hidden py-5">
				<div className="flex gap-2.5">
					<span className={props.tone === "default" ? "" : "[&_path]:fill-white"}>
						<Community />
					</span>
					<div className="flex flex-col">
						<span className={t.text}>{props.title}</span>
						<span className={`text-xs ${t.text}`}>{props.subtitle}</span>
					</div>
				</div>
				<div className="flex items-center gap-2.5 py-2">
					<span className={`text-xl font-semibold ${t.text}`}>{props.value}</span>
					{props.note ? <span className={`text-xs ${props.noteClass ?? t.text}`}>{props.note}</span> : null}
				</div>
				<div className="flex items-center gap-6">
					{props.stats.map((s) => (
						<div key={s.label}>
							<div>
								<span className={`text-xs font-semibold ${s.symbolClass ?? t.text}`}>{s.symbol}</span>
								<span className={`text-xs ${t.text}`}>{s.value}</span>
							</div>
							<span className={`text-xs ${t.text}`}>{s.label}</span>
						</div>
					))}
				</div>
			</Card.Content>
		</Card>
	);
}

const Dashed = ({ children }: { children: React.ReactNode }) => (
	<div className="flex justify-center gap-2.5">
		<div className="flex flex-col rounded-xl border-2 border-dashed border-border px-6 py-2">
			<span className="text-xl font-semibold text-foreground">{children}</span>
		</div>
	</div>
);

const initial = (s?: string | null) => (s ?? "?").slice(0, 1).toUpperCase();
const when = (iso: string) => {
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString();
};

export function Home({ orgEnabled, auditLogEnabled, isAdmin }: HomeFlags) {
	const { data: session } = authClient.useSession();
	const sessions = useSessions();
	const accounts = useAccounts();
	const orgs = useOrgs(orgEnabled);
	const invites = useInvites(orgEnabled);
	const audit = useAudit(auditLogEnabled, 200);
	const entries: Entry[] = audit.data ?? [];
	const nSessions = sessions.data?.length ?? 0;
	const nAccounts = accounts.data?.length ?? 0;
	const nOrgs = orgs.data?.length ?? 0;
	const nInvites = invites.data?.length ?? 0;
	const failed = entries.filter((e) => e.status === "failed").length;
	const statsLoading = sessions.isLoading || accounts.isLoading || (orgEnabled && (orgs.isLoading || invites.isLoading));
	const name = session?.user?.name || session?.user?.email || "there";
	return (
		<div className="h-full lg:px-6">
			<div className="mx-auto flex w-full max-w-[90rem] flex-wrap justify-center gap-4 px-4 pt-3 sm:pt-10 lg:px-0 xl:flex-nowrap xl:gap-6">
				<div className="mt-6 flex w-full flex-col gap-6">
					<div className="flex flex-col gap-2">
						<h3 className="text-xl font-semibold">Welcome back, {name}</h3>
						<div className="grid w-full grid-cols-1 justify-center gap-5 md:grid-cols-2 2xl:grid-cols-3">
							{statsLoading ? (
								<>
									<StatCardSkeleton />
									{orgEnabled ? <StatCardSkeleton /> : null}
									<StatCardSkeleton />
								</>
							) : (
								<>
							<StatCard
								tone="primary"
								title="Sessions"
								subtitle="Devices signed in"
								value={nSessions}
								note={nSessions > 1 ? "Review them in Security" : "Only this device"}
								stats={[
									{ symbol: "↓", value: Math.max(nSessions - 1, 0), label: "Others", symbolClass: "text-success" },
									{ symbol: "↑", value: failed, label: "Failed", symbolClass: "text-danger" },
									{ symbol: "⭐", value: session?.user?.emailVerified ? "Yes" : "No", label: "Verified" },
								]}
							/>
							{orgEnabled ? (
								<StatCard
									tone="default"
									title="Organizations"
									subtitle="Where you are a member"
									value={nOrgs}
									note={nInvites ? `${nInvites} pending` : "No invitations"}
									noteClass={nInvites ? "text-danger" : "text-muted"}
									stats={[
										{ symbol: "↓", value: nInvites, label: "Invitations", symbolClass: "text-success-600" },
										{ symbol: "↑", value: nOrgs, label: "Joined", symbolClass: "text-danger" },
										{ symbol: "⭐", value: nOrgs ? "Active" : "None", label: "Status", symbolClass: "text-danger" },
									]}
								/>
							) : null}
							<StatCard
								tone="success"
								title="Sign-in methods"
								subtitle="Linked accounts"
								value={nAccounts}
								note={nAccounts > 1 ? "Multiple ways in" : "One way in"}
								stats={[
									{ symbol: "↓", value: nAccounts, label: "Linked", symbolClass: "text-danger" },
									{ symbol: "↑", value: entries.length, label: "Events", symbolClass: "text-danger" },
									{ symbol: "⭐", value: (session?.user as { twoFactorEnabled?: boolean } | undefined)?.twoFactorEnabled ? "On" : "Off", label: "2FA" },
								]}
							/>
						</>
							)}
						</div>
					</div>
					{auditLogEnabled ? (
						<div className="flex h-full flex-col gap-2">
							<h3 className="text-xl font-semibold">Statistics</h3>
							<div className="w-full rounded-2xl bg-surface p-6 shadow-lg">
								{audit.isLoading ? <Skeleton className="h-[400px] w-full rounded-xl" /> : <Steam entries={entries} />}
							</div>
						</div>
					) : null}
				</div>
				<div className="mt-4 flex w-full flex-col gap-2 xl:max-w-md">
					<h3 className="text-xl font-semibold">Section</h3>
					<div className="flex flex-col justify-center gap-4 md:flex-col md:flex-nowrap">
						<Card className="w-full rounded-xl bg-surface px-4 py-6 shadow-md">
							<Card.Content className="gap-6 py-5">
								<Dashed>⭐ {orgEnabled ? "Organizations" : "You"}</Dashed>
								<div className="flex flex-col items-center gap-6">
									<span className="text-center text-xs">
										{orgEnabled ? "The organizations you belong to." : "Your profile at a glance."}
									</span>
									<AvatarGroup>
										{orgEnabled && orgs.isLoading ? (
											<Skeleton className="h-10 w-28 rounded-full" />
										) : orgEnabled && nOrgs ? (
											orgs.data?.slice(0, 5).map((o) => (
												<Avatar key={o.id}>
													{o.logo ? <Avatar.Image src={o.logo} alt={o.name} /> : null}
													<Avatar.Fallback>{initial(o.name)}</Avatar.Fallback>
												</Avatar>
											))
										) : (
											<Avatar>
												{session?.user?.image ? <Avatar.Image src={session.user.image} alt="" /> : null}
												<Avatar.Fallback>{initial(name)}</Avatar.Fallback>
											</Avatar>
										)}
									</AvatarGroup>
								</div>
							</Card.Content>
						</Card>
						{auditLogEnabled ? (
							<Card className="rounded-xl bg-surface px-3 shadow-md">
								<Card.Content className="gap-4 py-5">
									<Dashed>Recent activity</Dashed>
									<div className="flex flex-col gap-6">
										{audit.isLoading
											? Array.from({ length: 4 }, (_, i) => (
													// biome-ignore lint/suspicious/noArrayIndexKey: static placeholders.
													<div key={i} className="grid w-full grid-cols-4 items-center" aria-hidden="true">
														<Skeleton className="h-10 w-10 rounded-full" />
														<Skeleton className="h-4 w-20 rounded-lg" />
														<Skeleton className="h-3 w-12 rounded-lg" />
														<Skeleton className="h-3 w-14 rounded-lg" />
													</div>
												))
											: null}
										{!audit.isLoading && entries.length === 0 ? <p className="text-center text-sm text-muted">Nothing yet.</p> : null}
										{entries.slice(0, 5).map((e) => (
											<div key={e.id} className="grid w-full grid-cols-4 items-center">
												<div className="w-full">
													<Avatar color={e.status === "failed" ? "danger" : "accent"}>
														<Avatar.Fallback>{initial(e.action)}</Avatar.Fallback>
													</Avatar>
												</div>
												<span className="truncate font-semibold text-foreground">{e.action}</span>
												<div>
													<span className={`text-xs ${e.status === "failed" ? "text-danger" : "text-success"}`}>{e.status}</span>
												</div>
												<div>
													<span className="text-xs text-muted">{when(e.createdAt)}</span>
												</div>
											</div>
										))}
									</div>
								</Card.Content>
							</Card>
						) : null}
					</div>
				</div>
			</div>
			{isAdmin ? (
				<div className="mx-auto flex w-full max-w-[90rem] flex-col justify-center gap-3 px-4 py-5 lg:px-0">
					<div className="flex flex-wrap justify-between">
						<h3 className="text-center text-xl font-semibold">Latest Users</h3>
						<a href="/account/users" className="cursor-pointer text-accent no-underline">
							View All
						</a>
					</div>
					<LatestUsers />
				</div>
			) : null}
		</div>
	);
}

function LatestUsers() {
	const users = useUsers(true, 5);
	return <UsersTable users={users.data?.users ?? []} loading={users.isLoading} denied={users.isError} />;
}
