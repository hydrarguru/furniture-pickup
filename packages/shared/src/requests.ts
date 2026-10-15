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

export const CANCELLABLE_STATUSES = [
  "unverified",
  "new",
] as const satisfies readonly RequestStatus[];

/** Statuses where the store is working on the pickup, so changes go through a phone call. */
export const CALL_TO_CANCEL_STATUSES = [
  "in_progress",
  "accepted",
  "on_the_way",
] as const satisfies readonly RequestStatus[];

export const CANCEL_REASON_MAX = 500;

export const cancelRequestSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(3, "Berätta kort varför du avbokar")
    .max(CANCEL_REASON_MAX, `Högst ${CANCEL_REASON_MAX} tecken`),
});
export type CancelRequestInput = z.infer<typeof cancelRequestSchema>;
