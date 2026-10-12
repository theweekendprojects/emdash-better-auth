/** Pure data prep for the statistics chart (kept apart so it runs under plain Node in the self-check). */
import type { Entry } from "./data.js";

export const DAYS = 14;

/** Count entries per local day for the last DAYS days, split by status. */
export function dailyCounts(entries: Entry[], now = new Date()) {
	const days = Array.from({ length: DAYS }, (_, i) => {
		const d = new Date(now);
		d.setHours(0, 0, 0, 0);
		d.setDate(d.getDate() - (DAYS - 1 - i));
		return d;
	});
	const ok = new Map<string, number>();
	const bad = new Map<string, number>();
	for (const e of entries) {
		const m = e.status === "failed" ? bad : ok;
		const k = new Date(e.createdAt).toDateString();
		m.set(k, (m.get(k) ?? 0) + 1);
	}
	return {
		days,
		ok: days.map((d) => ok.get(d.toDateString()) ?? 0),
		bad: days.map((d) => bad.get(d.toDateString()) ?? 0),
	};
}
