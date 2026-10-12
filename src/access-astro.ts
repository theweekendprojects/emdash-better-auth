/**
 * Content access for theme pages: members-only and premium entries.
 *
 * A theme calls these where it reads content:
 *
 *   const { entry } = await getEmDashEntry("posts", slug);
 *   const blocked = await gateEntry(Astro, entry);       // before any rendering
 *   if (blocked) return blocked;
 *
 *   const posts = await filterEntries(Astro, entries);   // in lists, feeds and tag pages
 *
 * Public entries cost nothing: no session lookup, no extra headers. See ./access.ts for the rules.
 * Responses that depend on who is looking get `Cache-Control: private, no-store`; a theme must also
 * skip `Astro.cache.set(...)` for them.
 */
import type { AstroGlobal } from "astro";
import { type Access, decide, entryAccess, listed, STAFF_ROLE, type Viewer } from "./access.ts";
import { contentAccessEnabled } from "./providers.ts";
import { getAuthUser } from "./route.ts";

export { type Access, decide, entryAccess, listed } from "./access.ts";

type Entry = { data?: Record<string, unknown> };
/** What the checks need. Both `Astro` (pages) and the middleware context satisfy it. */
export type AccessContext = Pick<AstroGlobal, "locals" | "request" | "site" | "redirect" | "url"> & { originPathname?: string };

/** Mark a response as per-viewer so no shared cache stores it. */
export function markPrivate(Astro: AstroGlobal): void {
	Astro.response.headers.set("Cache-Control", "private, no-store");
	Astro.response.headers.set("Vary", "Cookie");
}

/** Signed-in user's role, or null when signed out. EmDash's own session first, then Better Auth's cookie. */
async function viewerBase(Astro: AccessContext): Promise<{ role: number; premium: boolean } | null> {
	const u = Astro.locals.user as { role?: number } | undefined;
	if (u) return { role: u.role ?? 10, premium: false };
	const ba = await getAuthUser(Astro);
	if (!ba) return null;
	return { role: ba.role === "admin" ? 50 : 10, premium: ba.premium === true };
}

export async function viewerFor(Astro: AccessContext, needPremium: boolean): Promise<Viewer | null> {
	const base = await viewerBase(Astro);
	if (!base) return null;
	if (needPremium && !base.premium && base.role < STAFF_ROLE) {
		const ba = await getAuthUser(Astro);
		return { role: base.role, premium: ba?.premium === true };
	}
	return base;
}

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface GateOptions {
	/** Where "Upgrade" points for signed-in users without premium. */
	upgradeUrl?: string;
}

/**
 * The decision for one entry: a Response to send instead of the page (or null), and whether the answer
 * depends on who is looking (then the page must not be cached). Used by `gateEntry` and the middleware.
 */
export async function checkEntry(Astro: AccessContext, entry: Entry | null | undefined, options: GateOptions = {}): Promise<{ block: Response | null; viewerDependent: boolean }> {
	const access = entryAccess(entry);
	if (access === "public" || !(await contentAccessEnabled())) return { block: null, viewerDependent: false };
	const viewer = await viewerFor(Astro, access === "premium");
	const decision = decide(access, viewer);
	if (decision === "allow") return { block: null, viewerDependent: true };
	// The address the visitor typed, not Astro.url: a host that rewrites to a theme route shows the internal path there.
	const here = (Astro.originPathname ?? Astro.url.pathname) + Astro.url.search;
	if (decision === "login") {
		const res = Astro.redirect(`/auth/sign-in?redirect=${encodeURIComponent(here)}`);
		res.headers.set("Cache-Control", "private, no-store");
		return { block: res, viewerDependent: true };
	}
	// premium: a signed-in user without it. Title and excerpt are the teaser.
	const title = esc(entry?.data?.title);
	const teaser = esc(entry?.data?.excerpt);
	const upgrade = esc(options.upgradeUrl ?? "/account/billing");
	const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:36rem;margin:12vh auto;padding:0 1rem;color:#18181b}a.b{display:inline-block;margin-top:1rem;padding:.6rem 1.1rem;border-radius:999px;background:#0066cc;color:#fff;text-decoration:none}p{color:#52525b}@media(prefers-color-scheme:dark){body{background:#09090b;color:#fafafa}p{color:#a1a1aa}}</style></head><body><main><h1>${title}</h1><p>${teaser}</p><p>This is a premium article.</p><a class="b" href="${upgrade}">Upgrade to read</a></main></body></html>`;
	return { block: new Response(html, { status: 403, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", Vary: "Cookie" } }), viewerDependent: true };
}

/** Returns a Response to send instead of the page, or null when the viewer may read the entry. Themes only need this when the site does not use the `betterAuthAccess()` integration. */
export async function gateEntry(Astro: AstroGlobal, entry: Entry | null | undefined, options: GateOptions = {}): Promise<Response | null> {
	const { block, viewerDependent } = await checkEntry(Astro, entry, options);
	if (viewerDependent) markPrivate(Astro);
	return block;
}

/** Entries the viewer may see in a list, feed or tag page. Members-only entries disappear for others. */
export async function filterEntries<T extends Entry>(Astro: AstroGlobal, entries: T[]): Promise<T[]> {
	const levels = entries.map((e) => entryAccess(e));
	if (levels.every((l: Access) => l === "public") || !(await contentAccessEnabled())) return entries;
	markPrivate(Astro);
	const viewer = await viewerFor(Astro, false);
	return entries.filter((_, i) => listed(levels[i] as Access, viewer));
}

/** True for entries a list should show with a lock (premium the viewer cannot open). */
export async function isLocked(Astro: AstroGlobal, entry: Entry): Promise<boolean> {
	const access = entryAccess(entry);
	if (access === "public" || !(await contentAccessEnabled())) return false;
	return decide(access, await viewerFor(Astro, access === "premium")) !== "allow";
}
