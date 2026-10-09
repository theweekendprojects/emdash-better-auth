/**
 * Vite plugin that lets a site add Better Auth UI plugins (settings tabs,
 * avatar-menu items) to every view this package renders.
 *
 * ```ts
 * // astro.config.mjs
 * import { betterAuthUi } from "emdash-better-auth/vite";
 * export default defineConfig({
 *   vite: { plugins: [betterAuthUi({ plugins: "./src/better-auth-ui.ts" })] },
 * });
 * ```
 *
 * `./src/better-auth-ui.ts` default-exports an array of Better Auth UI plugins.
 * Sites that do not use this keep the empty default list, with no change.
 */
import { resolve } from "node:path";
import type { Plugin } from "vite";

export interface BetterAuthUiOptions {
	/** Module whose default export is an array of Better Auth UI plugins. Path (relative to the project root) or package specifier. */
	plugins: string;
}

export function betterAuthUi(options: BetterAuthUiOptions): Plugin {
	const target = /^\.{0,2}\//.test(options.plugins) ? resolve(process.cwd(), options.plugins) : options.plugins;
	return {
		name: "emdash-better-auth:ui-plugins",
		enforce: "pre",
		config: () => ({
			resolve: { alias: [{ find: /^emdash-better-auth\/ui-plugins$/, replacement: target }] },
		}),
	};
}
