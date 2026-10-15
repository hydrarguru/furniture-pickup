export const PICKUP_MIN_LEAD_DAYS = 2;
export const PICKUP_MAX_LEAD_DAYS = 60;

const stockholmDate = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
});

/** Today's date in Sweden as YYYY-MM-DD, regardless of the server's or browser's timezone. */
export const stockholmToday = (now = new Date()): string => stockholmDate.format(now);

/** Adds whole days to a YYYY-MM-DD date. */
export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Inclusive range of dates a user may propose for pickup. */
export function pickupDateRange(now = new Date()): {
  min: string;
  max: string;
} {
  const today = stockholmToday(now);
  return {
    min: addDays(today, PICKUP_MIN_LEAD_DAYS),
    max: addDays(today, PICKUP_MAX_LEAD_DAYS),
  };
}

/** Clock hours for the fixed parts of the day (Swedish local time). */
export const PART_HOURS = {
  forenoon: { from: "08:00", to: "12:00" },
  afternoon: { from: "12:00", to: "17:00" },
  evening: { from: "17:00", to: "20:00" },
} as const;

const stockholmParts = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Stockholm",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** Minutes Stockholm is ahead of UTC at the given instant (60 in winter, 120 in summer). */
function stockholmOffsetMinutes(instant: Date): number {
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(stockholmParts.formatToParts(instant).find((x) => x.type === type)?.value);
  const asUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
  );
  return Math.round((asUtc - Math.floor(instant.getTime() / 60000) * 60000) / 60000);
}

/** Swedish wall-clock date + time ("2026-10-20", "09:00") -> UTC ISO timestamp. Daylight Savings Time-aware. */
export function stockholmToUtcIso(date: string, time: string): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const [hours, minutes] = time.split(":").map(Number) as [number, number];
  const wall = Date.UTC(year, month - 1, day, hours, minutes);
  // Two passes settle the offset even right next to a DST switch.
  let utc = wall - stockholmOffsetMinutes(new Date(wall)) * 60000;
  utc = wall - stockholmOffsetMinutes(new Date(utc)) * 60000;
  return new Date(utc).toISOString();
}
