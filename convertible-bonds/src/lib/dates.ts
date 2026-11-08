export interface TaipeiParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
  isoDate: string;
  minutesOfDay: number;
}

export function taipeiParts(instant: Date): TaipeiParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const bag: Record<string, string> = {};
  for (const part of fmt.formatToParts(instant)) {
    if (part.type !== "literal") bag[part.type] = part.value;
  }
  const hour = bag.hour === "24" ? "00" : bag.hour;
  return {
    year: bag.year,
    month: bag.month,
    day: bag.day,
    hour,
    minute: bag.minute,
    second: bag.second,
    isoDate: `${bag.year}-${bag.month}-${bag.day}`,
    minutesOfDay: Number(hour) * 60 + Number(bag.minute),
  };
}

export function formatTaipeiIso(instant: Date): string {
  const p = taipeiParts(instant);
  return `${p.isoDate}T${p.hour}:${p.minute}:${p.second}+08:00`;
}

export function weekdaySun0(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isValidYmd(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return dt.getUTCFullYear() === year && dt.getUTCMonth() === month - 1 && dt.getUTCDate() === day;
}

export function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Gregorian YYYYMMDD or ROC yyyMMdd. Anything else stays unknown. */
export function parseRocOrGregorianDate(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!/^\d{7,8}$/.test(s)) return null;
  if (s.length === 8) {
    const year = Number(s.slice(0, 4));
    const month = Number(s.slice(4, 6));
    const day = Number(s.slice(6, 8));
    if (year < 1990 || year > 2100 || !isValidYmd(year, month, day)) return null;
    return isoDate(year, month, day);
  }
  const year = Number(s.slice(0, 3)) + 1911;
  const month = Number(s.slice(3, 5));
  const day = Number(s.slice(5, 7));
  if (!isValidYmd(year, month, day)) return null;
  return isoDate(year, month, day);
}

/** ROC year-month such as 11509 → 2026-09. This is not a day. */
export function parseRocYearMonth(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!/^\d{5}$/.test(s)) return null;
  const year = Number(s.slice(0, 3)) + 1911;
  const month = Number(s.slice(3, 5));
  if (month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Spoken time from the material-information files.
 * 64607 is 06:46:07, not 64,607 seconds. Pad to six digits.
 */
export function parseSpokenTime(raw: unknown): string | null {
  if (raw == null) return null;
  const digits = String(raw).trim();
  if (!/^\d{1,6}$/.test(digits)) return null;
  const padded = digits.padStart(6, "0");
  const hh = Number(padded.slice(0, 2));
  const mm = Number(padded.slice(2, 4));
  const ss = Number(padded.slice(4, 6));
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return `${padded.slice(0, 2)}:${padded.slice(2, 4)}:${padded.slice(4, 6)}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return isoDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
