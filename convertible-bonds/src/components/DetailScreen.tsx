import type { ReactNode } from "react";
import { Badge, Missing } from "@/components/ui";
import { formatNumber, formatPercentPoints, formatShares } from "@/lib/format";
import type { Instrument, Snapshot } from "@/lib/types";

export function DetailScreen({ snapshot, id }: { snapshot: Snapshot; id: string }) {
  const item = snapshot.instruments.find((row) => row.recordId === id);
  if (!item) {
    return (
      <section>
        <a href="#/" className="text-sm underline">回目錄</a>
        <h2 className="mt-3 text-xl font-semibold">找不到這筆</h2>
        <p className="mt-2 text-sm text-muted">目錄裡沒有 {id}。沒有用空白列補上。</p>
      </section>
    );
  }
  const events = snapshot.events.filter((event) => event.companyCode === item.issuerCode);
  return (
    <article className="space-y-4">
      <a href="#/" className="text-sm underline">回目錄</a>
      <header className="rounded-3xl border border-line bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          {item.quarantined ? <Badge tone="warn">隔離區</Badge> : <Badge tone="ok">有債券代碼</Badge>}
          <Badge>轉換標的未核對</Badge>
          <Badge tone="bad">可轉債行情未取得</Badge>
        </div>
        <h2 className="mt-3 text-2xl font-semibold">{item.cbCode ?? "無代碼"} {item.shortName}</h2>
        <p className="mt-1 text-sm text-muted">發行人 {item.issuerCode} {item.issuerName}。這是發行機構，不是已經確認的轉換標的。</p>
        {item.quarantineReason ? <p className="mt-2 text-sm">{item.quarantineReason}</p> : null}
      </header>
      <section className="grid gap-4 md:grid-cols-2">
        <Card title="轉換價格">
          <Field label="發行時轉換價" value={formatNumber(item.conversionPriceAtIssuance)} note={`原始欄位 Conversion/ExchangePriceAtIssuance：${item.conversionPriceAtIssuanceRaw || "空白"}`} />
          <Field label="目前生效轉換價" value={null} note="沒有來源。不會把發行價標成目前生效。" />
          <Field label="生效日" value={null} />
          <Field label="停止轉換" value={null} note="未知，不是沒有停止。" />
        </Card>
        <Card title="可轉債行情與公式">
          <Field label="百元收盤 P" value={null} />
          <Field label="轉換價值 V" value={null} />
          <Field label="市場轉換溢價" value={null} />
          <p className="text-sm leading-6 text-muted">
            V = 100 × S / K，溢價 = P / V − 1。只在 P、S、目前生效的 K 都有效且時點一致時才算。現在 P 與有效 K 都未取得，所以兩個結果維持未取得。
          </p>
        </Card>
      </section>
      <Card title="發行人股票">
        {item.issuerEquity ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="市場與名稱" value={`${item.issuerEquity.market} ${item.issuerEquity.name}`} note={item.issuerEquity.nameMatchesIssuer ? "名稱與發行機構相同。" : "名稱與發行機構不同，請自行再核。"} />
            <Field label="交易日" value={item.issuerEquity.tradeDate} />
            <Field label="收盤" value={formatNumber(item.issuerEquity.close, 2) ?? item.issuerEquity.closeRaw} note="幣別未在欄位說明完整標示，所以不加元。" />
            <Field label="成交股數" value={formatShares(item.issuerEquity.volumeShares)} note="官方欄位是成交股數，沒有乘 1,000。" />
            <p className="text-sm text-muted md:col-span-2">
              已保存 {item.issuerEquityHistory.length} 個交易日。不足以計算 87／284 日均線或教材的量能策略。
            </p>
          </div>
        ) : <p className="text-sm">這次快照沒有對到發行人股票。<Missing /></p>}
      </Card>
      {item.conversionPeriodNote ? <p className="rounded-2xl bg-[#f8efdc] px-4 py-3 text-sm text-warn">{item.conversionPeriodNote}</p> : null}
      <section className="grid gap-4 md:grid-cols-2">
        <Card title="日期與條款">
          <Field label="主檔資料日" value={item.masterAsOf} note="不是最後成交日。" />
          <Field label="發行日" value={item.issueDate} />
          <Field label="掛牌日" value={item.listingDate} note="不是最後交易日。" />
          <Field label="到期日" value={item.maturityDate} />
          <Field label="轉換期間" value={item.conversionPeriodStart && item.conversionPeriodEnd ? `${item.conversionPeriodStart} 至 ${item.conversionPeriodEnd}` : null} />
          <Field label="賣回日" value={item.putOptionDate} />
          <Field label="賣回價" value={item.putOptionPrice == null ? null : formatNumber(item.putOptionPrice)} note={item.putTermsStatus === "not_provided" ? `原始值 ${item.putOptionPriceRaw || "空白"}。沒有賣回日的 0 不是零元賣回。單位未標示。` : "單位未在 OpenAPI 標示。"} />
          <Field label="贖回條款" value={null} />
          <Field label="擔保代碼" value={item.guaranteedCodeRaw || null} note={item.guaranteeDescription ? `來源敘述：${item.guaranteeDescription}` : "代碼沒有中文對照，不翻譯成有擔保或無擔保。"} />
          <Field label="掛牌狀態代碼" value={item.listingStatusRaw || null} note="不把代碼 2 或 5 說成上市或上櫃。" />
        </Card>
        <Card title="餘額、票息、營收">
          <Field label="發行總額" value={formatNumber(item.issueAmount, 0)} note="單位未標示。" />
          <Field label="目前餘額" value={formatNumber(item.outstandingAmount, 0)} note="不是集保餘額，差額也不等於已轉換。" />
          <Field label="票面利率" value={item.couponRate == null ? null : `${formatNumber(item.couponRate)}（來源字串 ${item.couponRateRaw}）`} note={item.couponRate === 0 ? "來源寫 0。這是來源記載，不是本站補零。單位未標示。" : "單位未標示。"} />
          <Field label="月營收年月" value={item.revenue?.yearMonth ?? null} note="這是來源記載的資料年月，不是抓取日，也不會把下一個月補上。" />
          <Field label="當月營收" value={formatNumber(item.revenue?.monthRevenue ?? null, 0)} note="金額單位未標示。" />
          <Field label="月增率" value={formatPercentPoints(item.revenue?.momPct ?? null)} note="12.35 代表 12.35%，沒有再乘 100。" />
        </Card>
      </section>
      <Card title="融資融券線索">
        {item.margin ? (
          <div className="space-y-2 text-sm">
            <p>{item.margin.market}。交易日：{item.margin.tradeDate ?? "未確認"}（{item.margin.tradeDateStatus === "not_in_response" ? "這份上市回應沒有日期欄，沒有填成 11 月 6 日。" : "日期來自上櫃檔案。"}）</p>
            <p>券償原始值：{item.margin.stockRedemptionRaw ?? "未取得"}。券買原始值：{item.margin.shortCoverRaw ?? "未取得"}。券賣原始值：{item.margin.shortSaleRaw ?? "未取得"}。</p>
            <p className="text-muted">數量單位未標示。券償增加不是已確認的可轉債轉換，也不能用來指認特定人。</p>
          </div>
        ) : <p className="text-sm">沒有對到融資融券列。<Missing /></p>}
      </Card>
      <Card title="這次快照裡的相關公告">
        {events.length === 0 ? <p className="text-sm">沒有對到此發行機構。不能因此說過去沒有公告。</p> : events.map((event) => (
          <details key={event.id} className="border-t border-line py-3 first:border-t-0">
            <summary className="cursor-pointer text-sm font-medium">{event.subject || "（沒有主旨）"}</summary>
            <p className="mt-2 text-xs text-muted">發言 {event.spokenAt ?? "時間未取得"}，事實日 {event.factDate ?? "未取得"}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{event.explanation}</p>
          </details>
        ))}
      </Card>
      <Card title="這檔現在不能做的研究">
        <ul className="list-disc space-y-1 pl-5 text-sm leading-6">
          <li>不標示突破目前轉換價。沒有生效價歷史。</li>
          <li>不做可轉債十日量新高。沒有個券量。</li>
          <li>不計算 CBAS 權利金或費率。</li>
        </ul>
      </Card>
      <Card title="來源與警告">
        <p className="text-sm"><a className="underline" href={item.sourceUrl}>{item.sourceUrl}</a></p>
        <ul className="mt-3 space-y-2 text-sm">
          {item.warnings.map((warning) => <li key={warning.code}><span className="text-muted">{warning.code}</span> {warning.message}</li>)}
        </ul>
      </Card>
    </article>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-line bg-card p-5">
      <h3 className="mb-3 text-base font-semibold">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, value, note }: { label: string; value: string | null; note?: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-sm font-medium">{value ?? <Missing />}</p>
      {note ? <p className="text-xs leading-5 text-muted">{note}</p> : null}
    </div>
  );
}
