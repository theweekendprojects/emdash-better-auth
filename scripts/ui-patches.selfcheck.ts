/** Checks for the Better Auth UI source patch: `node --no-warnings scripts/ui-patches.selfcheck.ts` */
import { readdirSync, readFileSync } from "node:fs";
import { patchOrgProfile } from "../src/ui-patches.ts";

let failed = 0;
const check = (name: string, ok: boolean) => {
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
};
const sample = "v && T.reset({\n\t\t\tadditionalFields: f(l(m, v)),\n\t\t\tname: v.name,\n\t\t\tslug: v.slug\n\t\t});";
check("patches the profile reset", patchOrgProfile(sample)?.includes("}, { keepDefaultValues: true })") === true);
check("leaves other resets alone", patchOrgProfile("p.reset({ roles: x });") === null);
check("does not patch twice", patchOrgProfile(patchOrgProfile(sample) ?? "") === null);
// Against the real installed file, so an upstream change fails here instead of silently in production.
const dir = "node_modules/@better-auth-ui/heroui/dist";
const file = readdirSync(dir).find((f) => f.startsWith("organization-switcher") && f.endsWith(".js"));
check("matches the installed Better Auth UI", !!file && patchOrgProfile(readFileSync(`${dir}/${file}`, "utf8")) !== null);
process.exit(failed ? 1 : 0);
