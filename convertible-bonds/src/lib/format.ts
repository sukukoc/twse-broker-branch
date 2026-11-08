export function formatNumber(value: number | null | undefined, digits = 4): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat("zh-Hant-TW", { maximumFractionDigits: digits }).format(value);
}

export function formatShares(value: number | null | undefined): string | null {
  const text = formatNumber(value, 0);
  return text == null ? null : `${text} 股`;
}

export function formatPercentPoints(value: number | null | undefined): string | null {
  const text = formatNumber(value, 2);
  return text == null ? null : `${text}%`;
}
