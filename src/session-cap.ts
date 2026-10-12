/** Which of a user's sessions to delete so only the newest `max` remain. Never returns `keepToken`. */
export function sessionsToDelete(
	rows: Array<{ token: string; createdAt: string | Date }>,
	keepToken: string,
	max: number,
): string[] {
	const newestFirst = [...rows].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
	const keep = new Set([keepToken, ...newestFirst.slice(0, max).map((r) => r.token)]);
	return newestFirst.map((r) => r.token).filter((t) => !keep.has(t));
}
