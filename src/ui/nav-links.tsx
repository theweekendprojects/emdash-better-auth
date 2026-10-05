/**
 * Avatar-menu links shared by the account, admin and organization islands.
 *
 * The pages this plugin adds (/admin, /audit-log, /organization) used to be
 * reachable only by typing the URL. Every UserButton now lists the ones that
 * apply: feature-gated by the same flags the routes check, and admin-level
 * links only for EmDash admins (the pages re-check the role server-side, this
 * only decides what to show). The audit log page has no UserButton (it isn't
 * inside the auth provider) and keeps its own back button.
 */

import type { UserButtonLink } from "@better-auth-ui/heroui";
import { Briefcase, ClockArrowRotateLeft, Persons } from "@gravity-ui/icons";

/**
 * EmDash logo mark (rounded square + dash), taken from EmDash's own admin
 * lockup. Single colour (currentColor) instead of the brand gradient so it
 * matches the other muted menu icons. Explicit 16px like the gravity icons the
 * built-in items use (an unsized SVG fills the menu row).
 */
function EmDashIcon() {
	return (
		<svg
			viewBox="0 0 119 118"
			width={16}
			height={16}
			fill="currentColor"
			className="shrink-0 text-muted"
			aria-hidden="true"
		>
			<path d="M0.410156 96.5125V21.2097C0.410156 9.48841 9.91245 -0.013916 21.6338 -0.013916V9.40601L21.3291 9.40991C14.9509 9.57133 9.83008 14.7927 9.83008 21.2097V96.5125C9.83008 102.93 14.9509 108.151 21.3291 108.312L21.6338 108.316H96.9365L97.2412 108.312C103.518 108.153 108.577 103.094 108.736 96.8171L108.74 96.5125V21.2097C108.74 14.6909 103.455 9.40601 96.9365 9.40601V-0.013916C108.658 -0.013916 118.16 9.48838 118.16 21.2097V96.5125C118.16 108.234 108.658 117.736 96.9365 117.736H21.6338C9.91248 117.736 0.410156 108.234 0.410156 96.5125ZM96.9365 -0.013916V9.40601H21.6338V-0.013916H96.9365Z" />
			<path d="M28.6699 53.366H90.4746V63.6668H28.6699V53.366Z" />
		</svg>
	);
}

export interface NavLinkFlags {
	/** Signed-in user is an EmDash admin (role >= 50). */
	isEmdashAdmin?: boolean;
	/** Admin user-management plugin is on (/admin exists). */
	adminEnabled?: boolean;
	/** Audit logging is on (/audit-log exists). */
	auditLogEnabled?: boolean;
	/** Organizations are on (/organization exists). */
	orgEnabled?: boolean;
	/** The page being rendered, so its own link is left out. */
	current?: "admin" | "organization" | "account";
}

export function buildNavLinks({
	isEmdashAdmin = false,
	adminEnabled = false,
	auditLogEnabled = false,
	orgEnabled = false,
	current,
}: NavLinkFlags): UserButtonLink[] {
	const links: UserButtonLink[] = [];
	if (isEmdashAdmin && adminEnabled && current !== "admin") {
		links.push({
			label: "Manage users",
			href: "/admin",
			icon: <Persons className="text-muted" />,
			visibility: "authenticated",
		});
	}
	if (isEmdashAdmin && auditLogEnabled) {
		links.push({
			label: "Audit log",
			href: "/audit-log",
			icon: <ClockArrowRotateLeft className="text-muted" />,
			visibility: "authenticated",
		});
	}
	if (orgEnabled && current !== "organization") {
		links.push({
			label: "Organization",
			href: "/organization",
			icon: <Briefcase className="text-muted" />,
			visibility: "authenticated",
		});
	}
	if (isEmdashAdmin) {
		links.push({
			label: "EmDash Admin",
			href: "/_emdash/admin",
			icon: <EmDashIcon />,
			visibility: "authenticated",
		});
	}
	return links;
}
