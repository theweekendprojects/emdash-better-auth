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
	/**
	 * Resource caps for subscribers on this plan (sites, storage). Carried
	 * through to Stripe's plan `limits` and exposed for a host to enforce. The
	 * plugin itself never enforces these.
	 */
	limits?: PlanLimits;
}

/**
 * Price IDs for a plan, resolved at runtime from operator config. `month` is
 * required for a plan to be usable; `year` enables the annual toggle.
 */
export interface PlanPriceIds {
	month: string;
	year?: string;
}

/**
 * Per-plan resource limits, surfaced to the host so a hosting product can map a
 * subscription to how many sites / how much storage the customer gets. These
 * are the SAME keys the host's limit resolver understands (`sitesPerUser`,
 * `mediaBytesPerSite`, …); the plugin never enforces them itself (it has no
 * concept of "sites") — it only carries the numbers through to Stripe's plan
 * `limits` and exposes them for the host to read. Omit for a plan with no
 * resource caps (e.g. enterprise = negotiated out of band).
 */
export interface PlanLimits {
	/** Sites a subscriber on this plan may own. */
	sitesPerUser?: number;
	/** Media bytes one of their sites may hold. */
	mediaBytesPerSite?: number;
}

/** GiB in bytes, for readable storage caps below. */
const GiB = 1024 ** 3;

/** The built-in plan catalog (metadata only — no price IDs). Edit here to
 * change what plans exist; price IDs are supplied separately per environment.
 *
 * Tiers mirror a typical managed-hosting ladder (Kinsta-style): Pro for an
 * individual, Business for a small team, Agency for a shop running many client
 * sites, Enterprise for negotiated custom limits. The "free" tier is NOT a
 * Stripe plan — it's the absence of a subscription, so the host applies the
 * free limits as the baseline (see {@link FREE_PLAN_LIMITS}). */
export const PLAN_DEFINITIONS: readonly PlanDefinition[] = [
	{
		id: "pro",
		name: "Pro",
		description: "For individuals and creators shipping real work.",
		features: ["3 sites", "10 GB media per site", "7-day free trial", "Priority support"],
		highlighted: true,
		monthlyAmount: 2000,
		annualAmount: 19200,
		currency: "USD",
		trialDays: 7,
		limits: { sitesPerUser: 3, mediaBytesPerSite: 10 * GiB },
	},
	{
		id: "enterprise",
		name: "Enterprise",
		description: "Custom limits, SLA and support. Contact us.",
		features: ["Custom site limit", "Custom storage", "SLA + dedicated support"],
		// A high built-in ceiling so a subscribed enterprise customer is never
		// blocked by the generic guard; the REAL caps come from the metadata on
		// their manually-created Stripe subscription (negotiated per customer).
		monthlyAmount: 50000,
		annualAmount: 480000,
		currency: "USD",
		limits: { sitesPerUser: 1000, mediaBytesPerSite: 1000 * GiB },
	},
];

/**
 * Limits for a user with NO active subscription (the free tier). This is not a
 * Stripe plan — it's the baseline the host falls back to. Kept here next to the
 * paid catalog so the whole ladder reads in one place.
 */
export const FREE_PLAN_LIMITS: PlanLimits = { sitesPerUser: 1, mediaBytesPerSite: 1 * GiB };

/**
 * Resolve the resource limits for a plan id (e.g. the `plan` field of an active
 * Stripe subscription). Unknown/empty id → the free-tier baseline. Pure, so the
 * host can unit-test its mapping without the Stripe SDK.
 */
export function planLimits(planId: string | null | undefined): PlanLimits {
	if (!planId) return FREE_PLAN_LIMITS;
	const def = PLAN_DEFINITIONS.find((p) => p.id === planId.toLowerCase());
	return def?.limits ?? FREE_PLAN_LIMITS;
}

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
			...(def.limits
				? {
						limits: {
							...(def.limits.sitesPerUser !== undefined ? { sitesPerUser: def.limits.sitesPerUser } : {}),
							...(def.limits.mediaBytesPerSite !== undefined ? { mediaBytesPerSite: def.limits.mediaBytesPerSite } : {}),
						},
					}
				: {}),
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

/**
 * A subscriber's resolved entitlements, parsed from Stripe metadata (plan price
 * metadata, overridden by per-subscription metadata). All optional: a key absent
 * from the metadata is left undefined so the caller can fall back to a built-in
 * default or a lower tier. Two kinds live here:
 *   - CAPS: read-and-block (sites, storage, entries, custom domains).
 *   - ALLOWANCES: metered-and-reset per billing period (ai credits). The number
 *     here is only the monthly ALLOWANCE; the usage counter + reset live
 *     elsewhere (see emdash-plan/product/better-auth-stripe-features.md).
 * Feature-flag keys are intentionally NOT here yet (add when a feature reads one).
 */
export interface PlanEntitlements {
	/** Cap: sites a user may own. */
	sitesPerUser?: number;
	/** Cap: media bytes per site. */
	mediaBytesPerSite?: number;
	/** Cap: posts/entries per site (guards a huge import). */
	maxEntriesPerSite?: number;
	/** Cap: number of custom domains allowed. */
	customDomains?: number;
	/** Allowance: AI operations per billing period (metered + reset elsewhere). */
	aiCredits?: number;
}

/**
 * The numeric metadata keys we recognize, and the entitlement field each maps
 * to. Extending the platform's packages is a ONE-LINE change here (plus an
 * enforcement point for the new key) — after that a new plan or a changed value
 * is Stripe-metadata-only, no deploy. Unknown keys are ignored on purpose, so a
 * stray metadata entry can never widen a limit.
 */
const NUMERIC_ENTITLEMENT_KEYS = [
	"sitesPerUser",
	"mediaBytesPerSite",
	"maxEntriesPerSite",
	"customDomains",
	"aiCredits",
] as const;

/**
 * Parse a Stripe metadata record (values are always strings in Stripe) into a
 * typed {@link PlanEntitlements}. Only recognized keys are read; each must be a
 * finite, non-negative integer or it is skipped (a malformed value never
 * silently becomes 0, which could wrongly block or wrongly unlock). Pure and
 * dependency-free so it is unit-testable without Stripe.
 *
 * Merge order is the CALLER's job: parse the plan (price) metadata, then parse
 * the subscription metadata, then spread sub over price so a per-customer value
 * wins. This function parses ONE record.
 */
export function parsePlanEntitlements(
	metadata: Record<string, unknown> | null | undefined,
): PlanEntitlements {
	const out: PlanEntitlements = {};
	if (!metadata) return out;
	for (const key of NUMERIC_ENTITLEMENT_KEYS) {
		const raw = metadata[key];
		if (raw === undefined || raw === null || raw === "") continue;
		// Stripe stores strings; tolerate a real number too.
		const n = typeof raw === "number" ? raw : Number(String(raw).trim());
		if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) continue;
		out[key] = n;
	}
	return out;
}

/**
 * Merge two parsed entitlement objects, with `override` winning per key (a
 * per-subscription value over the plan default). A key absent from both stays
 * absent. Pure.
 */
export function mergeEntitlements(
	base: PlanEntitlements,
	override: PlanEntitlements,
): PlanEntitlements {
	return { ...base, ...override };
}
