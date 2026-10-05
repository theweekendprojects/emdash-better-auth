/**
 * Runnable self-check for the users.data JSON additional-field helpers.
 *
 * Dependency-free assert script (no framework). Verifies the admin plugin's
 * string `role` and ban fields merge/clear/preserve correctly in users.data,
 * which is the whole no-migration mechanism for admin + 2FA + bio fields.
 */

import { deepEqual, equal } from "./assert.js";
import {
	pickAdditionalData,
	parseAdditionalData,
	mergeAdditionalData,
	effectiveAdminRole,
} from "../src/additional-data.js";

const FIELDS = new Set(["bio", "twoFactorEnabled", "role", "banned", "banReason", "banExpires"]);

// 1. Pick only recognized fields present in the payload; absent keys omitted.
{
	const picked = pickAdditionalData(
		{ role: "admin", banned: true, email: "x@y.z", name: "X" },
		FIELDS,
	);
	deepEqual(picked, { role: "admin", banned: true });
}

// 2. A field set to undefined is normalized to null (explicit clear).
{
	const picked = pickAdditionalData({ banReason: undefined }, FIELDS);
	deepEqual(picked, { banReason: null });
}

// 3. Merge sets admin fields into an empty blob.
{
	const json = mergeAdditionalData(null, { role: "admin", banned: true });
	deepEqual(parseAdditionalData(json), { role: "admin", banned: true });
}

// 4. Merge preserves unrelated existing keys (role update leaves bio intact).
{
	const start = JSON.stringify({ bio: "hi", twoFactorEnabled: true });
	const json = mergeAdditionalData(start, { role: "admin" });
	deepEqual(parseAdditionalData(json), {
		bio: "hi",
		twoFactorEnabled: true,
		role: "admin",
	});
}

// 5. A null value removes just that key.
{
	const start = JSON.stringify({ role: "admin", banned: true, bio: "hi" });
	const json = mergeAdditionalData(start, { banned: null });
	deepEqual(parseAdditionalData(json), { role: "admin", bio: "hi" });
}

// 6. Empty `next` returns the original string unchanged (no rewrite).
{
	const start = JSON.stringify({ role: "admin" });
	equal(mergeAdditionalData(start, {}), start);
}

// 7. Removing the last key collapses the blob to null (not "{}").
{
	const start = JSON.stringify({ role: "admin" });
	equal(mergeAdditionalData(start, { role: null }), null);
}

// 8. parseAdditionalData tolerates malformed JSON and non-objects.
{
	deepEqual(parseAdditionalData("not json"), {});
	deepEqual(parseAdditionalData("123"), {});
	deepEqual(parseAdditionalData(null), {});
}

// EmDash admins (numeric role >= 50) count as Better Auth "admin" unless an
// explicit string role was stored; everyone else stays null.
{
	equal(effectiveAdminRole(null, 50), "admin");
	equal(effectiveAdminRole(null, 10), null);
	equal(effectiveAdminRole("user", 50), "user", "explicit stored role wins");
	equal(effectiveAdminRole("", 50), "admin", "empty string is not a stored role");
	equal(effectiveAdminRole(null, "50"), null, "non-numeric emdash role ignored");
}

console.log("additional-data self-check: all 9 cases passed");
