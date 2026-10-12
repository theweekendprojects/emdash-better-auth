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
