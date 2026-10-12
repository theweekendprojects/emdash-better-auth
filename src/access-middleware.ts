/**
 * Content access without touching the theme. Added by the `betterAuthAccess()` integration.
 *
 *  - an entry page (found through the collection's URL pattern) is gated before the theme renders
 *  - the search API and RSS / sitemap XML drop entries the reader may not open
 *
 * HTML lists are not rewritten: they show titles (a teaser). A theme that wants them hidden calls
 * `filterEntries` from `emdash-better-auth/access`.
 * Entries are public unless they carry an `access` field (see ./access.ts). Everything is skipped
 * when the "Members-only and premium content" setting is off.
 */
import { defineMiddleware } from "astro:middleware";
import { getEmDashEntry, SchemaRegistry } from "emdash";
import { getDb } from "emdash/runtime";
import { sql } from "kysely";
import { type Access, compileUrlPattern, entryAccess, hiddenFromFeed, matchUrlPattern, type UrlPattern, wallClass } from "./access.ts";
import { checkEntry, isSignedIn, viewerFor } from "./access-astro.ts";
import { accessSettings } from "./providers.ts";

type Ctx = Parameters<Parameters<typeof defineMiddleware>[0]>[0];
type Next = Parameters<Parameters<typeof defineMiddleware>[0]>[1];

/** Routes that never hold theme content. */
const SKIP = /^\/(?:_emdash|_astro|_image|api|auth|login|signup|account|organization|admin|audit-log|sites|\.well-known)(?:\/|$)/;
const SLUG = /^[a-z][a-z0-9_]*$/;

// ---- URL pattern -> entry. Cached per host: one isolate can serve many sites (multi-site hosts).
const PATTERN_TTL_MS = 30_000;
const patternCache = new Map<string, { at: number; patterns: UrlPattern[] }>();

async function patternsFor(host: string): Promise<UrlPattern[]> {
	const hit = patternCache.get(host);
	if (hit && Date.now() - hit.at < PATTERN_TTL_MS) return hit.patterns;
	const collections = await new SchemaRegistry(await getDb()).listCollections();
	const patterns: UrlPattern[] = [];
	for (const c of collections) {
		// No URL pattern set (many themes route by file): assume the usual `/<collection>/<slug>`.
		const compiled = compileUrlPattern(c.slug, c.urlPattern || (c.routable === false ? "" : `/${c.slug}/{slug}`));
		if (compiled) patterns.push(compiled);
	}
	patternCache.set(host, { at: Date.now(), patterns });
	return patterns;
}

// ---- access level by (collection, slug|id), straight from the content table
async function levels(by: "slug" | "id", wanted: Array<{ collection: string; key: string }>): Promise<Map<string, Access>> {
	const out = new Map<string, Access>();
	const db = await getDb();
	for (const collection of new Set(wanted.map((w) => w.collection))) {
		if (!SLUG.test(collection)) continue;
		const keys = [...new Set(wanted.filter((w) => w.collection === collection).map((w) => w.key))];
		try {
			const column = sql.ref(by);
			const rows = await sql<{ k: string; access: string | null }>`SELECT ${column} AS k, access FROM ${sql.table(`ec_${collection}`)} WHERE ${column} IN (${sql.join(keys)})`.execute(db);
			for (const r of rows.rows) out.set(`${collection}:${r.k}`, entryAccess({ data: { access: r.access } }));
		} catch {
			// No `access` column on this collection: everything in it is public.
		}
	}
	return out;
}


const privateHeaders = (res: Response, cacheControl = "private, no-store"): Response => {
	const headers = new Headers(res.headers);
	headers.delete("content-length");
	headers.set("Cache-Control", cacheControl);
	headers.set("Vary", "Cookie");
	return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
};

async function filterSearch(ctx: Ctx, res: Response): Promise<Response> {
	if (!res.ok || !res.headers.get("content-type")?.includes("json")) return res;
	const body = (await res.clone().json().catch(() => null)) as { data?: { items?: Array<{ collection?: string; id?: string }> } } | null;
	const items = body?.data?.items;
	if (!Array.isArray(items) || items.length === 0) return res;
	try {
		const found = await levels("id", items.filter((i) => typeof i.collection === "string" && typeof i.id === "string").map((i) => ({ collection: i.collection!, key: i.id! })));
		if (![...found.values()].some((a) => a !== "public")) return res;
		const viewer = await viewerFor(ctx, true);
		const kept = items.filter((i) => !hiddenFromFeed(found.get(`${i.collection}:${i.id}`), viewer));
		if (kept.length === items.length) return privateHeaders(res);
		const out = new Response(JSON.stringify({ ...body, data: { ...body?.data, items: kept } }), { status: res.status, headers: res.headers });
		return privateHeaders(out);
	} catch {
		return res;
	}
}

/** RSS `<item>` and sitemap `<url>` blocks whose link points at an entry the reader may not open are dropped. */
async function filterXml(ctx: Ctx, res: Response, host: string): Promise<Response> {
	if (!res.ok || !/xml/.test(res.headers.get("content-type") ?? "")) return res;
	try {
		const xml = await res.clone().text();
		const blocks = [...xml.matchAll(/<(item|url)>[\s\S]*?<\/\1>/g)];
		if (blocks.length === 0) return res;
		const patterns = await patternsFor(host);
		const refs = blocks.map((b) => {
			const link = /<(?:link|loc)>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/.exec(b[0])?.[1];
			if (!link) return null;
			try {
				return matchUrlPattern(patterns, new URL(link, ctx.url).pathname);
			} catch {
				return null;
			}
		});
		const found = await levels("slug", refs.filter((r) => r !== null).map((r) => ({ collection: r.collection, key: r.slug })));
		if (![...found.values()].some((a) => a !== "public")) return res;
		const viewer = await viewerFor(ctx, true);
		let out = xml;
		blocks.forEach((b, i) => {
			const r = refs[i];
			if (r && hiddenFromFeed(found.get(`${r.collection}:${r.slug}`), viewer)) out = out.replace(b[0], "");
		});
		const headers = new Headers(res.headers);
		headers.delete("content-length");
		return privateHeaders(new Response(out, { status: res.status, headers }));
	} catch {
		return res;
	}
}

// ---- the two switches, cached a few seconds per host so a page view does not pay a settings read
const SETTINGS_TTL_MS = 10_000;
const settingsCache = new Map<string, { at: number; value: { contentAccess: boolean; siteLogin: boolean } }>();
async function settingsFor(host: string) {
	const hit = settingsCache.get(host);
	if (hit && Date.now() - hit.at < SETTINGS_TTL_MS) return hit.value;
	const value = await accessSettings();
	settingsCache.set(host, { at: Date.now(), value });
	return value;
}

const unauthorized = () =>
	new Response(JSON.stringify({ error: "Sign in to view this." }), {
		status: 401,
		headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store", Vary: "Cookie" },
	});

export const onRequest = defineMiddleware(async (ctx, next: Next) => {
	if (ctx.request.method !== "GET" && ctx.request.method !== "HEAD") return next();
	// The visitor's address, without the trailing slash some sites add (`/rss.xml/`).
	const path = (ctx.originPathname ?? ctx.url.pathname).replace(/(.)\/$/, "$1");
	const host = ctx.url.host;
	const { contentAccess, siteLogin } = await settingsFor(host);
	const kind = siteLogin ? wallClass(path) : "open";

	// Sign-in wall: the whole public site needs a signed-in visitor.
	if (kind !== "open") {
		if (!(await isSignedIn(ctx))) {
			if (kind === "api") return unauthorized();
			const res = ctx.redirect(`/auth/sign-in?redirect=${encodeURIComponent((ctx.originPathname ?? ctx.url.pathname) + ctx.url.search)}`);
			res.headers.set("Cache-Control", "private, no-store");
			return res;
		}
		// Signed in. Nothing may land in a shared cache for the next, anonymous, visitor.
		// Uploaded files: the browser may keep them, a shared cache may not.
		if (path.startsWith("/_emdash/api/media/")) return privateHeaders(await next(), "private, max-age=3600");
		return privateHeaders(await entryRules(ctx, next, path, host, contentAccess));
	}
	return entryRules(ctx, next, path, host, contentAccess);
});

/** Members-only / premium rules for one request (the part that works with or without the wall). */
async function entryRules(ctx: Ctx, next: Next, path: string, host: string, contentAccess: boolean): Promise<Response> {
	if (path === "/_emdash/api/search") {
		const res = await next();
		return contentAccess ? filterSearch(ctx, res) : res;
	}
	if (SKIP.test(path)) return next();
	const isXml = /\.xml$/.test(path);
	if (!isXml && /\.[a-z0-9]{1,5}$/i.test(path)) return next(); // a static file
	if (!contentAccess) return next();
	if (isXml) return filterXml(ctx, await next(), host);
	try {
		const hit = matchUrlPattern(await patternsFor(host), path);
		if (!hit) return next();
		const { entry } = await getEmDashEntry(hit.collection, hit.slug);
		const { block, viewerDependent } = await checkEntry(ctx, entry);
		if (block) return block;
		const res = await next();
		return viewerDependent ? privateHeaders(res) : res;
	} catch {
		// Cannot tell what this page is: let the theme answer (it fails on its own if the database is down).
		return next();
	}
}
