#!/usr/bin/env python3
"""Fetch TWSE broker-branch data for LISTED WARRANTS (認購/認售, incl. 牛熊證) that traded on the latest day.
Reuses fetch_one/parse from fetch_all.py. Resume cache: OUT/<date>/warrant_raw/<id>.csv
Usage: python3 fetch_warrants.py [--date 20261029] [--workers 4] [--delay 0.5] [--ids 030001,...]
"""
import argparse, csv, json, os, sys, time, threading, requests
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_all import fetch_one, parse, UA, TO

TYPES = {"0999": "認購", "0999C": "認購", "0999X": "認購", "0999P": "認售", "0999B": "認售", "0999Y": "認售"}
SUB = {"0999": "認購權證", "0999C": "牛證", "0999X": "可展延牛證", "0999P": "認售權證", "0999B": "熊證", "0999Y": "可展延熊證"}

def warrant_list(day):
    info = {}
    for t, kind in TYPES.items():
        j = requests.get("https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX",
                         params=dict(date=day, type=t, response="json"), timeout=(5, 30)).json()
        if j.get("stat") != "OK" or j.get("date") != day:
            print("MI_INDEX", t, j.get("stat"), j.get("date")); continue
        for tb in j["tables"]:
            if not tb.get("data") or "證券代號" not in (tb.get("fields") or []): continue
            f = tb["fields"]; ix = {k: f.index(k) for k in ("證券代號", "證券名稱", "成交股數", "成交金額", "收盤價", "標的代號", "標的名稱")}
            for r in tb["data"]:
                v = int(r[ix["成交股數"]].replace(",", "") or 0)
                if v > 0:
                    info[r[ix["證券代號"]].strip()] = dict(name=r[ix["證券名稱"]].strip(), type=kind, sub=SUB[t], vol=v,
                        amt=int(r[ix["成交金額"]].replace(",", "") or 0), close=r[ix["收盤價"]],
                        und_id=r[ix["標的代號"]].strip(), und_name=r[ix["標的名稱"]].strip())
        time.sleep(1)
    return info

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=datetime.now(timezone(timedelta(hours=8))).strftime("%Y%m%d"))
    ap.add_argument("--workers", type=int, default=4); ap.add_argument("--delay", type=float, default=0.5)
    ap.add_argument("--ids"); ap.add_argument("--out", default=os.path.dirname(os.path.abspath(__file__)))
    a = ap.parse_args()
    date = f"{a.date[:4]}-{a.date[4:6]}-{a.date[6:]}"
    base = os.path.join(a.out, date); os.makedirs(os.path.join(base, "warrant_raw"), exist_ok=True)
    lp = os.path.join(base, "warrant_list.json")
    if os.path.exists(lp): info = json.load(open(lp, encoding="utf-8"))
    else:
        info = warrant_list(a.date); json.dump(info, open(lp, "w", encoding="utf-8"), ensure_ascii=False)
    ids = a.ids.split(",") if a.ids else sorted(info)
    rawdir = os.path.join(base, "warrant_raw")
    stats = dict(ok=0, tries=0, empty=0, fail=0, vol_mismatch=0); t0 = time.time()
    lock = threading.Lock(); local = threading.local()
    def sess():
        if not hasattr(local, "s"):
            local.s = requests.Session(); local.s.headers["User-Agent"] = UA
        return local.s
    def work(w):
        p = os.path.join(rawdir, w + ".csv")
        for attempt in range(3):
            try:
                txt, tries = fetch_one(sess(), w); break
            except Exception as e:
                local.s = requests.Session(); local.s.headers["User-Agent"] = UA
                if attempt == 2:
                    with lock: stats["fail"] += 1
                    print("FAIL", w, e, flush=True); return
                time.sleep(3)
        with lock: stats["tries"] += tries
        if txt is None:
            with lock: stats["empty"] += 1
            print("EMPTY", w, flush=True); open(p + ".empty", "w").close(); return
        rows = parse(txt); buy = sum(r[3] for r in rows); sell = sum(r[4] for r in rows)
        v = info.get(w, {}).get("vol")
        if buy != sell or (v and buy != v):
            with lock: stats["vol_mismatch"] += 1
            print(f"WARN {w} buy={buy} sell={sell} MI_INDEX vol={v}", flush=True)
        tmp = p + ".tmp"; open(tmp, "w", encoding="utf-8").write(txt); os.replace(tmp, p)
        with lock: stats["ok"] += 1; n = stats["ok"]
        if n % 50 == 0:
            print(f"[{n}/{len(todo)}] {w} elapsed={(time.time()-t0)/60:.1f}m {stats}", flush=True)
        time.sleep(a.delay)
    todo = [w for w in ids if not os.path.exists(os.path.join(rawdir, w + ".csv"))
            and not os.path.exists(os.path.join(rawdir, w + ".csv.empty"))]
    print(f"{len(ids)} warrants, {len(todo)} to fetch, workers={a.workers}", flush=True)
    with ThreadPoolExecutor(a.workers) as ex: list(ex.map(work, todo))
    if a.ids: print("DONE (ids mode)", stats); return
    out = os.path.join(a.out, f"warrant_branch_{date}.csv")
    with open(out, "w", newline="", encoding="utf-8-sig") as f:
        wr = csv.writer(f)
        wr.writerow(["date", "warrant_id", "warrant_name", "type", "broker_id", "broker_branch", "price",
                     "buy_shares", "sell_shares", "buy_amount", "sell_amount"])
        for w in ids:
            p = os.path.join(rawdir, w + ".csv")
            if os.path.exists(p):
                for bid, br, pr, b, s in parse(open(p, encoding="utf-8").read()):
                    px = float(pr)
                    wr.writerow([date, w, info[w]["name"], info[w]["type"], bid, br, pr, b, s, round(px * b), round(px * s)])
    print("DONE", out, stats, f"{(time.time()-t0)/60:.1f} min", flush=True)

if __name__ == "__main__":
    main()
