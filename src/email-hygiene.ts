/**
 * Pure email hygiene helpers: normalization (for dedupe), disposable-domain
 * detection, and operator allowlist handling.
 *
 * Dependency-free so it can be unit-tested without the emdash runtime. The
 * disposable domain data lives in a separate module (`disposable-domains.ts`)
 * and is only imported here; callers that keep `blockDisposableEmail` off and
 * never call {@link isDisposableEmail} let the bundler tree-shake it away.
 */

import { DISPOSABLE_EMAIL_DOMAINS } from "./disposable-domains.js";

/** Domains whose local part is dot-insensitive (a.b@gmail == ab@gmail). */
const DOT_INSENSITIVE_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/** googlemail.com is an alias of gmail.com for addressing purposes. */
const DOMAIN_ALIASES: Record<string, string> = { "googlemail.com": "gmail.com" };

/**
 * Providers that treat `local+tag@domain` as an alias of `local@domain`.
 * Everyone strips the `+tag`; only the dot handling above is Gmail-specific.
 */
const PLUS_TAG_DOMAINS = new Set([
	"gmail.com",
	"googlemail.com",
	"outlook.com",
	"hotmail.com",
	"live.com",
	"fastmail.com",
	"proton.me",
	"protonmail.com",
]);

export interface NormalizedEmail {
	/** The address as given (only trimmed + lowercased), used for sending. */
	original: string;
	/** Canonical uniqueness key — compare THIS for dedupe, never store as the address. */
	key: string;
	/** Lowercased domain part (after alias resolution). */
	domain: string;
}

/**
 * Normalize an email into a canonical dedupe key without losing the address to
 * send to. Lowercases; for Gmail/Googlemail strips dots in the local part and
 * folds googlemail→gmail; strips a `+tag` suffix for providers that alias it.
 * The returned `key` is for uniqueness comparison only; always send to
 * `original`.
 */
export function normalizeEmail(email: string): NormalizedEmail {
	const trimmed = email.trim().toLowerCase();
	const at = trimmed.lastIndexOf("@");
	// No usable @ — can't normalize a domain, key is the whole string.
	if (at <= 0 || at === trimmed.length - 1) {
		return { original: trimmed, key: trimmed, domain: "" };
	}
	let local = trimmed.slice(0, at);
	let domain = trimmed.slice(at + 1);

	domain = DOMAIN_ALIASES[domain] ?? domain;

	if (PLUS_TAG_DOMAINS.has(domain)) {
		const plus = local.indexOf("+");
		if (plus !== -1) local = local.slice(0, plus);
	}
	if (DOT_INSENSITIVE_DOMAINS.has(domain)) {
		local = local.replace(/\./g, "");
	}

	return { original: trimmed, key: `${local}@${domain}`, domain };
}

/** Parse an operator allowlist (comma / newline separated) into a lowercased Set. */
export function parseAllowlist(raw: string | null | undefined): ReadonlySet<string> {
	if (!raw) return new Set();
	return new Set(
		raw
			.split(/[\s,]+/)
			.map((d) => d.trim().toLowerCase())
			.filter(Boolean),
	);
}

/**
 * Whether an email's domain is a known disposable/throwaway domain. An operator
 * allowlist always wins (for privacy relays the operator trusts). Pass the
 * already-normalized domain (from {@link normalizeEmail}) to catch Gmail
 * aliases, though disposable providers aren't aliased so either works.
 */
export function isDisposableEmail(domain: string, allowlist: ReadonlySet<string>): boolean {
	const d = domain.trim().toLowerCase();
	if (!d) return false;
	if (allowlist.has(d)) return false;
	return DISPOSABLE_EMAIL_DOMAINS.has(d);
}
