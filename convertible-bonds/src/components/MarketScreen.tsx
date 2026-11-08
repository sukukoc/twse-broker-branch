import { useMemo, useState } from "react";
import { Badge, Missing, TextInput } from "@/components/ui";
import { formatNumber, formatPercentPoints, formatShares } from "@/lib/format";
import type { Instrument, Snapshot } from "@/lib/types";

type View = "coded" | "quarantine";
type SortKey = "cbCode" | "shortName" | "maturityDate" | "issuance" | "close" | "volume" | "mom";

export function MarketScreen({ snapshot }: { snapshot: Snapshot }) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("coded");
  const [market, setMarket] = useState<"all" | "TWSE" | "TPEx" | "none">("all");
  const [sortKey, setSortKey] = useState<SortKey>("cbCode");
  const [volumeMin, setVolumeMin] = useState("");
  const rows = useMemo(() => {
    const min = volumeMin.trim() === "" ? null : Number(volumeMin);
    const q = query.trim().toLowerCase();
    const picked = snapshot.instruments.filter((item) => (view === "quarantine" ? item.quarantined : !item.quarantined));
    return picked
      .filter((item) => {
        if (market === "none") return item.issuerEquity == null;
        if (market !== "all" && item.issuerEquity?.market !== market) return false;
        if (min != null && Number.isFinite(min)) {
          if (item.issuerEquity?.volumeShares == null || item.issuerEquity.volumeShares < min) return false;
        }
        if (!q) return true;
        const hay = [item.cbCode, item.shortName, item.issuerCode, item.issuerName, item.issuerEquity?.name]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => compare(a, b, sortKey));
  }, [snapshot.instruments, query, view, market, sortKey, volumeMin]);

  return (
    <section>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold">轉(交)換債發行目錄</h2>
          <p className="mt-1 text-sm text-muted">
            有代碼 {snapshot.coverage.codedBonds} 檔，代碼無法當主鍵 {snapshot.coverage.quarantined} 檔。有代碼不等於已確認正在交易。
          </p>
        </div>
        <div className="flex gap-2">
          <button className={tab(view === "coded")} onClick={() => setView("coded")} type="button">有債券代碼</button>
          <button className={tab(view === "quarantine")} onClick={() => setView("quarantine")} type="button">隔離區</button>
        </div>
      </div>
      <div className="mb-4 grid gap-3 md:grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr]">
        <label className="block text-sm">
          <span className="mb-1 block text-muted">搜尋代碼或名稱</span>
          <TextInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如 11011 或 台泥" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">發行人股票市場</span>
          <select className="h-10 w-full rounded-xl border border-line bg-card px-3" value={market} onChange={(event) => setMarket(event.target.value as typeof market)}>
            <option value="all">全部</option>
            <option value="TWSE">上市行情有對到</option>
            <option value="TPEx">上櫃行情有對到</option>
            <option value="none">沒有對到</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">排序</span>
          <select className="h-10 w-full rounded-xl border border-line bg-card px-3" value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
            <option value="cbCode">債券代碼</option>
            <option value="shortName">簡稱</option>
            <option value="maturityDate">到期日</option>
            <option value="issuance">發行時轉換價</option>
            <option value="close">發行人股票收盤</option>
            <option value="volume">發行人成交股數</option>
            <option value="mom">{snapshot.coverage.revenueYearMonth ?? "未取得"} 月增率</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">發行人成交股數至少</span>
          <TextInput inputMode="numeric" value={volumeMin} onChange={(event) => setVolumeMin(event.target.value)} placeholder="股，不是可轉債張數" />
        </label>
      </div>
      <fieldset disabled className="mb-4 rounded-2xl border border-dashed border-line bg-card/70 p-4 opacity-80">
        <legend className="px-2 text-sm font-medium text-cinnabar">尚未開放的篩選</legend>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm">市場轉換溢價下限<input disabled className="mt-1 h-10 w-full rounded-xl border border-line px-3" /></label>
          <label className="text-sm">轉換價值區間<input disabled className="mt-1 h-10 w-full rounded-xl border border-line px-3" /></label>
          <label className="text-sm">可轉債成交量<input disabled className="mt-1 h-10 w-full rounded-xl border border-line px-3" /></label>
        </div>
        <p id="blocked-filters" className="mt-3 text-sm text-muted">
          溢價要有同日可轉債百元價、有效轉換價，以及一致的股價。這三樣目前沒有同時成立，所以不做溢價排名，也不用發行價代算。
        </p>
      </fieldset>
      <p className="mb-3 text-sm text-muted">顯示 {rows.length} 列</p>
      {rows.length === 0 ? (
        <p className="rounded-2xl border border-line bg-card p-6 text-sm">沒有符合的列。空白是未知，不是零。</p>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-line bg-card md:block">
            <table className="w-full min-w-[860px] border-collapse text-left text-sm">
              <caption className="sr-only">可轉債發行目錄</caption>
              <thead className="bg-sand text-xs text-muted">
                <tr>
                  {["債券", "發行人", "到期", "發行時轉換價", "發行人股票", "成交股數", "月營收月增"].map((label) => (
                    <th key={label} scope="col" className="px-3 py-2 font-medium">{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr key={item.recordId} className="border-t border-line">
                    <th scope="row" className="px-3 py-3 text-left font-medium">
                      <a className="underline decoration-line underline-offset-4" href={`#/bond/${encodeURIComponent(item.recordId)}`}>
                        {item.cbCode ?? "無代碼"} {item.shortName}
                      </a>
                    </th>
                    <td className="px-3 py-3">{item.issuerCode} {item.issuerName}</td>
                    <td className="px-3 py-3 tabular-nums">{item.maturityDate ?? <Missing />}</td>
                    <td className="px-3 py-3 tabular-nums">{formatNumber(item.conversionPriceAtIssuance) ?? <Missing />}</td>
                    <td className="px-3 py-3">
                      {item.issuerEquity ? (
                        <span className="tabular-nums">{item.issuerEquity.market} {formatNumber(item.issuerEquity.close, 2) ?? item.issuerEquity.closeRaw}</span>
                      ) : <Missing />}
                      {item.issuerEquity && !item.issuerEquity.nameMatchesIssuer ? <Badge tone="warn">名稱不同</Badge> : null}
                    </td>
                    <td className="px-3 py-3 tabular-nums">{formatShares(item.issuerEquity?.volumeShares) ?? <Missing />}</td>
                    <td className="px-3 py-3 tabular-nums">{formatPercentPoints(item.revenue?.momPct) ?? <Missing />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 md:hidden">
            {rows.map((item) => (
              <a key={item.recordId} href={`#/bond/${encodeURIComponent(item.recordId)}`} className="rounded-2xl border border-line bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted">{item.cbCode ?? "無代碼"}</p>
                    <p className="text-lg font-semibold">{item.shortName || item.issuerName}</p>
                  </div>
                  <Badge>{item.issuerEquity?.market ?? "股票未對到"}</Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div><dt className="text-xs text-muted">發行人</dt><dd>{item.issuerCode} {item.issuerName}</dd></div>
                  <div><dt className="text-xs text-muted">到期</dt><dd>{item.maturityDate ?? "未取得"}</dd></div>
                  <div><dt className="text-xs text-muted">發行時轉換價</dt><dd className="tabular-nums">{formatNumber(item.conversionPriceAtIssuance) ?? "未取得"}</dd></div>
                  <div><dt className="text-xs text-muted">發行人收盤</dt><dd className="tabular-nums">{formatNumber(item.issuerEquity?.close, 2) ?? "未取得"}</dd></div>
                </dl>
              </a>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function tab(active: boolean): string {
  return `rounded-full px-3 py-1.5 text-sm ${active ? "bg-ink text-paper" : "bg-sand text-ink"}`;
}

function compare(a: Instrument, b: Instrument, key: SortKey): number {
  const value = (item: Instrument): string | number | null => {
    if (key === "cbCode") return item.cbCode;
    if (key === "shortName") return item.shortName;
    if (key === "maturityDate") return item.maturityDate;
    if (key === "issuance") return item.conversionPriceAtIssuance;
    if (key === "close") return item.issuerEquity?.close ?? null;
    if (key === "volume") return item.issuerEquity?.volumeShares ?? null;
    return item.revenue?.momPct ?? null;
  };
  const left = value(a);
  const right = value(b);
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
