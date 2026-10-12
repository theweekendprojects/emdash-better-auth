/**
 * Every signed-in page (account, admin, audit log, organization) inside the
 * admin layout (see ./dashboard).
 *
 * Menu hierarchy (a group is hidden when it has nothing in it):
 *   Home
 *   Workspace       plugin pages (a host's own pages, Organizations ...), Active organization
 *   Account         Profile, Security, Sessions & activity, API keys, Connected apps,
 *                   OAuth clients, Billing
 *   Administration  Users, User management, Audit log        (admins only)
 *
 * No hand-kept list of features: a page exists when its Better Auth UI plugin is
 * registered (that follows the site's feature switches). The page bodies are
 * Better Auth UI's own cards, composed here by plugin id:
 *   Security         password, linked accounts, two-factor, passkeys, wallets and any
 *                    card from a plugin we do not know (so new plugins still show up)
 *   API keys         the api-key plugin's cards
 *   Connected apps   the oauth-provider plugin's cards
 *   Profile          account settings + the delete-account card
 * Plugin settings tabs (`settingsTabs`) get their own entry as well.
 */
import { Admin, AccountSettings, ChangePassword, LinkedAccounts, Settings } from "@better-auth-ui/heroui";
import { Organization } from "@better-auth-ui/heroui/plugins/organization";
import { useAuth } from "@better-auth-ui/react";
import type * as React from "react";
import { AuditLogTable } from "./AuditLogView.js";
import { Activity } from "./dashboard/activity.js";
import { Home } from "./dashboard/home.js";
import { HouseIcon } from "./dashboard/icons/breadcrumb/house-icon.js";
import { AccountsIcon } from "./dashboard/icons/sidebar/accounts-icon.js";
import { BalanceIcon } from "./dashboard/icons/sidebar/balance-icon.js";
import { ChangeLogIcon } from "./dashboard/icons/sidebar/changelog-icon.js";
import { CustomersIcon } from "./dashboard/icons/sidebar/customers-icon.js";
import { DevIcon } from "./dashboard/icons/sidebar/dev-icon.js";
import { FilterIcon } from "./dashboard/icons/sidebar/filter-icon.js";
import { HomeIcon } from "./dashboard/icons/sidebar/home-icon.js";
import { PaymentsIcon } from "./dashboard/icons/sidebar/payments-icon.js";
import { ProductsIcon } from "./dashboard/icons/sidebar/products-icon.js";
import { ReportsIcon } from "./dashboard/icons/sidebar/reports-icon.js";
import { SettingsIcon } from "./dashboard/icons/sidebar/settings-icon.js";
import { ViewIcon } from "./dashboard/icons/sidebar/view-icon.js";
import { DashboardLayout } from "./dashboard/layout.js";
import type { NavGroup, NavItem } from "./dashboard/sidebar.js";
import { Accounts } from "./dashboard/users.js";
import { TableRaceBoundary } from "./race-boundary.js";

export type Section = "account" | "admin" | "audit" | "organization";

/** Plugin settings tabs that belong under "Account"; every other tab goes under "Workspace". */
const ACCOUNT_TABS = new Set(["billing", "oauthClients"]);
/** Menu titles for known plugin tabs whose view name is camelCase. */
const TAB_TITLES: Record<string, string> = { oauthClients: "OAuth clients", organizations: "Organizations", billing: "Billing" };
/** Plugins whose security cards get their own page instead of the Security page. */
const OWN_PAGE: Record<string, string> = { apiKey: "api-keys", oauthProvider: "connected-apps", deleteUser: "account" };

function iconFor(view: string): React.ReactNode {
	if (/org|team/.test(view)) return <CustomersIcon />;
	if (/billing|plan|pay/.test(view)) return <PaymentsIcon />;
	if (/key|oauth|dev/i.test(view)) return <DevIcon />;
	if (/site|project/.test(view)) return <ProductsIcon />;
	if (view === "home") return <HomeIcon />;
	if (view === "users") return <AccountsIcon />;
	if (view === "account") return <ViewIcon />;
	if (view === "security") return <SettingsIcon />;
	if (view === "connected-apps") return <FilterIcon />;
	return <ReportsIcon />;
}
const humanize = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Breadcrumb (Home / Group / Page) + title, as on the template's Accounts page. */
function PageFrame({ title, group, wide, children }: { title: string; group?: string; wide?: boolean; children: React.ReactNode }) {
	const sep = <span aria-hidden="true" className="px-1 text-muted">/</span>;
	return (
		<div className="h-full px-4 py-6 lg:px-6">
			<div className={`mx-auto flex w-full flex-col gap-4 ${wide ? "max-w-5xl" : "max-w-3xl"}`}>
				<ul className="flex flex-wrap">
					<li className="flex gap-2">
						<HouseIcon />
						<a href="/account/home" className="text-foreground no-underline">
							<span>Home</span>
						</a>
						{sep}
					</li>
					{group ? (
						<li className="flex gap-2">
							<span className="text-muted">{group}</span>
							{sep}
						</li>
					) : null}
					<li className="flex gap-2">
						<span>{title}</span>
					</li>
				</ul>
				<h1 className="text-xl font-semibold">{title}</h1>
				{children}
			</div>
		</div>
	);
}

/** Card components registered by plugins, picked by plugin id. */
// biome-ignore lint/suspicious/noExplicitAny: plugin shapes are typed per plugin; we only read id/securityCards.
type Plugin = any;
function cardsOf(plugins: Plugin[], pick: (id: string) => boolean): React.ReactNode[] {
	return plugins
		.filter((p) => pick(p.id))
		.flatMap((p) =>
			// biome-ignore lint/suspicious/noExplicitAny: card components take the Card variant prop.
			(p.securityCards ?? []).map((Card: any, i: number) => <Card key={`${p.id}-${i}`} />),
		);
}

export function DashboardShell({
	path,
	section = "account",
	brand,
	userMenu,
	orgEnabled = false,
	auditLogEnabled = false,
	adminEnabled = false,
	isAdmin = false,
	role = 0,
	feedbackUrl,
	helpUrl,
}: {
	path: string;
	section?: Section;
	brand: { name: string; logoUrl?: string | null; tagline?: string };
	/** Avatar menu for the top bar. */
	userMenu: React.ReactNode;
	/** What the signed-in user can see (mirrors the site flags; the server still enforces access). */
	orgEnabled?: boolean;
	auditLogEnabled?: boolean;
	adminEnabled?: boolean;
	isAdmin?: boolean;
	/** EmDash role level; 20 and above is staff (writes content). */
	role?: number;
	feedbackUrl?: string;
	helpUrl?: string;
}) {
	const { basePaths, plugins = [], emailAndPassword, socialProviders } = useAuth() as {
		basePaths?: { settings?: string };
		plugins?: Plugin[];
		emailAndPassword?: { enabled?: boolean };
		socialProviders?: unknown[];
	};
	const base = basePaths?.settings ?? "/account";
	const staff = role >= 20;
	const hasCards = (id: string) => plugins.some((p) => p.id === id && p.securityCards?.length);

	const item = (view: string, title: string, seg = view): NavItem => ({
		title,
		href: `${base}/${seg}`,
		icon: iconFor(view),
		active: section === "account" && path === seg,
	});
	const fixed = (on: boolean, title: string, href: string, icon: React.ReactNode, sec: Section): NavItem[] =>
		on ? [{ title, href, icon, active: section === sec }] : [];

	// biome-ignore lint/suspicious/noExplicitAny: see Plugin.
	const tabs = plugins.flatMap((p) => (p.settingsTabs ?? []).map((t: any) => ({ p, t })));
	const tabItem = ({ p, t }: { p: Plugin; t: { view: string; label: unknown } }) =>
		item(t.view, TAB_TITLES[t.view] ?? (typeof t.label === "string" ? t.label : humanize(t.view)), p.viewPaths?.settings?.[t.view] ?? t.view);

	const workspace: NavItem[] = [
		...(staff ? [{ title: "Content editor", href: "/_emdash/admin", icon: <ProductsIcon />, active: false }] : []),
		...tabs.filter(({ t }: { t: { view: string } }) => !ACCOUNT_TABS.has(t.view)).map(tabItem),
		...fixed(orgEnabled, "Active organization", "/organization", <BalanceIcon />, "organization"),
	];
	const account: NavItem[] = [
		item("account", "Profile"),
		item("security", "Security"),
		item("activity", "Sessions & activity"),
		...(staff && hasCards("apiKey") ? [item("api-keys", "API keys")] : []),
		...(staff && hasCards("oauthProvider") ? [item("connected-apps", "Connected apps")] : []),
		...tabs.filter(({ t, p }: { t: { view: string }; p: Plugin }) => ACCOUNT_TABS.has(t.view) && (staff || p.id !== "oauthProvider")).map(tabItem),
	];
	const administration: NavItem[] = isAdmin
		? [
				item("users", "Users"),
				...fixed(adminEnabled, "User management", "/admin", <DevIcon />, "admin"),
				...fixed(auditLogEnabled, "Audit log", "/audit-log", <ChangeLogIcon />, "audit"),
			]
		: [];
	const groups: NavGroup[] = [
		...(staff ? [{ items: [item("home", "Home")] }] : []),
		...(workspace.length ? [{ title: "Workspace", items: workspace }] : []),
		{ title: "Account", items: account },
		...(administration.length ? [{ title: "Administration", items: administration }] : []),
	];
	const where = (title: string) => groups.find((g) => g.items.some((i) => i.title === title))?.title;
	const current = groups.flatMap((g) => g.items).find((i) => i.active);
	const title = current?.title ?? humanize(path);
	const group = current ? where(current.title) : undefined;
	const frame = (body: React.ReactNode, wide?: boolean) => (
		<PageFrame title={title} group={group} wide={wide}>
			{body}
		</PageFrame>
	);

	let body: React.ReactNode;
	if (section === "admin") {
		body = frame(<div className="admin-view"><Admin view={path} /></div>, true);
	} else if (section === "audit") {
		body = frame(<AuditLogTable mode="admin" />, true);
	} else if (section === "organization") {
		body = frame(<TableRaceBoundary><Organization view={path} /></TableRaceBoundary>, true);
	} else if (path === "home") {
		body = <Home orgEnabled={orgEnabled} auditLogEnabled={auditLogEnabled} isAdmin={isAdmin} />;
	} else if (path === "users") {
		body = <Accounts />;
	} else if (path === "activity") {
		body = frame(<Activity auditLogEnabled={auditLogEnabled} />, true);
	} else if (path === "account") {
		body = frame(
			<div className="flex flex-col gap-4 md:gap-6">
				<AccountSettings />
				{cardsOf(plugins, (id) => OWN_PAGE[id] === "account")}
			</div>,
		);
	} else if (path === "security") {
		body = frame(
			<div className="flex flex-col gap-4 md:gap-6">
				{emailAndPassword?.enabled ? <ChangePassword /> : null}
				{socialProviders?.length ? <LinkedAccounts /> : null}
				{cardsOf(plugins, (id) => !OWN_PAGE[id])}
				<a href={`${base}/activity`} className="rounded-2xl bg-surface p-4 text-sm text-foreground no-underline shadow-md">
					Devices you are signed in on and your sign-in history: <span className="text-accent">open Sessions & activity</span>
				</a>
			</div>,
		);
	} else if (path === "api-keys" || path === "connected-apps") {
		body = frame(<div className="flex flex-col gap-4 md:gap-6">{cardsOf(plugins, (id) => OWN_PAGE[id] === path)}</div>);
	} else {
		// A plugin's own settings tab (organizations, billing, oauth-clients, a host's own pages ...).
		body = frame(
			<div className="settings-bare">
				<Settings path={path} />
			</div>,
		);
	}
	return (
		<DashboardLayout
			brand={brand}
			groups={groups}
			userMenu={userMenu}
			settingsHref={`${base}/account`}
			orgEnabled={orgEnabled}
			feedbackUrl={feedbackUrl}
			helpUrl={helpUrl}
			siteUrl="/"
		>
			{body}
		</DashboardLayout>
	);
}
