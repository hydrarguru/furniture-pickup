import { EventEmitter } from "node:events";

/** In-process events. The admin notification stream (milestone 5) subscribes to these. */
export interface AppEvents {
  "request.verified": [{ id: string }];
  /** An employee opened the request for the first time. */
  "request.seen": [{ id: string }];
  /** Status or other staff-visible data changed. */
  "request.changed": [{ id: string }];
  /** The requester cancelled and the request was deleted. */
  "request.cancelled": [{ id: string; visibleToStaff: boolean }];
  /** The retention job deleted one or more requests. */
  "requests.purged": [{ count: number }];
}

export class AppEventBus extends EventEmitter<AppEvents> {}
