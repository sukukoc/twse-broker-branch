# 可轉債研究雷達

台灣可轉債的研究目錄。它讀政府資料開放平臺已授權的官方 OpenAPI，整理發行主檔、發行人股票、月營收、重大訊息與融資融券線索。

這不是買賣名單，也沒有可轉債溢價排名。可轉債個券日行情和目前生效轉換價都還沒有正式、可再散布的來源，所以這兩欄維持「未取得」，不會用發行價或 0 補上。

預定放在既有 GitHub Pages 網站的子目錄，網址形如：

`https://sukukoc.github.io/twse-broker-branch/convertible-bonds/`

靜態檔使用相對路徑。建置結果放在這個倉庫的 `docs/convertible-bonds/`，對上上面的子路徑。券商分點頁與 `docs/data/` 維持原樣，首頁只加一條連到這裡的連結。沒有另開倉庫，也沒有部署到 Vercel。

## 現在看得到的資料

驗證樣本時間是 2026-11-08（台北時間）早上抓到的官方回應：

| 資料 | 資料日 | 說明 |
|---|---|---|
| 轉(交)換債發行主檔 | 2026-11-07 | 426 列。其中 399 列有債券代碼，27 列代碼空白、無或 N/A，放在隔離區 |
| 上市／上櫃股票收盤 | 2026-11-06 | 只依機構代碼並陳，稱為發行人股票，不是已核對的轉換標的 |
| 月營收 | 2026-09 | 出表日 2026-10-17。不是 10 月營收 |
| 上櫃重大訊息 | 出表 2026-11-07 | 含可轉債與法說線索。事實日可以是未來 |
| 上市重大訊息 | 出表 2026-11-08 | 這次快照沒有對到可轉債或法說關鍵字 |
| 上櫃融資融券 | 2026-11-06 | 有日期。數量單位未標示 |
| 上市融資融券 | 未記載 | 原始回應沒有交易日，畫面不填成 11 月 6 日 |
| 可轉債個券行情 | 未取得 | 不呼叫網頁內部的 `bond/cbDayQry` |
| 目前生效轉換價 | 未取得 | 主檔只有發行時轉換價格 |

台泥一永 `11011`、中砂二 `15602`、合晶八 `61828` 的有效轉換價、可轉債收盤與溢價都是空值。合晶的發行人股票在上櫃，台泥與中砂在上市。

## 在這台機器上執行

需要 Node.js 22。

```bash
npm ci
npm test
npm run update -- --from-vendor data/vendor/2026-11-08
npm run dev
```

開發站點是 [可轉債研究雷達](http://127.0.0.1:43127)。正式靜態檔：

```bash
npm run build
npm run preview
```

`dist/` 裡的 `index.html`、`assets/`、`data/` 使用 `./` 相對路徑。

## 每日更新命令

向九個已驗證的官方網址，以及開休市日期，做伺服器端 GET。瀏覽器不直接呼叫交易所，所以沒有 CORS 問題。

```bash
npm run update
```

結果寫進：

- `data/cb-radar.sqlite`：發行人股票的日線，依市場、代碼、交易日覆寫同一列。可轉債日線表存在，但在行情來源解鎖前保持 0 列
- `data/published/snapshot.json`：網站讀的最後一次可用快照
- `data/published/market.csv`：含授權網址的匯出，缺值是空欄
- `data/published/last-update.json`：給排程或機器人看的摘要
- `public/data/`：靜態網站一起帶走的副本
- `data/backups/`：覆寫前的備份，只留最近 14 份
- `data/raw/`：線上抓取的原始 JSON

結束時印出一行 `CB_RADAR_RESULT {...}`。`complete` 在可轉債行情與有效轉換價補上之前一直是 `false`。結束代碼 0 只表示九個已驗證來源沒有失敗，不表示研究功能已經齊全。有來源失敗時結束代碼是 1，而且不會用空白蓋掉上次的目錄。

來源若比預期的收盤日舊，狀態是 `pending`，不會製造當天的空白 K 線。台北時間平日 18:00 之後才期待當天股票收盤。倉庫裡的 `.github/workflows/cb-research-daily.yml` 在週一到週五 18:00（台北，UTC 10:00）於 GitHub 的伺服器執行 `npm run update`，並可手動 `workflow_dispatch`。它用 `CB_SCHEDULING=github-actions` 把快照的 `schedulingEnabled` 設為 true。推送使用 `GITHUB_TOKEN`，不會再觸發 Pages 的 push 工作流程，所以同一條工作流程在推送之後另外請求一次 Pages 建置。沒有第二條排程，也沒有外部通知。

離線重跑已驗證樣本：

```bash
npm run update -- --from-vendor data/vendor/2026-11-08
```

## 搬到 GitHub Pages

原始碼在倉庫的 `convertible-bonds/`。`bash scripts/publish-to-docs.sh` 只把 `dist/` 複製到 `docs/convertible-bonds/`，不改券商分點資料。

相對路徑已用下面三個網址形狀測過，都會讀到 `.../convertible-bonds/data/snapshot.json`：

- `.../convertible-bonds/`
- `.../convertible-bonds`
- `.../convertible-bonds/index.html#/bond/11011`

頁面路由使用 hash（`#/bond/11011`），GitHub Pages 不需要另外的重新導向。

更新資料的機器要能跑 Node。更新後把新的 `data/` 與重新建置的 `dist/` 交回那個子目錄。這個工作流還沒有在券商分點倉庫裡啟用。

## 測試

```bash
npm test
```

涵蓋日期與單位、休市日、發行價不得當成有效價、公式與空值、三檔真實對照、名稱不一致、隔離區、上市融資融券沒有日期、9 月營收、空的主檔不會清掉上次目錄、SQLite 重複寫入、相對路徑，以及畫面搜尋與明細。

## 授權

九個市場資料集採用政府資料開放授權條款第 1 版：<https://data.gov.tw/license>。頁尾保留提供機關與來源網址。櫃買網站使用條款限制開放資料以外的自動擷取，因此可轉債日成交網頁只放連結，不抓內容。
