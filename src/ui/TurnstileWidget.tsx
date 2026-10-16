/**
 * Cloudflare Turnstile widget for Better Auth UI's official `captchaPlugin`.
 *
 * The plugin owns the request plumbing: it puts the token we hand to `setToken`
 * into the `x-captcha-response` header, and the sign-in / sign-up / forgot-password
 * forms call the function we register with `setReset` after a failed submit
 * (a Turnstile token is single-use and is spent even by a rejected request).
 * We only render the widget and wire its three callbacks. This replaces an earlier
 * hand-rolled fetch wrapper + module-level token store that never reset the widget,
 * which is why a failed first attempt left every later attempt with
 * "Missing CAPTCHA response" until a page reload.
 *
 * Standard pattern: https://better-auth-ui.com/docs/shadcn/plugins/captcha
 */
import type { CaptchaRenderProps } from "@better-auth-ui/react/plugins/captcha";
import { useTheme } from "next-themes";
import * as React from "react";

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

// biome-ignore lint/suspicious/noExplicitAny: the Turnstile global is injected by the script.
const api = () => (window as any).turnstile;

/** Load api.js once per page; resolves when `window.turnstile` is usable. */
let scriptPromise: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
	if (api()) return Promise.resolve();
	scriptPromise ??= new Promise<void>((resolve, reject) => {
		const existing = document.querySelector<HTMLScriptElement>('script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]');
		const s = existing ?? document.createElement("script");
		s.addEventListener("load", () => resolve());
		s.addEventListener("error", () => {
			scriptPromise = null; // allow a retry on the next mount
			reject(new Error("Turnstile failed to load"));
		});
		if (!existing) {
			s.src = TURNSTILE_SRC;
			s.async = true;
			s.defer = true;
			document.head.appendChild(s);
		} else if (api()) {
			resolve();
		}
	});
	return scriptPromise;
}

export function makeTurnstileWidget(siteKey: string) {
	return function TurnstileWidget({ setToken, clearToken, setReset }: CaptchaRenderProps) {
		const ref = React.useRef<HTMLDivElement>(null);
		// Match the page: next-themes may force light/dark, otherwise follow the OS.
		const { resolvedTheme } = useTheme();
		React.useEffect(() => {
			let widgetId: string | undefined;
			let cancelled = false;
			loadTurnstile()
				.then(() => {
					if (cancelled || !ref.current || !api()) return;
					widgetId = api().render(ref.current, {
						sitekey: siteKey,
						theme: resolvedTheme === "dark" ? "dark" : resolvedTheme === "light" ? "light" : "auto",
						callback: (token: string) => setToken(token),
						"expired-callback": () => clearToken(),
						"error-callback": () => clearToken(),
					});
					// The forms call this after a failed submit; it clears the spent token and
					// makes Turnstile issue a fresh one via `callback`.
					setReset(() => {
						try {
							if (widgetId && api()) api().reset(widgetId);
						} catch {
							// widget gone; nothing to reset
						}
					});
				})
				.catch(() => clearToken());
			return () => {
				cancelled = true;
				setReset(null);
				clearToken();
				try {
					if (widgetId && api()) api().remove(widgetId);
				} catch {
					// widget already gone
				}
			};
		}, [setToken, clearToken, setReset, resolvedTheme]);
		return <div ref={ref} className="flex w-full justify-center" />;
	};
}
