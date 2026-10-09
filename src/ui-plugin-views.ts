import extraUiPlugins from "emdash-better-auth/ui-plugins";

type Section = "auth" | "settings" | "admin";

/**
 * View path segments contributed by the site's extra Better Auth UI plugins
 * (`viewPaths.<section>` on each plugin). The pages allow-list known views and
 * 404 the rest, so plugin views have to be let through explicitly.
 */
export function extraViews(section: Section): string[] {
	return extraUiPlugins.flatMap((plugin) => Object.values((plugin?.viewPaths?.[section] ?? {}) as Record<string, string>));
}
