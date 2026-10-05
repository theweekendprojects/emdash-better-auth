/**
 * Runnable self-check for writeKvSettings' locked-secret guard.
 *
 * The admin UI hides every secret / social credential behind an "unlock"
 * toggle (editSecrets for the core keys, editSocial_<id> per provider). The
 * save path must enforce the same lock server-side: a secret / provider
 * id+secret is written ONLY when its unlock flag came back true. This proves a
 * stray Save (or browser autofill) while locked cannot clobber a stored value.
 */

import { deepEqual, equal } from "./assert.js";
import {
	EDIT_SECRETS_FLAG,
	SETTINGS_KEYS,
	editSocialFlag,
	providerClientIdKey,
	providerClientSecretKey,
	writeKvSettings,
} from "../src/settings.js";

/** In-memory KVAccess stub recording what actually got written/deleted. */
function makeKv() {
	const store = new Map<string, unknown>();
	return {
		store,
		kv: {
			async get<T = unknown>(k: string): Promise<T | null> {
				return (store.has(k) ? (store.get(k) as T) : null);
			},
			async set(k: string, v: unknown): Promise<void> {
				store.set(k, v);
			},
			async delete(k: string): Promise<void> {
				store.delete(k);
			},
		},
	};
}

const SK = `settings:${SETTINGS_KEYS.betterAuthSecret}`;
const GID = `settings:${providerClientIdKey("google")}`;
const GSK = `settings:${providerClientSecretKey("google")}`;

// 1. LOCKED: a secret rides along but the unlock toggle is false/absent ->
//    nothing is written (the stored value is left untouched).
{
	const { store, kv } = makeKv();
	store.set(SK, "stored-signing-key");
	await writeKvSettings(kv, {
		// no editSecrets flag at all
		[SETTINGS_KEYS.betterAuthSecret]: "AUTOFILLED-JUNK",
	});
	equal(store.get(SK), "stored-signing-key", "locked core secret preserved (flag absent)");

	await writeKvSettings(kv, {
		[EDIT_SECRETS_FLAG]: false,
		[SETTINGS_KEYS.betterAuthSecret]: "AUTOFILLED-JUNK",
	});
	equal(store.get(SK), "stored-signing-key", "locked core secret preserved (flag false)");
}

// 2. UNLOCKED: unlock toggle true + a new value -> written.
{
	const { store, kv } = makeKv();
	await writeKvSettings(kv, {
		[EDIT_SECRETS_FLAG]: true,
		[SETTINGS_KEYS.betterAuthSecret]: "new-key",
	});
	equal(store.get(SK), "new-key", "unlocked core secret written");
}

// 3. UNLOCKED but blank -> stored secret kept (blank = keep existing).
{
	const { store, kv } = makeKv();
	store.set(SK, "stored-signing-key");
	await writeKvSettings(kv, {
		[EDIT_SECRETS_FLAG]: true,
		[SETTINGS_KEYS.betterAuthSecret]: "   ",
	});
	equal(store.get(SK), "stored-signing-key", "unlocked blank secret keeps stored value");
}

// 4. Per-provider lock: google's id/secret ride along without editSocial_google
//    -> both untouched; with it true -> both written. Independent of core flag.
{
	const { store, kv } = makeKv();
	store.set(GID, "stored-id");
	store.set(GSK, "stored-secret");
	await writeKvSettings(kv, {
		[EDIT_SECRETS_FLAG]: true, // core unlocked must NOT unlock a provider
		[providerClientIdKey("google")]: "junk-id",
		[providerClientSecretKey("google")]: "junk-secret",
	});
	equal(store.get(GID), "stored-id", "locked provider id preserved");
	equal(store.get(GSK), "stored-secret", "locked provider secret preserved");

	await writeKvSettings(kv, {
		[editSocialFlag("google")]: true,
		[providerClientIdKey("google")]: "real-id",
		[providerClientSecretKey("google")]: "real-secret",
	});
	equal(store.get(GID), "real-id", "unlocked provider id written");
	equal(store.get(GSK), "real-secret", "unlocked provider secret written");
}

// 5. Non-sensitive keys are always writable (no unlock flag needed), and
//    toggles still persist on a locked save (so unrelated settings aren't lost).
{
	const { store, kv } = makeKv();
	await writeKvSettings(kv, {
		[SETTINGS_KEYS.baseUrl]: "https://example.com",
		[SETTINGS_KEYS.adminEnabled]: true,
		// a locked secret in the same payload is simply ignored
		[SETTINGS_KEYS.betterAuthSecret]: "junk",
	});
	deepEqual(
		{
			base: store.get(`settings:${SETTINGS_KEYS.baseUrl}`),
			admin: store.get(`settings:${SETTINGS_KEYS.adminEnabled}`),
			secret: store.has(SK),
		},
		{ base: "https://example.com", admin: true, secret: false },
		"non-sensitive keys written while locked secret ignored",
	);
}

// 6. Free-text validation: junk accent / base URL is rejected (reported, not
//    written, stored value kept); valid values and clearing still work.
{
	const { store, kv } = makeKv();
	const AK = `settings:${SETTINGS_KEYS.accentColor}`;
	const BK = `settings:${SETTINGS_KEYS.baseUrl}`;
	store.set(AK, "#123456");
	const bad = await writeKvSettings(kv, {
		[SETTINGS_KEYS.accentColor]: "heroui-test-1@example.com",
		[SETTINGS_KEYS.baseUrl]: "not a url",
	});
	deepEqual([...bad].sort(), [SETTINGS_KEYS.accentColor, SETTINGS_KEYS.baseUrl].sort(), "junk rejected");
	equal(store.get(AK), "#123456", "stored accent kept on rejection");
	equal(store.has(BK), false, "junk base url not written");
	const good = await writeKvSettings(kv, {
		[SETTINGS_KEYS.accentColor]: "rgb(0, 102, 204)",
		[SETTINGS_KEYS.baseUrl]: "https://example.com",
	});
	deepEqual(good, [], "valid values accepted");
	equal(store.get(AK), "rgb(0, 102, 204)");
	await writeKvSettings(kv, { [SETTINGS_KEYS.accentColor]: "" });
	equal(store.has(AK), false, "blank clears accent");
}

console.log("write-settings-lock self-check: all cases passed");
