/** Statistics chart (area), as in the template. Client only: apexcharts needs `window`. */
import * as React from "react";
import type { Entry } from "./data.js";

const Chart = React.lazy(() => import("react-apexcharts"));
const DAYS = 14;

/** Count entries per local day for the last DAYS days, split by status. */
function series(entries: Entry[]) {
	const days = Array.from({ length: DAYS }, (_, i) => {
		const d = new Date();
		d.setHours(0, 0, 0, 0);
		d.setDate(d.getDate() - (DAYS - 1 - i));
		return d;
	});
	const key = (d: Date) => d.toDateString();
	const ok = new Map<string, number>();
	const bad = new Map<string, number>();
	for (const e of entries) {
		const m = e.status === "failed" ? bad : ok;
		const k = key(new Date(e.createdAt));
		m.set(k, (m.get(k) ?? 0) + 1);
	}
	return {
		categories: days.map((d) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" })),
		series: [
			{ name: "Successful", data: days.map((d) => ok.get(key(d)) ?? 0) },
			{ name: "Failed", data: days.map((d) => bad.get(key(d)) ?? 0) },
		],
	};
}

export function Steam({ entries }: { entries: Entry[] }) {
	const [mounted, setMounted] = React.useState(false);
	React.useEffect(() => setMounted(true), []);
	const s = React.useMemo(() => series(entries), [entries]);
	// Text and grid colours come from CSS (auth.css `.apexcharts-*`), so light/dark follow the theme.
	const options = {
		chart: { type: "area" as const, animations: { easing: "linear" as const, speed: 300 }, stacked: true, toolbar: { show: false }, background: "transparent" },
		xaxis: { categories: s.categories },
		tooltip: { enabled: false },
		grid: { show: true, strokeDashArray: 0, position: "back" as const },
		stroke: { curve: "smooth" as const },
		dataLabels: { enabled: false },
		legend: { show: false },
		markers: { size: 0 },
		colors: ["#17c964", "#006fee"],
	};
	return (
		<div className="z-20 w-full" style={{ minHeight: 425 }}>
			{mounted ? (
				<React.Suspense fallback={null}>
					<Chart options={options} series={s.series} type="area" height={425} />
				</React.Suspense>
			) : null}
		</div>
	);
}
