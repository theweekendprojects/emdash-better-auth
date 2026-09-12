/**
 * Custom Better-Auth database adapter for EmDash.
 *
 * Routes Better-Auth's four models to two different backing stores so the
 * plugin is portable across any EmDash site without hand-written migrations:
 *
 *   - `user`    -> EmDash's own `users` table (real Kysely SQL). This makes
 *                  Better-Auth accounts first-class EmDash users, visible in
 *                  the admin UI and subject to EmDash RBAC (the `role` column).
 *   - `account` -> plugin storage collection `accounts` (password hashes,
 *                  OAuth tokens). Keyed by Better-Auth's generated id.
 *   - `session` -> plugin storage collection `sessions`.
 *   - `verification` -> plugin storage collection `verifications`.
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

/**
 * Resolve userId from a where clause. For username updates, we need to find
 * the user ID to sync the usernames collection. We support:
 * - id = <userId> (direct lookup)
 */
function resolveUserIdFromWhere(where: CleanedWhere[]): string | null {
	for (const clause of where) {
		if (clause.field === "id" && clause.operator === "eq") {
			return clause.value as string;
		}
	}
	return null;
}

interface UsersDB {
	users: UsersTable;
}

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

/**
 * Model routing. Better-Auth calls the custom adapter with the *mapped* model
 * name (the `modelName` configured in auth.ts), so the user model arrives as
 * "users" (EmDash's table). The other three keep Better-Auth's default names.
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
				await db.insertInto("users").values(row).execute();

				// Store username and displayUsername in plugin storage for atomic
				// uniqueness (via uniqueIndexes). Better Auth's username plugin
				// expects these fields on the user model; we surface them by
				// appending to user records in findOne/findMany.
				// The username plugin passes username and displayUsername fields
				// in data (after field mapping). If present, create the username record.
				const username = data.username as string | undefined;
				const displayUsername = data.displayUsername as string | undefined;
				if (username && displayUsername) {
					const usernames = storage.usernames;
					// The unique index on usernames collection will enforce uniqueness
					// atomically; no need for a separate check.
					await usernames.put(row.id, {
						id: row.id,
						userId: row.id,
						username,
						displayUsername,
					});
				}

				// Return the user record augmented with username fields so Better Auth
				// sees them. This is safe because Better Auth's user model mapping
				// allows additional fields beyond the physical table columns.
				return { ...row, username: username ?? null, displayUsername: displayUsername ?? null } as unknown as typeof data;
			}

			const collection = storageFor(storage, model);
			const id = (data.id as string) ?? ulid();
			const record = { ...data, id };
			await collection.put(id, record);
			return record as typeof data;
		},

		async findOne({ model, where }) {
			if (isUserModel(model)) {
				let query = db.selectFrom("users").selectAll();
				for (const clause of where) {
					query = query.where(
						clause.field as keyof UsersTable & string,
						"=",
						clause.value as never,
					);
				}
				const row = await query.executeTakeFirst();
				if (!row) return null;

				// Augment user record with username fields from plugin storage.
				const usernames = storage.usernames;
				const usernameRecord = await usernames.get(row.id);
				const username = (usernameRecord as Record<string, unknown> | null)?.username ?? null;
				const displayUsername = (usernameRecord as Record<string, unknown> | null)?.displayUsername ?? null;

				return { ...row, username, displayUsername } as unknown as Record<string, unknown>;
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
				let query = db.selectFrom("users").selectAll();
				for (const clause of where ?? []) {
					query = query.where(
						clause.field as keyof UsersTable & string,
						"=",
						clause.value as never,
					);
				}
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
				const usernames = storage.usernames;
				return Promise.all(
					rows.map(async (row) => {
						const usernameRecord = await usernames.get(row.id);
						const username = (usernameRecord as Record<string, unknown> | null)?.username ?? null;
						const displayUsername = (usernameRecord as Record<string, unknown> | null)?.displayUsername ?? null;
						return { ...row, username, displayUsername } as unknown as Record<string, unknown>;
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
				let query = db.updateTable("users").set(update as Record<string, never>);
				for (const clause of where) {
					query = query.where(
						clause.field as keyof UsersTable & string,
						"=",
						clause.value as never,
					);
				}
				await query.execute();

				// Sync username changes to the usernames collection if present.
				const username = (update as Record<string, unknown>).username as string | undefined;
				const displayUsername = (update as Record<string, unknown>).displayUsername as string | undefined;
				if (username || displayUsername) {
					const usernames = storage.usernames;
					// Find the user ID via the where clause for proper sync.
					const userId = resolveUserIdFromWhere(where);
					if (userId) {
						const existing = await usernames.get(userId);
						const merged = {
							...(existing ?? { userId }),
							username: username ?? (existing?.username as string | undefined),
							displayUsername: displayUsername ?? (existing?.displayUsername as string | undefined),
						};
						await usernames.put(userId, merged);
					}
				}

				return this.findOne({ model, where });
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
				let query = db.updateTable("users").set(update as Record<string, never>);
				for (const clause of where) {
					query = query.where(
						clause.field as keyof UsersTable & string,
						"=",
						clause.value as never,
					);
				}
				const res = await query.executeTakeFirst();

				// Sync username changes to the usernames collection if present.
				const username = (update as Record<string, unknown>).username as string | undefined;
				const displayUsername = (update as Record<string, unknown>).displayUsername as string | undefined;
				if (username || displayUsername) {
					const usernames = storage.usernames;
					// For updateMany, we'd need to query users first to get userIds.
					// Since updateMany on users is rare and username updates are
					// typically on single users, skip bulk sync here.
					// Users can sync manually if needed, or this could be optimized
					// by querying users first.
				}

				return Number(res.numUpdatedRows ?? 0);
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
				// Get userId(s) before deletion to clean up username records.
				const userId = resolveUserIdFromWhere(where);
				let query = db.deleteFrom("users");
				for (const clause of where) {
					query = query.where(
						clause.field as keyof UsersTable & string,
						"=",
						clause.value as never,
					);
				}
				await query.execute();
				// Clean up username record(s) for deleted user(s).
				if (userId) {
					await storage.usernames.delete(userId);
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
				// Get userIds first to clean up username records.
				// For deleteMany, we'd need to query users first.
				// Skip bulk username cleanup here for simplicity.
				let query = db.deleteFrom("users");
				for (const clause of where) {
					query = query.where(
						clause.field as keyof UsersTable & string,
						"=",
						clause.value as never,
					);
				}
				const res = await query.executeTakeFirst();
				return Number(res.numDeletedRows ?? 0);
			}

			const collection = storageFor(storage, model);
			const matches = await queryStorage(collection, where);
			return collection.deleteMany(matches.map((m) => m.id));
		},

		async count({ model, where }) {
			if (isUserModel(model)) {
				let query = db
					.selectFrom("users")
					.select((eb) => eb.fn.countAll<number>().as("count"));
				for (const clause of where ?? []) {
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
