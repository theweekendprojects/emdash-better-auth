/**
 * Application-level uniqueness constraints for storage-backed Better-Auth
 * models. EmDash 0.30 does not enforce `uniqueIndexes` as a DB constraint, so
 * the adapter enforces these with a check-then-write before create (same
 * approach as usernames). This module holds the declarative config and the
 * pure matching predicate; the adapter owns the (async, paged) storage query.
 */

/**
 * Fields that together must be unique per model (keyed by Better-Auth model
 * name). Every field here is an index on its collection, so the pre-write
 * lookup is an indexed query.
 *   - organization.slug: a slug identifies a tenant globally.
 *   - member (userId + organizationId): a user joins an org at most once.
 *   - teamMember (userId + teamId): a user joins a team at most once.
 */
export const UNIQUE_CONSTRAINTS: Record<string, readonly string[]> = {
	organization: ["slug"],
	member: ["userId", "organizationId"],
	teamMember: ["userId", "teamId"],
};

/**
 * True when `candidate` holds the same values as `data` for every constraint
 * field — i.e. inserting `data` would collide with the existing `candidate`.
 * Compared with strict equality on each field (slugs/ids are strings).
 */
export function recordMatchesConstraint(
	fields: readonly string[],
	data: Record<string, unknown>,
	candidate: Record<string, unknown>,
): boolean {
	return fields.every((f) => candidate[f] === data[f]);
}

/**
 * Whether a create of `data` must be uniqueness-checked for `model`: there is a
 * constraint AND every constraint field is present (non-null) in the payload.
 * A missing/null field means there's nothing that could collide.
 */
export function constraintToCheck(
	model: string,
	data: Record<string, unknown>,
): readonly string[] | null {
	const fields = UNIQUE_CONSTRAINTS[model];
	if (!fields) return null;
	if (fields.some((f) => data[f] === undefined || data[f] === null)) return null;
	return fields;
}
