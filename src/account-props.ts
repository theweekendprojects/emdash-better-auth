/**
 * Props for the account island, shared by every page that renders it
 * (/account/*, /admin, /audit-log, /organization). One island means one sidebar
 * and one set of Better Auth UI plugins on every page.
 */
import { getSiteSettings } from "emdash";
import {
	accentColor,
	adminEnabled,
	apiKeyEnabled,
	auditLogEnabled,
	billingEnabled,
	configuredSocialProviders,
	deleteAccountEnabled,
	emailOtpEnabled,
	multiSessionEnabled,
	oidcProviderEnabled,
	orgEnabled,
	passkeyEnabled,
	planPriceIds,
	teamsEnabled,
	twoFactorEnabled,
} from "./providers.ts";

/** EmDash ADMIN role level (numeric RBAC: SUBSCRIBER=10 … ADMIN=50). */
export const ROLE_ADMIN = 50;

export async function accountProps(role: number | undefined) {
	// Every flag is its own settings read; run them together instead of one after another.
	const [siteSettings, accent, billing, social, twoFactor, org, teams, apiKey, passkey, oidc, audit, emailOtp, multiSession, admin, deleteAccount] =
		await Promise.all([
			getSiteSettings().catch(() => null),
			accentColor(),
			billingEnabled(),
			configuredSocialProviders(),
			twoFactorEnabled(),
			orgEnabled(),
			teamsEnabled(),
			apiKeyEnabled(),
			passkeyEnabled(),
			oidcProviderEnabled(),
			auditLogEnabled(),
			emailOtpEnabled(),
			multiSessionEnabled(),
			adminEnabled(),
			deleteAccountEnabled(),
		]);
	return {
		accent,
		props: {
			siteName: siteSettings?.title || "Account",
			tagline: siteSettings?.tagline ?? "",
			logoUrl: siteSettings?.logo?.url ?? null,
			socialProviders: social,
			twoFactorEnabled: twoFactor,
			orgEnabled: org,
			teamsEnabled: teams,
			apiKeyEnabled: apiKey,
			passkeyEnabled: passkey,
			billingEnabled: billing,
			oidcProviderEnabled: oidc,
			auditLogEnabled: audit,
			emailOtpEnabled: emailOtp,
			multiSessionEnabled: multiSession,
			planPriceIds: billing ? planPriceIds() : {},
			isEmdashAdmin: (role ?? 0) >= ROLE_ADMIN,
			adminEnabled: admin,
			deleteAccountEnabled: deleteAccount,
		},
	};
}
