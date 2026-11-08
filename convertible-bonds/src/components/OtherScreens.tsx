import { useMemo, useState } from "react";
import { Badge, TextInput } from "@/components/ui";
import type { Snapshot } from "@/lib/types";

export function EventsScreen({ snapshot }: { snapshot: Snapshot }) {
  const [onlyLeads, setOnlyLeads] = useState(true);
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const q = query.trim();
    return snapshot.events.filter((event) => {
      if (onlyLeads && event.lead === "other") return false;
      if (!q) return true;
      return `${event.companyCode} ${event.companyName} ${event.subject} ${event.explanation}`.includes(q);
    });
  }, [snapshot.events, onlyLeads, query]);
  return (
    <section>
      <h2 className="text-xl font-semibold">公告與法說線索</h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        上市這次 {snapshot.eventCounts.listedRows} 則，其中可轉債或法說關鍵字 {snapshot.eventCounts.listedLeads} 則。
        上櫃 {snapshot.eventCounts.otcRows} 則，關鍵字 {snapshot.eventCounts.otcLeads} 則。
        這是當期快照，不是完整行事曆，也沒有簡報檔。
      </p>
      <div className="my-4 flex flex-col gap-3 md:flex-row">
        <label className="block flex-1 text-sm">
          <span className="mb-1 block text-muted">搜尋</span>
          <TextInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="公司、可轉債、法說" />
        </label>
        <button type="button" className="h-10 self-end rounded-full bg-sand px-4 text-sm" onClick={() => setOnlyLeads((value) => !value)}>
          {onlyLeads ? "只看可轉債與法說" : "看全部重大訊息"}
        </button>
      </div>
      {snapshot.eventCounts.listedLeads === 0 ? (
        <p className="mb-3 rounded-2xl bg-sand px-4 py-3 text-sm">上市重大訊息這次沒有對到可轉債或法說關鍵字。這不代表歷史上沒有。</p>
      ) : null}
      <div className="space-y-3">
        {rows.map((event) => (
          <article key={event.id} className="rounded-2xl border border-line bg-card p-4">
            <div className="flex flex-wrap gap-2">
              <Badge>{event.market}</Badge>
              <Badge tone={event.lead === "other" ? "muted" : "warn"}>{event.lead === "other" ? "其他" : "線索"}</Badge>
            </div>
            <h3 className="mt-2 text-base font-semibold">{event.companyCode} {event.companyName}</h3>
            <p className="mt-1 text-sm">{event.subject}</p>
            <p className="mt-2 text-xs text-muted">
              出表 {event.publishedDate ?? "未取得"}，發言 {event.spokenAt ?? "未取得"}，事實日 {event.factDate ?? "未取得"}
            </p>
            <details className="mt-2">
              <summary className="cursor-pointer text-sm text-pine">閱讀說明</summary>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{event.explanation}</p>
            </details>
          </article>
        ))}
      </div>
    </section>
  );
}

export function StatusScreen({ snapshot }: { snapshot: Snapshot }) {
  return (
    <section>
      <h2 className="text-xl font-semibold">資料狀態</h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        這次狀態是「{snapshot.runStatus}」，complete 為 false。九個已驗證來源可以更新，但可轉債個券行情與目前生效轉換價仍缺，所以不是完整成功。
        {snapshot.schedulingEnabled ? "每個週一到週五台北時間 18:00 由 GitHub Actions 更新。" : "排程沒有啟用。"}
      </p>
      <p className="mt-3 text-sm">股票新鮮度：{snapshot.calendar.equityFreshness}。預期交易日：{snapshot.calendar.expectedEquitySession ?? "未判斷"}。{snapshot.calendar.note}</p>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-card">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-sand text-xs text-muted">
            <tr>
              {["資料", "狀態", "資料日", "列數", "取得時間"].map((label) => <th key={label} className="px-3 py-2 font-medium">{label}</th>)}
            </tr>
          </thead>
          <tbody>
            {snapshot.sources.map((source) => (
              <tr key={source.id} className="border-t border-line align-top">
                <th scope="row" className="px-3 py-3 text-left font-medium">
                  <a className="underline" href={source.url}>{source.title}</a>
                  <p className="mt-1 text-xs font-normal text-muted">{source.note}</p>
                </th>
                <td className="px-3 py-3">{source.status}</td>
                <td className="px-3 py-3">{source.asOfLabel}</td>
                <td className="px-3 py-3 tabular-nums">{source.rowCount ?? "—"}</td>
                <td className="px-3 py-3">{source.retrievedAt ?? "未記錄"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function MethodologyScreen() {
  return (
    <article className="max-w-3xl space-y-4 text-sm leading-7">
      <h2 className="text-xl font-semibold">方法與界線</h2>
      <p>
        這座站把《小資可轉債權攻略》整理筆記裡的歷史教材，和現在真正接上的官方資料分開。教材裡的策略是作者當時的研究架構，不是本站已經算出的買賣訊號。
      </p>
      <h3 className="text-base font-semibold">現在有的</h3>
      <ul className="list-disc space-y-1 pl-5">
        <li>櫃買轉(交)換債發行主檔，資料日 2026-11-07 的已驗證快照，以及之後每次更新抓到的同一支 OpenAPI。</li>
        <li>上市與上櫃股票日成交。只在機構代碼完全相同時並陳，並標成發行人股票。</li>
        <li>上市與上櫃月營收。畫面年月來自來源的「資料年月」。先前核過的公開快照是 2026 年 9 月、出表日 2026-10-17，那不是 10 月營收；若來源改了月份，以當次快照為準。</li>
        <li>重大訊息裡用關鍵字找出的可轉債與法說線索。</li>
        <li>上櫃融資融券有檔案日期；上市融資融券沒有日期欄，交易日保持空白。</li>
      </ul>
      <h3 className="text-base font-semibold">現在沒有、也不會補假的</h3>
      <ul className="list-disc space-y-1 pl-5">
        <li>可轉債個券開高低收與成交量。公開網頁有下載 CSV 按鈕，但沒有正式、可授權再散布的網址。不呼叫頁面內部的 bond/cbDayQry。</li>
        <li>目前生效轉換價與歷次調整。主檔欄位只是發行時轉換價格。</li>
        <li>溢價、轉換價值排名、突破轉換價、十日量新高、CBAS 報價與任何回測。</li>
      </ul>
      <h3 className="text-base font-semibold">公式</h3>
      <p>轉換價值 V = 100 × S / K。市場轉換溢價 = P / V − 1。K 必須是目前生效價格。發行價、零、空白都不會被拿去算。沒有同日的 P 與 S 也不算。</p>
      <h3 className="text-base font-semibold">單位</h3>
      <p>股票成交量用官方的「成交股數」，不改成張。營收百分比維持來源數值。債券金額、賣回價、幣別代碼與融資融券數量，規格沒寫單位，畫面上就不加元或張。</p>
      <h3 className="text-base font-semibold">教材策略對照</h3>
      <p>條款篩選、第六天、相對溢價、突破轉換價、券償、蜜月、長黑與量能新高，都還停在研究筆記。本站只在資料狀態頁標出缺什麼。沒有自動下單，也沒有外部通知。</p>
      <h3 className="text-base font-semibold">授權</h3>
      <p>
        九個已驗證資料集在政府資料開放平臺標示政府資料開放授權條款第 1 版。使用時保留資料提供機關、資料名稱、資料日與來源網址。櫃買網站使用條款限制開放資料以外的自動擷取，所以可轉債日行情網頁沒有被抓進來。
      </p>
    </article>
  );
}
