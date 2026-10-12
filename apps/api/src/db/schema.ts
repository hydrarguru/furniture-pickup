import { REQUEST_STATUSES } from "@hamtning/shared";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

const statusList = sql.raw(REQUEST_STATUSES.map((s) => `'${s}'`).join(","));

export const employees = sqliteTable("employees", {
  id: text().primaryKey(),
  email: text().notNull().unique(),
  name: text().notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text({ enum: ["staff", "admin"] })
    .notNull()
    .default("staff"),
  createdAt: text("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  idHash: text("id_hash").primaryKey(),
  employeeId: text("employee_id")
    .notNull()
    .references(() => employees.id, { onDelete: "cascade" }),
  expiresAt: text("expires_at").notNull(),
});

export const requests = sqliteTable(
  "requests",
  {
    id: text().primaryKey(), // ULID
    status: text({ enum: REQUEST_STATUSES }).notNull().default("unverified"),
    name: text().notNull(),
    email: text().notNull(),
    phone: text().notNull(), // E.164
    street: text().notNull(),
    postcode: text().notNull(), // 5 digits
    city: text().notNull(),
    accessNotes: text("access_notes"),
    hasElevator: integer("has_elevator", { mode: "boolean" }),
    floor: integer(),
    message: text(),
    consentAt: text("consent_at").notNull(),
    verifiedAt: text("verified_at"),
    seenAt: text("seen_at"),
    tokenHash: text("token_hash").notNull(),
    tokenExpires: text("token_expires").notNull(),
    codeHash: text("code_hash"), // 6-digit fallback code
    confirmedStart: text("confirmed_start"),
    confirmedEnd: text("confirmed_end"),
    staffMessage: text("staff_message"),
    assignedTo: text("assigned_to").references(() => employees.id, { onDelete: "set null" }),
    closedAt: text("closed_at"), // purge at +30 days
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    check("requests_status_check", sql`${t.status} IN (${statusList})`),
    index("idx_requests_status_created").on(t.status, t.createdAt),
    index("idx_requests_closed_at").on(t.closedAt).where(sql`${t.closedAt} IS NOT NULL`),
    index("idx_requests_token_hash").on(t.tokenHash),
  ],
);

export const categories = sqliteTable("categories", {
  id: integer().primaryKey({ autoIncrement: true }),
  labelSv: text("label_sv").notNull().unique(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: integer({ mode: "boolean" }).notNull().default(true),
});

export const items = sqliteTable("items", {
  id: text().primaryKey(),
  requestId: text("request_id")
    .notNull()
    .references(() => requests.id, { onDelete: "cascade" }),
  title: text().notNull(),
  categoryId: integer("category_id").references(() => categories.id),
  description: text(),
  condition: text({ enum: ["good", "ok", "worn"] }),
  quantity: integer().notNull().default(1),
});

export const images = sqliteTable("images", {
  id: text().primaryKey(),
  requestId: text("request_id")
    .notNull()
    .references(() => requests.id, { onDelete: "cascade" }),
  itemId: text("item_id").references(() => items.id, { onDelete: "set null" }),
  s3Key: text("s3_key").notNull().unique(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  position: integer().notNull().default(0),
});

export const timeWindows = sqliteTable("time_windows", {
  id: text().primaryKey(),
  requestId: text("request_id")
    .notNull()
    .references(() => requests.id, { onDelete: "cascade" }),
  date: text().notNull(), // YYYY-MM-DD
  part: text({ enum: ["forenoon", "afternoon", "evening", "custom"] }).notNull(),
  fromTime: text("from_time"),
  toTime: text("to_time"),
  note: text(),
});

export const pendingUploads = sqliteTable("pending_uploads", {
  s3Key: text("s3_key").primaryKey(),
  expiresAt: text("expires_at").notNull(),
  ipHash: text("ip_hash"),
});

export const requestEvents = sqliteTable("request_events", {
  id: text().primaryKey(),
  requestId: text("request_id")
    .notNull()
    .references(() => requests.id, { onDelete: "cascade" }),
  employeeId: text("employee_id").references(() => employees.id, { onDelete: "set null" }),
  type: text({ enum: ["status_change", "note", "email_sent"] }).notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  note: text(),
  createdAt: text("created_at").notNull(),
});
