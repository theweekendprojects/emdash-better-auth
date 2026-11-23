/** Checks for the Better Auth UI source patches: `node --no-warnings scripts/ui-patches.selfcheck.ts` */
import { readdirSync, readFileSync } from "node:fs";
import { patchAdminRoles, patchOrgProfile } from "../src/ui-patches.ts";
let failed = 0;
const check = (name: string, ok: boolean) => {
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
};
const sample = "v && T.reset({\n\t\t\tadditionalFields: f(l(m, v)),\n\t\t\tname: v.name,\n\t\t\tslug: v.slug\n\t\t});";
check("patches the profile reset", patchOrgProfile(sample)?.includes("}, { keepDefaultValues: true })") === true);
check("leaves other resets alone", patchOrgProfile("p.reset({ roles: x });") === null);
check("does not patch twice", patchOrgProfile(patchOrgProfile(sample) ?? "") === null);

// Admin Roles patch, shaped like the 1.7.34 user sheet (reset and save).
const adminSample = [
	"$.reset({",
	"\t\t\tname: Z?.name ?? \"\",",
	"\t\t\troles: Ne(Z?.role, j.defaultRole, j.allowMultipleRoles)",
	"\t\t}, { keepDefaultValues: !0 });",
	"W.data?.success && !Q && t.push(Ye.mutateAsync({",
	"\t\t\t\tuserId: Z.id,",
	"\t\t\t\trole: Me(e.roles)",
	"\t\t\t}));",
].join("\n");
const patchedAdmin = patchAdminRoles(adminSample) ?? "";
check("admin: empty roles when the user has no role", patchedAdmin.includes("roles: Z?.role ? Ne(Z.role, j.defaultRole, j.allowMultipleRoles) : []"));
check("admin: set-role only when a role is selected", patchedAdmin.includes("!Q && e.roles.length > 0 && t.push(Ye.mutateAsync({ userId: Z.id, role: Me(e.roles)"));
check("admin: leaves unrelated files alone", patchAdminRoles("p.reset({ roles: x });") === null);
check("admin: does not patch twice", patchAdminRoles(patchedAdmin) === null);

// Against the real installed files, so an upstream change fails here instead of silently in production.
const dir = "node_modules/@better-auth-ui/heroui/dist";
const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
const orgFile = files.find((f) => f.startsWith("organization-switcher"));
check("org patch matches the installed Better Auth UI", !!orgFile && patchOrgProfile(readFileSync(`${dir}/${orgFile}`, "utf8")) !== null);
const adminFile = files.find((f) => f.startsWith("admin-") && patchAdminRoles(readFileSync(`${dir}/${f}`, "utf8")) !== null);
check("admin roles patch matches the installed Better Auth UI", !!adminFile);
process.exit(failed ? 1 : 0);
