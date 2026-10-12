/** Checks for the user-agent parser: `node --no-warnings scripts/device.selfcheck.ts` */
import { describeDevice } from "../src/ui/dashboard/device.ts";

let failed = 0;
const check = (name: string, got: unknown, want: unknown) => {
	const ok = JSON.stringify(got) === JSON.stringify(want);
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : ` got ${JSON.stringify(got)}`}`);
};
check("Chrome on Mac", describeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36"), { browser: "Chrome", os: "macOS" });
check("Safari on iPhone", describeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"), { browser: "Safari", os: "iOS" });
check("Edge on Windows (not Chrome)", describeDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0"), { browser: "Edge", os: "Windows" });
check("Firefox on Linux", describeDevice("Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0"), { browser: "Firefox", os: "Linux" });
check("Chrome on Android (not Linux)", describeDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"), { browser: "Chrome", os: "Android" });
check("missing", describeDevice(null), { browser: "Unknown browser", os: "Unknown device" });
process.exit(failed ? 1 : 0);
