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
	equal(r.apiKeyEnabled, false);
	equal(r.passkeyEnabled, false);
}

// 1b. apiKeyEnabled / passkeyEnabled turn on from saved booleans and coerce
//     the string shape EmDash form persistence produces.
{
	const r = resolveSettings({ apiKeyEnabled: true, passkeyEnabled: "1" }, {});
	equal(r.apiKeyEnabled, true);
	equal(r.passkeyEnabled, true);
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

// 7. Billing flag defaults off; turns on from a saved boolean. Stripe secrets
//    resolve saved-over-env; absent → undefined.
{
	const off = resolveSettings({}, {});
	equal(off.billingEnabled, false);
	equal(off.stripeSecretKey, undefined);
	equal(off.stripeWebhookSecret, undefined);

	const on = resolveSettings(
		{ billingEnabled: true, stripeSecretKey: "sk_saved" },
		{ stripeSecretKey: "sk_env", stripeWebhookSecret: "whsec_env" },
	);
	equal(on.billingEnabled, true);
	// Saved wins over env for the secret key…
	equal(on.stripeSecretKey, "sk_saved");
	// …and the env fallback fills the webhook secret that wasn't saved.
	equal(on.stripeWebhookSecret, "whsec_env");
}

// 8. Accent color: undefined when unset (caller applies the default), and the
//    saved value (trimmed) when present.
{
	equal(resolveSettings({}, {}).accentColor, undefined);
	equal(resolveSettings({ accentColor: "  #0066cc  " }, {}).accentColor, "#0066cc");
}

// 9. OIDC / OAuth 2.1 provider flag defaults off and turns on from the saved
//    boolean (and its string shape). It's independent of every other flag.
{
	equal(resolveSettings({}, {}).oidcProviderEnabled, false);
	equal(resolveSettings({ oidcProviderEnabled: true }, {}).oidcProviderEnabled, true);
	equal(resolveSettings({ oidcProviderEnabled: "1" }, {}).oidcProviderEnabled, true);
}

// 10. The passwordless / session / security flags default off and turn on from
//     saved booleans (and the "1"/"true" string shapes).
{
	const off = resolveSettings({}, {});
	equal(off.magicLinkEnabled, false);
	equal(off.emailOtpEnabled, false);
	equal(off.anonymousEnabled, false);
	equal(off.multiSessionEnabled, false);
	equal(off.hibpEnabled, false);

	const on = resolveSettings(
		{
			magicLinkEnabled: true,
			emailOtpEnabled: "1",
			anonymousEnabled: "true",
			multiSessionEnabled: true,
			hibpEnabled: "on",
		},
		{},
	);
	equal(on.magicLinkEnabled, true);
	equal(on.emailOtpEnabled, true);
	equal(on.anonymousEnabled, true);
	equal(on.multiSessionEnabled, true);
	equal(on.hibpEnabled, true);
}

// 11. Generic OAuth: the flag is forced FALSE when no provider config resolves,
//     even if saved true — so an enabled-but-unconfigured toggle doesn't claim
//     to be active. It's honored only when the env config has a usable provider
//     (both providerId + clientId). Entries missing either are dropped.
{
	// Flag on, but no config → inert (false), empty config list.
	const noConfig = resolveSettings({ genericOAuthEnabled: true }, {});
	equal(noConfig.genericOAuthEnabled, false);
	equal(noConfig.genericOAuthConfig.length, 0);

	// Flag on + a valid provider → enabled, config passed through.
	const withConfig = resolveSettings(
		{ genericOAuthEnabled: true },
		{
			genericOAuthConfig: [
				{ providerId: "keycloak", clientId: "kc-id", clientSecret: "kc-secret" },
				// invalid (no clientId) → filtered out.
				{ providerId: "broken", clientId: "" },
			],
		},
	);
	equal(withConfig.genericOAuthEnabled, true);
	equal(withConfig.genericOAuthConfig.length, 1);
	equal(withConfig.genericOAuthConfig[0]?.providerId, "keycloak");

	// Config present but flag off → disabled, but the (filtered) list still
	// resolves (the flag, not the list, gates registration).
	const flagOff = resolveSettings(
		{ genericOAuthEnabled: false },
		{ genericOAuthConfig: [{ providerId: "okta", clientId: "ok-id" }] },
	);
	equal(flagOff.genericOAuthEnabled, false);

	// A providerId colliding with a built-in social provider id is dropped
	// outright (never silently hijacks /callback/google), even though it has
	// valid credentials. A non-colliding entry in the same list is unaffected.
	const collision = resolveSettings(
		{ genericOAuthEnabled: true },
		{
			genericOAuthConfig: [
				{ providerId: "google", clientId: "evil-id", clientSecret: "evil-secret" },
				{ providerId: "keycloak", clientId: "kc-id", clientSecret: "kc-secret" },
			],
		},
	);
	equal(collision.genericOAuthConfig.length, 1);
	equal(collision.genericOAuthConfig[0]?.providerId, "keycloak");
	equal(collision.genericOAuthEnabled, true);

	// If EVERY configured entry collides, the list ends up empty and the flag
	// is forced back off (same "inert toggle" rule as the no-config case).
	const allCollide = resolveSettings(
		{ genericOAuthEnabled: true },
		{ genericOAuthConfig: [{ providerId: "github", clientId: "x", clientSecret: "y" }] },
	);
	equal(allCollide.genericOAuthConfig.length, 0);
	equal(allCollide.genericOAuthEnabled, false);
}

// 12. Audit log: flag defaults off; retention defaults to 365 and coerces the
//     stored string shape, treats 0 as "keep forever", and falls back to the
//     default for negative/non-numeric values.
{
	const def = resolveSettings({}, {});
	equal(def.auditLogEnabled, false);
	equal(def.auditLogRetentionDays, 365);

	equal(resolveSettings({ auditLogEnabled: "1" }, {}).auditLogEnabled, true);
	// Stored as a string by the form; coerced to a number.
	equal(resolveSettings({ auditLogRetentionDays: "90" }, {}).auditLogRetentionDays, 90);
	// 0 = keep forever (valid, not the default).
	equal(resolveSettings({ auditLogRetentionDays: "0" }, {}).auditLogRetentionDays, 0);
	// Negative / garbage → fall back to the default.
	equal(resolveSettings({ auditLogRetentionDays: "-5" }, {}).auditLogRetentionDays, 365);
	equal(resolveSettings({ auditLogRetentionDays: "abc" }, {}).auditLogRetentionDays, 365);
}

console.log("settings-resolve self-check: all cases passed");
