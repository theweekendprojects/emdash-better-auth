/**
 * Server-only helper: which social providers are configured at runtime.
 *
 * Reads the Worker env so the auth pages can show a provider's button only
 * when its credentials are actually set. Keeping this in its own module (that
 * imports `cloudflare:workers`) means the client island never pulls in the
 * Worker env binding.
 */

import { env } from "cloudflare:workers";

const GOOGLE_SECRET_PLACEHOLDER = "PASTE_YOUR_CLIENT_SECRET_HERE";

/**
 * Returns the list of social providers with valid credentials configured
 * (e.g. `["google"]`), for passing to the auth UI's `socialProviders` prop.
 */
export function configuredSocialProviders(): string[] {
	const workerEnv = env as Record<string, string | undefined>;
	const providers: string[] = [];

	const googleId = workerEnv.GOOGLE_CLIENT_ID;
	const googleSecret = workerEnv.GOOGLE_CLIENT_SECRET;
	if (googleId && googleSecret && googleSecret !== GOOGLE_SECRET_PLACEHOLDER) {
		providers.push("google");
	}

	return providers;
}
