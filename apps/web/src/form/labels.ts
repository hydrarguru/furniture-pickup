import type { RequestFormInput } from "@hamtning/shared";

type Part = RequestFormInput["timeWindows"][number]["part"];
type Condition = NonNullable<RequestFormInput["items"][number]["condition"]>;

export const PART_LABELS: Record<Part, string> = {
  forenoon: "Förmiddag",
  afternoon: "Eftermiddag",
  evening: "Kväll",
  custom: "Egen tid",
};

export const PART_HINTS: Record<Part, string> = {
  forenoon: "08–12",
  afternoon: "12–17",
  evening: "17–20",
  custom: "Ange från och till",
};

export const CONDITION_LABELS: Record<Condition, string> = {
  good: "Mycket bra",
  ok: "Bra",
  worn: "Sliten",
};

const dateFormat = new Intl.DateTimeFormat("sv-SE", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

/** "2026-10-20" -> "tisdag 20 oktober" */
export const formatDate = (isoDate: string) =>
  isoDate ? dateFormat.format(new Date(`${isoDate}T12:00:00`)) : "";
