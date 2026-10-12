/** Checks for the dashboard chart's day bucketing: `node --no-warnings scripts/chart.selfcheck.ts` */
import { DAYS, dailyCounts } from "../src/ui/dashboard/chart-data.ts";
import type { Entry } from "../src/ui/dashboard/data.ts";

const now = new Date(2026, 9, 12, 15, 0, 0); // local, mid-afternoon
const at = (daysAgo: number, status: Entry["status"]): Entry => ({
	id: `${daysAgo}${status}`, userId: null, action: "sign-in", status,
	createdAt: new Date(2026, 9, 12 - daysAgo, 3, 0, 0).toISOString(),
});
const r = dailyCounts([at(0, "success"), at(0, "success"), at(0, "failed"), at(3, "success"), at(20, "success")], now);
let failed = 0;
const check = (name: string, got: unknown, want: unknown) => {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
check("14 days", r.days.length, DAYS);
check("today successes are last", r.ok.at(-1), 2);
check("today failures are last", r.bad.at(-1), 1);
check("3 days ago", r.ok.at(-4), 1);
check("older than window is dropped", r.ok.reduce((a, b) => a + b, 0), 3);
process.exit(failed ? 1 : 0);
