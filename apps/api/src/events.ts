import { EventEmitter } from "node:events";

/** In-process events. The admin notification stream (milestone 5) subscribes to these. */
export interface AppEvents {
  "request.verified": [{ id: string }];
}

export class AppEventBus extends EventEmitter<AppEvents> {}
