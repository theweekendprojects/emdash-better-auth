/**
 * Admin-style layout for the account pages: sidebar, top bar with breadcrumb
 * and user menu, content column.
 *
 * No new registry: the menu is built from what Better Auth UI already knows.
 * Account and Security are built in; every Better Auth UI plugin that declares
 * `settingsTabs` (organizations, billing, API keys, OAuth clients, and any
 * plugin from `emdash-better-auth/ui-plugins`) gets an entry automatically,
 * under "Manage". The page body is Better Auth UI's own `<Settings />` with its
 * tab row hidden by CSS (`.settings-bare`, see auth.css), so each panel stays
 * upstream code and nothing here needs maintenance when it changes.
 *
 * Narrow screens keep the same links as a horizontally scrolling row.
 */
import { Settings } from "@better-auth-ui/heroui";
import { useAuth } from "@better-auth-ui/react";
import type * as React from "react";

interface Item {
	label: React.ReactNode;
	href: string;
}

export function DashboardShell({
	path,
	brand,
	userMenu,
	children,
}: {
	path: string;
	/** Logo or site name, shown at the top of the sidebar. */
	brand: React.ReactNode;
	/** Avatar menu for the top bar. */
	userMenu: React.ReactNode;
	children?: React.ReactNode;
}) {
	// biome-ignore lint/suspicious/noExplicitAny: plugin shapes are typed per plugin; we only read settingsTabs/viewPaths.
	const { basePaths, plugins } = useAuth() as any;
	const base: string = basePaths?.settings ?? "/account";
	const account: Item[] = [
		{ label: "Account", href: `${base}/account` },
		{ label: "Security", href: `${base}/security` },
	];
	const manage: Item[] =
		// biome-ignore lint/suspicious/noExplicitAny: see above.
		(plugins ?? []).flatMap((p: any) =>
			// biome-ignore lint/suspicious/noExplicitAny: see above.
			(p.settingsTabs ?? []).map((t: any) => ({
				label: t.label as React.ReactNode,
				href: `${base}/${p.viewPaths?.settings?.[t.view] ?? t.view}`,
			})),
		);
	const all = [...manage, ...account];
	// The page path is the last segment of an item's href ("account", "organizations", ...).
	const current = all.find((i) => i.href.endsWith(`/${path}`));

	const link = (i: Item) => (
		<a
			key={i.href}
			href={i.href}
			aria-current={i === current ? "page" : undefined}
			className={`block whitespace-nowrap rounded-xl px-3 py-2 text-sm no-underline transition-colors ${
				i === current
					? "bg-accent/10 font-semibold text-accent"
					: "text-muted hover:bg-default hover:text-foreground"
			}`}
		>
			<span className="inline-flex items-center gap-2">{i.label}</span>
		</a>
	);
	const group = (label: string, items: Item[]) =>
		items.length === 0 ? null : (
			<div className="flex flex-col gap-1">
				<p className="px-3 text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
				{items.map(link)}
			</div>
		);

	return (
		<div className="flex min-h-svh">
			<aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col gap-8 overflow-y-auto border-r border-border bg-background p-4 md:flex">
				<a href="/" className="px-3 py-2 text-foreground no-underline">
					{brand}
				</a>
				{group("Manage", manage)}
				{group("Account", account)}
			</aside>
			<div className="flex min-w-0 flex-1 flex-col">
				<header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-border bg-background px-4 py-3 md:px-8">
					<div className="flex min-w-0 items-center gap-2 text-sm">
						<a href="/" className="font-semibold text-foreground no-underline md:hidden">
							{brand}
						</a>
						<span className="hidden text-muted md:inline">Home</span>
						<span className="hidden text-muted md:inline">/</span>
						<span className="inline-flex items-center gap-2 truncate font-medium">{current?.label ?? "Account"}</span>
					</div>
					{userMenu}
				</header>
				<nav aria-label="Account" className="border-b border-border px-4 py-2 md:hidden">
					<div className="flex gap-1 overflow-x-auto">{all.map(link)}</div>
				</nav>
				<main className="flex-1 p-4 md:p-8">
					<div className="w-full max-w-3xl">
						<div className="settings-bare">
							<Settings path={path} />
						</div>
						{children}
					</div>
				</main>
			</div>
		</div>
	);
}
