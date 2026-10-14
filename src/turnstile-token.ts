/**
 * One-slot store for the current Cloudflare Turnstile token.
 *
 * The Better Auth UI forms submit through the auth client's fetch, which we cannot reach into to add a
 * field. So the widget (rendered in AuthView) stashes its token here, and the client's fetch wrapper
 * (client.ts) reads it and sends it as the `x-captcha-response` header on the captcha-protected
 * endpoints. Turnstile tokens are single-use, so the token is cleared once read; the widget refreshes
 * it on expiry and after each use.
 */
let token: string | null = null;

export function setTurnstileToken(value: string | null): void {
	token = value;
}

/** Returns the current token and clears it (tokens are single-use). */
export function takeTurnstileToken(): string | null {
	const t = token;
	token = null;
	return t;
}
