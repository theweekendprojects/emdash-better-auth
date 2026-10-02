/**
 * Tiny dependency-free assert for the self-check scripts, so they run with just
 * `tsc` + `node` and need no `@types/node` or test framework.
 */

export function ok(cond: unknown, msg: string): void {
	if (!cond) throw new Error(`assertion failed: ${msg}`);
}

export function equal(actual: unknown, expected: unknown, msg?: string): void {
	if (actual !== expected) {
		throw new Error(`${msg ?? "equal"}: expected ${String(expected)}, got ${String(actual)}`);
	}
}

export function deepEqual(actual: unknown, expected: unknown, msg?: string): void {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a !== e) throw new Error(`${msg ?? "deepEqual"}: expected ${e}, got ${a}`);
}
