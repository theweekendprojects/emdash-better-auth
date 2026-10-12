/** Checks for the session cap: `node --no-warnings scripts/session-cap.selfcheck.ts` */
import { sessionsToDelete } from "../src/session-cap.ts";

let failed = 0;
const check = (name: string, got: unknown, want: unknown) => {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` got ${JSON.stringify(got)}`}`);
};
const at = (t: string, day: number) => ({ token: t, createdAt: new Date(2026, 9, day).toISOString() });
const rows = [at("a", 1), at("b", 2), at("c", 3), at("d", 4), at("e", 5)]; // oldest first, as the adapter may return
check("deletes the oldest beyond max", sessionsToDelete(rows, "e", 3).sort(), ["a", "b"]);
check("under the cap deletes nothing", sessionsToDelete(rows, "e", 5), []);
check("never deletes the current session, even if it looks old", sessionsToDelete(rows, "a", 2).sort(), ["b", "c"]);
check("order of input does not matter", sessionsToDelete([...rows].reverse(), "e", 3).sort(), ["a", "b"]);
process.exit(failed ? 1 : 0);
