import { z } from "zod";
import { normalizePhone } from "./phone.js";
import { normalizePostcode } from "./postcode.js";

export const MAX_IMAGES = 8;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_TIME_WINDOWS = 3;
export const IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

const text = (max: number) => z.string().trim().max(max);
const requiredText = (max: number) => text(max).min(1, "Obligatoriskt fält");

export const postcodeSchema = z.string().transform((v, ctx) => {
  const n = normalizePostcode(v);
  if (!n) {
    ctx.addIssue({ code: "custom", message: "Ange ett giltigt postnummer (5 siffror)" });
    return z.NEVER;
  }
  return n;
});

export const phoneSchema = z.string().transform((v, ctx) => {
  const n = normalizePhone(v);
  if (!n) {
    ctx.addIssue({ code: "custom", message: "Ange ett giltigt telefonnummer" });
    return z.NEVER;
  }
  return n;
});

export const timeWindowSchema = z
  .object({
    date: z.iso.date(),
    part: z.enum(["forenoon", "afternoon", "evening", "custom"]),
    fromTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    toTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    note: text(200).optional(),
  })
  .refine((w) => w.part !== "custom" || (w.fromTime && w.toTime && w.fromTime < w.toTime), {
    message: "Ange en giltig från- och tilltid",
    path: ["fromTime"],
  });

export const itemSchema = z.object({
  title: requiredText(120),
  categoryId: z.number().int().positive().optional(),
  description: text(1000).optional(),
  condition: z.enum(["good", "ok", "worn"]).optional(),
  quantity: z.number().int().min(1).max(99).default(1),
});

export const createRequestSchema = z.object({
  name: requiredText(120),
  email: z
    .email()
    .max(254)
    .transform((e) => e.toLowerCase()),
  phone: phoneSchema,
  street: requiredText(160),
  postcode: postcodeSchema,
  city: requiredText(80),
  floor: z.number().int().min(-2).max(60).optional(),
  hasElevator: z.boolean().optional(),
  accessNotes: text(500).optional(),
  message: text(2000).optional(),
  items: z.array(itemSchema).min(1, "Lägg till minst ett föremål").max(30),
  /** S3 keys returned by /api/uploads/presign. At least one photo is required. */
  imageKeys: z.array(z.string().min(1).max(200)).min(1, "Minst ett foto krävs").max(MAX_IMAGES),
  timeWindows: z.array(timeWindowSchema).min(1, "Föreslå minst en tid").max(MAX_TIME_WINDOWS),
  consent: z.literal(true, { error: "Du måste godkänna hanteringen av personuppgifter" }),
  turnstileToken: z.string().min(1),
});
export type CreateRequestInput = z.input<typeof createRequestSchema>;
export type CreateRequest = z.output<typeof createRequestSchema>;

export const presignRequestSchema = z.object({
  files: z
    .array(
      z.object({
        contentType: z.enum(IMAGE_CONTENT_TYPES),
        size: z.number().int().positive().max(MAX_IMAGE_BYTES),
      }),
    )
    .min(1)
    .max(MAX_IMAGES),
});
