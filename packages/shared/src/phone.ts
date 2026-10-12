/** Normalizes common Swedish phone formats to E.164 (+46...). Returns null if implausible. */
export function normalizePhone(input: string): string | null {
  let s = input.replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (s.startsWith("0") && !s.startsWith("00")) s = `+46${s.slice(1)}`;
  if (!/^\+\d{8,15}$/.test(s)) return null;
  return s;
}
