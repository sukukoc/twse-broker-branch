export interface ConversionInputs {
  stockPrice: number | null;
  conversionPrice: number | null;
  conversionPriceKind: "effective" | "issuance" | "unknown";
  suspended: boolean | null;
}

/** V = 100 × S / K. Issuance price is never accepted as K. */
export function conversionValuePer100(input: ConversionInputs): number | null {
  if (input.conversionPriceKind !== "effective") return null;
  if (input.suspended === true) return null;
  const stock = input.stockPrice;
  const strike = input.conversionPrice;
  if (stock == null || strike == null) return null;
  if (!(stock > 0) || !(strike > 0)) return null;
  if (!Number.isFinite(stock) || !Number.isFinite(strike)) return null;
  return (100 * stock) / strike;
}

export interface PremiumInputs {
  cbPricePer100: number | null;
  conversionValue: number | null;
  sameSession: boolean;
}

/** premium = P / V − 1. Requires a conversion value already computed from an effective K. */
export function marketConversionPremium(input: PremiumInputs): number | null {
  if (!input.sameSession) return null;
  const price = input.cbPricePer100;
  const value = input.conversionValue;
  if (price == null || value == null) return null;
  if (!(price > 0) || !(value > 0)) return null;
  if (!Number.isFinite(price) || !Number.isFinite(value)) return null;
  return price / value - 1;
}

export interface EffectivePriceUpdate {
  price: number;
  effectiveDate: string;
}

export interface PriceVersions {
  issuancePrice: number | null;
  issuanceRaw: string;
  effectivePrice: number | null;
  effectiveDate: string | null;
}

/** A later effective price does not overwrite the issuance price. */
export function applyEffectiveConversionPrice(
  current: PriceVersions,
  update: EffectivePriceUpdate,
): PriceVersions {
  if (!(update.price > 0) || !update.effectiveDate) return { ...current, effectivePrice: null, effectiveDate: null };
  return {
    issuancePrice: current.issuancePrice,
    issuanceRaw: current.issuanceRaw,
    effectivePrice: update.price,
    effectiveDate: update.effectiveDate,
  };
}

export interface VolumeBreakoutResult {
  signal: null;
  status: "not_applicable";
  reason: string;
}

/** Textbook S10 is not evaluated until verified CB daily volume history exists. */
export function volumeBreakoutGate(_bars: unknown[] | null | undefined): VolumeBreakoutResult {
  return {
    signal: null,
    status: "not_applicable",
    reason:
      "可轉債個券日行情與成交量尚未取得，歷史不足。不產生量能訊號，也不用示意資料回測。",
  };
}
