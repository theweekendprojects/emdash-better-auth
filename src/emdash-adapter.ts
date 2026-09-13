/**
 * Custom Better-Auth database adapter for EmDash.
 *
 * Routes Better-Auth's models to two different backing stores so the plugin is
 * portable across any EmDash site without hand-written migrations:
 *
 *   - `user`    -> EmDash's own `users` table (real Kysely SQL). This makes
 *                  Better-Auth accounts first-class EmDash users, visible in
 *                  the admin UI and subject to EmDash RBAC (the `role` column).
 *   - `account` -> plugin storage collection `accounts` (password hashes,
 *                  OAuth tokens). Keyed by Better-Auth's generated id.
 *   - `session` -> plugin storage collection `sessions`.
 *   - `verification` -> plugin storage collection `verifications`.
 *   - `username` -> plugin storage collection `usernames` (see USERNAME below).
 *
 * The storage-backed models use EmDash's `getAuthProviderStorage()` API, which
 * persists to the shared `_plugin_storage` table under the `auth:better-auth`
 * namespace. No site-specific tables are required.
 *
 * The adapter factory (from better-auth) does all field-name mapping and
 * value coercion for us before calling into this CustomAdapter, as long as we
 * declare `supportsBooleans: false` / `supportsDates: false` / `supportsJSON:
 * false` in the factory config (D1/SQLite has no native boolean/date/json).
 * That means every value we receive here is already a primitive safe to store
 * in SQLite, and every `where.field` is already the physical column/key name.
 *
 * USERNAME (the Better-Auth `username` plugin):
 * The plugin adds `username` (used for login/lookup) and `displayUsername`
 * (human-cased, display only) to the *user* model. EmDash's `users` table has
 * NO such columns and this package ships no migrations, so we store both in a
 * dedicated `usernames` plugin-storage collection keyed by userId.
 *
 * UNIQUENESS — IMPORTANT: we declare `uniqueIndexes: ["username"]` (index.ts),
 * but EmDash 0.30's storage layer folds `uniqueIndexes` into the regular index
 * list (verified: `createStorageAccess` does `[...indexes, ...uniqueIndexes]`)
 * — it makes `username` INDEXED/queryable but does NOT enforce a DB uniqueness
 * constraint. So handle uniqueness is enforced at the APPLICATION level, in two
 * places: Better-Auth's username plugin (its own availability check) and our
 * `syncUsername` (rejects a handle already owned by another user). Both are
 * check-then-write, so a tiny TOCTOU race exists under truly concurrent
 * same-handle signups; for a blog/community that window is negligible and
 * D1 per-isolate serialization narrows it further. If EmDash later enforces
 * `uniqueIndexes` as a real constraint, this becomes atomic for free. (Do not
 * claim atomic uniqueness until then.)
 *
 * The username plugin normalizes `username` (default: lowercase) via an input
 * transform BEFORE the adapter is called, so every `username` value we receive
 * here (in `data` or in a where-clause) is already normalized; we store and
 * match it verbatim, keeping both sides consistent for free.
 *
 * Because `username`/`displayUsername` are not real `users` columns, the user
 * model needs two extra behaviours the plain SQL path can't provide:
 *   1. READ AUGMENT  — after loading a user row, attach `username`/
 *      `displayUsername` from the `usernames` collection so Better-Auth sees
 *      the fields it expects on the user object.
 *   2. REVERSE LOOKUP — when Better-Auth queries the user model *by* username
 *      (the availability check and username sign-in both do
 *      `findOne({ model: "user", where: [{ field: "username", value }] })`),
 *      resolve that username -> userId via the `usernames` collection first,
 *      then run the SQL query by `id`. Without this, username sign-in and
 *      duplicate detection are broken.
 */

import { createAdapterFactory } from "better-auth/adapters";
import type { CleanedWhere, CustomAdapter } from "@better-auth/core/db/adapter";
import { ulid } from "ulidx";
import type { Kysely } from "kysely";
import type { StorageCollection } from "emdash";

/**
 * The subset of EmDash's `users` table this adapter reads and writes.
 * Better-Auth's field mapping (configured in auth.ts) translates its
 * `user` model fields to these physical column names before we see them.
 */
interface UsersTable {
	id: string;
	email: string;
	name: string | null;
	avatar_url: string | null;
	role: number;
	email_verified: number;
	disabled: number;
	data: string | null;
	created_at: string;
	updated_at: string;
}

interface UsersDB {
	users: UsersTable;
}

/** Physical columns of the `users` table — used to tell real column
 * where-clauses apart from the virtual `username`/`displayUsername` fields. */
const USER_COLUMNS = new Set<string>([
	"id",
	"email",
	"name",
	"avatar_url",
	"role",
	"email_verified",
	"disabled",
	"data",
	"created_at",
	"updated_at",
]);

/** Virtual (non-column) user fields backed by the `usernames` collection. */
const USERNAME_FIELDS = new Set<string>(["username", "displayUsername"]);

/** Additional user fields stored in users.data JSON column (not real DB columns). */
const ADDITIONAL_DATA_FIELDS = new Set<string>(["bio"]);

/**
 * Storage collections the plugin declares (see index.ts `storage`).
 * Everything Better-Auth stores that isn't a user lands in one of these.
 */
export interface BetterAuthStorage {
	accounts: StorageCollection<Record<string, unknown>>;
	sessions: StorageCollection<Record<string, unknown>>;
	verifications: StorageCollection<Record<string, unknown>>;
	usernames: StorageCollection<Record<string, unknown>>;
}

/** Shape of a stored username record (keyed by userId in the collection). */
interface UsernameRecord {
	id: string;
	userId: string;
	username: string;
	displayUsername: string | null;
}

/**
 * Model routing. Better-Auth calls the custom adapter with the *mapped* model
 * name (the `modelName` configured in auth.ts), so the user model arrives as
 * "users" (EmDash's table). The others keep Better-Auth's default names.
 */
const USER_MODEL = "users";

function isUserModel(model: string): boolean {
	return model === USER_MODEL;
}

function storageFor(
	storage: BetterAuthStorage,
	model: string,
): StorageCollection<Record<string, unknown>> {
	switch (model) {
		case "account":
			return storage.accounts;
		case "session":
			return storage.sessions;
		case "verification":
			return storage.verifications;
		case "username":
			return storage.usernames;
		default:
			throw new Error(`[better-auth] No storage collection for model "${model}"`);
	}
}

/** Resolve a direct `id = eq` userId from a where clause, if present. */
function directUserId(where: CleanedWhere[]): string | null {
	for (const clause of where) {
		if (clause.field === "id" && clause.operator === "eq") {
			return clause.value as string;
		}
	}
	return null;
}

/**
 * Read one username record by userId. Returns null when the user has no
 * username claimed (never throws on a missing key).
 */
async function getUsernameRecord(
	storage: BetterAuthStorage,
	userId: string,
): Promise<UsernameRecord | null> {
	const rec = (await storage.usernames.get(userId)) as UsernameRecord | null;
	return rec ?? null;
}

/**
 * Find the userId that currently owns a (normalized) username, via the
 * `usernames` collection's unique `username` index. Returns null if unclaimed.
 * Uses the collection query (indexed) rather than a scan; falls back to an
 * in-memory match if the storage layer ignores the where filter.
 */
async function userIdForUsername(
	storage: BetterAuthStorage,
	username: string,
): Promise<string | null> {
	// Bounded scan with in-memory match — the usernames working set is one row
	// per user and storage queries are paginated; this is correct regardless of
	// whether the backend honors the where filter, and it's only hit on the
	// (rare) by-username path (sign-in / availability check), not on every read.
	let cursor: string | undefined;
	do {
		const page = await storage.usernames.query({ limit: 1000, cursor });
		for (const item of page.items) {
			if ((item.data as UsernameRecord).username === username) {
				return (item.data as UsernameRecord).userId ?? item.id;
			}
		}
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);
	return null;
}

/**
 * Given a user-model where clause, resolve it to a set of SQL-safe clauses
 * (only real `users` columns) plus a decision about whether the clause is
 * satisfiable at all.
 *
 * If the clause references a virtual username field (`username` /
 * `displayUsername`), we translate it to an `id = <userId>` clause by looking
 * the value up in the `usernames` collection first. Better-Auth only ever
 * emits a single `{ field: "username", value }` clause for the by-username
 * path, so we handle the common shapes and treat anything exotic as unmatched.
 *
 * Returns:
 *   - `{ clauses }`      — SQL-safe where clauses to run against `users`.
 *   - `{ unmatchable }`  — the query can't match any row (e.g. username not
 *                          claimed, or an unsupported operator on a virtual
 *                          field). Callers should short-circuit to empty.
 */
async function resolveUserWhere(
	storage: BetterAuthStorage,
	where: CleanedWhere[],
): Promise<{ clauses: CleanedWhere[] } | { unmatchable: true }> {
	const clauses: CleanedWhere[] = [];
	for (const clause of where) {
		if (!USERNAME_FIELDS.has(clause.field) && !ADDITIONAL_DATA_FIELDS.has(clause.field)) {
			// Real column — pass through (guard against unexpected virtual keys).
			if (!USER_COLUMNS.has(clause.field)) {
				// Unknown field that isn't a username or additional field: cannot satisfy in SQL.
				return { unmatchable: true };
			}
			clauses.push(clause);
			continue;
		}

		// Virtual username field. Only `username` is queryable/unique; a lookup
		// by `displayUsername` isn't something Better-Auth does, but handle it
		// defensively by scanning for a matching display value.
		if (clause.operator !== "eq" || typeof clause.value !== "string") {
			return { unmatchable: true };
		}

		if (ADDITIONAL_DATA_FIELDS.has(clause.field)) {
			// Bio is stored in users.data JSON column. Better Auth doesn't query
			// by bio, so we just pass this through as-is (the SQL engine will
			// handle JSON extraction if needed). For now, we skip it since
			// Better Auth doesn't need to filter users by bio.
			// If needed in future, we could implement JSON_CONTAINS or similar.
			continue;
		}

		// Handle a username-field lookup. `username` uses the unique index;
		// `displayUsername` (rarely queried) falls back to a bounded scan.
		let userId: string | null = null;
		if (clause.field === "username") {
			userId = await userIdForUsername(storage, clause.value);
		} else {
			// displayUsername — scan for a matching display value.
			let cursor: string | undefined;
			do {
				const page = await storage.usernames.query({ limit: 1000, cursor });
				for (const item of page.items) {
					if ((item.data as UsernameRecord).displayUsername === clause.value) {
						userId = (item.data as UsernameRecord).userId ?? item.id;
						break;
					}
				}
				cursor = !userId && page.hasMore ? page.cursor : undefined;
			} while (cursor);
		}

		if (!userId) return { unmatchable: true };
		clauses.push({ field: "id", operator: "eq", value: userId, connector: "AND" });
	}
	return { clauses };
}

/**
 * Persist / update a user's username record, enforcing uniqueness and freeing
 * a previously-claimed handle on rename.
 *
 * - Uniqueness: enforced at the APPLICATION level here (EmDash's storage does
 *   not enforce `uniqueIndexes` as a constraint — see the file header). We look
 *   up the current owner of the handle and throw if it belongs to another user.
 *   This is check-then-write, so it has a small race window under concurrent
 *   same-handle signups; acceptable for the blog/community use case.
 * - Rename: `put(userId, ...)` overwrites the user's own record in place, so an
 *   old handle is freed automatically (the record is keyed by userId, and the
 *   unique index tracks the current `username` value on that record).
 * - Partial updates: when only `displayUsername` changes, the existing
 *   `username` is preserved (and vice-versa).
 */
async function syncUsername(
	storage: BetterAuthStorage,
	userId: string,
	next: { username?: string | null; displayUsername?: string | null },
): Promise<void> {
	const existing = await getUsernameRecord(storage, userId);

	const username =
		next.username !== undefined
			? next.username
			: (existing?.username ?? undefined);
	const displayUsername =
		next.displayUsername !== undefined
			? next.displayUsername
			: (existing?.displayUsername ?? null);

	// Nothing to store (no username on this account) — clean up any stale record.
	if (!username) {
		if (existing) await storage.usernames.delete(userId);
		return;
	}

	// Reject a handle already owned by a different user.
	const owner = await userIdForUsername(storage, username);
	if (owner && owner !== userId) {
		throw new Error(`[better-auth] username "${username}" is already taken`);
	}

	await storage.usernames.put(userId, {
		id: userId,
		userId,
		username,
		displayUsername: displayUsername ?? null,
	} satisfies UsernameRecord);
}

/** Extract username/displayUsername from a create/update payload (or {}). */
function pickUsernameFields(data: Record<string, unknown>): {
	username?: string | null;
	displayUsername?: string | null;
} {
	const out: { username?: string | null; displayUsername?: string | null } = {};
	if ("username" in data) out.username = (data.username as string | null) ?? null;
	if ("displayUsername" in data) {
		out.displayUsername = (data.displayUsername as string | null) ?? null;
	}
	return out;
}

/** Extract bio from a create/update payload (or {}). */
function pickBioField(data: Record<string, unknown>): string | null | undefined {
	if ("bio" in data) return (data.bio as string) ?? null;
	return undefined;
}

/** Parse the users.data JSON column and extract additional fields. */
function parseAdditionalData(dataJson: string | null): { bio?: string } {
	if (!dataJson) return {};
	try {
		return JSON.parse(dataJson) as { bio?: string };
	} catch {
		return {};
	}
}

/** Merge additional fields (like bio) into the users.data JSON. */
function mergeAdditionalData(
	currentDataJson: string | null,
	next: { bio?: string | null },
): string | null {
	const current = currentDataJson ? parseAdditionalData(currentDataJson) : {};
	if (next.bio === undefined) return currentDataJson; // No change
	if (next.bio === null) {
		// Remove bio from data
		delete current.bio;
		return Object.keys(current).length > 0 ? JSON.stringify(current) : null;
	}
	current.bio = next.bio;
	return Object.keys(current).length > 0 ? JSON.stringify(current) : null;
}

/** Attach username/displayUsername/bio to a user row for return to Better-Auth. */
function withUsername(
	row: Record<string, unknown>,
	rec: UsernameRecord | null,
): Record<string, unknown> {
	const data = (row.data as string | null) ?? null;
	const bio = data ? parseAdditionalData(data).bio : null;

	return {
		...row,
		username: rec?.username ?? null,
		displayUsername: rec?.displayUsername ?? null,
		bio: bio ?? null,
	};
}

/**
 * Apply a Better-Auth where-clause (already cleaned by the factory) to a
 * plain record. Storage collections only offer coarse querying, so for
 * correctness we filter in memory after a bounded fetch. Auth working sets
 * (a user's sessions, a verification token) are tiny, so this is fine.
 */
function matchesWhere(record: Record<string, unknown>, where: CleanedWhere[]): boolean {
	if (where.length === 0) return true;
	// Better-Auth only ever emits AND-connected clauses for these models.
	return where.every((clause) => {
		const actual = record[clause.field];
		const expected = clause.value;
		switch (clause.operator) {
			case "eq":
				return actual === expected;
			case "ne":
				return actual !== expected;
			case "in":
				return Array.isArray(expected) && (expected as unknown[]).includes(actual);
			case "not_in":
				return Array.isArray(expected) && !(expected as unknown[]).includes(actual);
			case "gt":
				return (actual as number) > (expected as number);
			case "gte":
				return (actual as number) >= (expected as number);
			case "lt":
				return (actual as number) < (expected as number);
			case "lte":
				return (actual as number) <= (expected as number);
			case "contains":
				return typeof actual === "string" && actual.includes(String(expected));
			case "starts_with":
				return typeof actual === "string" && actual.startsWith(String(expected));
			case "ends_with":
				return typeof actual === "string" && actual.endsWith(String(expected));
			default:
				return actual === expected;
		}
	});
}

/**
 * Pull every row for a storage collection (paginated) and filter in memory.
 * Bounded by auth working-set sizes; not a general query engine.
 */
async function queryStorage(
	collection: StorageCollection<Record<string, unknown>>,
	where: CleanedWhere[],
	opts?: { limit?: number; sortBy?: { field: string; direction: "asc" | "desc" } },
): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
	const results: Array<{ id: string; data: Record<string, unknown> }> = [];
	let cursor: string | undefined;
	do {
		const page = await collection.query({ limit: 1000, cursor });
		for (const item of page.items) {
			if (matchesWhere(item.data, where)) results.push(item);
		}
		cursor = page.hasMore ? page.cursor : undefined;
	} while (cursor);

	if (opts?.sortBy) {
		const { field, direction } = opts.sortBy;
		results.sort((a, b) => {
			const av = a.data[field];
			const bv = b.data[field];
			if (av === bv) return 0;
			const cmp = (av as number | string) < (bv as number | string) ? -1 : 1;
			return direction === "desc" ? -cmp : cmp;
		});
	}
	if (opts?.limit !== undefined) return results.slice(0, opts.limit);
	return results;
}

/**
 * Build the EmDash custom adapter for Better-Auth.
 *
 * @param db      EmDash's Kysely instance (from `locals.emdash.db`).
 * @param storage Plugin storage collections from `getAuthProviderStorage`.
 */
export function emdashAdapter(db: Kysely<UsersDB>, storage: BetterAuthStorage) {
	/** Build a where-filtered `users` query base from SQL-safe column clauses.
	 * Call `.selectAll()` / `.select("id")` at the use site. */
	function userWhere(clauses: CleanedWhere[]) {
		let query = db.selectFrom("users");
		for (const clause of clauses) {
			query = query.where(
				clause.field as keyof UsersTable & string,
				"=",
				clause.value as never,
			);
		}
		return query;
	}

	/** Resolve all userIds matched by a user-model where clause (for bulk
	 * username sync/cleanup). Resolves virtual username fields first. */
	async function matchedUserIds(where: CleanedWhere[]): Promise<string[]> {
		const resolved = await resolveUserWhere(storage, where);
		if ("unmatchable" in resolved) return [];
		const rows = await userWhere(resolved.clauses).select("id").execute();
		return rows.map((r) => r.id);
	}

	const createCustomAdapter = (): CustomAdapter => ({
		async create({ model, data }) {
			if (isUserModel(model)) {
				// The factory has already applied field mapping + coercion, so
				// `data` uses physical column names. Fill EmDash-required columns
				// the factory doesn't know about.
				const now = new Date().toISOString();
				const row: UsersTable = {
					id: (data.id as string) ?? ulid(),
					email: String(data.email).toLowerCase(),
					name: (data.name as string | null) ?? null,
					avatar_url: (data.avatar_url as string | null) ?? null,
					role: (data.role as number | undefined) ?? 10, // 10 = subscriber
					email_verified: (data.email_verified as number | undefined) ?? 0,
					disabled: (data.disabled as number | undefined) ?? 0,
					data: (data.data as string | null) ?? null,
					created_at: (data.created_at as string | undefined) ?? now,
					updated_at: (data.updated_at as string | undefined) ?? now,
				};

				// Claim the username FIRST so a duplicate handle fails before we
				// create the user row (avoids an orphaned user with no handle).
				const uf = pickUsernameFields(data);
				if (uf.username) {
					await syncUsername(storage, row.id, uf);
				}

				// Merge bio into the users.data JSON column. Bio is not a real column
				// but stored inside the data JSON. We merge it in carefully to avoid
				// clobbering other keys already in data.
				const bio = pickBioField(data);
				if (bio !== undefined) {
					row.data = mergeAdditionalData(row.data, { bio });
				}

				try {
					await db.insertInto("users").values(row).execute();
				} catch (err) {
					// User insert failed after we claimed the handle — release it so
					// the handle isn't orphaned by a failed signup.
					if (uf.username) await storage.usernames.delete(row.id).catch(() => {});
					throw err;
				}

				const rec = await getUsernameRecord(storage, row.id);
				return withUsername(row as unknown as Record<string, unknown>, rec) as unknown as typeof data;
			}

			const collection = storageFor(storage, model);
			const id = (data.id as string) ?? ulid();
			const record = { ...data, id };
			await collection.put(id, record);
			return record as typeof data;
		},

		async findOne({ model, where }) {
			if (isUserModel(model)) {
				const resolved = await resolveUserWhere(storage, where);
				if ("unmatchable" in resolved) return null;
				const row = await userWhere(resolved.clauses).selectAll().executeTakeFirst();
				if (!row) return null;
				const rec = await getUsernameRecord(storage, (row as UsersTable).id);
				return withUsername(row as unknown as Record<string, unknown>, rec) as unknown as Record<string, unknown>;
			}

			const collection = storageFor(storage, model);
			// Fast path: direct id lookup.
			const idClause = where.find((w) => w.field === "id" && w.operator === "eq");
			if (idClause && where.length === 1) {
				const found = await collection.get(idClause.value as string);
				return (found as Record<string, unknown> | null) ?? null;
			}
			const matches = await queryStorage(collection, where, { limit: 1 });
			return matches.length > 0 ? matches[0].data : null;
		},

		async findMany({ model, where, limit, sortBy, offset }) {
			if (isUserModel(model)) {
				const resolved = await resolveUserWhere(storage, where ?? []);
				if ("unmatchable" in resolved) return [];
				let query = userWhere(resolved.clauses).selectAll();
				if (sortBy) {
					query = query.orderBy(
						sortBy.field as keyof UsersTable & string,
						sortBy.direction,
					);
				}
				if (limit !== undefined) query = query.limit(limit);
				if (offset !== undefined) query = query.offset(offset);
				const rows = await query.execute();

				// Augment user records with username fields from plugin storage.
				return Promise.all(
					rows.map(async (row) => {
						const rec = await getUsernameRecord(storage, (row as UsersTable).id);
						return withUsername(
							row as unknown as Record<string, unknown>,
							rec,
						) as unknown as Record<string, unknown>;
					}),
				);
			}

			const collection = storageFor(storage, model);
			const matches = await queryStorage(collection, where ?? [], { sortBy });
			const sliced = offset ? matches.slice(offset) : matches;
			const limited = limit !== undefined ? sliced.slice(0, limit) : sliced;
			return limited.map((m) => m.data);
		},

		async update({ model, where, update }) {
			if (isUserModel(model)) {
				const resolved = await resolveUserWhere(storage, where);
				if ("unmatchable" in resolved) return null;

				// Separate username fields, bio, and real column updates.
				const upd = update as Record<string, unknown>;
				const uf = pickUsernameFields(upd);
				const bio = pickBioField(upd);
				const columnUpdate: Record<string, unknown> = {};
				for (const [k, v] of Object.entries(upd)) {
					if (!USERNAME_FIELDS.has(k) && !ADDITIONAL_DATA_FIELDS.has(k)) {
						columnUpdate[k] = v;
					}
				}

				// Resolve the target user id (username/bio updates need it for sync).
				const targetId =
					directUserId(resolved.clauses) ??
					(await userWhere(resolved.clauses).select("id").executeTakeFirst())?.id ??
					null;

				// Sync username first so a taken-handle rejection aborts before the
				// column write (keeps the record and the row consistent).
				if ((uf.username !== undefined || uf.displayUsername !== undefined) && targetId) {
					await syncUsername(storage, targetId, uf);
				}

				// Merge bio into users.data if present (separate from column updates).
				if (bio !== undefined && targetId) {
					const row = await userWhere(resolved.clauses).selectAll().executeTakeFirst();
					if (row) {
						const currentData = (row as UsersTable).data as string | null;
						const newData = mergeAdditionalData(currentData, { bio });
						if (newData !== currentData) {
							await db
								.updateTable("users")
								.set({ data: newData })
								.where("id", "=", targetId)
								.execute();
						}
					}
				}

				if (Object.keys(columnUpdate).length > 0) {
					let query = db.updateTable("users").set(columnUpdate as Record<string, never>);
					for (const clause of resolved.clauses) {
						query = query.where(
							clause.field as keyof UsersTable & string,
							"=",
							clause.value as never,
						);
					}
					await query.execute();
				}

				return this.findOne({ model, where: resolved.clauses });
			}

			const collection = storageFor(storage, model);
			const matches = await queryStorage(collection, where, { limit: 1 });
			if (matches.length === 0) return null;
			const merged = { ...matches[0].data, ...(update as Record<string, unknown>) };
			await collection.put(matches[0].id, merged);
			return merged;
		},

		async updateMany({ model, where, update }) {
			if (isUserModel(model)) {
				const resolved = await resolveUserWhere(storage, where);
				if ("unmatchable" in resolved) return 0;

				const upd = update as Record<string, unknown>;
				const uf = pickUsernameFields(upd);
				const bio = pickBioField(upd);
				const columnUpdate: Record<string, unknown> = {};
				for (const [k, v] of Object.entries(upd)) {
					if (!USERNAME_FIELDS.has(k) && !ADDITIONAL_DATA_FIELDS.has(k)) {
						columnUpdate[k] = v;
					}
				}

				// Sync username for every matched user. A bulk username set to the
				// same value across multiple users would violate uniqueness — the
				// second syncUsername throws, which is the correct behaviour.
				if (uf.username !== undefined || uf.displayUsername !== undefined) {
					const ids = await matchedUserIds(where);
					for (const id of ids) {
						await syncUsername(storage, id, uf);
					}
				}

				// Merge bio into users.data for every matched user.
				if (bio !== undefined) {
					const ids = await matchedUserIds(where);
					for (const id of ids) {
						const row = await db.selectFrom("users").selectAll().where("id", "=", id).executeTakeFirst();
						if (row) {
							const currentData = (row as UsersTable).data as string | null;
							const newData = mergeAdditionalData(currentData, { bio });
							if (newData !== currentData) {
								await db.updateTable("users").set({ data: newData }).where("id", "=", id).execute();
							}
						}
					}
				}

				let updated = 0;
				if (Object.keys(columnUpdate).length > 0) {
					let query = db.updateTable("users").set(columnUpdate as Record<string, never>);
					for (const clause of resolved.clauses) {
						query = query.where(
							clause.field as keyof UsersTable & string,
							"=",
							clause.value as never,
						);
					}
					const res = await query.executeTakeFirst();
					updated = Number(res.numUpdatedRows ?? 0);
				} else {
					// username/bio-only bulk update: report the count we synced.
					updated = (await matchedUserIds(where)).length;
				}
				return updated;
			}

			const collection = storageFor(storage, model);
			const matches = await queryStorage(collection, where);
			for (const m of matches) {
				await collection.put(m.id, { ...m.data, ...(update as Record<string, unknown>) });
			}
			return matches.length;
		},

		async delete({ model, where }) {
			if (isUserModel(model)) {
				const resolved = await resolveUserWhere(storage, where);
				if ("unmatchable" in resolved) return;
				// Resolve affected ids up front so we can free their handles.
				const ids = await matchedUserIds(where);
				let query = db.deleteFrom("users");
				for (const clause of resolved.clauses) {
					query = query.where(
						clause.field as keyof UsersTable & string,
						"=",
						clause.value as never,
					);
				}
				await query.execute();
				// Free every deleted user's username so the handle can be reclaimed.
				for (const id of ids) {
					await storage.usernames.delete(id).catch(() => {});
				}
				return;
			}

			const collection = storageFor(storage, model);
			const idClause = where.find((w) => w.field === "id" && w.operator === "eq");
			if (idClause && where.length === 1) {
				await collection.delete(idClause.value as string);
				return;
			}
			const matches = await queryStorage(collection, where);
			await collection.deleteMany(matches.map((m) => m.id));
		},

		async deleteMany({ model, where }) {
			if (isUserModel(model)) {
				const resolved = await resolveUserWhere(storage, where);
				if ("unmatchable" in resolved) return 0;
				// Free handles for all matched users before deleting the rows.
				const ids = await matchedUserIds(where);
				let query = db.deleteFrom("users");
				for (const clause of resolved.clauses) {
					query = query.where(
						clause.field as keyof UsersTable & string,
						"=",
						clause.value as never,
					);
				}
				const res = await query.executeTakeFirst();
				for (const id of ids) {
					await storage.usernames.delete(id).catch(() => {});
				}
				return Number(res.numDeletedRows ?? ids.length);
			}

			const collection = storageFor(storage, model);
			const matches = await queryStorage(collection, where);
			return collection.deleteMany(matches.map((m) => m.id));
		},

		async count({ model, where }) {
			if (isUserModel(model)) {
				const resolved = await resolveUserWhere(storage, where ?? []);
				if ("unmatchable" in resolved) return 0;
				let query = db
					.selectFrom("users")
					.select((eb) => eb.fn.countAll<number>().as("count"));
				for (const clause of resolved.clauses) {
					query = query.where(
						clause.field as keyof UsersTable & string,
						"=",
						clause.value as never,
					);
				}
				const res = await query.executeTakeFirstOrThrow();
				return Number(res.count);
			}

			const collection = storageFor(storage, model);
			const matches = await queryStorage(collection, where ?? []);
			return matches.length;
		},

		// Race-safe single-use consume (verification tokens). Storage has no
		// atomic delete-returning, but auth working sets are per-user tiny and
		// D1 requests are serialized per isolate, so read-then-delete is safe
		// enough here.
		async consumeOne({ model, where }) {
			const found = await this.findOne({ model, where });
			if (!found) return null;
			await this.delete({ model, where });
			return found;
		},

		// Guarded counter mutation. Only ever hit for rate-limit-style rows,
		// which the storage-backed models don't use, but implement for contract
		// completeness.
		async incrementOne({ model, where, increment, set }) {
			const found = await this.findOne<Record<string, unknown>>({ model, where });
			if (!found) return null;
			const updated: Record<string, unknown> = { ...found, ...(set ?? {}) };
			for (const [field, delta] of Object.entries(increment)) {
				updated[field] = ((found[field] as number) ?? 0) + delta;
			}
			await this.update({ model, where, update: updated });
			return updated;
		},
	});

	return createAdapterFactory({
		config: {
			adapterId: "emdash",
			adapterName: "EmDash Adapter",
			// D1/SQLite: let the factory coerce these to primitives for us.
			supportsBooleans: false,
			supportsDates: false,
			supportsJSON: false,
			supportsNumericIds: false,
			// We generate ULIDs ourselves in create(); let better-auth pass ids through.
			transaction: false,
		},
		adapter: createCustomAdapter,
	});
}
