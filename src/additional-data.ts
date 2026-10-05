/**
 * Helpers for the "additional fields" that have no real `users` column and are
 * stored inside the `users.data` JSON blob: `bio`, `twoFactorEnabled`, and the
 * admin plugin's string `role` / `banned` / `banReason` / `banExpires`.
 *
 * Dependency-free so it can be unit-tested without the emdash runtime. The
 * recognized field set is passed in by the adapter (its `ADDITIONAL_DATA_FIELDS`).
 */

/**
 * Extract every additional field present in a create/update payload, keyed by
 * field name. A key maps to its value, or to `null` when the payload explicitly
 * cleared it. Keys absent from the payload are omitted, so a partial update
 * never touches an unmentioned field.
 */
export function pickAdditionalData(
	data: Record<string, unknown>,
	fields: ReadonlySet<string>,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const field of fields) {
		if (field in data) out[field] = data[field] ?? null;
	}
	return out;
}

/** Parse the users.data JSON column into a plain object (never throws). */
export function parseAdditionalData(dataJson: string | null): Record<string, unknown> {
	if (!dataJson) return {};
	try {
		const parsed = JSON.parse(dataJson) as unknown;
		return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/**
 * Merge additional fields into the users.data JSON column.
 *
 * `next` carries only the fields being changed (from {@link pickAdditionalData}).
 * A `null` value removes the key; any other value sets it. Keys absent from
 * `next` are preserved, so this never clobbers data written by another concern
 * (e.g. a `role` update leaves `bio` intact). Returns the original JSON string
 * unchanged when `next` is empty, and `null` when the blob ends up empty.
 */
export function mergeAdditionalData(
	currentDataJson: string | null,
	next: Record<string, unknown>,
): string | null {
	if (Object.keys(next).length === 0) return currentDataJson;
	const current = parseAdditionalData(currentDataJson);
	for (const [key, value] of Object.entries(next)) {
		if (value === null) delete current[key];
		else current[key] = value;
	}
	return Object.keys(current).length > 0 ? JSON.stringify(current) : null;
}

/** EmDash's numeric ADMIN level (SUBSCRIBER=10 … ADMIN=50). */
const EMDASH_ADMIN_LEVEL = 50;

/**
 * Better Auth admin-plugin role for a user. An explicitly stored string role
 * (set through the admin UI) always wins; otherwise an EmDash admin (numeric
 * role >= 50) is treated as "admin". Without this nobody ever holds the string
 * "admin", so Better Auth's admin plugin answered "Access denied" even to the
 * site's EmDash admins. Everyone else stays null (the plugin's default "user").
 */
export function effectiveAdminRole(stored: unknown, emdashRole: unknown): string | null {
	if (typeof stored === "string" && stored !== "") return stored;
	return typeof emdashRole === "number" && emdashRole >= EMDASH_ADMIN_LEVEL ? "admin" : null;
}
