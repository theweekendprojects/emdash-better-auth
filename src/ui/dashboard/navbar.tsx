/** Top bar. Port of the nextui-dashboard-template navbar (MIT) to HeroUI v3. */
import { Dropdown, SearchField } from "@heroui/react";
import * as React from "react";
import { FeedbackIcon } from "./icons/navbar/feedback-icon.js";
import { NotificationIcon } from "./icons/navbar/notificationicon.js";
import { SupportIcon } from "./icons/navbar/support-icon.js";
import { useLayout } from "./layout.js";

function BurgerButton() {
	const { toggle } = useLayout();
	return (
		<button
			type="button"
			aria-label="Menu"
			onClick={toggle}
			className="flex h-6 w-6 cursor-pointer flex-col justify-around border-none bg-transparent p-0 focus:outline-none [&_div]:h-px [&_div]:w-6 [&_div]:rounded-xl [&_div]:bg-foreground"
		>
			<div />
			<div />
		</button>
	);
}

function Notifications() {
	return (
		<Dropdown>
			<Dropdown.Trigger aria-label="Notifications" className="cursor-pointer bg-transparent p-0">
				<NotificationIcon />
			</Dropdown.Trigger>
			<Dropdown.Popover placement="bottom end">
				<Dropdown.Menu className="w-80" aria-label="Notifications">
					<Dropdown.Section>
						<Dropdown.Item id="none" isDisabled textValue="No notifications">
							<div className="flex flex-col py-2">
								<span className="text-base font-semibold">No notifications</span>
								<span className="text-sm text-muted">Updates about your account will show up here.</span>
							</div>
						</Dropdown.Item>
					</Dropdown.Section>
				</Dropdown.Menu>
			</Dropdown.Popover>
		</Dropdown>
	);
}

export function Navbar(props: {
	userMenu: React.ReactNode;
	feedbackUrl?: string;
	helpUrl?: string;
	children: React.ReactNode;
}) {
	const { query, setQuery } = useLayout();
	return (
		<div className="relative flex flex-1 flex-col overflow-x-hidden overflow-y-auto">
			<header className="sticky top-0 z-40 flex h-16 w-full items-center gap-4 border-b border-border bg-background/70 px-6 backdrop-blur-lg">
				<div className="md:hidden">
					<BurgerButton />
				</div>
				<div className="w-full max-md:hidden">
					<SearchField fullWidth aria-label="Search menu" value={query} onChange={setQuery}>
						<SearchField.Group>
							<SearchField.SearchIcon />
							<SearchField.Input placeholder="Search..." />
							<SearchField.ClearButton />
						</SearchField.Group>
					</SearchField>
				</div>
				<div className="ml-auto flex items-center gap-4">
					{props.feedbackUrl ? (
						<a href={props.feedbackUrl} className="flex items-center gap-2 text-foreground no-underline max-md:hidden">
							<FeedbackIcon />
							<span>Feedback?</span>
						</a>
					) : null}
					<Notifications />
					{props.helpUrl ? (
						<a href={props.helpUrl} aria-label="Help" className="max-md:hidden">
							<SupportIcon />
						</a>
					) : null}
					{props.userMenu}
				</div>
			</header>
			{props.children}
		</div>
	);
}
