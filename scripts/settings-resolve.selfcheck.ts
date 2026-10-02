/**
 * Runnable self-check for resolveSettings' new feature flags.
 *
 * Focuses on the non-trivial rule: teamsEnabled is forced false unless
 * orgEnabled is true, so a stale saved teams toggle can never register team
 * collections without the organization plugin. Also confirms admin/org flags
 * default off and coerce string booleans.
 */

import { equal } from "./assert.js";
import { resolveSettings } from "../src/settings.js";

// 1. All flags default to false when nothing is saved.
{
	const r = resolveSettings({}, {});
	equal(r.adminEnabled, false);
	equal(r.orgEnabled, false);
	equal(r.teamsEnabled, false);
}

// 2. adminEnabled / orgEnabled turn on from saved booleans.
{
	const r = resolveSettings({ adminEnabled: true, orgEnabled: true }, {});
	equal(r.adminEnabled, true);
	equal(r.orgEnabled, true);
}

// 3. String "true"/"1" coerce to true (EmDash form persistence shape).
{
	const r = resolveSettings({ adminEnabled: "true", orgEnabled: "1" }, {});
	equal(r.adminEnabled, true);
	equal(r.orgEnabled, true);
}

// 4. teamsEnabled is forced false when orgEnabled is false, even if saved true.
{
	const r = resolveSettings({ orgEnabled: false, teamsEnabled: true }, {});
	equal(r.teamsEnabled, false);
}

// 5. teamsEnabled honored only when orgEnabled is also true.
{
	const r = resolveSettings({ orgEnabled: true, teamsEnabled: true }, {});
	equal(r.teamsEnabled, true);
}

// 6. The data-driven social provider list resolves the newer providers
//    (facebook / twitter / cloudflare), not just google/github. A provider is
//    included only when BOTH id + secret are present, keyed by its Better Auth
//    id (which is also the callback path segment).
{
	const r = resolveSettings(
		{
			facebookClientId: "fb-id",
			facebookClientSecret: "fb-secret",
			twitterClientId: "x-id",
			twitterClientSecret: "x-secret",
			cloudflareClientId: "cf-id",
			cloudflareClientSecret: "cf-secret",
			// Only an id, no secret → must be excluded.
			googleClientId: "g-id",
		},
		{},
	);
	equal(r.socialProviders.facebook?.clientId, "fb-id");
	equal(r.socialProviders.twitter?.clientSecret, "x-secret");
	equal(r.socialProviders.cloudflare?.clientId, "cf-id");
	// google has no secret → not configured.
	equal(r.socialProviders.google, undefined);
}

console.log("settings-resolve self-check: all 6 cases passed");
