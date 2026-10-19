import { z } from "zod";
import type { RequestStatus } from "./statuses.js";

export const EMPLOYEE_ROLES = ["staff", "admin"] as const;
export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

export const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, "Ange användarnamn")
    .max(64)
    .transform((u) => u.toLowerCase()),
  password: z.string().min(1, "Ange lösenord").max(200),
});

/** Statuses staff can set. `unverified` and `cancelled` only come from the requester. */
export const STAFF_SETTABLE_STATUSES = [
  "new",
  "in_progress",
  "accepted",
  "on_the_way",
  "declined",
] as const;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Ange tid som TT:MM");

export const statusChangeSchema = z
  .object({
    status: z.enum(STAFF_SETTABLE_STATUSES),
    /** Shown to the requester on their status page (and emailed). */
    message: z.string().trim().max(2000).optional(),
    /** Required when accepting: the pickup time in Swedish local time. */
    confirmed: z
      .object({ date: z.iso.date(), fromTime: hhmm, toTime: hhmm })
      .refine((c) => c.fromTime < c.toTime, {
        message: "Från-tiden måste vara före till-tiden",
        path: ["fromTime"],
      })
      .optional(),
  })
  .refine((b) => b.status !== "accepted" || b.confirmed, {
    message: "Välj en hämtningstid",
    path: ["confirmed"],
  });
export type StatusChange = z.infer<typeof statusChangeSchema>;

export const noteSchema = z.object({
  note: z.string().trim().min(1).max(2000),
});

export const categoryCreateSchema = z.object({
  labelSv: z.string().trim().min(1, "Ange ett namn").max(60),
});
export const categoryUpdateSchema = z
  .object({
    labelSv: z.string().trim().min(1).max(60),
    active: z.boolean(),
  })
  .partial();

export interface Me {
  id: string;
  username: string;
  name: string;
  role: EmployeeRole;
}

export interface AdminRequestListItem {
  id: string;
  status: RequestStatus;
  name: string;
  city: string;
  postcode: string;
  createdAt: string;
  verifiedAt: string | null;
  seen: boolean;
  deleteAfter: string | null;
  itemSummary: string;
  itemCount: number;
  imageCount: number;
  thumbnailUrl: string | null;
}

export interface AdminRequestPage {
  requests: AdminRequestListItem[];
  nextCursor: string | null;
}

export interface AdminRequestDetail {
  id: string;
  status: RequestStatus;
  name: string;
  email: string;
  phone: string;
  street: string;
  postcode: string;
  city: string;
  floor: number | null;
  hasElevator: boolean | null;
  accessNotes: string | null;
  message: string | null;
  createdAt: string;
  verifiedAt: string | null;
  confirmedStart: string | null;
  confirmedEnd: string | null;
  staffMessage: string | null;
  deleteAfter: string | null;
  items: {
    id: string;
    title: string;
    category: string | null;
    condition: "good" | "ok" | "worn" | null;
    quantity: number;
    description: string | null;
  }[];
  images: { id: string; url: string }[];
  timeWindows: {
    id: string;
    date: string;
    part: "forenoon" | "afternoon" | "evening" | "custom";
    fromTime: string | null;
    toTime: string | null;
    note: string | null;
  }[];
  events: {
    id: string;
    type: "status_change" | "note" | "email_sent";
    fromStatus: RequestStatus | null;
    toStatus: RequestStatus | null;
    note: string | null;
    employeeName: string | null;
    createdAt: string;
  }[];
}

export type StatusCounts = Record<Exclude<RequestStatus, "unverified">, number>;

export interface NotificationSummary {
  unseenCount: number;
  counts: StatusCounts;
  latestUnseen: {
    id: string;
    name: string;
    city: string;
    verifiedAt: string;
  }[];
}

export interface AdminCategory {
  id: number;
  labelSv: string;
  active: boolean;
}

/** Swedish alphabetical order (Å, Ä, Ö after Z), ignoring case. */
export const compareSv = new Intl.Collator("sv", { sensitivity: "base" }).compare;

/**
 * A request the customer cancelled themselves. The request is deleted at once; only this
 * entry is kept, without name, contact details or photos, and it is deleted after 30 days.
 */
export interface AdminCancellation {
  id: string;
  reason: string;
  items: string;
  requestCreatedAt: string;
  cancelledAt: string;
}

/**
 * Where a pickup address is on the map. `area` means the street wasn't found and the point is
 * the middle of the postcode area.
 */
export interface GeoLocation {
  lat: number;
  lon: number;
  precision: "address" | "area";
}

export interface AdminRequestLocation {
  location: GeoLocation | null;
}
