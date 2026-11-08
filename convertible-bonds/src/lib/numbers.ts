const MISSING = new Set(["", "-", "--", "---", "X", "null", "NULL", "NaN"]);

export function blankToNull(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  return s === "" ? null : s;
}

/** Parse a source number. Empty and dashes are unknown, not zero. A literal 0 stays 0. */
export function parseSourceNumber(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/,/g, "").replace(/\s+/g, "");
  if (MISSING.has(s)) return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Prices of zero or below are not usable quotes. The raw string is kept separately. */
export function parsePositivePrice(raw: unknown): number | null {
  const n = parseSourceNumber(raw);
  if (n == null || n <= 0) return null;
  return n;
}

export function usableBondCode(raw: unknown): string | null {
  const s = blankToNull(raw);
  if (s == null) return null;
  if (s === "無" || s === "N/A" || s === "NA" || s === "n/a" || s === "-") return null;
  return s;
}

export function namesMatch(issuerName: string, equityName: string): boolean {
  const norm = (value: string) => value.trim().replace(/\*$/, "");
  return norm(issuerName) !== "" && norm(issuerName) === norm(equityName);
}

export function leadKind(text: string): "cb" | "conference" | "both" | "other" {
  const cb = /轉換公司債|可轉換公司債|交換公司債|可轉債/.test(text);
  const conference = /法人說明會|法說會/.test(text);
  if (cb && conference) return "both";
  if (cb) return "cb";
  if (conference) return "conference";
  return "other";
}

export function trimKeys(row: unknown): Record<string, unknown> {
  if (row == null || typeof row !== "object" || Array.isArray(row)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    out[key.trim()] = value;
  }
  return out;
}

export function hasTrimmedKeys(row: unknown, keys: string[]): boolean {
  const bag = trimKeys(row);
  return keys.every((key) => Object.prototype.hasOwnProperty.call(bag, key));
}
