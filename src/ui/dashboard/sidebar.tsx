/** Sidebar. Port of the nextui-dashboard-template sidebar (MIT) to HeroUI v3. */
import { Avatar, Dropdown } from "@heroui/react";
import * as React from "react";
import { FilterIcon } from "./icons/sidebar/filter-icon.js";
import { SettingsIcon } from "./icons/sidebar/settings-icon.js";
import { useOrgs } from "./data.js";
import { BottomIcon } from "./icons/sidebar/bottom-icon.js";
import { authClient } from "../../client.js";
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
				className={`flex h-full min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl px-3.5 transition-all duration-150 active:scale-[0.98] ${
					active ? "bg-accent text-accent-foreground [&_svg_path]:fill-accent-foreground" : "hover:bg-default"
				}`}
			>
				{icon}
				<span className={active ? "font-medium text-accent-foreground" : "text-foreground"}>{title}</span>
			</div>
		</a>
	);
}

function BrandBlock({ name, logoUrl, tagline }: { name: string; logoUrl?: string | null; tagline?: string }) {
	return (
		<div className="flex items-center gap-2">
			{logoUrl ? (
				<img src={logoUrl} alt="" className="h-9 w-auto max-w-11 rounded-lg object-contain" />
			) : (
				<div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-background text-lg font-semibold">
					{name.slice(0, 1).toUpperCase()}
				</div>
			)}
			{/* Long names and taglines wrap (two lines at most) instead of being cut off; the full text is the tooltip. */}
			<div className="flex min-w-0 max-w-44 flex-col">
				<span title={name} className="line-clamp-2 break-words text-xl font-medium leading-tight text-foreground">{name}</span>
				{tagline ? <span title={tagline} className="line-clamp-2 break-words text-xs font-medium leading-snug text-muted">{tagline}</span> : null}
			</div>
		</div>
	);
}

/** Brand block. With organizations on it is the template's "companies" dropdown: pick the active organization. */
function Brand(props: { name: string; logoUrl?: string | null; tagline?: string; orgEnabled?: boolean }) {
	const orgs = useOrgs(!!props.orgEnabled);
	if (!props.orgEnabled || !orgs.data?.length) {
		return (
			<a href="/" className="text-foreground no-underline">
				<BrandBlock {...props} />
			</a>
		);
	}
	return (
		<Dropdown>
			<Dropdown.Trigger aria-label="Switch organization" className="cursor-pointer bg-transparent p-0 text-left">
				<div className="flex items-center gap-2">
					<BrandBlock {...props} />
					<BottomIcon />
				</div>
			</Dropdown.Trigger>
			<Dropdown.Popover placement="bottom start">
				<Dropdown.Menu
					className="w-full min-w-[260px]"
					aria-label="Organizations"
					onAction={async (id) => {
						// biome-ignore lint/suspicious/noExplicitAny: organization client methods are typed per build.
						await (authClient as any).organization.setActive({ organizationId: String(id) });
						window.location.reload();
					}}
				>
					<Dropdown.Section>
						<span className="px-3 py-1 text-xs text-muted">Organizations</span>
						{orgs.data.map((o) => (
							<Dropdown.Item key={o.id} id={o.id} textValue={o.name}>
								<div className="flex flex-col py-2">
									<span className="text-base font-semibold">{o.name}</span>
									<span className="text-xs text-muted">{o.slug}</span>
								</div>
							</Dropdown.Item>
						))}
					</Dropdown.Section>
				</Dropdown.Menu>
			</Dropdown.Popover>
		</Dropdown>
	);
}

export function Sidebar(props: {
	brand: { name: string; logoUrl?: string | null; tagline?: string };
	groups: NavGroup[];
	settingsHref?: string;
	orgEnabled?: boolean;
}) {
	const { data: session } = authClient.useSession();
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
				className={`fixed z-[202] h-full w-64 shrink-0 -translate-x-full flex-col overflow-y-auto border-r border-border bg-background px-3 py-4 transition-transform md:static md:ml-0 md:flex md:h-screen md:translate-x-0 ${
					open ? "ml-0 translate-x-0 pt-20 [display:inherit]" : ""
				}`}
			>
				<div className="flex items-center gap-8 px-6">
					<Brand {...props.brand} orgEnabled={props.orgEnabled} />
				</div>
				<div className="flex h-full flex-col justify-between">
					<nav aria-label="Main" className="mt-4 flex min-h-0 flex-col gap-3 px-2">
						{groups.map((g, n) => (
							<div key={g.title ?? n} className="flex flex-col gap-1">
								{g.title ? <span className="text-xs font-normal text-muted">{g.title}</span> : null}
								{g.items.map((i) => (
									<SidebarItem key={i.href} {...i} />
								))}
							</div>
						))}
					</nav>
					{props.settingsHref ? (
						<div className="flex items-center justify-center gap-6 px-8 pb-4 pt-6 [@media(max-height:800px)]:hidden">
							<a href={props.settingsHref} aria-label="Profile settings" title="Profile settings" className="max-w-fit">
								<SettingsIcon />
							</a>
							<a href={`${props.settingsHref.replace(/\/[^/]*$/, "")}/security`} aria-label="Security" title="Security" className="max-w-fit">
								<FilterIcon />
							</a>
							<a href={props.settingsHref} aria-label="Your profile" title="Your profile">
								<Avatar size="sm">
									{session?.user?.image ? <Avatar.Image src={session.user.image} alt="" /> : null}
									<Avatar.Fallback>{(session?.user?.name || session?.user?.email || "?").slice(0, 1).toUpperCase()}</Avatar.Fallback>
								</Avatar>
							</a>
						</div>
					) : null}
				</div>
			</div>
		</aside>
	);
}
