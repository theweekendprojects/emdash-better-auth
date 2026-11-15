/**
 * Checks the precompiled auth stylesheet: `node --no-warnings scripts/auth-css.selfcheck.ts`
 * (run after `pnpm run build:css`). Fails if the build left Tailwind directives behind, if a
 * relative font URL would break once shipped, or if a class the pages or HeroUI rely on is missing.
 */
import { readFileSync } from "node:fs";
import { ok } from "./assert.ts";

const css = readFileSync("dist/auth.css", "utf8");

ok(!css.includes("@import"), "no unresolved @import left in the compiled CSS");
ok(!css.includes("@source"), "no unresolved @source left in the compiled CSS");
ok(!/url\(/.test(css), "no url() refs (relative font paths would break when shipped)");
for (const cls of ["min-h-svh", "flex-col", "bg-background", "alert-dialog__dialog", "settings-bare", "admin-view"]) {
	ok(css.includes(cls), `compiled CSS contains .${cls}`);
}
console.log("auth-css self-check: all cases passed");
