import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSnapshot } from "../src/lib/assemble";
import { assessEquityFreshness, createCalendar, expectedEquitySession } from "../src/lib/calendar";
import { parseRocOrGregorianDate, parseRocYearMonth, parseSpokenTime } from "../src/lib/dates";
import { applyEffectiveConversionPrice, conversionValuePer100, marketConversionPremium, volumeBreakoutGate } from "../src/lib/formulas";
import { parseSourceNumber } from "../src/lib/numbers";
import { resolveDataUrl, parseHash } from "../src/lib/public-url";
import { defaultPaths, runUpdate } from "../src/lib/run-update";
import { BLOCKED_CB_DAILY_QUOTE, FETCHABLE_SOURCES } from "../src/lib/sources";
import { countCbBars, countStockBars, openDatabase } from "../src/lib/storage";
import { loadVendorPayloads } from "../src/lib/vendor";
import { snapshotToCsv } from "../src/lib/csv";

const vendor = path.resolve("data/vendor/2026-11-08");
const now = new Date("2026-11-08T04:00:00.000Z");

function holidayRows() {
  return JSON.parse(fs.readFileSync(path.join(vendor, "twse-holiday.raw.json"), "utf8")) as {
    Name: string;
    Date: string;
    Description?: string;
  }[];
}

describe("dates, units and formulas", () => {
  it("parses ROC dates, year-months and spoken times", () => {
    expect(parseRocOrGregorianDate("1151106")).toBe("2026-11-06");
    expect(parseRocOrGregorianDate("20261107")).toBe("2026-11-07");
    expect(parseRocYearMonth("11509")).toBe("2026-09");
    expect(parseRocYearMonth("11509")).not.toBe("2026-10");
    expect(parseSpokenTime("64607")).toBe("06:46:07");
    expect(parseSpokenTime("70003")).toBe("07:00:03");
    expect(parseSourceNumber("")).toBeNull();
    expect(parseSourceNumber("--")).toBeNull();
    expect(parseSourceNumber("0")).toBe(0);
    expect(parseSourceNumber("12.353609508827128")).toBeCloseTo(12.353609508827128);
  });

  it("does not turn issuance price or nulls into a premium", () => {
    expect(conversionValuePer100({ stockPrice: 26.75, conversionPrice: 36.5, conversionPriceKind: "issuance", suspended: null })).toBeNull();
    expect(conversionValuePer100({ stockPrice: 26.75, conversionPrice: null, conversionPriceKind: "effective", suspended: null })).toBeNull();
    expect(conversionValuePer100({ stockPrice: 0, conversionPrice: 36.5, conversionPriceKind: "effective", suspended: null })).toBeNull();
    expect(conversionValuePer100({ stockPrice: 50, conversionPrice: 40, conversionPriceKind: "effective", suspended: false })).toBe(125);
    expect(marketConversionPremium({ cbPricePer100: 110, conversionValue: 100, sameSession: true })).toBeCloseTo(0.1);
    expect(marketConversionPremium({ cbPricePer100: null, conversionValue: 100, sameSession: true })).toBeNull();
    expect(marketConversionPremium({ cbPricePer100: 110, conversionValue: 100, sameSession: false })).toBeNull();
    const updated = applyEffectiveConversionPrice(
      { issuancePrice: 36.5, issuanceRaw: "36.5000", effectivePrice: null, effectiveDate: null },
      { price: 30, effectiveDate: "2026-11-01" },
    );
    expect(updated.issuancePrice).toBe(36.5);
    expect(updated.effectivePrice).toBe(30);
    expect(volumeBreakoutGate([{ volume: 999 }]).signal).toBeNull();
  });

  it("classifies weekends and the 2026 holiday file", () => {
    const calendar = createCalendar(holidayRows());
    expect(calendar.isTradingDay("2026-11-06")).toBe("open");
    expect(calendar.isTradingDay("2026-11-07")).toBe("closed");
    expect(calendar.isTradingDay("2026-11-08")).toBe("closed");
    expect(calendar.isTradingDay("2026-01-01")).toBe("closed");
    expect(calendar.isTradingDay("2026-01-02")).toBe("open");
    expect(calendar.isTradingDay("2026-02-11")).toBe("open");
    expect(calendar.isTradingDay("2026-02-12")).toBe("closed");
    expect(calendar.isTradingDay("2026-02-13")).toBe("closed");
    expect(calendar.isTradingDay("2027-01-04")).toBe("unknown");
    expect(expectedEquitySession(now, calendar)).toEqual({ date: "2026-11-06", phase: "due" });
    expect(expectedEquitySession(new Date("2026-11-06T09:00:00.000Z"), calendar)).toEqual({
      date: "2026-11-05",
      phase: "not_yet_due",
    });
    expect(assessEquityFreshness({ now: new Date("2026-11-06T10:30:00.000Z"), calendar, observedDate: "2026-11-05" }).status).toBe("pending");
    expect(assessEquityFreshness({ now, calendar, observedDate: "2026-11-06" }).status).toBe("fresh");
  });
});

describe("verified vendor snapshot", () => {
  const payloads = loadVendorPayloads(vendor);
  const built = buildSnapshot({ now, payloads, previous: null, previousBars: [] });
  const snapshot = built.snapshot;

  it("keeps the three real joins null for premium and effective price", () => {
    for (const code of ["11011", "15602", "61828"]) {
      const row = snapshot.instruments.find((item) => item.cbCode === code);
      expect(row, code).toBeTruthy();
      expect(row?.effectiveConversionPrice).toBeNull();
      expect(row?.cbClose).toBeNull();
      expect(row?.conversionValue).toBeNull();
      expect(row?.conversionPremium).toBeNull();
      expect(row?.conversionUnderlyingVerified).toBe(false);
      expect(row?.issuerEquity?.tradeDate).toBe("2026-11-06");
    }
    expect(snapshot.instruments.find((item) => item.cbCode === "11011")?.issuerEquity?.market).toBe("TWSE");
    expect(snapshot.instruments.find((item) => item.cbCode === "15602")?.issuerEquity?.market).toBe("TWSE");
    expect(snapshot.instruments.find((item) => item.cbCode === "61828")?.issuerEquity?.market).toBe("TPEx");
    const tcc = snapshot.instruments.find((item) => item.cbCode === "11011")!;
    expect(tcc.shortName).toBe("台泥一永");
    expect(tcc.conversionPriceAtIssuance).toBe(36.5);
    expect(tcc.issuerEquity?.close).toBe(26.75);
    expect(tcc.issuerEquity?.volumeShares).toBe(70512966);
    expect(tcc.revenue?.yearMonth).toBe("2026-09");
    expect(tcc.margin?.tradeDate).toBeNull();
    expect(tcc.margin?.tradeDateStatus).toBe("not_in_response");
    const china = snapshot.instruments.find((item) => item.cbCode === "15602")!;
    expect(china.conversionPeriodStart).toBe("2026-12-04");
    expect(china.conversionPeriodNote).toContain("轉換期間");
    expect(china.putOptionPrice).toBeNull();
    const wafer = snapshot.instruments.find((item) => item.cbCode === "61828")!;
    expect(wafer.issuerEquity?.close).toBe(69);
    expect(wafer.issuerEquity?.volumeShares).toBe(30149479);
  });

  it("does not translate mismatched names into a verified underlying", () => {
    const row = snapshot.instruments.find((item) => item.cbCode === "35221");
    expect(row?.issuerName).toBe("御頂");
    expect(row?.issuerEquity?.name).toBe("御嵿");
    expect(row?.issuerEquity?.nameMatchesIssuer).toBe(false);
    expect(row?.warnings.some((warning) => warning.code === "issuer_name_differs_from_equity_file")).toBe(true);
  });

  it("quarantines blank and placeholder codes and leaves every premium null", () => {
    expect(snapshot.coverage.cbMasterRows).toBe(426);
    expect(snapshot.coverage.quarantined).toBe(27);
    expect(snapshot.coverage.codedBonds).toBe(399);
    expect(snapshot.coverage.premiumComputed).toBe(0);
    expect(snapshot.instruments.every((item) => item.conversionPremium == null && item.cbClose == null)).toBe(true);
    expect(snapshot.coverage.revenueYearMonth).toBe("2026-09");
    expect(snapshot.complete).toBe(false);
    expect(snapshot.schedulingEnabled).toBe(false);
    expect(snapshot.eventCounts.listedLeads).toBe(0);
    expect(snapshot.eventCounts.otcLeads).toBeGreaterThan(0);
    const spoken = snapshot.events.find((event) => event.companyCode === "6103");
    expect(spoken?.spokenTime).toBe("11:37:14");
    expect(spoken?.factDate).toBe("2026-11-13");
  });

  it("exports empty premium columns and does not call the internal quote action", () => {
    const csv = snapshotToCsv(snapshot);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("effective_conversion_price");
    expect(csv).toContain("11011");
    const line = csv.split("\n").find((row) => row.startsWith("11011,") || row.includes(",11011,"));
    expect(line).toBeTruthy();
    expect(FETCHABLE_SOURCES.map((source) => source.url).join(" ")).not.toContain("cbDayQry");
    expect(BLOCKED_CB_DAILY_QUOTE.reason).toContain("bond/cbDayQry");
  });

  it("keeps the previous directory when the master file comes back empty", () => {
    const failed = buildSnapshot({
      now,
      payloads: {
        ...payloads,
        "cb-master": { ok: false, rows: [], error: "HTTP 500", fetchedAt: null, httpStatus: 500, sha256: null, finalUrl: null },
      },
      previous: snapshot,
      previousBars: [],
    });
    expect(failed.snapshot.instruments).toHaveLength(snapshot.instruments.length);
    expect(failed.snapshot.instruments.find((item) => item.cbCode === "11011")?.issuerEquity?.close).toBe(26.75);
    expect(failed.verifiedFailures.some((line) => line.startsWith("cb-master"))).toBe(true);
    expect(failed.persistBars).toBe(false);
  });
});

describe("storage and paths", () => {
  it("upserts stock bars without inventing convertible-bond bars", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cbradar-"));
    const paths = defaultPaths(dir);
    const first = await runUpdate({ paths, fromVendor: vendor, now, pauseMs: 0 });
    const db = openDatabase(paths.dbPath);
    const bars = countStockBars(db);
    expect(countCbBars(db)).toBe(0);
    db.close();
    const second = await runUpdate({ paths, fromVendor: vendor, now, pauseMs: 0 });
    const db2 = openDatabase(paths.dbPath);
    expect(countStockBars(db2)).toBe(bars);
    expect(countCbBars(db2)).toBe(0);
    db2.close();
    expect(first.complete).toBe(false);
    expect(second.codedBonds).toBe(399);
    const snapshot = JSON.parse(fs.readFileSync(path.join(paths.publishDir, "snapshot.json"), "utf8"));
    expect(snapshot.coverage.premiumComputed).toBe(0);
  });

  it("resolves data next to a GitHub Pages subdirectory", () => {
    expect(resolveDataUrl("https://sukukoc.github.io/twse-broker-branch/convertible-bonds/", "data/snapshot.json")).toBe(
      "https://sukukoc.github.io/twse-broker-branch/convertible-bonds/data/snapshot.json",
    );
    expect(resolveDataUrl("https://sukukoc.github.io/twse-broker-branch/convertible-bonds/index.html#/bond/11011", "data/snapshot.json")).toBe(
      "https://sukukoc.github.io/twse-broker-branch/convertible-bonds/data/snapshot.json",
    );
    expect(resolveDataUrl("https://sukukoc.github.io/twse-broker-branch/convertible-bonds", "data/market.csv")).toBe(
      "https://sukukoc.github.io/twse-broker-branch/convertible-bonds/data/market.csv",
    );
    expect(parseHash("#/bond/11011")).toEqual({ name: "bond", id: "11011" });
  });
});
