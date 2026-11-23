/**
 * Source patches for Better Auth UI, applied by the Vite plugin in ./vite.ts.
 *
 * Organization profile form (Settings tab of /organization): the form is filled by
 * `form.reset({ name, slug })` once the organization has loaded, but on the next
 * re-render @tanstack/react-form (1.33.x) sees the hard-coded empty `defaultValues`
 * differ from the ones `reset` stored and resets the untouched form back to empty.
 * Result: Name and Slug show their placeholders. `keepDefaultValues` stops the
 * second reset. Remove when upstream fixes it (the patch simply stops matching).
 */
const ORG_PROFILE_RESET = /(\w+)\.reset\((\{\s*additionalFields:[^}]*?name:\s*\w+\.name,\s*slug:\s*\w+\.slug\s*\})\)/;

/** Returns the patched source, or null when this file has nothing to patch. */
export function patchOrgProfile(code: string): string | null {
	if (!ORG_PROFILE_RESET.test(code)) return null;
	return code.replace(ORG_PROFILE_RESET, "$1.reset($2, { keepDefaultValues: true })");
}

/**
 * Admin user sheet, Roles field (Better Auth UI 1.7.34, admin-*.js). A user with no
 * role (`role: null`) was shown the site's default role, and saving then called
 * set-role with it, so the default role got written onto a user who never had one.
 * Two edits, both only for the admin user sheet:
 *   1. The reset starts the Roles field empty when the user has no role.
 *   2. Save only sends set-role when a role is selected.
 * Remove when upstream fixes it (the patch stops matching). Upstream report:
 * https://github.com/better-auth-ui/better-auth-ui/issues/598
 */
const ADMIN_ROLES_RESET =
	/roles: (\w+)\((\w+)\?\.role, (\w+)\.defaultRole, (\w+)\.allowMultipleRoles\)(\s*\n\s*\}, \{ keepDefaultValues: !0 \}\);)/;
const ADMIN_ROLES_SAVE = /(\w+)\.data\?\.success && !(\w+) && t\.push\((\w+)\.mutateAsync\(\{\s*userId: (\w+)\.id,\s*role: (\w+)\(e\.roles\)/;
/** Returns the patched source, or null when this file has nothing to patch. */
export function patchAdminRoles(code: string): string | null {
	if (!ADMIN_ROLES_RESET.test(code) || !ADMIN_ROLES_SAVE.test(code)) return null;
	return code
		.replace(ADMIN_ROLES_RESET, "roles: $2?.role ? $1($2.role, $3.defaultRole, $4.allowMultipleRoles) : []$5")
		.replace(ADMIN_ROLES_SAVE, "$1.data?.success && !$2 && e.roles.length > 0 && t.push($3.mutateAsync({ userId: $4.id, role: $5(e.roles)");
}
