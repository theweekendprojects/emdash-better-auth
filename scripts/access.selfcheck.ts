/** Checks for the content access rules: `node --no-warnings scripts/access.selfcheck.ts` */
import { compileUrlPattern, decide, entryAccess, hiddenFromFeed, listed, matchUrlPattern, type Viewer, wallClass } from "../src/access.ts";

let failed = 0;
const check = (name: string, got: unknown, want: unknown) => {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` got ${JSON.stringify(got)}`}`);
};
const sub: Viewer = { role: 10, premium: false };
const paid: Viewer = { role: 10, premium: true };
const staff: Viewer = { role: 20, premium: false };

check("no field is public", entryAccess({ data: {} }), "public");
check("no data is public", entryAccess(undefined), "public");
check("unknown value fails closed", entryAccess({ data: { access: "vip" } }), "members");
check("public for anonymous", decide("public", null), "allow");
check("members: anonymous must sign in", decide("members", null), "login");
check("members: any signed-in user", decide("members", sub), "allow");
check("premium: anonymous must sign in", decide("premium", null), "login");
check("premium: free user gets the paywall", decide("premium", sub), "premium");
check("premium: paid user", decide("premium", paid), "allow");
check("staff see everything", [decide("members", staff), decide("premium", staff)], ["allow", "allow"]);
check("members posts are hidden from anonymous lists", listed("members", null), false);
check("members posts are listed for users", listed("members", sub), true);
check("premium posts are always listed (teaser)", [listed("premium", null), listed("premium", sub)], [true, true]);
check("feeds hide premium from non-premium", [hiddenFromFeed("premium", sub), hiddenFromFeed("premium", paid), hiddenFromFeed("members", null), hiddenFromFeed("public", null), hiddenFromFeed(undefined, null)], [true, false, true, false, false]);
const pats = [compileUrlPattern("posts", "/posts/{slug}"), compileUrlPattern("docs", "/docs/{category}/{slug}"), compileUrlPattern("x", "/x/{id}")].filter((p) => p !== null);
check("pattern without {slug} is ignored", pats.length, 2);
check("matches /posts/a", matchUrlPattern(pats, "/posts/a"), { collection: "posts", slug: "a" });
check("matches trailing slash", matchUrlPattern(pats, "/posts/a/"), { collection: "posts", slug: "a" });
check("slug in second position", matchUrlPattern(pats, "/docs/guides/intro"), { collection: "docs", slug: "intro" });
check("list page is not an entry", matchUrlPattern(pats, "/posts"), null);
check("no prefix match", matchUrlPattern(pats, "/posts/a/b"), null);
check("dot in a pattern is literal", matchUrlPattern([compileUrlPattern("f", "/f.html/{slug}")!], "/fxhtml/a"), null);
check("wall: theme pages", [wallClass("/"), wallClass("/posts/a"), wallClass("/rss.xml"), wallClass("/sitemap-posts.xml")], ["page", "page", "page", "page"]);
check("wall: data endpoints", [wallClass("/_emdash/api/search"), wallClass("/_emdash/api/search/suggest"), wallClass("/_emdash/api/media/file/01ABC.png"), wallClass("/_emdash/api/comments/posts/x"), wallClass("/_image")], ["api", "api", "api", "api", "api"]);
check("wall: sign-in, account and admin stay open", [wallClass("/auth/sign-in"), wallClass("/api/auth/get-session"), wallClass("/account/security"), wallClass("/_emdash/admin"), wallClass("/_emdash/api/content/posts"), wallClass("/_astro/x.js"), wallClass("/login")], ["open", "open", "open", "open", "open", "open", "open"]);
check("wall: static files stay open", [wallClass("/favicon.ico"), wallClass("/img/a.png")], ["open", "open"]);
check("wall: a prefix is not a match", [wallClass("/authors"), wallClass("/accounting")], ["page", "page"]);
process.exit(failed ? 1 : 0);
