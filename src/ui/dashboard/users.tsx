/**
 * Users table, Accounts page and Add User dialog.
 * Port of the nextui-dashboard-template table/accounts (MIT) to HeroUI v3, fed by
 * the Better Auth admin API (admin role required; the server enforces it).
 *
 * A plain <table>: HeroUI v3's Table is a react-aria collection and throws when
 * server-rendered (see the note in AuditLogView.tsx).
 */
import { Avatar, Button, Chip, Input, Label, Modal, TextField, Tooltip } from "@heroui/react";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { authClient } from "../../client.js";
import { type AdminUser, useUsers } from "./data.js";
import { SkeletonRows } from "./skeletons.js";
import { DotsIcon } from "./icons/accounts/dots-icon.js";
import { ExportIcon } from "./icons/accounts/export-icon.js";
import { InfoIcon } from "./icons/accounts/info-icon.js";
import { TrashIcon } from "./icons/accounts/trash-icon.js";
import { HouseIcon } from "./icons/breadcrumb/house-icon.js";
import { UsersIcon } from "./icons/breadcrumb/users-icon.js";
import { SettingsIcon } from "./icons/sidebar/settings-icon.js";
import { DeleteIcon } from "./icons/table/delete-icon.js";
import { EditIcon } from "./icons/table/edit-icon.js";
import { EyeIcon } from "./icons/table/eye-icon.js";

// biome-ignore lint/suspicious/noExplicitAny: admin client methods are typed per build.
const admin = (authClient as any).admin;

const status = (u: AdminUser) => (u.banned ? "banned" : u.emailVerified ? "active" : "unverified");
const STATUS_COLOR = { active: "success", banned: "danger", unverified: "warning" } as const;

function IconButton(props: { label: string; onClick: () => void; children: React.ReactNode }) {
	return (
		<Tooltip>
			<Tooltip.Trigger>
				<button type="button" aria-label={props.label} onClick={props.onClick} className="cursor-pointer border-none bg-transparent p-0">
					{props.children}
				</button>
			</Tooltip.Trigger>
			<Tooltip.Content>{props.label}</Tooltip.Content>
		</Tooltip>
	);
}

export function UsersTable({ users, loading, denied }: { users: AdminUser[]; loading?: boolean; denied?: boolean }) {
	const qc = useQueryClient();
	const remove = async (u: AdminUser) => {
		if (!window.confirm(`Delete ${u.email}? This cannot be undone.`)) return;
		await admin.removeUser({ userId: u.id });
		await qc.invalidateQueries({ queryKey: ["dash", "users"] });
	};
	return (
		<div className="flex w-full flex-col gap-4">
			<div className="overflow-x-auto rounded-2xl bg-surface p-4 shadow-md">
				<table className="w-full min-w-[40rem] text-left text-sm">
					<thead>
						<tr className="text-xs uppercase text-muted">
							<th className="rounded-l-lg bg-default px-3 py-3 font-semibold">Name</th>
							<th className="bg-default px-3 py-3 font-semibold">Role</th>
							<th className="bg-default px-3 py-3 font-semibold">Status</th>
							<th className="rounded-r-lg bg-default px-3 py-3 text-center font-semibold">
								<span className="sr-only">Actions</span>
							</th>
						</tr>
					</thead>
					<tbody>
						{loading && users.length === 0 ? <SkeletonRows cols={4} rows={5} /> : null}
						{users.length === 0 && !loading ? (
							<tr>
								<td colSpan={4} className="px-3 py-6 text-center text-muted">
									{denied ? "You need an administrator account to see users." : "No users found."}
								</td>
							</tr>
						) : null}
						{users.map((u) => {
							const s = status(u);
							return (
								<tr key={u.id}>
									<td className="px-3 py-3">
										<div className="flex items-center gap-3">
											<Avatar size="sm">
												{u.image ? <Avatar.Image src={u.image} alt="" /> : null}
												<Avatar.Fallback>{(u.name || u.email).slice(0, 1).toUpperCase()}</Avatar.Fallback>
											</Avatar>
											<div className="flex flex-col">
												<span className="font-medium text-foreground">{u.name || u.email}</span>
												<span className="text-xs text-muted">{u.email}</span>
											</div>
										</div>
									</td>
									<td className="px-3 py-3 capitalize">{u.role ?? "user"}</td>
									<td className="px-3 py-3">
										<Chip size="sm" variant="soft" color={STATUS_COLOR[s]}>
											<span className="text-xs capitalize">{s}</span>
										</Chip>
									</td>
									<td className="px-3 py-3">
										<div className="flex items-center justify-center gap-4">
											<IconButton label="Details" onClick={() => window.location.assign("/admin")}>
												<EyeIcon size={20} fill="#979797" />
											</IconButton>
											<IconButton label="Edit user" onClick={() => window.location.assign("/admin")}>
												<EditIcon size={20} fill="#979797" />
											</IconButton>
											<IconButton label="Delete user" onClick={() => remove(u)}>
												<DeleteIcon size={20} fill="#FF0080" />
											</IconButton>
										</div>
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function AddUser() {
	const qc = useQueryClient();
	const [open, setOpen] = React.useState(false);
	const [error, setError] = React.useState("");
	const [busy, setBusy] = React.useState(false);
	const submit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		const f = new FormData(e.currentTarget);
		const password = String(f.get("password"));
		if (password !== String(f.get("confirm"))) return setError("Passwords do not match.");
		setBusy(true);
		setError("");
		const r = await admin.createUser({ email: String(f.get("email")), name: String(f.get("name")), password, role: "user" });
		setBusy(false);
		if (r?.error) return setError(r.error.message ?? "Could not add the user.");
		await qc.invalidateQueries({ queryKey: ["dash", "users"] });
		setOpen(false);
	};
	return (
		<Modal state={{ isOpen: open, setOpen, open: () => setOpen(true), close: () => setOpen(false), toggle: () => setOpen((o) => !o) }}>
			<Button variant="primary" onPress={() => setOpen(true)}>
				Add User
			</Button>
			<Modal.Backdrop>
				<Modal.Container placement="top">
					<Modal.Dialog>
						<form onSubmit={submit}>
							<Modal.Header>
								<Modal.Heading>Add User</Modal.Heading>
							</Modal.Header>
							<Modal.Body className="flex flex-col gap-3">
								{[
									["email", "Email", "email"],
									["name", "Name", "text"],
									["password", "Password", "password"],
									["confirm", "Confirm Password", "password"],
								].map(([name, label, type]) => (
									<TextField key={name} name={name} type={type} isRequired fullWidth autoComplete={type === "password" ? "new-password" : "off"}>
										<Label>{label}</Label>
										<Input variant="secondary" />
									</TextField>
								))}
								{error ? (
									<p role="alert" className="text-sm text-danger">
										{error}
									</p>
								) : null}
							</Modal.Body>
							<Modal.Footer>
								<Button variant="danger-soft" onPress={() => setOpen(false)}>
									Close
								</Button>
								<Button variant="primary" type="submit" isDisabled={busy}>
									Add User
								</Button>
							</Modal.Footer>
						</form>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}

/** CSV with the columns the table shows. Quotes doubled, so commas in names are safe. */
function toCsv(users: AdminUser[]) {
	const q = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
	return [["name", "email", "role", "status"], ...users.map((u) => [u.name, u.email, u.role ?? "user", status(u)])].map((r) => r.map(q).join(",")).join("\n");
}

export function Accounts() {
	const users = useUsers(true, 100);
	const [search, setSearch] = React.useState("");
	const list = (users.data?.users ?? []).filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(search.trim().toLowerCase()));
	const exportCsv = () => {
		const a = document.createElement("a");
		a.href = URL.createObjectURL(new Blob([toCsv(list)], { type: "text/csv" }));
		a.download = "users.csv";
		a.click();
		URL.revokeObjectURL(a.href);
	};
	return (
		<div className="mx-auto my-10 flex w-full max-w-[95rem] flex-col gap-4 px-4 lg:px-6">
			<ul className="flex">
				<li className="flex gap-2">
					<HouseIcon />
					<a href="/account/home" className="text-foreground no-underline">
						<span>Home</span>
					</a>
					<span aria-hidden="true" className="px-1 text-muted">/</span>
				</li>
				<li className="flex gap-2">
					<UsersIcon />
					<span>Users</span>
					<span aria-hidden="true" className="px-1 text-muted">/</span>
				</li>
				<li className="flex gap-2">
					<span>List</span>
				</li>
			</ul>
			<h1 className="text-xl font-semibold">All Accounts</h1>
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div className="flex flex-wrap items-center gap-3 md:flex-nowrap">
					<TextField aria-label="Search users" value={search} onChange={setSearch}>
						<Input placeholder="Search users" variant="secondary" />
					</TextField>
					<SettingsIcon />
					<TrashIcon />
					<InfoIcon />
					<DotsIcon />
				</div>
				<div className="flex flex-row flex-wrap gap-3.5">
					<AddUser />
					<Button variant="primary" onPress={exportCsv}>
						<ExportIcon /> Export to CSV
					</Button>
				</div>
			</div>
			<div className="mx-auto w-full max-w-[95rem]">
				<UsersTable users={list} loading={users.isLoading} denied={users.isError} />
			</div>
		</div>
	);
}
