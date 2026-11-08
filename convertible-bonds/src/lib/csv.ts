import type { Instrument, Snapshot } from "./types";

const COLUMNS: { key: keyof Instrument | "warnings"; header: string }[] = [
  { key: "recordId", header: "record_id" },
  { key: "quarantined", header: "quarantined" },
  { key: "cbCode", header: "cb_code" },
  { key: "shortName", header: "short_name" },
  { key: "issuerCode", header: "issuer_code" },
  { key: "issuerName", header: "issuer_name" },
  { key: "masterAsOf", header: "master_as_of" },
  { key: "issueDate", header: "issue_date" },
  { key: "listingDate", header: "listing_date" },
  { key: "maturityDate", header: "maturity_date" },
  { key: "conversionPeriodStart", header: "conversion_period_start" },
  { key: "conversionPeriodEnd", header: "conversion_period_end" },
  { key: "conversionPriceAtIssuanceRaw", header: "conversion_price_at_issuance_raw" },
  { key: "conversionPriceAtIssuance", header: "conversion_price_at_issuance" },
  { key: "effectiveConversionPrice", header: "effective_conversion_price" },
  { key: "effectiveConversionPriceDate", header: "effective_conversion_price_date" },
  { key: "cbClose", header: "cb_close" },
  { key: "cbQuoteDate", header: "cb_quote_date" },
  { key: "conversionValue", header: "conversion_value" },
  { key: "conversionPremium", header: "conversion_premium" },
  { key: "currencyCodeRaw", header: "currency_code_raw" },
  { key: "currency", header: "currency" },
  { key: "listingStatusRaw", header: "listing_status_raw" },
  { key: "guaranteedCodeRaw", header: "guaranteed_code_raw" },
  { key: "issueAmountRaw", header: "issue_amount_raw" },
  { key: "outstandingAmountRaw", header: "outstanding_amount_raw" },
  { key: "amountUnit", header: "amount_unit" },
  { key: "couponRateRaw", header: "coupon_rate_raw" },
  { key: "putOptionDate", header: "put_option_date" },
  { key: "putOptionPriceRaw", header: "put_option_price_raw" },
  { key: "putOptionPrice", header: "put_option_price" },
  { key: "conversionUnderlyingVerified", header: "conversion_underlying_verified" },
  { key: "sourceUrl", header: "master_source_url" },
  { key: "licenseUrl", header: "license_url" },
  { key: "warnings", header: "warnings" },
];

function cell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function equityCells(item: Instrument): string[] {
  const equity = item.issuerEquity;
  return [
    equity?.market ?? "",
    equity?.tradeDate ?? "",
    equity?.closeRaw ?? "",
    equity?.volumeSharesRaw ?? "",
    equity?.name ?? "",
    equity ? String(equity.nameMatchesIssuer) : "",
    item.revenue?.yearMonth ?? "",
    item.revenue?.momPct == null ? "" : String(item.revenue.momPct),
    item.margin?.tradeDate ?? "",
    item.margin?.tradeDateStatus ?? "",
    item.margin?.stockRedemptionRaw ?? "",
    item.margin?.quantityUnit ?? "",
  ];
}

export function snapshotToCsv(snapshot: Snapshot): string {
  const headers = [
    ...COLUMNS.map((column) => column.header),
    "issuer_equity_market",
    "issuer_equity_trade_date",
    "issuer_equity_close_raw",
    "issuer_equity_volume_shares_raw",
    "issuer_equity_name",
    "issuer_name_matches_equity",
    "revenue_year_month",
    "revenue_mom_pct",
    "margin_trade_date",
    "margin_trade_date_status",
    "margin_stock_redemption_raw",
    "margin_quantity_unit",
  ];
  const lines = [headers.join(",")];
  for (const item of snapshot.instruments) {
    const base = COLUMNS.map((column) => {
      if (column.key === "warnings") return cell(item.warnings.map((warning) => warning.code).join("|"));
      return cell(item[column.key]);
    });
    lines.push([...base, ...equityCells(item)].join(","));
  }
  return `\uFEFF${lines.join("\n")}\n`;
}
