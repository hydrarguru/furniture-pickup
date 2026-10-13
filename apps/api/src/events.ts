import { EventEmitter } from "node:events";

/** In-process events. The admin notification stream (milestone 5) subscribes to these. */
export interface AppEvents {
  "request.verified": [{ id: string }];
  /** An employee opened the request for the first time. */
  "request.seen": [{ id: string }];
  /** Status or other staff-visible data changed. */
  "request.changed": [{ id: string }];
}

export class AppEventBus extends EventEmitter<AppEvents> {}
