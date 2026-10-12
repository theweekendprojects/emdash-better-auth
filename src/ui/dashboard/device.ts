/** Browser and OS from a user-agent string. Small and good enough for "where am I signed in". */
export function describeDevice(ua?: string | null): { browser: string; os: string } {
	if (!ua) return { browser: "Unknown browser", os: "Unknown device" };
	const browser = /Edg(e|A|iOS)?\//.test(ua)
		? "Edge"
		: /OPR\/|Opera/.test(ua)
			? "Opera"
			: /Firefox\/|FxiOS\//.test(ua)
				? "Firefox"
				: /Chrome\/|CriOS\//.test(ua)
					? "Chrome"
					: /Safari\//.test(ua)
						? "Safari"
						: "Unknown browser";
	const os = /iPhone|iPad|iPod/.test(ua)
		? "iOS"
		: /Android/.test(ua)
			? "Android"
			: /Windows NT/.test(ua)
				? "Windows"
				: /Mac OS X|Macintosh/.test(ua)
					? "macOS"
					: /CrOS/.test(ua)
						? "ChromeOS"
						: /Linux/.test(ua)
							? "Linux"
							: "Unknown device";
	return { browser, os };
}
