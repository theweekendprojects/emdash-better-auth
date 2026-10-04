/**
 * Custom `AuditLogStorage` backend for `better-auth-audit-logs`, over EmDash
 * plugin storage.
 *
 * WHY: the audit-log package defaults to its own `auditLog` DB table created by
 * a Better Auth migration (`@better-auth/cli generate`). This plugin ships NO
 * migrations — every model is routed into EmDash plugin storage via the custom
 * adapter — so we implement the package's `AuditLogStorage` interface against a
 * plugin-storage collection instead. Same no-migration guarantee as the rest of
 * the plugin.
 *
 * STORAGE SHAPE: D1/SQLite plugin storage holds primitives + JSON, not native
 * Date/object. So on WRITE we serialize `createdAt` to an ISO string and
 * `metadata` to a JSON string; on READ we parse them back to the `Date` /
 * `Record` the package's types expect. `createdAt` is also stored as the ISO
 * string in an indexed field so retention + ordering can use lexicographic
 * comparison (ISO-8601 sorts chronologically).
 *
 * QUERYING: the collection is indexed on `userId`, `action`, `createdAt`. We
 * push `userId`/`action` into the indexed `query()` where possible and filter
 * the rest (status, from/to date) in memory over a bounded scan — the same
 * pattern the main adapter uses. Auth-event volume for a CMS audience is
 * modest; retention keeps the working set bounded.
 *
 * ponytail: `read`/`readChain` do a paginated scan + in-memory
 * filter/sort/slice rather than a pushed-down ORDER BY + LIMIT, because EmDash
 * plugin storage exposes only coarse indexed equality queries, not range/sort.
 * Ceiling: O(n) over the retained rows per list call. Fine at CMS scale with
 * retention on; if a site disables retention and accumulates millions of rows,
 * list latency grows — upgrade path is a range-queryable store or a dedicated
 * table once EmDash exposes one. Tamper detection (`readChain`) is supported
 * but off by default.
 */

import type { StorageCollection } from "emdash";
import type {
	AuditLogEntry,
	AuditLogStorage,
	ChainReadOptions,
	StorageReadOptions,
	StorageReadResult,
} from "better-auth-audit-logs";

/** The persisted shape in plugin storage (primitives + JSON strings only). */
interface StoredAuditLog {
	id: string;
	userId: string | null;
	action: string;
	status: string;
	severity: string;
	ipAddress: string | null;
	userAgent: string | null;
	/** JSON-serialized metadata object. */
	metadata: string | null;
	/** ISO-8601 timestamp (sorts chronologically as a string). */
	createdAt: string;
	hash: string | null;
	previousHash: string | null;
}

/** Serialize a package `AuditLogEntry` into the stored primitive shape. */
function toStored(entry: AuditLogEntry): StoredAuditLog {
	return {
		id: entry.id,
		userId: entry.userId ?? null,
		action: entry.action,
		status: entry.status,
		severity: entry.severity,
		ipAddress: entry.ipAddress ?? null,
		userAgent: entry.userAgent ?? null,
		metadata:
			entry.metadata && Object.keys(entry.metadata).length > 0
				? JSON.stringify(entry.metadata)
				: null,
		createdAt:
			entry.createdAt instanceof Date
				? entry.createdAt.toISOString()
				: new Date(entry.createdAt).toISOString(),
		hash: entry.hash ?? null,
		previousHash: entry.previousHash ?? null,
	};
}

/** Parse a stored row back into the package `AuditLogEntry` (Date + object). */
function fromStored(row: StoredAuditLog): AuditLogEntry {
	let metadata: Record<string, unknown> = {};
	if (row.metadata) {
		try {
			const parsed = JSON.parse(row.metadata);
			if (parsed && typeof parsed === "object") metadata = parsed as Record<string, unknown>;
		} catch {
			// Corrupt JSON — surface an empty object rather than throwing on read.
		}
	}
	return {
		id: row.id,
		userId: row.userId ?? null,
		action: row.action,
		status: row.status as AuditLogEntry["status"],
		severity: row.severity as AuditLogEntry["severity"],
		ipAddress: row.ipAddress ?? null,
		userAgent: row.userAgent ?? null,
		metadata,
		createdAt: new Date(row.createdAt),
		hash: row.hash ?? null,
		previousHash: row.previousHash ?? null,
	};
}

/** Fetch all rows (bounded pages), optionally pushing one indexed equality. */
async function scanAll(
	collection: StorageCollection<Record<string, unknown>>,
	where?: Record<string, string>,
): Promise<StoredAuditLog[]> {
	const out: StoredAuditLog[] = [];
	let cursor: string | undefined;
	do {
		const page = await collection.query({
			limit: 100,
			cursor,
			...(where && Object.keys(where).length > 0 ? { where } : {}),
		});
		for (const item of page.items) out.push(item.data as unknown as StoredAuditLog);
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	return out;
}

/** Does a stored row satisfy the non-indexed read filters (status, date range)? */
function matchesFilters(row: StoredAuditLog, o: StorageReadOptions): boolean {
	if (o.status && row.status !== o.status) return false;
	if (o.from && row.createdAt < o.from.toISOString()) return false;
	if (o.to && row.createdAt > o.to.toISOString()) return false;
	return true;
}

/**
 * Build an `AuditLogStorage` bound to the plugin's `auditLogs` collection.
 * Passed to `auditLog({ storage })` in auth.ts.
 */
export function createAuditLogStorage(
	collection: StorageCollection<Record<string, unknown>>,
): AuditLogStorage {
	return {
		async write(entry) {
			const row = toStored(entry);
			await collection.put(row.id, row as unknown as Record<string, unknown>);
		},

		async read(options: StorageReadOptions): Promise<StorageReadResult> {
			// Push the most selective indexed equality we have into the query;
			// filter the rest in memory.
			const where: Record<string, string> = {};
			if (options.userId) where.userId = options.userId;
			else if (options.action) where.action = options.action;

			const rows = (await scanAll(collection, where))
				.filter((r) => (options.action ? r.action === options.action : true))
				.filter((r) => (options.userId ? r.userId === options.userId : true))
				.filter((r) => matchesFilters(r, options))
				// Newest first.
				.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

			const total = rows.length;
			const slice = rows.slice(options.offset, options.offset + options.limit);
			return { entries: slice.map(fromStored), total };
		},

		async readById(id: string): Promise<AuditLogEntry | null> {
			const row = (await collection.get(id)) as unknown as StoredAuditLog | null;
			return row ? fromStored(row) : null;
		},

		async deleteOlderThan(date: Date): Promise<number> {
			const cutoff = date.toISOString();
			const stale = (await scanAll(collection)).filter((r) => r.createdAt < cutoff);
			for (const r of stale) await collection.delete(r.id);
			return stale.length;
		},

		// Required only when tamper detection is enabled (off by default here).
		// Entries newest first, scoped to a chain by userId (null = the no-user
		// chain, e.g. failed sign-ins).
		async readChain(options: ChainReadOptions): Promise<AuditLogEntry[]> {
			const rows = (await scanAll(collection))
				.filter((r) =>
					options.userId === undefined ? true : (r.userId ?? null) === options.userId,
				)
				.filter((r) => (options.from ? r.createdAt >= options.from.toISOString() : true))
				.filter((r) => (options.to ? r.createdAt <= options.to.toISOString() : true))
				.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
			return rows.slice(options.offset, options.offset + options.limit).map(fromStored);
		},
	};
}
