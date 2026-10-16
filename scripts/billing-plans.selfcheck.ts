/**
 * Runnable self-check for the plan mappers. Dependency-free.
 *
 * The non-trivial behavior: a plan is only usable with a monthly price id
 * (dropped otherwise), the annual price is included only when both the id and
 * the display amount exist, and the two output shapes (server StripePlan vs UI
 * BillingPlan) are derived from one catalog.
 */

import { deepEqual, equal } from "./assert.js";
import {
	type PlanDefinition,
	toStripePlans,
	toBillingPlans,
	planLimits,
	FREE_PLAN_LIMITS,
	PLAN_DEFINITIONS,
	parsePlanEntitlements,
	mergeEntitlements,
} from "../src/billing-plans.js";

const defs: PlanDefinition[] = [
	{
		id: "pro",
		name: "Pro",
		description: "For individuals.",
		features: ["A", "B"],
		highlighted: true,
		monthlyAmount: 2000,
		annualAmount: 19200,
		currency: "USD",
		trialDays: 14,
	},
	{ id: "basic", name: "Basic", monthlyAmount: 500 },
];

// 1. No price ids → no usable plans (degrade to empty, not error).
equal(toStripePlans(defs, {}).length, 0);
equal(toBillingPlans(defs, {}).length, 0);

// 2. Monthly-only price id → server plan uses it; UI has a single month price.
{
	const server = toStripePlans(defs, { basic: { month: "price_basic_m" } });
	deepEqual(server, [{ name: "basic", priceId: "price_basic_m" }]);

	const ui = toBillingPlans(defs, { basic: { month: "price_basic_m" } });
	equal(ui.length, 1);
	equal(ui[0]!.prices.length, 1);
	equal(ui[0]!.prices[0]!.interval, "month");
	equal(ui[0]!.prices[0]!.amount, 500);
}

// 3. Month + year → annualDiscountPriceId on server; two prices in UI; trial maps.
{
	const ids = { pro: { month: "price_pro_m", year: "price_pro_y" } };
	const server = toStripePlans(defs, ids);
	deepEqual(server, [
		{
			name: "pro",
			priceId: "price_pro_m",
			annualDiscountPriceId: "price_pro_y",
			freeTrial: { days: 14 },
		},
	]);

	const ui = toBillingPlans(defs, ids);
	equal(ui[0]!.prices.length, 2);
	equal(ui[0]!.prices[1]!.interval, "year");
	equal(ui[0]!.prices[1]!.amount, 19200);
	equal(ui[0]!.highlighted, true);
	deepEqual(ui[0]!.features, ["A", "B"]);
}

// 4. A plan missing its monthly id is dropped even if others are present.
{
	const ids = { pro: { month: "price_pro_m" } }; // basic absent
	equal(toStripePlans(defs, ids).length, 1);
	equal(toBillingPlans(defs, ids).length, 1);
	equal(toStripePlans(defs, ids)[0]!.name, "pro");
}

// 5. planLimits: known plan → its caps; unknown/empty → free baseline.
{
	deepEqual(planLimits("pro"), { sitesPerUser: 3, mediaBytesPerSite: 10 * 1024 ** 3 });
	deepEqual(planLimits("enterprise"), { sitesPerUser: 1000, mediaBytesPerSite: 1000 * 1024 ** 3 });
	deepEqual(planLimits("PRO"), planLimits("pro")); // case-insensitive
	deepEqual(planLimits("nope"), FREE_PLAN_LIMITS); // unknown → free
	deepEqual(planLimits(null), FREE_PLAN_LIMITS); // no subscription → free
	deepEqual(planLimits(undefined), FREE_PLAN_LIMITS);
	// Free tier is stricter than any paid plan.
	equal(FREE_PLAN_LIMITS.sitesPerUser, 1);
}

// 6. The real catalog carries limits through to the Stripe plan shape.
{
	const ids = { pro: { month: "price_pro_m" } };
	const server = toStripePlans(PLAN_DEFINITIONS, ids);
	equal(server.length, 1);
	deepEqual(server[0]!.limits, { sitesPerUser: 3, mediaBytesPerSite: 10 * 1024 ** 3 });
	// Pro now carries a 7-day trial.
	deepEqual(server[0]!.freeTrial, { days: 7 });
}

// 7. parsePlanEntitlements: strings → numbers, ignore unknown, reject malformed.
{
	deepEqual(parsePlanEntitlements(null), {});
	deepEqual(parsePlanEntitlements({ sitesPerUser: "3", aiCredits: "500" }), { sitesPerUser: 3, aiCredits: 500 });
	// a real number is tolerated, not only strings
	deepEqual(parsePlanEntitlements({ customDomains: 2 }), { customDomains: 2 });
	// unknown keys ignored (a stray metadata entry can't widen anything)
	deepEqual(parsePlanEntitlements({ sitesPerUser: "1", whatever: "9" }), { sitesPerUser: 1 });
	// malformed values skipped (never silently 0)
	deepEqual(parsePlanEntitlements({ sitesPerUser: "abc", mediaBytesPerSite: "-5", aiCredits: "1.5" }), {});
	deepEqual(parsePlanEntitlements({ maxEntriesPerSite: "" }), {});
}

// 8. mergeEntitlements: per-subscription override wins per key; others preserved.
{
	const plan = parsePlanEntitlements({ sitesPerUser: "3", mediaBytesPerSite: "100", aiCredits: "500" });
	const sub = parsePlanEntitlements({ sitesPerUser: "50", aiCredits: "5000" }); // one enterprise's custom caps
	deepEqual(mergeEntitlements(plan, sub), { sitesPerUser: 50, mediaBytesPerSite: 100, aiCredits: 5000 });
}

console.log("billing-plans self-check: all 8 cases passed");
