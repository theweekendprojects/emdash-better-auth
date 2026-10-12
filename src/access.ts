/**
 * Who may read an entry: the pure rules, no framework imports (runs under plain Node in the self-check).
 *
 * An entry carries an `access` field (a select on the collection):
 *   public    anyone (the default, also when the field does not exist)
 *   members   signed-in users only; hidden from lists and feeds for everyone else
 *   premium   premium users only; listed with a lock and a teaser, the page shows a paywall
 * Staff (EmDash role CONTRIBUTOR and above) always see everything: they write it.
 */
export const ACCESS_LEVELS = ["public", "members", "premium"] as const;
export type Access = (typeof ACCESS_LEVELS)[number];

/** EmDash CONTRIBUTOR and above. */
export const STAFF_ROLE = 20;

/** `null` = signed out. */
export interface Viewer {
	role: number;
	premium: boolean;
}

/** The access level of an entry. A missing value is public; an unknown value is treated as `members` (fail closed). */
export function entryAccess(entry: { data?: Record<string, unknown> } | null | undefined): Access {
	const v = entry?.data?.access;
	if (v === undefined || v === null || v === "") return "public";
	return (ACCESS_LEVELS as readonly unknown[]).includes(v) ? (v as Access) : "members";
}

export type Decision = "allow" | "login" | "premium";

export function decide(access: Access, viewer: Viewer | null): Decision {
	if (access === "public") return "allow";
	if (!viewer) return "login";
	if (viewer.role >= STAFF_ROLE) return "allow";
	if (access === "members") return "allow";
	return viewer.premium ? "allow" : "premium";
}

/** Should the entry appear in a list, feed or search result for this viewer? Premium entries do (as a teaser). */
export function listed(access: Access, viewer: Viewer | null): boolean {
	return access === "premium" ? true : decide(access, viewer) === "allow";
}
/** Hidden from search and feeds: anything the reader could not open (premium too, unlike lists). */
export function hiddenFromFeed(access: Access | undefined, viewer: Viewer | null): boolean {
	return access !== undefined && access !== "public" && decide(access, viewer) !== "allow";
}
/**
 * How the sign-in wall treats a path (`siteLoginRequired`).
 *  open  never walled: sign-in and account pages, admin and auth APIs, built assets
 *  api   data a visitor could fetch directly (search, uploaded files, comments): 401 when signed out
 *  page  everything the theme renders: redirect to sign-in when signed out
 */
export type WallClass = "open" | "api" | "page";
const WALLED_API = /^\/(?:_emdash\/api\/(?:search(?:\/suggest)?|media\/file\/.+|comments(?:\/.*)?)|_image)$/;
const OPEN = /^\/(?:_emdash|_astro|api|auth|login|signup|account|organization|admin|audit-log|sites|\.well-known)(?:\/|$)/;
export function wallClass(path: string): WallClass {
	if (WALLED_API.test(path)) return "api";
	if (OPEN.test(path)) return "open";
	// A file (image, font, script) next to the theme; sitemaps and feeds are pages.
	if (/\.[a-z0-9]{1,5}$/i.test(path) && !/\.xml$/.test(path)) return "open";
	return "page";
}
export interface UrlPattern {
	collection: string;
	re: RegExp;
	slugAt: number;
}
/** A collection URL pattern such as `/posts/{slug}` as a regex. Patterns without `{slug}` cannot name an entry. */
export function compileUrlPattern(collection: string, pattern: string): UrlPattern | null {
	if (!pattern) return null;
	const names: string[] = [];
	const body = pattern
		.replace(/[.*+?^$()|[\]\\]/g, "\\$&")
		.replace(/\{(\w+)\}/g, (_m, n: string) => {
			names.push(n);
			return "([^/]+)";
		});
	const slugAt = names.indexOf("slug");
	return slugAt < 0 ? null : { collection, re: new RegExp(`^${body}/?$`), slugAt };
}
/** Doubled slashes (`//posts/a`, seen in feeds that join a base URL ending in `/`) must still match. */
export const cleanPath = (path: string): string => path.replace(/\/{2,}/g, "/");
export function matchUrlPattern(patterns: UrlPattern[], path: string): { collection: string; slug: string } | null {
	for (const p of patterns) {
		const m = p.re.exec(cleanPath(path));
		if (m?.[p.slugAt + 1]) return { collection: p.collection, slug: decodeURIComponent(m[p.slugAt + 1]!) };
	}
	return null;
}
