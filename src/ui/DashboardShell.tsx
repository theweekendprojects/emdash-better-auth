/**
 * Every signed-in page (account, admin, audit log, organization) inside the
 * admin layout (see ./dashboard).
 *
 * No new registry: the menu is built from what Better Auth UI already knows.
 * Every plugin that declares `settingsTabs` (organizations, billing, API keys,
 * OAuth clients, and any plugin from `emdash-better-auth/ui-plugins`) gets an
 * entry under "Main Menu" by itself, next to the fixed admin pages. Page bodies
 * are Better Auth UI's own components, so each panel stays upstream code and
 * needs no maintenance when it changes; the Settings tab row is hidden by CSS
 * (`.settings-bare`, see auth.css) because the sidebar replaces it.
 */
import { Admin, Settings } from "@better-auth-ui/heroui";
import { Organization } from "@better-auth-ui/heroui/plugins/organization";
import { useAuth } from "@better-auth-ui/react";
import type * as React from "react";
import { AuditLogTable } from "./AuditLogView.js";
import { Home } from "./dashboard/home.js";
import { HouseIcon } from "./dashboard/icons/breadcrumb/house-icon.js";
import { AccountsIcon } from "./dashboard/icons/sidebar/accounts-icon.js";
import { BalanceIcon } from "./dashboard/icons/sidebar/balance-icon.js";
import { ChangeLogIcon } from "./dashboard/icons/sidebar/changelog-icon.js";
import { CustomersIcon } from "./dashboard/icons/sidebar/customers-icon.js";
import { DevIcon } from "./dashboard/icons/sidebar/dev-icon.js";
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

/** Icon by settings view name; unknown plugin views get a neutral one. */
function iconFor(view: string): React.ReactNode {
	if (/org|team/.test(view)) return <CustomersIcon />;
	if (/billing|plan|pay/.test(view)) return <PaymentsIcon />;
	if (/key|oauth|client|dev/.test(view)) return <DevIcon />;
	if (/site|project/.test(view)) return <ProductsIcon />;
	if (view === "home") return <HomeIcon />;
	if (view === "users") return <AccountsIcon />;
	if (view === "account") return <ViewIcon />;
	if (view === "security") return <SettingsIcon />;
	return <ReportsIcon />;
}
const humanize = (s: string) => s.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());

/** Breadcrumb + title, as on the template's Accounts page. */
function PageFrame({ title, wide, children }: { title: string; wide?: boolean; children: React.ReactNode }) {
	return (
		<div className="h-full px-4 py-6 lg:px-6">
			<div className={`mx-auto flex w-full flex-col gap-4 ${wide ? "max-w-5xl" : "max-w-3xl"}`}>
				<ul className="flex">
					<li className="flex gap-2">
						<HouseIcon />
						<a href="/account/home" className="text-foreground no-underline">
							<span>Home</span>
						</a>
						<span> / </span>{" "}
					</li>
					<li className="flex gap-2">
						<span>{title}</span>
					</li>
				</ul>
				<h3 className="text-xl font-semibold">{title}</h3>
				{children}
			</div>
		</div>
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
	feedbackUrl,
	helpUrl,
	children,
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
	feedbackUrl?: string;
	helpUrl?: string;
	children?: React.ReactNode;
}) {
	// biome-ignore lint/suspicious/noExplicitAny: plugin shapes are typed per plugin; we only read settingsTabs/viewPaths.
	const { basePaths, plugins } = useAuth() as any;
	const base: string = basePaths?.settings ?? "/account";
	const item = (view: string, title: string, seg = view): NavItem => ({
		title,
		href: `${base}/${seg}`,
		icon: iconFor(view),
		active: section === "account" && path === seg,
	});
	const fixed = (on: boolean, title: string, href: string, icon: React.ReactNode, sec: Section): NavItem[] =>
		on ? [{ title, href, icon, active: section === sec }] : [];
	const tabs: NavItem[] =
		// biome-ignore lint/suspicious/noExplicitAny: see above.
		(plugins ?? []).flatMap((p: any) =>
			// biome-ignore lint/suspicious/noExplicitAny: see above.
			(p.settingsTabs ?? []).map((t: any) =>
				item(t.view, typeof t.label === "string" ? t.label : humanize(t.view), p.viewPaths?.settings?.[t.view] ?? t.view),
			),
		);
	const main: NavItem[] = [
		...tabs,
		...fixed(orgEnabled, "Active organization", "/organization", <BalanceIcon />, "organization"),
		...(isAdmin ? [item("users", "Users")] : []),
		...fixed(isAdmin && adminEnabled, "Roles & sessions", "/admin", <DevIcon />, "admin"),
		...fixed(isAdmin && auditLogEnabled, "Audit log", "/audit-log", <ChangeLogIcon />, "audit"),
	];
	const groups: NavGroup[] = [
		{ items: [item("home", "Home")] },
		...(main.length ? [{ title: "Main Menu", items: main }] : []),
		{ title: "General", items: [item("account", "Account"), item("security", "Security")] },
	];
	const all = groups.flatMap((g) => g.items);
	const title = all.find((i) => i.active)?.title ?? humanize(path);

	let body: React.ReactNode;
	if (section === "admin") {
		body = (
			<PageFrame title={title} wide>
				<div className="admin-view">
					<Admin view={path} />
				</div>
			</PageFrame>
		);
	} else if (section === "audit") {
		body = (
			<PageFrame title={title} wide>
				<AuditLogTable mode="admin" />
			</PageFrame>
		);
	} else if (section === "organization") {
		body = (
			<PageFrame title={title} wide>
				<TableRaceBoundary>
					<Organization view={path} />
				</TableRaceBoundary>
			</PageFrame>
		);
	} else if (path === "home") {
		body = <Home orgEnabled={orgEnabled} auditLogEnabled={auditLogEnabled} isAdmin={isAdmin} />;
	} else if (path === "users") {
		body = <Accounts />;
	} else {
		body = (
			<PageFrame title={title}>
				<div className="settings-bare">
					<Settings path={path} />
				</div>
				{children}
			</PageFrame>
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
