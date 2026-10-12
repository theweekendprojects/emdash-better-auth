/**
 * Small data hooks for the dashboard pieces. Everything comes from the
 * existing Better Auth client; nothing here talks to a new endpoint.
 */
import { useQuery } from "@tanstack/react-query";
import { authClient } from "../../client.js";

export interface Entry {
	id: string;
	userId: string | null;
	action: string;
	status: "success" | "failed";
	createdAt: string;
}

// biome-ignore lint/suspicious/noExplicitAny: the client's plugin methods are typed per build; we only read plain data.
const c = authClient as any;
const data = <T,>(r: { data?: T | null } | undefined, fallback: T): T => r?.data ?? fallback;

export const useSessions = () =>
	useQuery({ queryKey: ["dash", "sessions"], queryFn: async () => data<unknown[]>(await c.listSessions(), []) });

export const useAccounts = () =>
	useQuery({ queryKey: ["dash", "accounts"], queryFn: async () => data<unknown[]>(await c.listAccounts(), []) });

export const useOrgs = (enabled: boolean) =>
	useQuery({
		queryKey: ["dash", "orgs"],
		enabled,
		queryFn: async () => data<Array<{ id: string; name: string; slug: string; logo?: string | null }>>(await c.organization.list(), []),
	});

export const useInvites = (enabled: boolean) =>
	useQuery({
		queryKey: ["dash", "invites"],
		enabled,
		queryFn: async () => data<Array<{ id: string; organizationName?: string; role?: string }>>(await c.organization.listUserInvitations(), []),
	});

/** Newest audit entries; the endpoint scopes to the session user (all users for admins). */
export const useAudit = (enabled: boolean, limit = 100) =>
	useQuery({
		queryKey: ["dash", "audit", limit],
		enabled,
		queryFn: async (): Promise<Entry[]> => {
			const res = await authClient.$fetch(`/audit-log/list?limit=${limit}&offset=0`, { method: "GET" });
			// Reads (list-/get-) would include the dashboard's own calls; show only real events.
			return ((res as { data?: { entries?: Entry[] } }).data?.entries ?? []).filter((e) => !/(^|:)(list|get)-/.test(e.action));
		},
	});

export interface AdminUser {
	id: string;
	name: string;
	email: string;
	image?: string | null;
	role?: string | null;
	banned?: boolean | null;
	emailVerified?: boolean | null;
	createdAt?: string | Date;
}

export const useUsers = (enabled: boolean, limit: number) =>
	useQuery({
		queryKey: ["dash", "users", limit],
		enabled,
		queryFn: async () => {
			const r = await c.admin.listUsers({ query: { limit, sortBy: "createdAt", sortDirection: "desc" } });
			if (r?.error) throw new Error(r.error.message ?? "denied");
			return { users: (r?.data?.users ?? []) as AdminUser[], total: (r?.data?.total ?? 0) as number };
		},
	});
