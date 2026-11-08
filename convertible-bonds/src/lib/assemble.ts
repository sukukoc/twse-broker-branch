import { createHash } from "node:crypto";
import { assessEquityFreshness, createCalendar, type HolidayInput } from "./calendar";
import { formatTaipeiIso, parseRocOrGregorianDate, parseRocYearMonth, parseSpokenTime } from "./dates";
import { conversionValuePer100, marketConversionPremium } from "./formulas";
import {
  blankToNull,
  hasTrimmedKeys,
  leadKind,
  namesMatch,
  parsePositivePrice,
  parseSourceNumber,
  trimKeys,
  usableBondCode,
} from "./numbers";
import { BLOCKED_CB_DAILY_QUOTE, FETCHABLE_SOURCES, LICENSE_URL, sourceById } from "./sources";
import type {
  EventItem,
  Instrument,
  IssuerEquity,
  MarginObservation,
  RevenueObservation,
  Snapshot,
  SourceId,
  SourceStatus,
  WarningItem,
} from "./types";

export interface SourcePayload {
  ok: boolean;
  rows: unknown[];
  error: string | null;
  fetchedAt: string | null;
  httpStatus: number | null;
  sha256: string | null;
  finalUrl: string | null;
}

export interface StockBar {
  market: "TWSE" | "TPEx";
  code: string;
  name: string;
  tradeDate: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  closeRaw: string;
  volumeShares: number | null;
  volumeSharesRaw: string;
  turnoverRaw: string;
  transactions: number | null;
  sourceUrl: string;
  fetchedAt: string | null;
}

export interface BuildInput {
  now: Date;
  payloads: Partial<Record<SourceId, SourcePayload>>;
  previous: Snapshot | null;
  previousBars: StockBar[];
  schedulingEnabled?: boolean;
}

export interface BuildResult {
  snapshot: Snapshot;
  publishInstruments: boolean;
  persistBars: boolean;
  stockBars: StockBar[];
  verifiedFailures: string[];
}

const SHRINK_RATIO = 0.5;

function warn(code: string, message: string): WarningItem {
  return { code, message };
}

function hashId(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

function payload(input: BuildInput, id: SourceId): SourcePayload {
  return (
    input.payloads[id] ?? {
      ok: false,
      rows: [],
      error: "未提供",
      fetchedAt: null,
      httpStatus: null,
      sha256: null,
      finalUrl: null,
    }
  );
}

function rejectReason(input: BuildInput, id: SourceId): string | null {
  const body = payload(input, id);
  const def = sourceById(id);
  if (!body.ok) return body.error ?? "讀取失敗";
  if (!Array.isArray(body.rows) || body.rows.length === 0) return "空表，不視為市場已清空";
  if (!hasTrimmedKeys(body.rows[0], def.requiredKeys)) return "回應缺少規格欄位";
  const previousCount = input.previous?.sources.find((item) => item.id === id)?.rowCount;
  if (previousCount != null && previousCount > 0 && body.rows.length < previousCount * SHRINK_RATIO) {
    return `列數由 ${previousCount} 降到 ${body.rows.length}，低於一半，先保留上次結果`;
  }
  return null;
}

function uniqueField(rows: unknown[], field: string): string | null {
  const values = new Set<string>();
  for (const row of rows) {
    const bag = trimKeys(row);
    const iso = field === "資料年月" ? parseRocYearMonth(bag[field]) : parseRocOrGregorianDate(bag[field]);
    if (iso) values.add(iso);
  }
  if (values.size === 1) return [...values][0];
  return null;
}

function indexBy(rows: unknown[], codeField: string): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const bag = trimKeys(row);
    const code = blankToNull(bag[codeField]);
    if (code && !map.has(code)) map.set(code, bag);
  }
  return map;
}

function toEquity(bar: StockBar, issuerName: string, carriedForward: boolean): IssuerEquity {
  return {
    market: bar.market,
    code: bar.code,
    name: bar.name,
    tradeDate: bar.tradeDate,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    closeRaw: bar.closeRaw,
    volumeShares: bar.volumeShares,
    volumeSharesRaw: bar.volumeSharesRaw,
    turnoverRaw: bar.turnoverRaw,
    transactions: bar.transactions,
    priceUnit: null,
    turnoverUnit: null,
    volumeUnit: "share",
    sourceUrl: bar.sourceUrl,
    nameMatchesIssuer: namesMatch(issuerName, bar.name),
    carriedForward,
  };
}

function barFromListed(row: Record<string, unknown>, sourceUrl: string, fetchedAt: string | null): StockBar | null {
  const tradeDate = parseRocOrGregorianDate(row.Date);
  const code = blankToNull(row.Code);
  if (!tradeDate || !code) return null;
  return {
    market: "TWSE",
    code,
    name: String(row.Name ?? ""),
    tradeDate,
    open: parsePositivePrice(row.OpeningPrice),
    high: parsePositivePrice(row.HighestPrice),
    low: parsePositivePrice(row.LowestPrice),
    close: parsePositivePrice(row.ClosingPrice),
    closeRaw: String(row.ClosingPrice ?? ""),
    volumeShares: parseSourceNumber(row.TradeVolume),
    volumeSharesRaw: String(row.TradeVolume ?? ""),
    turnoverRaw: String(row.TradeValue ?? ""),
    transactions: parseSourceNumber(row.Transaction),
    sourceUrl,
    fetchedAt,
  };
}

function barFromOtc(row: Record<string, unknown>, sourceUrl: string, fetchedAt: string | null): StockBar | null {
  const tradeDate = parseRocOrGregorianDate(row.Date);
  const code = blankToNull(row.SecuritiesCompanyCode);
  if (!tradeDate || !code) return null;
  return {
    market: "TPEx",
    code,
    name: String(row.CompanyName ?? ""),
    tradeDate,
    open: parsePositivePrice(row.Open),
    high: parsePositivePrice(row.High),
    low: parsePositivePrice(row.Low),
    close: parsePositivePrice(row.Close),
    closeRaw: String(row.Close ?? ""),
    volumeShares: parseSourceNumber(row.TradingShares),
    volumeSharesRaw: String(row.TradingShares ?? ""),
    turnoverRaw: String(row.TransactionAmount ?? ""),
    transactions: parseSourceNumber(row.TransactionNumber),
    sourceUrl,
    fetchedAt,
  };
}

function revenueFrom(row: Record<string, unknown>, market: "TWSE" | "TPEx", sourceUrl: string): RevenueObservation {
  return {
    market,
    yearMonth: parseRocYearMonth(row["資料年月"]) ?? "",
    publishedDate: parseRocOrGregorianDate(row["出表日期"]),
    monthRevenue: parseSourceNumber(row["營業收入-當月營收"]),
    monthRevenueRaw: String(row["營業收入-當月營收"] ?? ""),
    amountUnit: null,
    momPct: parseSourceNumber(row["營業收入-上月比較增減(%)"]),
    yoyPct: parseSourceNumber(row["營業收入-去年同月增減(%)"]),
    ytdRevenueRaw: String(row["累計營業收入-當月累計營收"] ?? ""),
    ytdYoyPct: parseSourceNumber(row["累計營業收入-前期比較增減(%)"]),
    industry: blankToNull(row["產業別"]),
    note: blankToNull(row["備註"]),
    sourceUrl,
  };
}

function putFields(dateRaw: unknown, priceRaw: unknown): Pick<
  Instrument,
  "putOptionDate" | "putOptionPriceRaw" | "putOptionPrice" | "putTermsStatus"
> {
  const putOptionDate = parseRocOrGregorianDate(dateRaw);
  const putOptionPriceRaw = String(priceRaw ?? "");
  const parsed = parseSourceNumber(priceRaw);
  if (putOptionDate && parsed != null && parsed > 0) {
    return { putOptionDate, putOptionPriceRaw, putOptionPrice: parsed, putTermsStatus: "source_reported" };
  }
  return { putOptionDate, putOptionPriceRaw, putOptionPrice: null, putTermsStatus: "not_provided" };
}

function baseWarnings(): WarningItem[] {
  return [
    warn("current_conversion_price_unverified", "主檔只有發行時轉換價格，目前生效轉換價未取得。"),
    warn("bond_quotes_not_acquired", "可轉債個券日行情未取得，沒有百元收盤價。"),
    warn("currency_and_code_dictionary_unverified", "幣別、擔保、掛牌狀態等代碼沒有官方值域表，只保留原始代碼。"),
    warn(
      "issuer_equity_join_not_conversion_underlying_verification",
      "發行機構代碼對到的股票是發行人股票，尚未核對契約上的轉換標的。",
    ),
  ];
}

function assertRealDataMetricsStayNull(stockPrice: number | null, issuancePrice: number | null): void {
  const value = conversionValuePer100({
    stockPrice,
    conversionPrice: issuancePrice,
    conversionPriceKind: "issuance",
    suspended: null,
  });
  const premium = marketConversionPremium({
    cbPricePer100: null,
    conversionValue: value,
    sameSession: false,
  });
  if (value !== null || premium !== null) {
    throw new Error("發行時轉換價不得算出轉換價值或溢價");
  }
}

function buildInstrument(
  row: Record<string, unknown>,
  index: number,
  equity: { twse: StockBar | null; otc: StockBar | null },
  history: StockBar[],
  revenue: RevenueObservation | null,
  margin: MarginObservation | null,
  masterUrl: string,
): Instrument {
  const cbCode = usableBondCode(row.BondCode);
  const quarantined = cbCode == null;
  const warnings = baseWarnings();
  const issuanceRaw = String(row["Conversion/ExchangePriceAtIssuance"] ?? "");
  const issuance = parsePositivePrice(issuanceRaw);
  if (blankToNull(issuanceRaw) && issuance == null) {
    warnings.push(warn("issuance_conversion_price_not_positive", "發行時轉換價格不是正數，不拿來計算。"));
  }
  const masterAsOf = parseRocOrGregorianDate(row.Date);
  const conversionPeriodStart = parseRocOrGregorianDate(row["Conversion/ExchangePeriodStartDate"]);
  const conversionPeriodEnd = parseRocOrGregorianDate(row["Conversion/ExchangePeriodEndDate"]);
  let conversionPeriodNote: string | null = null;
  if (masterAsOf && conversionPeriodStart && conversionPeriodStart > masterAsOf) {
    conversionPeriodNote = "主檔記載的轉換期間起日晚於主檔資料日。不能因為已有代碼就假設當天可以轉換，後續公告仍要另核。";
    warnings.push(warn("conversion_period_not_started_on_master_date", conversionPeriodNote));
  }
  let issuerEquity: IssuerEquity | null = null;
  if (equity.twse && equity.otc) {
    warnings.push(warn("issuer_equity_market_conflict", "同一機構代碼同時出現在上市與上櫃行情，不挑選其中一邊。"));
  } else if (equity.twse || equity.otc) {
    const bar = (equity.twse ?? equity.otc)!;
    issuerEquity = toEquity(bar, String(row.IssuerName ?? ""), false);
    if (issuerEquity && !issuerEquity.nameMatchesIssuer) {
      warnings.push(
        warn(
          "issuer_name_differs_from_equity_file",
          `機構名稱「${row.IssuerName ?? ""}」與行情名稱「${issuerEquity.name}」不同。仍只依代碼並陳，不視為已核對轉換標的。`,
        ),
      );
    }
  } else {
    warnings.push(warn("issuer_equity_not_found", "這份上市／上櫃行情快照沒有相同的機構代碼。"));
  }
  const put = putFields(row.PutOptionDate, row.PutOptionPrice);
  if (!put.putOptionDate && parseSourceNumber(row.PutOptionPrice) === 0) {
    warnings.push(warn("put_zero_without_date_not_a_put", "賣回日空白且賣回價為 0，不是零元賣回。"));
  }
  const issuerCode = String(row.IssuerCode ?? "").trim();
  assertRealDataMetricsStayNull(issuerEquity?.close ?? null, issuance);
  const recordId = cbCode ?? `q-${hashId([issuerCode, String(row.SeriesNumber ?? ""), String(row.TrancheNumber ?? ""), String(row.IssueDate ?? ""), String(row.ShortName ?? ""), String(index)])}`;
  const equityHistory = issuerEquity
    ? history
        .filter((bar) => bar.market === issuerEquity.market && bar.code === issuerEquity.code)
        .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
        .map((bar) => ({ tradeDate: bar.tradeDate, close: bar.close, volumeShares: bar.volumeShares }))
    : [];
  return {
    recordId,
    quarantined,
    quarantineReason: quarantined ? "沒有可用的債券代碼（空白、無或 N/A），不當作全站主鍵。" : null,
    cbCode,
    cbCodeRaw: String(row.BondCode ?? ""),
    shortName: String(row.ShortName ?? ""),
    issuerCode,
    issuerName: String(row.IssuerName ?? ""),
    bondTypeCode: String(row.BondType ?? ""),
    seriesNumber: blankToNull(row.SeriesNumber),
    trancheNumber: blankToNull(row.TrancheNumber),
    masterAsOf,
    issueDate: parseRocOrGregorianDate(row.IssueDate),
    listingDate: parseRocOrGregorianDate(row.ListingDate),
    maturityDate: parseRocOrGregorianDate(row.MaturityDate),
    conversionPeriodStart,
    conversionPeriodEnd,
    conversionPeriodNote,
    conversionPriceAtIssuanceRaw: issuanceRaw,
    conversionPriceAtIssuance: issuance,
    effectiveConversionPrice: null,
    effectiveConversionPriceDate: null,
    cbOpen: null,
    cbHigh: null,
    cbLow: null,
    cbClose: null,
    cbQuoteDate: null,
    cbVolume: null,
    sourceReportedConversionValue: null,
    conversionValue: null,
    conversionPremium: null,
    lastTradingDate: null,
    conversionSuspended: null,
    callTerms: null,
    currency: null,
    guaranteed: null,
    amountUnit: null,
    conversionUnderlyingVerified: false,
    currencyCodeRaw: String(row.Currency ?? ""),
    listingStatusRaw: String(row.ListingStatus ?? ""),
    guaranteedCodeRaw: String(row.Guaranteed ?? ""),
    guaranteeDescription: blankToNull(row.GuaranteeDescription),
    issueAmountRaw: String(row.IssueAmount ?? ""),
    issueAmount: parseSourceNumber(row.IssueAmount),
    outstandingAmountRaw: String(row.OutstandingAmount ?? ""),
    outstandingAmount: parseSourceNumber(row.OutstandingAmount),
    couponRateRaw: String(row.CouponRate ?? ""),
    couponRate: parseSourceNumber(row.CouponRate),
    ...put,
    underwriterRaw: String(row.Underwriter ?? ""),
    trusteeRaw: String(row.Trustee ?? ""),
    outstandingChangeDate: parseRocOrGregorianDate(row.OutstandingChangeDate),
    outstandingChangeDescription: blankToNull(row.OutstandingChangeDescription),
    issuerEquity,
    issuerEquityHistory: equityHistory,
    revenue: revenue && revenue.yearMonth ? revenue : null,
    margin,
    warnings,
    sourceUrl: masterUrl,
    licenseUrl: LICENSE_URL,
  };
}

function buildEvents(rows: unknown[], market: "TWSE" | "TPEx", sourceUrl: string, fetchedAt: string | null): EventItem[] {
  return rows.map((row) => {
    const bag = trimKeys(row);
    const companyCode = String(bag["公司代號"] ?? bag.SecuritiesCompanyCode ?? "").trim();
    const subject = String(bag["主旨"] ?? "");
    const explanation = String(bag["說明"] ?? "");
    const spokenDate = parseRocOrGregorianDate(bag["發言日期"]);
    const spokenTime = parseSpokenTime(bag["發言時間"]);
    const lead = leadKind(`${subject}\n${explanation}`);
    return {
      id: hashId([market, companyCode, spokenDate ?? "", spokenTime ?? "", subject]),
      market,
      companyCode,
      companyName: String(bag["公司名稱"] ?? bag.CompanyName ?? ""),
      subject,
      clause: String(bag["符合條款"] ?? ""),
      explanation,
      publishedDate: parseRocOrGregorianDate(bag["出表日期"] ?? bag.Date),
      spokenDate,
      spokenTime,
      spokenAt: spokenDate && spokenTime ? `${spokenDate}T${spokenTime}+08:00` : null,
      factDate: parseRocOrGregorianDate(bag["事實發生日"]),
      lead,
      sourceUrl,
      retrievedAt: fetchedAt,
    };
  });
}

function sourceStatus(
  id: SourceId,
  body: SourcePayload,
  rejected: string | null,
  asOfDate: string | null,
  asOfLabel: string,
  carried: boolean,
): SourceStatus {
  const def = sourceById(id);
  let status: SourceStatus["status"] = "ok";
  let note = def.role;
  if (rejected) {
    status = carried ? "carried_forward" : "failed";
    note = rejected;
  }
  return {
    id,
    title: def.title,
    role: def.role,
    url: def.url,
    documentationUrl: def.documentationUrl,
    licenseName: "政府資料開放授權條款－第1版",
    licenseUrl: LICENSE_URL,
    licenseMetadataUrl: def.licenseMetadataUrl,
    provider: def.provider,
    cadence: def.cadence,
    asOfDate,
    asOfLabel,
    retrievedAt: body.fetchedAt,
    rowCount: body.ok ? body.rows.length : null,
    sha256: body.sha256,
    httpStatus: body.httpStatus,
    status,
    note,
    partOfVerifiedNine: def.partOfVerifiedNine,
  };
}

function carriedEquity(previous: Snapshot | null, issuerCode: string): IssuerEquity | null {
  const found = previous?.instruments.find((item) => item.issuerCode === issuerCode && item.issuerEquity);
  if (!found?.issuerEquity) return null;
  return { ...found.issuerEquity, carriedForward: true };
}

export function buildSnapshot(input: BuildInput): BuildResult {
  const failures: string[] = [];
  const masterReject = rejectReason(input, "cb-master");
  const masterBody = payload(input, "cb-master");
  if (masterReject) failures.push(`cb-master: ${masterReject}`);

  const usePreviousInstruments = Boolean(masterReject && input.previous);
  let instruments: Instrument[] = [];
  let events: EventItem[] = [];
  let stockBars = input.previousBars;
  let coded = 0;
  let quarantined = 0;
  let linked = 0;
  let mismatches = 0;
  let equityAsOf: string | null = null;
  let revenueYearMonth: string | null = null;
  let revenuePublished: string | null = null;

  const listedQuoteReject = rejectReason(input, "listed-stock-quotes");
  const otcQuoteReject = rejectReason(input, "otc-stock-quotes");
  if (listedQuoteReject) failures.push(`listed-stock-quotes: ${listedQuoteReject}`);
  if (otcQuoteReject) failures.push(`otc-stock-quotes: ${otcQuoteReject}`);

  const freshBars: StockBar[] = [];
  if (!listedQuoteReject) {
    const body = payload(input, "listed-stock-quotes");
    for (const row of body.rows) {
      const bar = barFromListed(trimKeys(row), sourceById("listed-stock-quotes").url, body.fetchedAt);
      if (bar) freshBars.push(bar);
    }
  }
  if (!otcQuoteReject) {
    const body = payload(input, "otc-stock-quotes");
    for (const row of body.rows) {
      const bar = barFromOtc(trimKeys(row), sourceById("otc-stock-quotes").url, body.fetchedAt);
      if (bar) freshBars.push(bar);
    }
  }
  const keptPrevious = input.previousBars.filter((bar) => {
    const replaced = freshBars.some((next) => next.market === bar.market && next.code === bar.code && next.tradeDate === bar.tradeDate);
    return !replaced;
  });
  stockBars = [...keptPrevious, ...freshBars];

  const listedMap = new Map<string, StockBar>();
  const otcMap = new Map<string, StockBar>();
  for (const bar of stockBars) {
    const target = bar.market === "TWSE" ? listedMap : otcMap;
    const prev = target.get(bar.code);
    if (!prev || bar.tradeDate >= prev.tradeDate) target.set(bar.code, bar);
  }

  const listedRevenueReject = rejectReason(input, "listed-revenue");
  const otcRevenueReject = rejectReason(input, "otc-revenue");
  if (listedRevenueReject) failures.push(`listed-revenue: ${listedRevenueReject}`);
  if (otcRevenueReject) failures.push(`otc-revenue: ${otcRevenueReject}`);
  const listedRevenue = !listedRevenueReject
    ? indexBy(payload(input, "listed-revenue").rows, "公司代號")
    : new Map<string, Record<string, unknown>>();
  const otcRevenue = !otcRevenueReject
    ? indexBy(payload(input, "otc-revenue").rows, "公司代號")
    : new Map<string, Record<string, unknown>>();

  const listedMarginReject = rejectReason(input, "listed-margin");
  const otcMarginReject = rejectReason(input, "otc-margin");
  if (listedMarginReject) failures.push(`listed-margin: ${listedMarginReject}`);
  if (otcMarginReject) failures.push(`otc-margin: ${otcMarginReject}`);
  const listedMargin = !listedMarginReject ? indexBy(payload(input, "listed-margin").rows, "股票代號") : new Map();
  const otcMargin = !otcMarginReject ? indexBy(payload(input, "otc-margin").rows, "SecuritiesCompanyCode") : new Map();

  if (!masterReject) {
    const masterUrl = sourceById("cb-master").url;
    instruments = masterBody.rows.map((row, index) => {
      const bag = trimKeys(row);
      const issuerCode = String(bag.IssuerCode ?? "").trim();
      const twse = listedQuoteReject ? null : listedMap.get(issuerCode) ?? null;
      const otc = otcQuoteReject ? null : otcMap.get(issuerCode) ?? null;
      let revenue: RevenueObservation | null = null;
      const listedRev = listedRevenue.get(issuerCode);
      const otcRev = otcRevenue.get(issuerCode);
      if (listedRev && otcRev) {
        revenue = null;
      } else if (listedRev) revenue = revenueFrom(listedRev, "TWSE", sourceById("listed-revenue").url);
      else if (otcRev) revenue = revenueFrom(otcRev, "TPEx", sourceById("otc-revenue").url);
      let margin: MarginObservation | null = null;
      const listedM = listedMargin.get(issuerCode);
      const otcM = otcMargin.get(issuerCode);
      if (listedM && otcM) margin = null;
      else if (listedM) {
        margin = {
          market: "TWSE",
          tradeDate: null,
          tradeDateStatus: "not_in_response",
          shortSaleRaw: blankToNull(listedM["融券賣出"]),
          shortCoverRaw: blankToNull(listedM["融券買進"]),
          stockRedemptionRaw: blankToNull(listedM["融券現券償還"]),
          shortBalanceRaw: blankToNull(listedM["融券今日餘額"]),
          quantityUnit: null,
          sourceUrl: sourceById("listed-margin").url,
        };
      } else if (otcM) {
        margin = {
          market: "TPEx",
          tradeDate: parseRocOrGregorianDate(otcM.Date),
          tradeDateStatus: "source_dated",
          shortSaleRaw: blankToNull(otcM.ShortSale),
          shortCoverRaw: blankToNull(otcM.ShortConvering),
          stockRedemptionRaw: blankToNull(otcM.StockRedemption),
          shortBalanceRaw: blankToNull(otcM.ShortSaleBalance),
          quantityUnit: null,
          sourceUrl: sourceById("otc-margin").url,
        };
      }
      const built = buildInstrument(bag, index, { twse, otc }, stockBars, revenue, margin, masterUrl);
      if ((listedQuoteReject || otcQuoteReject) && !built.issuerEquity) {
        const carried = carriedEquity(input.previous, issuerCode);
        if (carried) {
          built.issuerEquity = carried;
          built.warnings.push(warn("issuer_equity_carried_forward", "這次股票行情沒有更新，沿用上次已保存的發行人股票，沒有改成空白。"));
        }
      }
      return built;
    });
  } else if (input.previous) {
    instruments = input.previous.instruments;
  }

  const listedEventsReject = rejectReason(input, "listed-events");
  const otcEventsReject = rejectReason(input, "otc-events");
  if (listedEventsReject) failures.push(`listed-events: ${listedEventsReject}`);
  if (otcEventsReject) failures.push(`otc-events: ${otcEventsReject}`);
  const listedEvents = !listedEventsReject
    ? buildEvents(payload(input, "listed-events").rows, "TWSE", sourceById("listed-events").url, payload(input, "listed-events").fetchedAt)
    : (input.previous?.events.filter((item) => item.market === "TWSE") ?? []);
  const otcEvents = !otcEventsReject
    ? buildEvents(payload(input, "otc-events").rows, "TPEx", sourceById("otc-events").url, payload(input, "otc-events").fetchedAt)
    : (input.previous?.events.filter((item) => item.market === "TPEx") ?? []);
  events = [...listedEvents, ...otcEvents];

  for (const item of instruments) {
    if (item.quarantined) quarantined += 1;
    else coded += 1;
    if (item.issuerEquity) {
      linked += 1;
      if (equityAsOf == null || item.issuerEquity.tradeDate > equityAsOf) equityAsOf = item.issuerEquity.tradeDate;
      if (!item.issuerEquity.nameMatchesIssuer) mismatches += 1;
    }
    if (item.revenue?.yearMonth) {
      revenueYearMonth = item.revenue.yearMonth;
      revenuePublished = item.revenue.publishedDate;
    }
  }

  const holidayBody = payload(input, "twse-holiday");
  const holidayReject = rejectReason(input, "twse-holiday");
  const calendar = createCalendar(holidayReject ? null : (holidayBody.rows as HolidayInput[]));
  const freshness = assessEquityFreshness({ now: input.now, calendar, observedDate: equityAsOf });

  const masterAsOf = !masterReject ? uniqueField(masterBody.rows, "Date") : input.previous?.coverage.cbMasterAsOf ?? null;
  const sources: SourceStatus[] = FETCHABLE_SOURCES.map((def) => {
    const body = payload(input, def.id);
    const rejected = rejectReason(input, def.id);
    let asOf: string | null = null;
    let label = "沒有單一資料日";
    if (!rejected && (def.id === "listed-revenue" || def.id === "otc-revenue")) {
      const yearMonth = uniqueField(body.rows, "資料年月");
      const published = uniqueField(body.rows, "出表日期");
      asOf = yearMonth;
      label = `資料年月 ${yearMonth ?? "未解析"}，出表 ${published ?? "未解析"}`;
    } else if (!rejected && (def.id === "listed-events" || def.id === "otc-events")) {
      const published = uniqueField(body.rows, def.id === "otc-events" ? "Date" : "出表日期");
      const spoken = uniqueField(body.rows, "發言日期");
      asOf = published;
      label = `出表 ${published ?? "多個日期"}，發言 ${spoken ?? "多個日期"}。事實日見各列，可以是未來`;
    } else if (!rejected && def.id === "twse-holiday") {
      label = `年度開休市表，${body.rows.length} 列，不是單一交易日`;
    } else if (!rejected && def.dateFields.length === 1) {
      asOf = uniqueField(body.rows, def.dateFields[0]);
      label = asOf ?? "日期無法解析";
    } else if (def.id === "listed-margin" && !rejected) {
      asOf = null;
      label = "原始列沒有交易日，維持未知";
    }
    const carried = Boolean(rejected && def.id === "cb-master" && input.previous);
    return sourceStatus(def.id, body, rejected, asOf, label, carried);
  });

  sources.push({
    id: BLOCKED_CB_DAILY_QUOTE.id,
    title: BLOCKED_CB_DAILY_QUOTE.title,
    role: "個券開高低收與成交量",
    url: BLOCKED_CB_DAILY_QUOTE.pageUrl,
    documentationUrl: "https://www.tpex.org.tw/openapi/swagger.json",
    licenseName: "未取得可再散布的開放資料授權",
    licenseUrl: "https://www.tpex.org.tw/zh-tw/gtsm_disclaimer.html",
    licenseMetadataUrl: null,
    provider: "證券櫃檯買賣中心網站",
    cadence: "頁面看起來是每個交易日，但沒有已驗證的正式下載網址。",
    asOfDate: null,
    asOfLabel: "未取得",
    retrievedAt: null,
    rowCount: null,
    sha256: null,
    httpStatus: null,
    status: "unavailable",
    note: BLOCKED_CB_DAILY_QUOTE.reason,
    partOfVerifiedNine: false,
  });

  for (const quoteId of ["listed-stock-quotes", "otc-stock-quotes"] as const) {
    const quoteStatus = sources.find((item) => item.id === quoteId);
    if (!quoteStatus || quoteStatus.status === "failed" || quoteStatus.status === "carried_forward") continue;
    if (freshness.status === "pending") {
      quoteStatus.status = "pending";
      quoteStatus.note = `預期交易日 ${freshness.expectedDate} 的收盤還沒出現在來源裡。保留已有列，不寫入空白。`;
    } else if (freshness.status === "not_yet_due") {
      quoteStatus.status = "not_yet_due";
      quoteStatus.note = "台北時間還沒到 18:00，不要求當日收盤。";
    }
  }

  const runStatus = failures.length ? "failed" : freshness.status === "pending" ? "pending" : "partial";
  const historyDays = new Set(stockBars.map((bar) => bar.tradeDate)).size;

  const snapshot: Snapshot = {
    schemaVersion: 1,
    generatedAt: formatTaipeiIso(input.now),
    timezone: "Asia/Taipei",
    runStatus,
    complete: false,
    schedulingEnabled: input.schedulingEnabled === true,
    hosting: "static-github-pages",
    basePathNote:
      "靜態檔使用相對路徑，放在 GitHub Pages 的 /twse-broker-branch/convertible-bonds/。券商分點雷達留在同一網站根目錄，這支程式不改寫它的資料。",
    blocked: [
      { id: "cb-daily-quote", reason: BLOCKED_CB_DAILY_QUOTE.reason },
      { id: "effective-conversion-price", reason: "發行主檔的轉換價格是發行時價格，不是已驗證的目前生效價格。" },
      { id: "premium-ranking", reason: "沒有同日可轉債百元價與目前生效轉換價，不計算、不排序溢價。" },
      { id: "volume-breakout", reason: "沒有可轉債個券成交量歷史，不產生教材第十條量能訊號。" },
      { id: "cbas", reason: "沒有券商契約與報價，不提供 CBAS 權利金或費率。" },
    ],
    coverage: {
      cbMasterAsOf: masterAsOf,
      cbMasterRows: masterReject ? input.previous?.coverage.cbMasterRows ?? 0 : masterBody.rows.length,
      codedBonds: coded,
      quarantined,
      issuerEquityAsOf: equityAsOf,
      issuerEquityLinked: linked,
      issuerNameMismatches: mismatches,
      revenueYearMonth,
      revenuePublishedDate: revenuePublished,
      cbQuoteAsOf: null,
      effectiveConversionPriceCovered: 0,
      premiumComputed: 0,
      equityHistoryDays: historyDays,
    },
    calendar: {
      status: calendar.status,
      expectedEquitySession: freshness.expectedDate,
      phase: freshness.phase,
      equityFreshness: freshness.status,
      note:
        calendar.status === "loaded"
          ? "開休市表只用於判斷預期的股票收盤日。可轉債行情仍是未取得。"
          : "開休市表這次沒有用上，因此不把股票日期判斷成最新或過期。",
    },
    sources,
    instruments,
    events,
    eventCounts: {
      listedRows: listedEvents.length,
      otcRows: otcEvents.length,
      listedLeads: listedEvents.filter((item) => item.lead !== "other").length,
      otcLeads: otcEvents.filter((item) => item.lead !== "other").length,
    },
    attribution:
      "金融監督管理委員會證券期貨局／證券櫃檯買賣中心與臺灣證券交易所，2026，政府資料開放平臺所載開放資料。此開放資料依政府資料開放授權條款第 1 版釋出。授權：https://data.gov.tw/license 。本網站不是官方網站，計算與整理不代表資料提供機關的意見。",
  };

  const issuerCodes = new Set(instruments.map((item) => item.issuerCode));
  return {
    snapshot,
    publishInstruments: !masterReject || !input.previous,
    persistBars: !masterReject,
    stockBars: masterReject ? input.previousBars : stockBars.filter((bar) => issuerCodes.has(bar.code)),
    verifiedFailures: failures,
  };
}
