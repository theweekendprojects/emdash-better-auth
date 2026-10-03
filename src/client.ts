/**
 * Better-Auth browser client for the auth UI island.
 *
 * Points at the plugin's mounted handler (`/api/auth`, Better-Auth's default
 * basePath). `baseURL` is left to default to the current origin so the same
 * build works on any host/domain — the client resolves it from
 * `window.location` at runtime.
 */

import { createAuthClient } from "better-auth/react";
import { usernameClient } from "better-auth/client/plugins";
import { twoFactorClient } from "better-auth/client/plugins";
import { adminClient } from "better-auth/client/plugins";
import { organizationClient } from "better-auth/client/plugins";
import { apiKeyClient } from "@better-auth/api-key/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { stripeClient } from "@better-auth/stripe/client";

// The client is a single static build and can't read the per-request feature
// flags that gate the server plugins, so the admin + organization client
// plugins are always registered. They only add method namespaces
// (`authClient.admin.*`, `authClient.organization.*`); calls fail server-side
// if the matching server plugin is disabled, so registering them unconditionally
// is inert for sites that don't opt in. Teams use the organization namespace
// too — no separate client flag is needed for basic team calls.
// --- HeroUI table race workaround ------------------------------------------
// @better-auth-ui/heroui (verified through 1.7.26) adds a leading checkbox
// COLUMN to the org members / invitations tables as soon as the "can delete"
// permission query resolves, but its loading-placeholder ROW always has one
// cell fewer. If the permission answers BEFORE the other org requests (members,
// owners, invitations, ...) the table throws "Cell count must match column
// count" and the whole page goes blank. Which request wins is pure network
// timing, so the page crashes intermittently.
//
// Fix without patching the library: hold back the RESPONSE of permission
// checks until the other requests have settled, so the permission always lands
// LAST and the header and rows always agree. The permission request is still
// sent immediately (no extra round trip); only its result is delayed, by the
// time the slowest sibling request takes plus a 200ms quiet window to cover
// requests that start right after another finishes. Capped at 4s so a stuck
// sibling can never block the permission forever. Non-permission requests are
// untouched. Remove once upstream fixes the skeleton row.
let otherInFlight = 0;
let lastOtherSettledAt = 0;
const QUIET_MS = 200;
const MAX_HOLD_MS = 4000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function holdUntilSiblingsSettle(): Promise<void> {
	const started = Date.now();
	while (Date.now() - started < MAX_HOLD_MS) {
		if (otherInFlight === 0 && Date.now() - lastOtherSettledAt >= QUIET_MS) return;
		await sleep(50);
	}
}

const orderedFetch: typeof fetch = async (input, init) => {
	const url =
		typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
	if (!url.includes("/organization/")) return fetch(input, init); // unrelated: untouched
	if (!url.includes("has-permission")) {
		otherInFlight++;
		try {
			return await fetch(input, init);
		} finally {
			otherInFlight--;
			lastOtherSettledAt = Date.now();
		}
	}
	const response = await fetch(input, init); // network starts immediately
	await holdUntilSiblingsSettle(); // ...but the result lands last
	return response;
};

export const authClient = createAuthClient({
	// Better Auth's client uses better-fetch under the hood; customFetchImpl is
	// its supported hook for swapping the fetch implementation.
	fetchOptions: { customFetchImpl: orderedFetch },
	plugins: [
		usernameClient(),
		twoFactorClient(),
		adminClient(),
		organizationClient(),
		// API key + passkey method namespaces (authClient.apiKey.*,
		// authClient.passkey.* / signIn.passkey). Always registered — the client
		// is a single static build and can't read per-request flags; calls fail
		// server-side when the matching server plugin is disabled, so this is
		// inert for sites that don't opt in (same rationale as admin/org above).
		apiKeyClient(),
		passkeyClient(),
		// Adds authClient.subscription.* (upgrade/list/cancel/restore/portal).
		// Always registered; the server only honors it when the Stripe plugin is
		// enabled, so it's inert on sites without billing.
		stripeClient({ subscription: true }),
	],
});

export type AuthClient = typeof authClient;
