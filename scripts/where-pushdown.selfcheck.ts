/**
 * Runnable self-check for splitWhere (the where-pushdown fast path).
 *
 * Not a framework test — a dependency-free assert script. Run all self-checks
 * with `bash scripts/selfcheck.sh` (or `pnpm selfcheck`).
 *
 * Fails loudly (non-zero exit) if the split logic regresses.
 */

import { deepEqual, equal } from "./assert.js";
import { splitWhere, type WhereClauseLike } from "../src/where-pushdown.js";

const INDEXED = new Set(["id", "userId", "organizationId"]);

// 1. Indexed eq is pushed down; non-indexed stays residual.
{
	const where: WhereClauseLike[] = [
		{ field: "organizationId", operator: "eq", value: "org_1" },
		{ field: "role", operator: "eq", value: "admin" },
	];
	const { storageWhere, residual } = splitWhere(where, INDEXED);
	deepEqual(storageWhere, { organizationId: "org_1" });
	equal(residual.length, 1);
	equal(residual[0]!.field, "role");
}

// 2. Default operator (undefined) is treated as eq.
{
	const { storageWhere } = splitWhere([{ field: "userId", value: "u1" }], INDEXED);
	deepEqual(storageWhere, { userId: "u1" });
}

// 3. `in` on an indexed field becomes an InFilter.
{
	const { storageWhere, residual } = splitWhere(
		[{ field: "id", operator: "in", value: ["a", "b"] }],
		INDEXED,
	);
	deepEqual(storageWhere, { id: { in: ["a", "b"] } });
	equal(residual.length, 0);
}

// 4. starts_with and range operators push down as filter objects.
{
	const { storageWhere } = splitWhere(
		[
			{ field: "userId", operator: "starts_with", value: "u_" },
			{ field: "id", operator: "gte", value: 5 },
		],
		INDEXED,
	);
	deepEqual(storageWhere.userId, { startsWith: "u_" });
	deepEqual(storageWhere.id, { gte: 5 });
}

// 5. Operators storage can't express stay residual (never silently dropped).
{
	const where: WhereClauseLike[] = [
		{ field: "userId", operator: "ne", value: "u1" },
		{ field: "userId", operator: "contains", value: "x" },
		{ field: "userId", operator: "ends_with", value: "z" },
	];
	const { storageWhere, residual } = splitWhere(where, INDEXED);
	deepEqual(storageWhere, {});
	equal(residual.length, 3);
}

// 6. OR-connected clause is never pushed down.
{
	const { storageWhere, residual } = splitWhere(
		[{ field: "userId", operator: "eq", value: "u1", connector: "OR" }],
		INDEXED,
	);
	deepEqual(storageWhere, {});
	equal(residual.length, 1);
}

// 7. A second clause on an already-promoted field stays residual (no clobber).
{
	const where: WhereClauseLike[] = [
		{ field: "userId", operator: "eq", value: "u1" },
		{ field: "userId", operator: "eq", value: "u2" },
	];
	const { storageWhere, residual } = splitWhere(where, INDEXED);
	deepEqual(storageWhere, { userId: "u1" });
	equal(residual.length, 1);
	equal(residual[0]!.value, "u2");
}

// 8. Empty index set pushes nothing down (full-scan fallback).
{
	const { storageWhere, residual } = splitWhere(
		[{ field: "userId", operator: "eq", value: "u1" }],
		new Set(),
	);
	deepEqual(storageWhere, {});
	equal(residual.length, 1);
}

console.log("where-pushdown self-check: all 8 cases passed");
