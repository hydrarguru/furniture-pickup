export const PICKUP_MIN_LEAD_DAYS = 2;
export const PICKUP_MAX_LEAD_DAYS = 60;

const stockholmDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" });

/** Today's date in Sweden as YYYY-MM-DD, regardless of the server's or browser's timezone. */
export const stockholmToday = (now = new Date()): string => stockholmDate.format(now);

/** Adds whole days to a YYYY-MM-DD date. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Inclusive range of dates a user may propose for pickup. */
export function pickupDateRange(now = new Date()): { min: string; max: string } {
  const today = stockholmToday(now);
  return { min: addDays(today, PICKUP_MIN_LEAD_DAYS), max: addDays(today, PICKUP_MAX_LEAD_DAYS) };
}
