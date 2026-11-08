import type { ReactNode } from "react";
import type { Route } from "@/lib/public-url";
import { resolveDataUrl } from "@/lib/public-url";
import type { Snapshot } from "@/lib/types";

const LINKS: { href: string; name: Route["name"]; label: string }[] = [
  { href: "#/", name: "market", label: "發行目錄" },
  { href: "#/events", name: "events", label: "公告線索" },
  { href: "#/status", name: "status", label: "資料狀態" },
  { href: "#/methodology", name: "methodology", label: "方法與界線" },
];

export function Shell({
  route,
  snapshot,
  children,
}: {
  route: Route;
  snapshot: Snapshot | null;
  children: ReactNode;
}) {
  const csv = typeof window === "undefined" ? "data/market.csv" : resolveDataUrl(window.location.href, "data/market.csv");
  return (
    <div className="min-h-screen">
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-card focus:px-3 focus:py-2">
        跳到內容
      </a>
      <header className="bg-pine text-paper">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-5 md:flex-row md:items-end md:justify-between">
          <div className="flex items-start gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-cinnabar text-lg font-semibold">雷</div>
            <div>
              <p className="text-xs tracking-[0.18em] text-[#d5e4dc]">TAIWAN CB RESEARCH</p>
              <h1 className="text-2xl font-semibold tracking-wide">可轉債研究雷達</h1>
              <p className="mt-1 max-w-xl text-sm text-[#d7e3dc]">
                發行目錄、發行人股票、公告與月營收。不是買賣名單，也沒有可轉債溢價排名。
              </p>
            </div>
          </div>
          <a className="text-sm underline decoration-white/40 underline-offset-4" href={csv}>
            下載已核對欄位 CSV
          </a>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-2 overflow-x-auto px-4 pb-3" aria-label="主要">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              aria-current={route.name === link.name ? "page" : undefined}
              className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${route.name === link.name ? "bg-paper text-ink" : "text-paper/90 hover:bg-white/10"}`}
            >
              {link.label}
            </a>
          ))}
        </nav>
      </header>
      {snapshot ? <Coverage snapshot={snapshot} /> : null}
      <main id="content" className="mx-auto max-w-6xl px-4 py-6">
        {children}
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-10 text-xs leading-6 text-muted">
        {snapshot?.attribution ?? "資料尚未載入。"}
        <span className="mt-2 block">
          {snapshot?.schedulingEnabled
            ? "每個週一到週五台北時間 18:00，由 GitHub Actions 在伺服器更新。靜態頁只讀同一層的 data 檔，不從瀏覽器呼叫交易所。"
            : "排程沒有啟用。靜態頁只讀同一層的 data 檔，不從瀏覽器呼叫交易所。"}
        </span>
      </footer>
    </div>
  );
}

function Coverage({ snapshot }: { snapshot: Snapshot }) {
  const items = [
    ["主檔", snapshot.coverage.cbMasterAsOf ?? "未取得"],
    ["發行人股票", snapshot.coverage.issuerEquityAsOf ?? "未取得"],
    ["月營收", snapshot.coverage.revenueYearMonth ?? "未取得"],
    ["可轉債收盤", "未取得"],
    ["目前生效轉換價", "未取得"],
  ];
  return (
    <div className="border-b border-line bg-[#efe7d8]">
      <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-3 px-4 py-3 text-sm md:grid-cols-5">
        {items.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
