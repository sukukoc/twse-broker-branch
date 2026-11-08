export type SourceId =
  | "cb-master"
  | "listed-stock-quotes"
  | "otc-stock-quotes"
  | "listed-margin"
  | "otc-margin"
  | "listed-events"
  | "otc-events"
  | "listed-revenue"
  | "otc-revenue"
  | "twse-holiday";

export type RunStatus = "partial" | "failed" | "pending";

export type SourceRunStatus =
  | "ok"
  | "failed"
  | "pending"
  | "unavailable"
  | "not_yet_due"
  | "carried_forward"
  | "skipped";

export interface WarningItem {
  code: string;
  message: string;
}

export interface IssuerEquity {
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
  priceUnit: null;
  turnoverUnit: null;
  volumeUnit: "share";
  sourceUrl: string;
  nameMatchesIssuer: boolean;
  carriedForward: boolean;
}

export interface RevenueObservation {
  market: "TWSE" | "TPEx";
  yearMonth: string;
  publishedDate: string | null;
  monthRevenue: number | null;
  monthRevenueRaw: string;
  amountUnit: null;
  momPct: number | null;
  yoyPct: number | null;
  ytdRevenueRaw: string;
  ytdYoyPct: number | null;
  industry: string | null;
  note: string | null;
  sourceUrl: string;
}

export interface MarginObservation {
  market: "TWSE" | "TPEx";
  tradeDate: string | null;
  tradeDateStatus: "source_dated" | "not_in_response";
  shortSaleRaw: string | null;
  shortCoverRaw: string | null;
  stockRedemptionRaw: string | null;
  shortBalanceRaw: string | null;
  quantityUnit: null;
  sourceUrl: string;
}

export interface Instrument {
  recordId: string;
  quarantined: boolean;
  quarantineReason: string | null;
  cbCode: string | null;
  cbCodeRaw: string;
  shortName: string;
  issuerCode: string;
  issuerName: string;
  bondTypeCode: string;
  seriesNumber: string | null;
  trancheNumber: string | null;
  masterAsOf: string | null;
  issueDate: string | null;
  listingDate: string | null;
  maturityDate: string | null;
  conversionPeriodStart: string | null;
  conversionPeriodEnd: string | null;
  conversionPeriodNote: string | null;
  conversionPriceAtIssuanceRaw: string;
  conversionPriceAtIssuance: number | null;
  effectiveConversionPrice: null;
  effectiveConversionPriceDate: null;
  cbOpen: null;
  cbHigh: null;
  cbLow: null;
  cbClose: null;
  cbQuoteDate: null;
  cbVolume: null;
  sourceReportedConversionValue: null;
  conversionValue: null;
  conversionPremium: null;
  lastTradingDate: null;
  conversionSuspended: null;
  callTerms: null;
  currencyCodeRaw: string;
  currency: null;
  listingStatusRaw: string;
  guaranteedCodeRaw: string;
  guaranteed: null;
  guaranteeDescription: string | null;
  issueAmountRaw: string;
  issueAmount: number | null;
  outstandingAmountRaw: string;
  outstandingAmount: number | null;
  amountUnit: null;
  couponRateRaw: string;
  couponRate: number | null;
  putOptionDate: string | null;
  putOptionPriceRaw: string;
  putOptionPrice: number | null;
  putTermsStatus: "source_reported" | "not_provided";
  underwriterRaw: string;
  trusteeRaw: string;
  outstandingChangeDate: string | null;
  outstandingChangeDescription: string | null;
  conversionUnderlyingVerified: false;
  issuerEquity: IssuerEquity | null;
  issuerEquityHistory: { tradeDate: string; close: number | null; volumeShares: number | null }[];
  revenue: RevenueObservation | null;
  margin: MarginObservation | null;
  warnings: WarningItem[];
  sourceUrl: string;
  licenseUrl: string;
}

export type LeadKind = "cb" | "conference" | "both" | "other";

export interface EventItem {
  id: string;
  market: "TWSE" | "TPEx";
  companyCode: string;
  companyName: string;
  subject: string;
  clause: string;
  explanation: string;
  publishedDate: string | null;
  spokenDate: string | null;
  spokenTime: string | null;
  spokenAt: string | null;
  factDate: string | null;
  lead: LeadKind;
  sourceUrl: string;
  retrievedAt: string | null;
}

export interface SourceStatus {
  id: string;
  title: string;
  role: string;
  url: string;
  documentationUrl: string;
  licenseName: string;
  licenseUrl: string;
  licenseMetadataUrl: string | null;
  provider: string;
  cadence: string;
  asOfDate: string | null;
  asOfLabel: string;
  retrievedAt: string | null;
  rowCount: number | null;
  sha256: string | null;
  httpStatus: number | null;
  status: SourceRunStatus;
  note: string;
  partOfVerifiedNine: boolean;
}

export interface Snapshot {
  schemaVersion: 1;
  generatedAt: string;
  timezone: "Asia/Taipei";
  runStatus: RunStatus;
  complete: false;
  schedulingEnabled: boolean;
  hosting: "static-github-pages";
  basePathNote: string;
  blocked: { id: string; reason: string }[];
  coverage: {
    cbMasterAsOf: string | null;
    cbMasterRows: number;
    codedBonds: number;
    quarantined: number;
    issuerEquityAsOf: string | null;
    issuerEquityLinked: number;
    issuerNameMismatches: number;
    revenueYearMonth: string | null;
    revenuePublishedDate: string | null;
    cbQuoteAsOf: null;
    effectiveConversionPriceCovered: 0;
    premiumComputed: 0;
    equityHistoryDays: number;
  };
  calendar: {
    status: "loaded" | "unavailable";
    expectedEquitySession: string | null;
    phase: "due" | "not_yet_due" | "calendar_unknown";
    equityFreshness: "fresh" | "pending" | "not_yet_due" | "calendar_unknown" | "missing";
    note: string;
  };
  sources: SourceStatus[];
  instruments: Instrument[];
  events: EventItem[];
  eventCounts: {
    listedRows: number;
    otcRows: number;
    listedLeads: number;
    otcLeads: number;
  };
  attribution: string;
}
