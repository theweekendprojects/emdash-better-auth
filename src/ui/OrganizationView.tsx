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
import {
	useActiveOrganization,
	useListOrganizations,
	useListOrganizationMembers,
	useListOrganizationInvitations,
	useRemoveMember,
	useCancelInvitation,
	useSetActiveOrganization,
} from "@better-auth-ui/react/plugins/organization";
import { themePlugin } from "@better-auth-ui/heroui/plugins/theme";
import { usernamePlugin } from "@better-auth-ui/heroui/plugins/username";
import { Button, Chip, Link, Spinner, Table, Toast } from "@heroui/react";
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

/**
 * WHY CUSTOM MEMBER/INVITATION TABLES:
 * Better Auth UI's own `<OrganizationMembers>` / `<OrganizationInvitations>`
 * (rendered by `<Organization view="people">`) crash with HeroUI's
 * "Cell count must match column count" during client-side navigation. Their
 * table HEADER gates the role/teams columns on `table.getColumn(...).getIsVisible()`
 * while the row defaults `showRole = true` when that value is briefly
 * `undefined` mid-hydration — so on a SPA tab-click the header and row disagree
 * by one column for a tick and HeroUI throws. (It works on a hard refresh,
 * where the table state is settled before first paint — hence the
 * "crash on navigate, fine on refresh" flicker.) No version/config avoids it.
 *
 * We render both tables ourselves from the data hooks with a fixed column set,
 * so header and body always agree in a single pass — no race. Still the same
 * HeroUI compound Table API and the library's own query/mutation hooks.
 */

interface MemberRecord {
	id: string;
	userId: string;
	role: string;
	user?: { name?: string | null; email?: string | null };
}

interface InvitationRecord {
	id: string;
	email: string;
	role: string;
	status: string;
}

/** Members table: name/email + role, with a Remove action for non-owners. */
function CustomMembers() {
	const { data, isPending } = useListOrganizationMembers(authClient);
	const remove = useRemoveMember(authClient);
	const raw = Array.isArray(data)
		? data
		: ((data as { members?: MemberRecord[] } | undefined)?.members ?? []);
	const members = raw as MemberRecord[];

	return (
		<div className="flex flex-col gap-3">
			<h3 className="text-base font-semibold">Members</h3>
			{isPending ? (
				<div className="flex justify-center py-8">
					<Spinner />
				</div>
			) : members.length === 0 ? (
				<p className="text-sm text-foreground/60">No members yet.</p>
			) : (
				<Table>
					<Table.ScrollContainer>
						<Table.Content aria-label="Members">
							<Table.Header>
								<Table.Column isRowHeader>Member</Table.Column>
								<Table.Column>Role</Table.Column>
								<Table.Column className="text-end">Actions</Table.Column>
							</Table.Header>
							<Table.Body>
								{members.map((m) => (
									<Table.Row id={m.id} key={m.id}>
										<Table.Cell>
											<div className="flex flex-col">
												<span className="font-medium">
													{m.user?.name ?? m.user?.email ?? m.userId}
												</span>
												{m.user?.email ? (
													<span className="text-xs text-foreground/60">
														{m.user.email}
													</span>
												) : null}
											</div>
										</Table.Cell>
										<Table.Cell>
											<Chip size="sm" variant="flat">
												{m.role}
											</Chip>
										</Table.Cell>
										<Table.Cell className="text-end">
											{m.role === "owner" ? null : (
												<Button
													size="sm"
													variant="tertiary"
													isDisabled={remove.isPending}
													onPress={() => remove.mutate({ memberIdOrEmail: m.id })}
												>
													Remove
												</Button>
											)}
										</Table.Cell>
									</Table.Row>
								))}
							</Table.Body>
						</Table.Content>
					</Table.ScrollContainer>
				</Table>
			)}
		</div>
	);
}

/** Pending invitations table: email + role + status, with a Cancel action. */
function CustomInvitations() {
	const { data, isPending } = useListOrganizationInvitations(authClient);
	const cancel = useCancelInvitation(authClient);
	const raw = Array.isArray(data)
		? data
		: ((data as { invitations?: InvitationRecord[] } | undefined)?.invitations ?? []);
	const invitations = (raw as InvitationRecord[]).filter((i) => i.status === "pending");

	return (
		<div className="flex flex-col gap-3">
			<h3 className="text-base font-semibold">Invitations</h3>
			{isPending ? (
				<div className="flex justify-center py-8">
					<Spinner />
				</div>
			) : invitations.length === 0 ? (
				<p className="text-sm text-foreground/60">No pending invitations.</p>
			) : (
				<Table>
					<Table.ScrollContainer>
						<Table.Content aria-label="Invitations">
							<Table.Header>
								<Table.Column isRowHeader>Email</Table.Column>
								<Table.Column>Role</Table.Column>
								<Table.Column>Status</Table.Column>
								<Table.Column className="text-end">Actions</Table.Column>
							</Table.Header>
							<Table.Body>
								{invitations.map((inv) => (
									<Table.Row id={inv.id} key={inv.id}>
										<Table.Cell>{inv.email}</Table.Cell>
										<Table.Cell>{inv.role}</Table.Cell>
										<Table.Cell>
											<Chip size="sm" variant="flat">
												{inv.status}
											</Chip>
										</Table.Cell>
										<Table.Cell className="text-end">
											<Button
												size="sm"
												variant="tertiary"
												isDisabled={cancel.isPending}
												onPress={() => cancel.mutate({ invitationId: inv.id })}
											>
												Cancel
											</Button>
										</Table.Cell>
									</Table.Row>
								))}
							</Table.Body>
						</Table.Content>
					</Table.ScrollContainer>
				</Table>
			)}
		</div>
	);
}

/**
 * People tab: our custom members + invitations tables for the ACTIVE org.
 * Reproduces the shell's "no active organization" guard (since we render the
 * sub-pieces directly): if none is set but the user has an org, auto-select the
 * first and show a spinner; if the user has no org, show an empty state —
 * never fire a doomed `list-members` that would 400 and spin.
 */
function PeopleTab() {
	const { data: activeOrg, isPending: activePending } = useActiveOrganization(authClient);
	const { data: orgs, isPending: listPending } = useListOrganizations(authClient);
	const setActive = useSetActiveOrganization(authClient);

	const hasActive = !!activeOrg?.id;
	const firstOrgId = orgs && orgs.length > 0 ? orgs[0]!.id : null;

	const triggeredRef = React.useRef(false);
	React.useEffect(() => {
		if (!hasActive && firstOrgId && !setActive.isPending && !triggeredRef.current) {
			triggeredRef.current = true;
			setActive.mutate({ organizationId: firstOrgId });
		}
	}, [hasActive, firstOrgId, setActive]);

	if (hasActive) {
		return (
			<div className="flex flex-col gap-8">
				<CustomMembers />
				<CustomInvitations />
			</div>
		);
	}
	if (activePending || listPending || (firstOrgId && !hasActive)) {
		return (
			<div className="flex items-center justify-center py-16">
				<Spinner />
			</div>
		);
	}
	return (
		<div className="flex flex-col items-center gap-2 py-16 text-center">
			<p className="font-semibold">No organization selected</p>
			<p className="text-sm text-foreground/60">
				Create or select an organization to manage its people.
			</p>
		</div>
	);
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
}

export default function OrganizationView({
	path = "settings",
	siteName = "Organization",
	logoUrl = null,
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
								{logoUrl ? (
									<img src={logoUrl} alt={siteName} className="h-7 w-auto max-w-40 object-contain" />
								) : (
									<h1 className="sm:text-base truncate font-semibold">{siteName}</h1>
								)}
							</Link>
							<div className="flex items-center gap-3">
								<OrganizationSwitcher placement="bottom end" />
								<UserButton size="icon" placement="bottom end" />
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
							{path === "people" ? <PeopleTab /> : <Organization view={path} />}
						</div>
					</main>

					<Toast.Provider />
				</AuthProvider>
			</ThemeProvider>
		</QueryClientProvider>
	);
}
