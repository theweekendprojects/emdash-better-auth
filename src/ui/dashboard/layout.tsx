/**
 * Admin layout: sidebar + top bar + content.
 *
 * Ported to HeroUI v3 / Tailwind 4 from Siumauricio/nextui-dashboard-template
 * (MIT, see LICENSE-nextui-dashboard-template). Look and structure follow the
 * template; Next.js and NextUI v2 specifics are replaced, and the fake data is
 * replaced by props.
 */
import * as React from "react";
import { Navbar } from "./navbar.js";
import { Sidebar, type NavGroup } from "./sidebar.js";

interface LayoutState {
	/** Mobile drawer open. */
	open: boolean;
	toggle: () => void;
	/** Text typed in the top bar search; filters sidebar entries. */
	query: string;
	setQuery: (q: string) => void;
}

const LayoutContext = React.createContext<LayoutState>({
	open: false,
	toggle: () => {},
	query: "",
	setQuery: () => {},
});
export const useLayout = () => React.useContext(LayoutContext);

export interface DashboardLayoutProps {
	brand: { name: string; logoUrl?: string | null; tagline?: string };
	groups: NavGroup[];
	/** Avatar menu for the top bar (Better Auth UI's UserButton). */
	userMenu: React.ReactNode;
	/** Footer icon links in the sidebar: where the settings icons point. */
	settingsHref?: string;
	/** Optional top bar links; hidden when not set. */
	feedbackUrl?: string;
	helpUrl?: string;
	children: React.ReactNode;
}

export function DashboardLayout(props: DashboardLayoutProps) {
	const [open, setOpen] = React.useState(false);
	const [query, setQuery] = React.useState("");
	const toggle = React.useCallback(() => {
		setOpen((o) => {
			// Lock page scroll while the mobile drawer is open.
			document.body.style.overflow = o ? "" : "hidden";
			return !o;
		});
	}, []);
	return (
		<LayoutContext.Provider value={{ open, toggle, query, setQuery }}>
			<section className="flex">
				<Sidebar brand={props.brand} groups={props.groups} settingsHref={props.settingsHref} />
				<Navbar userMenu={props.userMenu} feedbackUrl={props.feedbackUrl} helpUrl={props.helpUrl}>
					{props.children}
				</Navbar>
			</section>
		</LayoutContext.Provider>
	);
}
