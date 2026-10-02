/**
 * Single source of truth for subscription plans.
 *
 * The Stripe server plugin and the Better Auth UI billing plugin each want a
 * DIFFERENT plan shape:
 *   - server `StripePlan`:  { name, priceId, annualDiscountPriceId?, limits?, freeTrial? }
 *   - UI `BillingPlan`:     { id, name, description?, prices: [{ id, amount, currency, interval }], features?, highlighted? }
 *
 * We define each plan ONCE here (display metadata) and derive both shapes. The
 * actual Stripe price IDs are operator config, not code — they differ per
 * Stripe account and between test/live mode — so they're injected at runtime
 * from settings/env via {@link PlanPriceIds}. A plan with no resolved monthly
 * price id is dropped (can't check out without it), so the plugin degrades to
 * "no plans" rather than erroring when price ids aren't set yet.
 *
 * This module is dependency-free (plain data + two mappers) so it can be unit
 * tested without the Stripe SDK or Better Auth UI.
 */

/** Static, non-secret display metadata for one plan. */
export interface PlanDefinition {
	/** Stable plan id/name (lowercased by Stripe when stored). */
	id: string;
	/** Human label shown in the pricing UI. */
	name: string;
	/** One-line description for the pricing card. */
	description?: string;
	/** Bullet features for the pricing card. */
	features?: string[];
	/** Highlight this plan in the pricing UI (the "recommended" card). */
	highlighted?: boolean;
	/** Monthly price in the currency's smallest unit (e.g. 2000 = $20.00). Display only. */
	monthlyAmount: number;
	/** Annual price in smallest unit, when an annual option exists. Display only. */
	annualAmount?: number;
	/** ISO currency, default "USD". */
	currency?: string;
	/** Free-trial length in days, if any. */
	trialDays?: number;
}

/**
 * Price IDs for a plan, resolved at runtime from operator config. `month` is
 * required for a plan to be usable; `year` enables the annual toggle.
 */
export interface PlanPriceIds {
	month: string;
	year?: string;
}

/** The built-in plan catalog (metadata only — no price IDs). Edit here to
 * change what plans exist; price IDs are supplied separately per environment. */
export const PLAN_DEFINITIONS: readonly PlanDefinition[] = [
	{
		id: "pro",
		name: "Pro",
		description: "For individuals shipping real work.",
		features: ["Everything in Free", "Priority support"],
		highlighted: true,
		monthlyAmount: 2000,
		annualAmount: 19200,
		currency: "USD",
	},
];

/** Server-side Stripe plan shape (subset the @better-auth/stripe plugin reads). */
export interface StripePlanShape {
	name: string;
	priceId: string;
	annualDiscountPriceId?: string;
	limits?: Record<string, number>;
	freeTrial?: { days: number };
}

/** UI BillingPlan shape (subset Better Auth UI's billing adapter reads). */
export interface BillingPlanShape {
	id: string;
	name: string;
	description?: string;
	prices: Array<{ id: string; amount: number; currency: string; interval: "month" | "year" }>;
	features?: string[];
	highlighted?: boolean;
}

/**
 * Build the SERVER plan list for @better-auth/stripe from the catalog + a map
 * of plan id -> resolved price ids. Plans without a monthly price id are
 * dropped (unusable). Returns [] when nothing is configured.
 */
export function toStripePlans(
	defs: readonly PlanDefinition[],
	priceIds: Record<string, PlanPriceIds | undefined>,
): StripePlanShape[] {
	const out: StripePlanShape[] = [];
	for (const def of defs) {
		const ids = priceIds[def.id];
		if (!ids?.month) continue;
		out.push({
			name: def.id,
			priceId: ids.month,
			...(ids.year ? { annualDiscountPriceId: ids.year } : {}),
			...(def.trialDays ? { freeTrial: { days: def.trialDays } } : {}),
		});
	}
	return out;
}

/**
 * Build the UI BillingPlan list from the catalog + resolved price ids. A plan's
 * `prices` carries a month entry (required) and a year entry when configured.
 * Plans without a monthly price id are dropped.
 */
export function toBillingPlans(
	defs: readonly PlanDefinition[],
	priceIds: Record<string, PlanPriceIds | undefined>,
): BillingPlanShape[] {
	const out: BillingPlanShape[] = [];
	for (const def of defs) {
		const ids = priceIds[def.id];
		if (!ids?.month) continue;
		const currency = def.currency ?? "USD";
		const prices: BillingPlanShape["prices"] = [
			{ id: ids.month, amount: def.monthlyAmount, currency, interval: "month" },
		];
		if (ids.year && def.annualAmount !== undefined) {
			prices.push({ id: ids.year, amount: def.annualAmount, currency, interval: "year" });
		}
		out.push({
			id: def.id,
			name: def.name,
			...(def.description ? { description: def.description } : {}),
			prices,
			...(def.features ? { features: def.features } : {}),
			...(def.highlighted ? { highlighted: true } : {}),
		});
	}
	return out;
}
