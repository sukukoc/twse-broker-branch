# twse-broker-branch：台股券商分點買賣抓取 ＋ 權證標的分點排行

每天收盤後，從臺灣證券交易所「買賣日報表查詢系統」抓回 **上市股票** 與 **上市權證** 的券商分點買賣明細，
並把權證依 **標的個股** 加總（認購／認售分開），做成可點選的排行網頁。

🔗 網頁：https://sukukoc.github.io/twse-broker-branch/

## 網頁內容

- 切換 **認購**（含牛證）／**認售**（含熊證），列出權證合計成交金額前 10 名的標的。
- 點一檔標的 →「該標的這一側所有權證」合併後的分點買賣，預設依成交金額由大到小，可切換排序：買進／賣出／買超／賣超。
- 標示「發行商」：分點是發行券商總公司、且買賣多半是自家權證（通常是造市）。
- 可展開看該標的的相關權證清單；用日期選單切換歷史日期。

## 程式

| 檔案 | 用途 |
|---|---|
| `scripts/fetch_all.py` | 抓全部上市股票（含 ETF/ETN/REITs）當日分點買賣 → `broker_branch_<日期>.csv` |
| `scripts/fetch_warrants.py` | 抓當日有成交的上市權證（認購、認售、牛熊證）分點買賣 → `warrant_branch_<日期>.csv` |
| `scripts/warrant_page_data.py` | 權證依標的加總、排行 → `warrant_page_data_<日期>.json`（網頁資料）與排行 CSV |
| `scripts/warrant_rank.py` | 單一權證 × 分點的買進金額／買超前 10 名 |
| `scripts/make_page_embed.py` | 把網頁資料壓縮成精簡版（每檔只留前 30 分點） |
| `scripts/watchdog.sh`、`scripts/warrant_watchdog.sh` | 看門程式：90 秒沒進度就重啟並從中斷處續跑 |
| `publish_site.py` | 把某天的 JSON 放進 `docs/data/`、更新日期清單，commit 並 push 到 GitHub Pages |

驗證碼用本機 [ddddocr](https://github.com/sml2h3/ddddocr) 辨識；預設同時 4 條連線，每檔間隔 0.5 秒；已抓過的檔案會快取在 `<日期>/raw/`、`<日期>/warrant_raw/`，中斷後重跑會接續。

## 使用方式

```bash
pip install -r requirements.txt
cd scripts

# 1) 股票分點（全市場約 25 分鐘）
python3 fetch_all.py                    # 或 --stocks 2330,2317 只抓幾檔
# 2) 權證分點（日期為 YYYYMMDD，預設今天）
python3 fetch_warrants.py --date 20261029
# 3) 權證依標的排行 → warrant_page_data_2026-10-29.json
python3 warrant_page_data.py 2026-10-29
# 4) 發佈到網頁
cd .. && python3 publish_site.py 2026-10-29 --src scripts
```

`publish_site.py` 會從 `~/.secrets/github_pat`（或環境變數 `GITHUB_TOKEN`）讀 token，只在 push 當下以環境變數傳給 git，不會寫進 repo 或 `.git/config`。

建議排程：週一到週五 17:20（台北時間）以後執行（證交所約 15:00–16:00 間更新為當日資料）。

## 資料來源與注意事項

- 資料來源：臺灣證券交易所 買賣日報表查詢系統 <https://bsr.twse.com.tw/bshtm/>，以及證交所盤後行情（MI_INDEX）。
- 證交所只提供 **最近一個交易日** 的分點資料，沒有歷史；只能每天自己存下來。
- 目前只含上市（證交所），不含上櫃（櫃買中心）。
- **使用條款**：證交所網站資料的著作權屬臺灣證券交易所，其使用條款限制未經同意的轉載、散布與商業使用。本 repo 與網頁僅供個人研究，請勿作商業用途；原始 CSV 不放在 repo 中。若證交所要求，請移除網頁資料。
- 本專案資料不構成任何投資建議。
