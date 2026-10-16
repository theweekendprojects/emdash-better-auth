/**
 * Assert-based self-check for email-hygiene.ts. No framework, no fixtures.
 * Run: node --experimental-strip-types src/email-hygiene.selfcheck.ts
 * (or via tsx). Exits non-zero on first failed assertion.
 */

import { strict as assert } from "node:assert";
import { isDisposableEmail, normalizeEmail, parseAllowlist } from "./email-hygiene.js";

// --- normalizeEmail: Gmail dot + plus folding ---
assert.equal(normalizeEmail("A.B.C+promo@Gmail.com").key, "abc@gmail.com", "gmail dots+tag");
assert.equal(normalizeEmail("ab@googlemail.com").key, "ab@gmail.com", "googlemail alias");
assert.equal(normalizeEmail("a.b@googlemail.com").key, "ab@gmail.com", "googlemail dots");

// --- plus-tag stripped for aliasing providers, NOT dots ---
assert.equal(normalizeEmail("user+x@outlook.com").key, "user@outlook.com", "outlook plus");
assert.equal(normalizeEmail("u.ser@outlook.com").key, "u.ser@outlook.com", "outlook keeps dots");

// --- non-aliasing domain untouched beyond lowercase ---
assert.equal(normalizeEmail("First.Last+tag@example.com").key, "first.last+tag@example.com", "other domain");

// --- malformed input doesn't throw, key = trimmed input ---
assert.equal(normalizeEmail("  notanemail ").key, "notanemail", "no @");
assert.equal(normalizeEmail("trailing@").key, "trailing@", "empty domain");

// --- original preserved for sending ---
assert.equal(normalizeEmail("A.B+x@Gmail.com").original, "a.b+x@gmail.com", "original kept");

// --- disposable detection ---
assert.equal(isDisposableEmail("mailinator.com", new Set()), true, "mailinator blocked");
assert.equal(isDisposableEmail("gmail.com", new Set()), false, "gmail allowed");
assert.equal(isDisposableEmail("", new Set()), false, "empty domain");

// --- allowlist overrides the block ---
const allow = parseAllowlist("mailinator.com, trusted-relay.com\nguerrillamail.com");
assert.equal(isDisposableEmail("mailinator.com", allow), false, "allowlisted disposable passes");
assert.equal(isDisposableEmail("guerrillamail.com", allow), false, "newline-separated allowlist");
assert.equal(allow.has("trusted-relay.com"), true, "allowlist parsed");

// --- parseAllowlist edge cases ---
assert.equal(parseAllowlist(null).size, 0, "null allowlist");
assert.equal(parseAllowlist("").size, 0, "empty allowlist");

console.log("email-hygiene self-check: all assertions passed");
