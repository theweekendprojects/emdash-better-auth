/** Sidebar. Port of the nextui-dashboard-template sidebar (MIT) to HeroUI v3. */
import { Tooltip } from "@heroui/react";
import * as React from "react";
import { FilterIcon } from "./icons/sidebar/filter-icon.js";
import { SettingsIcon } from "./icons/sidebar/settings-icon.js";
import { useLayout } from "./layout.js";

export interface NavItem {
	title: string;
	href: string;
	icon: React.ReactNode;
	active?: boolean;
}
export interface NavGroup {
	/** Section label ("Main Menu"); omit for the unlabeled top group. */
	title?: string;
	items: NavItem[];
}

function SidebarItem({ icon, title, active, href }: NavItem) {
	const { open, toggle } = useLayout();
	return (
		<a href={href} className="max-w-full text-foreground no-underline" onClick={() => open && toggle()}>
			<div
				className={`flex h-full min-h-[44px] w-full cursor-pointer items-center gap-2 rounded-xl px-3.5 transition-all duration-150 active:scale-[0.98] ${
					active ? "bg-accent-soft [&_svg_path]:fill-accent" : "hover:bg-default"
				}`}
			>
				{icon}
				<span className="text-foreground">{title}</span>
			</div>
		</a>
	);
}

function Brand({ name, logoUrl, tagline }: { name: string; logoUrl?: string | null; tagline?: string }) {
	return (
		<a href="/" className="flex items-center gap-2 text-foreground no-underline">
			{logoUrl ? (
				<img src={logoUrl} alt="" className="h-9 w-auto max-w-11 rounded-lg object-contain" />
			) : (
				<div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-background text-lg font-semibold">
					{name.slice(0, 1).toUpperCase()}
				</div>
			)}
			<div className="flex flex-col">
				<h3 className="m-0 whitespace-nowrap text-xl font-medium text-foreground">{name}</h3>
				{tagline ? <span className="max-w-40 truncate text-xs font-medium text-muted">{tagline}</span> : null}
			</div>
		</a>
	);
}

export function Sidebar(props: {
	brand: { name: string; logoUrl?: string | null; tagline?: string };
	groups: NavGroup[];
	settingsHref?: string;
}) {
	const { open, toggle, query } = useLayout();
	const q = query.trim().toLowerCase();
	const groups = props.groups
		.map((g) => ({ ...g, items: g.items.filter((i) => !q || i.title.toLowerCase().includes(q)) }))
		.filter((g) => g.items.length > 0);
	return (
		<aside className="sticky top-0 z-[20] h-screen">
			{open ? (
				<div
					className="fixed inset-0 z-[201] bg-[rgb(15_23_42/0.3)] opacity-80 transition-opacity md:hidden"
					onClick={toggle}
					aria-hidden="true"
				/>
			) : null}
			<div
				className={`fixed z-[202] h-full w-64 shrink-0 -translate-x-full flex-col overflow-y-auto border-r border-border bg-background px-3 py-6 transition-transform md:static md:ml-0 md:flex md:h-screen md:translate-x-0 ${
					open ? "ml-0 translate-x-0 pt-20 [display:inherit]" : ""
				}`}
			>
				<div className="flex items-center gap-8 px-6">
					<Brand {...props.brand} />
				</div>
				<div className="flex h-full flex-col justify-between">
					<nav aria-label="Main" className="mt-9 flex flex-col gap-6 px-2">
						{groups.map((g, n) => (
							<div key={g.title ?? n} className="flex flex-col gap-2">
								{g.title ? <span className="text-xs font-normal text-muted">{g.title}</span> : null}
								{g.items.map((i) => (
									<SidebarItem key={i.href} {...i} />
								))}
							</div>
						))}
					</nav>
					{props.settingsHref ? (
						<div className="flex items-center justify-center gap-6 px-8 pb-8 pt-16 md:pb-0 md:pt-10">
							<Tooltip>
								<Tooltip.Trigger>
									<a href={props.settingsHref} aria-label="Settings" className="max-w-fit">
										<SettingsIcon />
									</a>
								</Tooltip.Trigger>
								<Tooltip.Content>Settings</Tooltip.Content>
							</Tooltip>
							<Tooltip>
								<Tooltip.Trigger>
									<a href={`${props.settingsHref.replace(/\/[^/]*$/, "")}/security`} aria-label="Security" className="max-w-fit">
										<FilterIcon />
									</a>
								</Tooltip.Trigger>
								<Tooltip.Content>Security</Tooltip.Content>
							</Tooltip>
						</div>
					) : null}
				</div>
			</div>
		</aside>
	);
}
