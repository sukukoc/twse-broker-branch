#!/usr/bin/env python3
"""Fetch TWSE broker-branch data for LISTED WARRANTS (認購/認售, incl. 牛熊證) that traded on the latest day.
Reuses fetch_one/parse from fetch_all.py. Resume cache: OUT/<date>/warrant_raw/<id>.csv
Usage: python3 fetch_warrants.py [--date 20261029] [--workers 4] [--delay 0.5] [--ids 030001,...]
"""
import argparse, csv, json, os, re, sys, time, threading, requests
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_all import fetch_one, parse, UA, TO

SUB = {"認購": "認購權證", "認售": "認售權證"}
INDEX_CODES = {"臺股指數": "IX0001", "臺灣加權股價指數": "IX0001", "發行量加權股價指數": "IX0001", "電子類": "IX0027", "金融類": "IX0039"}

def _get(url, **params):
    for t in range(3):
        try: return requests.get(url, params=params, headers={"User-Agent": UA}, timeout=(5, 90)).json()
        except Exception as e: print("retry", url, e, flush=True); time.sleep(5)
    raise RuntimeError(url)

def warrant_list(day):
    """All listed warrants (認購/認售/牛熊) that traded on `day`.
    NOTE: MI_INDEX type=0999/0999P/... only returns a small subset of warrants, so use type=ALL
    (every listed security) + TWSE OpenAPI t187ap37_L (warrant basic info: type + underlying name)."""
    j = _get("https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX", date=day, type="ALL", response="json")
    if j.get("stat") != "OK" or j.get("date") != day: raise RuntimeError(f"MI_INDEX ALL {day}: {j.get('stat')}")
    tb = next(t for t in j["tables"] if t.get("data") and (t.get("fields") or [""])[0] == "證券代號")
    f = tb["fields"]; ix = {k: f.index(k) for k in ("證券代號", "證券名稱", "成交股數", "成交金額", "收盤價")}
    isw = lambda c: len(c) == 6 and c[0] == "0" and c[1] in "345678"
    rows = {r[0].strip(): r for r in tb["data"]}
    n2c = {re.sub(r"\(原名：.*?\)", "", r[1]).strip(): c for c, r in rows.items() if not isw(c)}
    cp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "market_cache", "tpex_names.json")
    try:
        tp = {r["CompanyName"].strip(): r["SecuritiesCompanyCode"].strip()
              for r in _get("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes")}
        os.makedirs(os.path.dirname(cp), exist_ok=True); json.dump(tp, open(cp, "w", encoding="utf-8"), ensure_ascii=False)
    except Exception as e:
        print("TPEx name map failed, using cache:", e, flush=True)
        tp = json.load(open(cp, encoding="utf-8")) if os.path.exists(cp) else {}
    for k, v in tp.items(): n2c.setdefault(k, v)
    n2c.update(INDEX_CODES)
    basic = {a["權證代號"]: a for a in _get("https://openapi.twse.com.tw/v1/opendata/t187ap37_L")}
    info = {}
    for c, r in rows.items():
        if not isw(c): continue
        v = int(r[ix["成交股數"]].replace(",", "") or 0)
        if v <= 0: continue
        name = r[ix["證券名稱"]].strip(); b = basic.get(c, {})
        kind = b.get("權證類型") or ("認售" if any(k in name[-4:] for k in "售熊") else "認購")
        und = re.sub(r"\(原名：.*?\)", "", b.get("標的證券/指數") or "").strip()
        info[c] = dict(name=name, type=kind, sub="牛證" if "牛" in name[-4:] else "熊證" if "熊" in name[-4:] else SUB[kind],
                       vol=v, amt=int(r[ix["成交金額"]].replace(",", "") or 0), close=r[ix["收盤價"]],
                       und_id=n2c.get(und, "?" + und), und_name=und)
    miss = sorted({i["und_name"] for i in info.values() if i["und_id"].startswith("?")})
    print(f"warrant_list {day}: {len(info)} traded, total amt {sum(i['amt'] for i in info.values()):,}; unmapped underlyings: {miss[:20]}", flush=True)
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
