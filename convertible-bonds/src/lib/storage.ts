import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { StockBar } from "./assemble";

export function openDatabase(file: string): DatabaseSync {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS stock_daily (
      market TEXT NOT NULL,
      stock_code TEXT NOT NULL,
      trade_date TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (market, stock_code, trade_date)
    );
    CREATE TABLE IF NOT EXISTS cb_daily (
      cb_code TEXT NOT NULL,
      trade_date TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (cb_code, trade_date)
    );
    CREATE TABLE IF NOT EXISTS ingest_runs (
      run_id TEXT PRIMARY KEY,
      finished_at TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL
    );
  `);
  return db;
}

export function readStockBars(db: DatabaseSync): StockBar[] {
  const rows = db.prepare("SELECT payload FROM stock_daily").all() as { payload: string }[];
  return rows.map((row) => JSON.parse(row.payload) as StockBar);
}

export function countStockBars(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM stock_daily").get() as { n: number };
  return Number(row.n);
}

export function countCbBars(db: DatabaseSync): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM cb_daily").get() as { n: number };
  return Number(row.n);
}

export function writeStockBars(db: DatabaseSync, bars: StockBar[]): void {
  const stmt = db.prepare(
    "INSERT INTO stock_daily (market, stock_code, trade_date, payload) VALUES (?, ?, ?, ?) ON CONFLICT(market, stock_code, trade_date) DO UPDATE SET payload = excluded.payload",
  );
  db.exec("BEGIN");
  try {
    for (const bar of bars) stmt.run(bar.market, bar.code, bar.tradeDate, JSON.stringify(bar));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function writeRun(db: DatabaseSync, runId: string, finishedAt: string, status: string, summary: unknown): void {
  db.prepare("INSERT OR REPLACE INTO ingest_runs (run_id, finished_at, status, summary) VALUES (?, ?, ?, ?)").run(
    runId,
    finishedAt,
    status,
    JSON.stringify(summary),
  );
}
