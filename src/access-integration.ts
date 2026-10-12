/**
 * Astro integration: gates members-only and premium entries without any theme change.
 *
 * ```ts
 * // astro.config.mjs
 * import { betterAuthAccess } from "emdash-better-auth/access-integration";
 * export default defineConfig({ integrations: [emdash({ ... }), betterAuthAccess()] });
 * ```
 *
 * List it after `emdash()`. See ./access-middleware.ts for what it covers.
 */
import type { AstroIntegration } from "astro";
import { PACKAGE_NAME } from "./index.ts";

export function betterAuthAccess(): AstroIntegration {
	return {
		name: "emdash-better-auth:access",
		hooks: {
			"astro:config:setup": ({ addMiddleware }) => {
				// "post": after the site's own middleware, which may rewrite the request to a theme route.
				addMiddleware({ entrypoint: `${PACKAGE_NAME}/access-middleware`, order: "post" });
			},
		},
	};
}
