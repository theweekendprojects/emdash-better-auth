/**
 * Where-clause pushdown: translate the part of a Better-Auth where that EmDash
 * storage can run in SQL (indexed fields, supported operators) into an EmDash
 * `WhereClause`, leaving the rest to be matched in JS.
 *
 * Dependency-free on purpose so it can be unit-tested without pulling in
 * better-auth or the emdash runtime. The adapter imports {@link splitWhere}.
 */

/** The subset of Better-Auth's `CleanedWhere` this translator reads. */
export interface WhereClauseLike {
	field: string;
	operator?: string;
	value: unknown;
	connector?: "AND" | "OR";
}

/**
 * EmDash `WhereValue` shape (a bare value for eq, or a filter object). Mirrors
 * `WhereClause` from emdash's plugin types without importing it, so the where
 * passed to `collection.query()` is pushed into SQL against the collection's
 * indexes instead of being filtered in JS after a full scan.
 */
export type StorageWhereValue =
	| string
	| number
	| boolean
	| null
	| { in: Array<string | number> }
	| { startsWith: string }
	| { gt?: number | string; gte?: number | string; lt?: number | string; lte?: number | string };

/**
 * Split a Better-Auth where into the part EmDash storage can run in SQL (only
 * clauses on INDEXED fields, using operators the storage query supports) and
 * the residual clauses that must still be matched in JS.
 *
 * EmDash's `validateWhereClause` THROWS on any where-field that isn't indexed,
 * so a clause is only promoted to the storage `where` when its field is in
 * `indexed`. Everything else (non-indexed field, or an operator storage can't
 * express like `ne`/`contains`/`ends_with`) stays in `residual` and is applied
 * by the caller's in-JS matcher over the returned page.
 *
 * Only one clause per field is promoted; a second clause on the same field
 * (rare, Better-Auth doesn't emit range pairs on these models) stays residual.
 * An OR-connected clause is never pushed down (storage ANDs its where entries),
 * so it stays residual to preserve semantics.
 */
export function splitWhere<T extends WhereClauseLike>(
	where: T[],
	indexed: ReadonlySet<string>,
): { storageWhere: Record<string, StorageWhereValue>; residual: T[] } {
	const storageWhere: Record<string, StorageWhereValue> = {};
	const residual: T[] = [];

	for (const clause of where) {
		const connector = clause.connector ?? "AND";
		if (connector !== "AND" || !indexed.has(clause.field) || clause.field in storageWhere) {
			residual.push(clause);
			continue;
		}

		switch (clause.operator ?? "eq") {
			case "eq":
				if (
					typeof clause.value === "string" ||
					typeof clause.value === "number" ||
					typeof clause.value === "boolean" ||
					clause.value === null
				) {
					storageWhere[clause.field] = clause.value;
				} else {
					residual.push(clause);
				}
				break;
			case "in":
				if (Array.isArray(clause.value)) {
					storageWhere[clause.field] = { in: clause.value as Array<string | number> };
				} else {
					residual.push(clause);
				}
				break;
			case "starts_with":
				if (typeof clause.value === "string") {
					storageWhere[clause.field] = { startsWith: clause.value };
				} else {
					residual.push(clause);
				}
				break;
			case "gt":
			case "gte":
			case "lt":
			case "lte":
				if (typeof clause.value === "number" || typeof clause.value === "string") {
					storageWhere[clause.field] = {
						[clause.operator as "gt" | "gte" | "lt" | "lte"]: clause.value,
					};
				} else {
					residual.push(clause);
				}
				break;
			default:
				residual.push(clause);
		}
	}

	return { storageWhere, residual };
}
