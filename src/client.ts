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
import { stripeClient } from "@better-auth/stripe/client";

// The client is a single static build and can't read the per-request feature
// flags that gate the server plugins, so the admin + organization client
// plugins are always registered. They only add method namespaces
// (`authClient.admin.*`, `authClient.organization.*`); calls fail server-side
// if the matching server plugin is disabled, so registering them unconditionally
// is inert for sites that don't opt in. Teams use the organization namespace
// too — no separate client flag is needed for basic team calls.
export const authClient = createAuthClient({
	plugins: [
		usernameClient(),
		twoFactorClient(),
		adminClient(),
		organizationClient(),
		// Adds authClient.subscription.* (upgrade/list/cancel/restore/portal).
		// Always registered; the server only honors it when the Stripe plugin is
		// enabled, so it's inert on sites without billing.
		stripeClient({ subscription: true }),
	],
});

export type AuthClient = typeof authClient;
