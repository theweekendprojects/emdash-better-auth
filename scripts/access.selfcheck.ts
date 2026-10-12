/** Checks for the content access rules: `node --no-warnings scripts/access.selfcheck.ts` */
import { decide, entryAccess, listed, type Viewer } from "../src/access.ts";

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
process.exit(failed ? 1 : 0);
