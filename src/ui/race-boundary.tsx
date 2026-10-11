import * as React from "react";

/**
 * Upstream race condition in @better-auth-ui/heroui (verified through 1.7.26):
 * the members / invitations tables add a leading checkbox COLUMN once the
 * "can delete" permission query resolves, but their loading placeholder row
 * always renders one cell fewer. If the permission answers BEFORE the list
 * does, HeroUI's Table throws "Cell count must match column count. Found 3
 * cells and 4 columns." and the whole page goes blank. Which request wins is
 * network timing, so it is intermittent in the wild (deterministic for us).
 *
 * Primary fix: client.ts orders the permission response after its sibling
 * requests so the race cannot happen. This boundary is only a safety net: it
 * catches exactly that error, remounts a few times, then shows a Reload button.
 * (Retrying alone is NOT enough - unmounting the table makes react-query abort
 * the in-flight member requests, so the data never lands.) Any OTHER error is
 * surfaced, not retried. Delete this once upstream fixes the skeleton row.
 */
const TRANSIENT_TABLE_ERROR = /Cell count must match column count/;

interface RetryBoundaryProps {
	children: React.ReactNode;
	/** Max remounts per failure streak (delay * retries = total patience). */
	maxRetries?: number;
	delayMs?: number;
}
interface RetryBoundaryState {
	failed: boolean;
	attempt: number;
	gaveUp: boolean;
	message: string;
}

export class TableRaceBoundary extends React.Component<RetryBoundaryProps, RetryBoundaryState> {
	state: RetryBoundaryState = { failed: false, attempt: 0, gaveUp: false, message: "" };
	private retryTimer: ReturnType<typeof setTimeout> | undefined;
	private stableTimer: ReturnType<typeof setTimeout> | undefined;

	static getDerivedStateFromError(error: Error): Partial<RetryBoundaryState> {
		return { failed: true, message: error?.message ?? "" };
	}

	componentDidCatch(error: Error) {
		clearTimeout(this.stableTimer);
		// Safety net only: the request-ordering fix in client.ts prevents the race.
		// If it ever slips through, retry a few times then offer a Reload button
		// (a long retry loop would just keep aborting the in-flight requests).
		const { maxRetries = 3, delayMs = 600 } = this.props;
		const transient = TRANSIENT_TABLE_ERROR.test(error?.message ?? "");
		if (!transient || this.state.attempt >= maxRetries) {
			this.setState({ gaveUp: true });
			return;
		}
		this.retryTimer = setTimeout(
			() => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 })),
			delayMs,
		);
	}

	componentDidUpdate() {
		// Rendered without throwing and stayed up: the race is over, so reset the
		// streak (a later org switch gets a fresh retry budget).
		if (!this.state.failed && this.state.attempt > 0) {
			clearTimeout(this.stableTimer);
			this.stableTimer = setTimeout(() => this.setState({ attempt: 0 }), 3000);
		}
	}

	componentWillUnmount() {
		clearTimeout(this.retryTimer);
		clearTimeout(this.stableTimer);
	}

	render() {
		if (this.state.failed) {
			if (this.state.gaveUp) {
				return (
					<div role="alert" className="text-center space-y-3">
						<p>Something went wrong loading this page.</p>
						<button type="button" className="underline" onClick={() => window.location.reload()}>
							Reload
						</button>
					</div>
				);
			}
			return (
				<p role="status" className="text-center text-muted">
					Loading…
				</p>
			);
		}
		// `key` forces a full remount on each retry so the table rebuilds.
		return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
	}
}
