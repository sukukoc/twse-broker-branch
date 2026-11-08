import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SourcePayload } from "./assemble";
import type { SourceId } from "./types";
import { FETCHABLE_SOURCES } from "./sources";

interface ManifestEntry {
  name: string;
  fetched_at?: string;
  status?: number;
  sha256?: string;
  final_url?: string;
  content_type?: string;
}

const FILE_NAMES: Record<SourceId, string> = {
  "cb-master": "cb-master.raw.json",
  "listed-stock-quotes": "listed-stock-quotes.raw.json",
  "otc-stock-quotes": "otc-stock-quotes.raw.json",
  "listed-margin": "listed-margin.raw.json",
  "otc-margin": "otc-margin.raw.json",
  "listed-events": "listed-events.raw.json",
  "otc-events": "otc-events.raw.json",
  "listed-revenue": "listed-revenue.raw.json",
  "otc-revenue": "otc-revenue.raw.json",
  "twse-holiday": "twse-holiday.raw.json",
};

export function loadVendorPayloads(dir: string): Partial<Record<SourceId, SourcePayload>> {
  const manifestPath = path.join(dir, "request-manifest.json");
  const manifest = fs.existsSync(manifestPath)
    ? (JSON.parse(fs.readFileSync(manifestPath, "utf8")) as ManifestEntry[])
    : [];
  const byName = new Map(manifest.map((entry) => [entry.name, entry]));
  const payloads: Partial<Record<SourceId, SourcePayload>> = {};
  for (const source of FETCHABLE_SOURCES) {
    const file = path.join(dir, FILE_NAMES[source.id]);
    if (!fs.existsSync(file)) {
      payloads[source.id] = {
        ok: false,
        rows: [],
        error: "樣本檔不存在",
        fetchedAt: null,
        httpStatus: null,
        sha256: null,
        finalUrl: source.url,
      };
      continue;
    }
    const bytes = fs.readFileSync(file);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const noted = byName.get(source.id);
    if (noted?.sha256 && noted.sha256 !== sha256) {
      payloads[source.id] = {
        ok: false,
        rows: [],
        error: "SHA-256 與 request-manifest 不符",
        fetchedAt: noted.fetched_at ?? null,
        httpStatus: noted.status ?? null,
        sha256,
        finalUrl: noted.final_url ?? source.url,
      };
      continue;
    }
    const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    if (!Array.isArray(parsed)) {
      payloads[source.id] = {
        ok: false,
        rows: [],
        error: "樣本不是 JSON 陣列",
        fetchedAt: noted?.fetched_at ?? null,
        httpStatus: noted?.status ?? null,
        sha256,
        finalUrl: source.url,
      };
      continue;
    }
    payloads[source.id] = {
      ok: true,
      rows: parsed,
      error: null,
      fetchedAt: noted?.fetched_at ?? null,
      httpStatus: noted?.status ?? null,
      sha256,
      finalUrl: noted?.final_url ?? source.url,
    };
  }
  return payloads;
}
