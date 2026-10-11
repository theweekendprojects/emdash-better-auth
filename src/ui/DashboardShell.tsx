/**
 * Account pages inside the admin layout (see ./dashboard).
 *
 * No new registry: the menu is built from what Better Auth UI already knows.
 * Account and Security are built in; every Better Auth UI plugin that declares
 * `settingsTabs` (organizations, billing, API keys, OAuth clients, and any
 * plugin from `emdash-better-auth/ui-plugins`) gets an entry automatically,
 * under "Main Menu". The page body is Better Auth UI's own `<Settings />` with
 * its tab row hidden by CSS (`.settings-bare`, see auth.css), so each panel
 * stays upstream code and nothing here needs maintenance when it changes.
 */
import { Settings } from "@better-auth-ui/heroui";
import { useAuth } from "@better-auth-ui/react";
import type * as React from "react";
import { DashboardLayout } from "./dashboard/layout.js";
import { Home } from "./dashboard/home.js";
import { Accounts } from "./dashboard/users.js";
import { HomeIcon } from "./dashboard/icons/sidebar/home-icon.js";
import { ViewIcon } from "./dashboard/icons/sidebar/view-icon.js";
import type { NavGroup, NavItem } from "./dashboard/sidebar.js";
import { AccountsIcon } from "./dashboard/icons/sidebar/accounts-icon.js";
import { CustomersIcon } from "./dashboard/icons/sidebar/customers-icon.js";
import { DevIcon } from "./dashboard/icons/sidebar/dev-icon.js";
import { PaymentsIcon } from "./dashboard/icons/sidebar/payments-icon.js";
import { ProductsIcon } from "./dashboard/icons/sidebar/products-icon.js";
import { ReportsIcon } from "./dashboard/icons/sidebar/reports-icon.js";
import { SettingsIcon } from "./dashboard/icons/sidebar/settings-icon.js";

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

export function DashboardShell({
	path,
	brand,
	userMenu,
	orgEnabled = false,
	auditLogEnabled = false,
	isAdmin = false,
	feedbackUrl,
	helpUrl,
	children,
}: {
	path: string;
	brand: { name: string; logoUrl?: string | null; tagline?: string };
	/** Avatar menu for the top bar. */
	userMenu: React.ReactNode;
	/** What the signed-in user can see (mirrors the site flags; the server still enforces access). */
	orgEnabled?: boolean;
	auditLogEnabled?: boolean;
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
		active: path === seg,
	});
	const main: NavItem[] =
		// biome-ignore lint/suspicious/noExplicitAny: see above.
		(plugins ?? []).flatMap((p: any) =>
			// biome-ignore lint/suspicious/noExplicitAny: see above.
			(p.settingsTabs ?? []).map((t: any) =>
				item(t.view, typeof t.label === "string" ? t.label : humanize(t.view), p.viewPaths?.settings?.[t.view] ?? t.view),
			),
		);
	const groups: NavGroup[] = [
		{ items: [item("home", "Home")] },
		...(main.length || isAdmin ? [{ title: "Main Menu", items: [...main, ...(isAdmin ? [item("users", "Users")] : [])] }] : []),
		{ title: "General", items: [item("account", "Account"), item("security", "Security")] },
	];
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
			{path === "home" ? (
				<Home orgEnabled={orgEnabled} auditLogEnabled={auditLogEnabled} isAdmin={isAdmin} />
			) : path === "users" ? (
				<Accounts />
			) : (
				<div className="h-full px-4 py-6 lg:px-6">
					<div className="mx-auto w-full max-w-3xl">
						<div className="settings-bare">
							<Settings path={path} />
						</div>
						{children}
					</div>
				</div>
			)}
		</DashboardLayout>
	);
}
