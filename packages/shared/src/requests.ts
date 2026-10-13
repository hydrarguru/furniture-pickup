import { z } from "zod";
import type { RequestStatus } from "./statuses.js";

/** 32 random bytes, base64url without padding. Sent only by email; proves ownership of the address. */
export const requestTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Ogiltig länk");

/** What the requester sees on their private status page. Never contains internal staff notes. */
export interface RequestStatusView {
  status: RequestStatus;
  createdAt: string;
  items: { title: string; quantity: number }[];
  timeWindows: {
    date: string;
    part: "forenoon" | "afternoon" | "evening" | "custom";
    fromTime: string | null;
    toTime: string | null;
  }[];
  imageCount: number;
  confirmedStart: string | null;
  confirmedEnd: string | null;
  /** Message from staff on accept/decline. */
  staffMessage: string | null;
  /** Set for closed requests: when the request and its photos are deleted. */
  deleteAfter: string | null;
  canCancel: boolean;
  /**
   * When the request reached each step on its way to the current status, oldest first.
   * Only statuses and times: staff notes and names are never included.
   */
  timeline: { status: RequestStatus; at: string }[];
}

/** Statuses from which the requester may still cancel. */
export const CANCELLABLE_STATUSES = [
  "unverified",
  "new",
  "in_progress",
  "accepted",
  "on_the_way",
] as const satisfies readonly RequestStatus[];
