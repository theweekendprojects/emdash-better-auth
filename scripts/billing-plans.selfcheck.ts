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

console.log("billing-plans self-check: all 4 cases passed");
