#!/usr/bin/env python3
"""Fetch TWSE broker-branch (券商分點) daily buy/sell for listed stocks from bsr.twse.com.tw.
BSR only serves the LATEST trading day, so run once per day after it updates (evening).
Usage: python3 fetch_all.py [--stocks 2330,2317] [--only-common] [--delay 1.5] [--out DIR]
Output: OUT/YYYY-MM-DD/raw/<stk>.csv (resume cache) + OUT/broker_branch_YYYY-MM-DD.csv
Columns: date, stock_id, broker_id, broker_branch, price, buy_shares, sell_shares
"""
import argparse, csv, io, json, os, re, sys, time, random
import requests, ddddocr, threading
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from bs4 import BeautifulSoup

B = "https://bsr.twse.com.tw/bshtm/"
UA = "Mozilla/5.0 (X11; Linux x86_64) personal-research"
ocr = ddddocr.DdddOcr(show_ad=False)
OCR_LOCK = threading.Lock()
TO = (5, 15)  # connect, read timeouts

def listed_stocks():
    # Prefer MI_INDEX for today (Taipei); the openapi STOCK_DAY_ALL can lag a day in the evening.
    try:
        from datetime import datetime, timezone, timedelta
        today = datetime.now(timezone(timedelta(hours=8))).strftime("%Y%m%d")
        j = requests.get("https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX",
                         params=dict(date=today, type="ALLBUT0999", response="json"), timeout=TO).json()
        if j.get("stat") == "OK":
            for t in j["tables"]:
                if t.get("fields") and t["fields"][:3] == ["證券代號", "證券名稱", "成交股數"] and t.get("data"):
                    vol = {r[0].strip(): int(r[2].replace(",", "") or 0) for r in t["data"]}
                    return f"{today[:4]}-{today[4:6]}-{today[6:]}", vol
    except Exception as e:
        print("MI_INDEX lookup failed, falling back to openapi:", e, flush=True)
    return listed_stocks_openapi()

def listed_stocks_openapi():
    d = requests.get("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL", timeout=TO).json()
    date = d[0]["Date"]  # ROC yyyMMdd
    y, m, dd = int(date[:3]) + 1911, date[3:5], date[5:7]
    vol = {x["Code"]: int(x["TradeVolume"] or 0) for x in d}
    return f"{y}-{m}-{dd}", vol

def fetch_one(s, stk, max_tries=8):
    for t in range(max_tries):
        r = s.get(B + "bsMenu.aspx", timeout=TO)
        soup = BeautifulSoup(r.text, "lxml")
        data = {i["name"]: i.get("value", "") for i in soup.select("input[type=hidden]")}
        img = soup.find("img", src=re.compile("CaptchaImage"))["src"]
        im = s.get(B + img, timeout=TO).content
        with OCR_LOCK: code = ocr.classification(im)
        data.update(RadioButton_Normal="RadioButton_Normal", TextBox_Stkno=stk,
                    CaptchaControl1=code, btnOK="查詢")
        r = s.post(B + "bsMenu.aspx", data=data, timeout=TO)
        err = re.search(r'id="Label_ErrorMsg"[^>]*>(.*?)</span>', r.text, re.S)
        err = err.group(1).strip() if err else ""
        if re.search(r"下載\s+%s\s+CSV" % re.escape(stk), r.text) and not err:
            c = s.get(B + "bsContent.aspx", timeout=(5, 30))
            if c.status_code == 200 and "csv" in c.headers.get("content-type", ""):
                return c.content.decode("utf-8-sig"), t + 1
        if err and "驗證碼" not in err:   # e.g. 查無資料 -> no trades / invalid code
            return None, t + 1
        time.sleep(0.3 + 0.3 * random.random())
    raise RuntimeError(f"{stk}: captcha failed {max_tries}x")

def parse(text):
    rows = []
    for line in csv.reader(io.StringIO(text)):
        for k in (0, 6):
            seg = line[k:k + 5]
            if len(seg) == 5 and seg[0].strip().isdigit():
                br = seg[1].strip()
                rows.append((br[:4], br[4:].replace("\u3000", "").strip(), seg[2],
                             int(seg[3]), int(seg[4])))
    return rows

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stocks"); ap.add_argument("--only-common", action="store_true",
                    help="only 4-digit codes (skip ETFs/ETNs with 5-6 char codes)")
    ap.add_argument("--delay", type=float, default=0.5)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--out", default=os.path.dirname(os.path.abspath(__file__)))
    a = ap.parse_args()
    date, vol = listed_stocks()
    stocks = a.stocks.split(",") if a.stocks else [c for c, v in vol.items() if v > 0]
    if a.only_common: stocks = [c for c in stocks if len(c) == 4]
    rawdir = os.path.join(a.out, date, "raw"); os.makedirs(rawdir, exist_ok=True)
    stats = dict(ok=0, tries=0, empty=0, fail=0, vol_mismatch=0); t0 = time.time()
    lock = threading.Lock(); local = threading.local()
    def sess():
        if not hasattr(local, "s"):
            local.s = requests.Session(); local.s.headers["User-Agent"] = UA
        return local.s
    def work(stk):
        p = os.path.join(rawdir, stk + ".csv")
        for attempt in range(3):
            try:
                txt, tries = fetch_one(sess(), stk); break
            except Exception as e:
                local.s = requests.Session(); local.s.headers["User-Agent"] = UA
                if attempt == 2:
                    with lock: stats["fail"] += 1
                    print("FAIL", stk, e, flush=True); return
                time.sleep(3)
        with lock: stats["tries"] += tries
        if txt is None:
            with lock: stats["empty"] += 1
            open(p + ".empty", "w").close(); return
        rows = parse(txt)
        buy = sum(r[3] for r in rows); sell = sum(r[4] for r in rows)
        if buy != sell or (stk in vol and not (0.5 * vol[stk] <= buy <= vol[stk])):
            with lock: stats["vol_mismatch"] += 1
            print(f"WARN {stk} buy_sum={buy} sell_sum={sell} vs STOCK_DAY_ALL vol={vol.get(stk)} (BSR may be a different day)", flush=True)
        tmp = p + ".tmp"; open(tmp, "w", encoding="utf-8").write(txt); os.replace(tmp, p)
        with lock:
            stats["ok"] += 1; n = stats["ok"]
        if n % 25 == 0:
            print(f"[{n}/{len(todo)}] {stk} elapsed={(time.time()-t0)/60:.1f}m {stats}", flush=True)
        time.sleep(a.delay)
    todo = [c for c in stocks if not os.path.exists(os.path.join(rawdir, c + ".csv"))
            and not os.path.exists(os.path.join(rawdir, c + ".csv.empty"))]
    print(f"{len(stocks)} stocks, {len(todo)} to fetch, workers={a.workers}", flush=True)
    with ThreadPoolExecutor(a.workers) as ex:
        list(ex.map(work, todo))
    out = os.path.join(a.out, f"broker_branch_{date}.csv")
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["date", "stock_id", "broker_id", "broker_branch", "price", "buy_shares", "sell_shares"])
        for stk in stocks:
            p = os.path.join(rawdir, stk + ".csv")
            if os.path.exists(p):
                for r in parse(open(p, encoding="utf-8").read()):
                    w.writerow([date, stk, *r])
    print("DONE", out, stats, f"{(time.time()-t0)/60:.1f} min", flush=True)

if __name__ == "__main__":
    main()
