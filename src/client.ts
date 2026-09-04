/**
 * Better-Auth browser client for the auth UI island.
 *
 * Points at the plugin's mounted handler (`/api/auth`, Better-Auth's default
 * basePath). `baseURL` is left to default to the current origin so the same
 * build works on any host/domain — the client resolves it from
 * `window.location` at runtime.
 */

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

export type AuthClient = typeof authClient;
