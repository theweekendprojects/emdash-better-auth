/** Shimmering placeholders shown while data loads (also in the server-rendered HTML). */
import { Card, Skeleton } from "@heroui/react";

/** Table body rows. */
export function SkeletonRows({ cols, rows = 5 }: { cols: number; rows?: number }) {
	return Array.from({ length: rows }, (_, r) => (
		// biome-ignore lint/suspicious/noArrayIndexKey: static placeholders.
		<tr key={r} aria-hidden="true">
			{Array.from({ length: cols }, (_, c) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static placeholders.
				<td key={c} className="px-3 py-3">
					<Skeleton className="h-4 w-full max-w-40 rounded-lg" />
				</td>
			))}
		</tr>
	));
}

/** Same footprint as a stat card. */
export function StatCardSkeleton() {
	return (
		<Card className="w-full rounded-xl bg-surface px-3 shadow-md xl:max-w-sm" aria-hidden="true">
			<Card.Content className="gap-3 py-5">
				<div className="flex gap-2.5">
					<Skeleton className="h-6 w-6 rounded-full" />
					<div className="flex flex-col gap-1.5">
						<Skeleton className="h-3.5 w-28 rounded-lg" />
						<Skeleton className="h-3 w-20 rounded-lg" />
					</div>
				</div>
				<Skeleton className="h-6 w-24 rounded-lg" />
				<div className="flex gap-6">
					<Skeleton className="h-8 w-16 rounded-lg" />
					<Skeleton className="h-8 w-16 rounded-lg" />
					<Skeleton className="h-8 w-16 rounded-lg" />
				</div>
			</Card.Content>
		</Card>
	);
}
