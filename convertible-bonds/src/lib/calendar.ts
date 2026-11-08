import { addDays, parseRocOrGregorianDate, taipeiParts, weekdaySun0 } from "./dates";

export interface HolidayInput {
  Name?: string;
  Date?: string;
  Description?: string | null;
}

export type DayStatus = "open" | "closed" | "unknown";

export function classifyHolidayText(name: string, description: string | null | undefined): DayStatus {
  const text = `${name} ${description ?? ""}`.replace(/<br\s*\/?>/gi, " ");
  const opens = text.includes("開始交易") || text.includes("最後交易");
  const closes = text.includes("無交易") || text.includes("放假") || text.includes("補假");
  if (opens && closes) return "unknown";
  if (opens) return "open";
  if (closes) return "closed";
  return "unknown";
}

export interface Calendar {
  status: "loaded" | "unavailable";
  isTradingDay(isoDate: string): DayStatus;
  previousTradingDay(isoDate: string): string | null;
}

export function createCalendar(rows: HolidayInput[] | null): Calendar {
  if (rows == null) {
    return {
      status: "unavailable",
      isTradingDay: () => "unknown",
      previousTradingDay: () => null,
    };
  }
  const byDate = new Map<string, DayStatus>();
  const years = new Set<number>();
  for (const row of rows) {
    const iso = parseRocOrGregorianDate(row.Date);
    if (!iso) continue;
    years.add(Number(iso.slice(0, 4)));
    const kind = classifyHolidayText(String(row.Name ?? ""), row.Description ?? null);
    const prev = byDate.get(iso);
    byDate.set(iso, prev && prev !== kind ? "unknown" : kind);
  }
  const isTradingDay = (isoDate: string): DayStatus => {
    const year = Number(isoDate.slice(0, 4));
    if (!years.has(year)) return "unknown";
    const marked = byDate.get(isoDate);
    if (marked === "unknown") return "unknown";
    if (marked === "open") return "open";
    if (marked === "closed") return "closed";
    const dow = weekdaySun0(isoDate);
    if (dow === 0 || dow === 6) return "closed";
    return "open";
  };
  return {
    status: "loaded",
    isTradingDay,
    previousTradingDay(isoDate: string): string | null {
      let cursor = isoDate;
      for (let i = 0; i < 20; i += 1) {
        cursor = addDays(cursor, -1);
        const status = isTradingDay(cursor);
        if (status === "open") return cursor;
        if (status === "unknown") return null;
      }
      return null;
    },
  };
}

export const EQUITY_CLOSE_MINUTES = 18 * 60;

export interface ExpectedSession {
  date: string | null;
  phase: "due" | "not_yet_due" | "calendar_unknown";
}

export function expectedEquitySession(now: Date, calendar: Calendar): ExpectedSession {
  const parts = taipeiParts(now);
  const today = calendar.isTradingDay(parts.isoDate);
  if (today === "unknown" || calendar.status === "unavailable") {
    return { date: null, phase: "calendar_unknown" };
  }
  if (today === "open" && parts.minutesOfDay >= EQUITY_CLOSE_MINUTES) {
    return { date: parts.isoDate, phase: "due" };
  }
  const previous = calendar.previousTradingDay(parts.isoDate);
  if (previous == null) return { date: null, phase: "calendar_unknown" };
  return { date: previous, phase: today === "open" ? "not_yet_due" : "due" };
}

export function assessEquityFreshness(input: {
  now: Date;
  calendar: Calendar;
  observedDate: string | null;
}): {
  status: "fresh" | "pending" | "not_yet_due" | "calendar_unknown" | "missing";
  expectedDate: string | null;
  phase: ExpectedSession["phase"];
} {
  const expected = expectedEquitySession(input.now, input.calendar);
  if (expected.phase === "calendar_unknown") {
    return { status: "calendar_unknown", expectedDate: null, phase: "calendar_unknown" };
  }
  if (input.observedDate == null) {
    return { status: "missing", expectedDate: expected.date, phase: expected.phase };
  }
  if (input.observedDate > expected.date!) {
    return { status: "fresh", expectedDate: expected.date, phase: expected.phase };
  }
  if (input.observedDate === expected.date) {
    return {
      status: expected.phase === "not_yet_due" ? "not_yet_due" : "fresh",
      expectedDate: expected.date,
      phase: expected.phase,
    };
  }
  return { status: "pending", expectedDate: expected.date, phase: expected.phase };
}
