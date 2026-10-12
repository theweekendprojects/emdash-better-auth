/**
 * Statistics chart: stacked area, two series over 14 days, as in the template.
 *
 * Plain SVG instead of apexcharts: that library is 1.6 MB raw (370 KB gzip) and
 * loaded on the landing page for a chart of 28 numbers. This is ~2 KB, renders
 * on the server too (no client-only mount, no layout shift) and follows the
 * HeroUI theme through CSS variables.
 */
import { dailyCounts, DAYS } from "./chart-data.js";
import type { Entry } from "./data.js";

const W = 520;
const H = 300;
const PAD = { l: 36, r: 12, t: 12, b: 28 };

export function Steam({ entries }: { entries: Entry[] }) {
	const { days, ok, bad } = dailyCounts(entries);
	const stacked = ok.map((v, i) => v + (bad[i] ?? 0));
	const max = Math.max(4, ...stacked);
	// Round the axis up to a "nice" step so the grid lines read well.
	const step = Math.ceil(max / 4);
	const top = step * 4;
	const x = (i: number) => PAD.l + (i * (W - PAD.l - PAD.r)) / (DAYS - 1);
	const y = (v: number) => H - PAD.b - (v * (H - PAD.t - PAD.b)) / top;
	const line = (vs: number[]) => vs.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
	const area = (upper: number[], lower: number[]) =>
		`${line(upper)} ${lower
			.map((v, i) => [v, i] as const)
			.reverse()
			.map(([v, i]) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`)
			.join(" ")} Z`;
	const zero = ok.map(() => 0);
	return (
		<div className="z-20 w-full">
			<svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Events per day, last 14 days">
				{[0, 1, 2, 3, 4].map((n) => (
					<g key={n}>
						<line x1={PAD.l} x2={W - PAD.r} y1={y(n * step)} y2={y(n * step)} stroke="var(--border)" />
						<text x={PAD.l - 6} y={y(n * step) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
							{n * step}
						</text>
					</g>
				))}
				{days.map((d, i) =>
					i % 2 === 0 ? (
						<text key={d.toISOString()} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">
							{d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
						</text>
					) : null,
				)}
				<path d={area(ok, zero)} fill="#17c964" fillOpacity="0.35" />
				<path d={line(ok)} fill="none" stroke="#17c964" strokeWidth="2" strokeLinejoin="round" />
				<path d={area(stacked, ok)} style={{ fill: "var(--accent)" }} fillOpacity="0.35" />
				<path d={line(stacked)} fill="none" style={{ stroke: "var(--accent)" }} strokeWidth="2" strokeLinejoin="round" />
			</svg>
			<p className="mt-2 flex justify-center gap-4 text-xs text-muted">
				<span>
					<span className="mr-1 inline-block size-2 rounded-full bg-[#17c964]" />
					Successful
				</span>
				<span>
					<span className="mr-1 inline-block size-2 rounded-full bg-accent" />
					Failed
				</span>
			</p>
		</div>
	);
}
