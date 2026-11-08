import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildSnapshot, type SourcePayload } from "./assemble";
import { snapshotToCsv } from "./csv";
import { atomicWrite, backupFile, copyFiles } from "./publish";
import { formatTaipeiIso } from "./dates";
import { FETCHABLE_SOURCES, verifiedNine } from "./sources";
import { countCbBars, countStockBars, openDatabase, readStockBars, writeRun, writeStockBars } from "./storage";
import type { Snapshot, SourceId } from "./types";
import { loadVendorPayloads } from "./vendor";

export interface UpdatePaths {
  dbPath: string;
  publishDir: string;
  publicDataDir: string;
  backupDir: string;
  rawDir: string;
}

export interface UpdateOptions {
  paths: UpdatePaths;
  now?: Date;
  fromVendor?: string;
  fetchImpl?: typeof fetch;
  pauseMs?: number;
  schedulingEnabled?: boolean;
}

export interface UpdateReport {
  runStatus: Snapshot["runStatus"];
  complete: false;
  verifiedFailures: string[];
  cbDailyBars: number;
  stockBars: number;
  codedBonds: number;
  generatedAt: string;
  wroteSnapshot: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(fetchImpl: typeof fetch, url: string): Promise<SourcePayload> {
  let lastError = "沒有回應";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "cb-research-radar/0.1 (open-data; server-side batch)",
        },
        signal: AbortSignal.timeout(40_000),
      });
      const text = await response.text();
      const sha256 = createHash("sha256").update(text).digest("hex");
      const contentType = response.headers.get("content-type");
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
      } else if (contentType && !contentType.includes("json")) {
        return {
          ok: false,
          rows: [],
          error: `Content-Type 不是 JSON：${contentType}`,
          fetchedAt: formatTaipeiIso(new Date()),
          httpStatus: response.status,
          sha256,
          finalUrl: response.url || url,
        };
      } else {
        const parsed = JSON.parse(text) as unknown;
        if (!Array.isArray(parsed)) {
          return {
            ok: false,
            rows: [],
            error: "JSON 不是陣列",
            fetchedAt: formatTaipeiIso(new Date()),
            httpStatus: response.status,
            sha256,
            finalUrl: response.url || url,
          };
        }
        return {
          ok: true,
          rows: parsed,
          error: null,
          fetchedAt: formatTaipeiIso(new Date()),
          httpStatus: response.status,
          sha256,
          finalUrl: response.url || url,
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : "讀取失敗";
    }
    await sleep(400 * attempt * attempt);
  }
  return {
    ok: false,
    rows: [],
    error: lastError,
    fetchedAt: formatTaipeiIso(new Date()),
    httpStatus: null,
    sha256: null,
    finalUrl: url,
  };
}

function readPrevious(file: string): Snapshot | null {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot;
  } catch {
    return null;
  }
}

export async function runUpdate(options: UpdateOptions): Promise<UpdateReport> {
  const now = options.now ?? new Date();
  const snapshotFile = path.join(options.paths.publishDir, "snapshot.json");
  const previous = readPrevious(snapshotFile);
  const db = openDatabase(options.paths.dbPath);
  const previousBars = readStockBars(db);
  let payloads: Partial<Record<SourceId, SourcePayload>>;
  if (options.fromVendor) {
    payloads = loadVendorPayloads(options.fromVendor);
  } else {
    payloads = {};
    const fetchImpl = options.fetchImpl ?? fetch;
    for (const source of FETCHABLE_SOURCES) {
      payloads[source.id] = await fetchJson(fetchImpl, source.url);
      const body = payloads[source.id];
      if (body?.ok && body.sha256) {
        const rawFile = path.join(options.paths.rawDir, source.id, `${body.sha256}.json`);
        atomicWrite(rawFile, JSON.stringify(body.rows));
      }
      await sleep(options.pauseMs ?? 800);
    }
  }
  const built = buildSnapshot({ now, payloads, previous, previousBars, schedulingEnabled: options.schedulingEnabled === true });
  const nineFailed = built.verifiedFailures.filter((line) =>
    verifiedNine().some((source) => line.startsWith(`${source.id}:`)),
  );
  backupFile(snapshotFile, options.paths.backupDir);
  if (fs.existsSync(options.paths.dbPath)) backupFile(options.paths.dbPath, options.paths.backupDir);
  if (built.persistBars) writeStockBars(db, built.stockBars);
  const csv = snapshotToCsv(built.snapshot);
  atomicWrite(snapshotFile, `${JSON.stringify(built.snapshot)}\n`);
  atomicWrite(path.join(options.paths.publishDir, "market.csv"), csv);
  const report: UpdateReport = {
    runStatus: built.snapshot.runStatus,
    complete: false,
    verifiedFailures: nineFailed,
    cbDailyBars: countCbBars(db),
    stockBars: countStockBars(db),
    codedBonds: built.snapshot.coverage.codedBonds,
    generatedAt: built.snapshot.generatedAt,
    wroteSnapshot: true,
  };
  atomicWrite(path.join(options.paths.publishDir, "last-update.json"), `${JSON.stringify(report, null, 2)}\n`);
  copyFiles(options.paths.publishDir, options.paths.publicDataDir, ["snapshot.json", "market.csv", "last-update.json"]);
  writeRun(db, built.snapshot.generatedAt, built.snapshot.generatedAt, built.snapshot.runStatus, report);
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  return report;
}

export function defaultPaths(root: string): UpdatePaths {
  return {
    dbPath: path.join(root, "data", "cb-radar.sqlite"),
    publishDir: path.join(root, "data", "published"),
    publicDataDir: path.join(root, "public", "data"),
    backupDir: path.join(root, "data", "backups"),
    rawDir: path.join(root, "data", "raw"),
  };
}
