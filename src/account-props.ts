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
	const siteSettings = await getSiteSettings().catch(() => null);
	const billing = await billingEnabled();
	return {
		accent: await accentColor(),
		props: {
			siteName: siteSettings?.title || "Account",
			tagline: siteSettings?.tagline ?? "",
			logoUrl: siteSettings?.logo?.url ?? null,
			socialProviders: await configuredSocialProviders(),
			twoFactorEnabled: await twoFactorEnabled(),
			orgEnabled: await orgEnabled(),
			teamsEnabled: await teamsEnabled(),
			apiKeyEnabled: await apiKeyEnabled(),
			passkeyEnabled: await passkeyEnabled(),
			billingEnabled: billing,
			oidcProviderEnabled: await oidcProviderEnabled(),
			auditLogEnabled: await auditLogEnabled(),
			emailOtpEnabled: await emailOtpEnabled(),
			multiSessionEnabled: await multiSessionEnabled(),
			planPriceIds: billing ? planPriceIds() : {},
			isEmdashAdmin: (role ?? 0) >= ROLE_ADMIN,
			adminEnabled: await adminEnabled(),
		},
	};
}
