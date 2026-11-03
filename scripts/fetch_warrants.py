#!/usr/bin/env python3
"""Fetch TWSE broker-branch data for LISTED WARRANTS (認購/認售, incl. 牛熊證) that traded on the latest day.
Reuses fetch_one/parse from fetch_all.py. Resume cache: OUT/<date>/warrant_raw/<id>.csv
Usage: python3 fetch_warrants.py [--date 20261029] [--workers 4] [--delay 0.5] [--ids 030001,...]
                                 [--max-minutes N] [--csv-only]
Order: warrants still to fetch are fetched in DESCENDING traded amount (warrant_list.json 'amt').
Exit codes: 0 = all done, 3 = PARTIAL (time budget used up; resume later), 4 = EXPIRED
(BSR is serving a different trading day than --date; nothing from this run's mismatching
fetches is saved), other non-zero = crash. warrant_branch_<date>.csv is (re)written from
whatever is cached on exit codes 0/3/4 and with --csv-only (no network).
"""
EXIT_DONE, EXIT_PARTIAL, EXIT_EXPIRED = 0, 3, 4
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
    ap.add_argument("--max-minutes", type=float, default=0, help="time budget; 0 = unlimited. exit 3 when used up")
    ap.add_argument("--csv-only", action="store_true", help="just rebuild warrant_branch_<date>.csv from cache")
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
    stop = threading.Event(); state = dict(reason=None)
    probe = []  # (warrant, matched?) for the first fetches with a known MI_INDEX vol
    PROBE_N, PROBE_BAD = 20, 0.6
    deadline = t0 + a.max_minutes * 60 if a.max_minutes > 0 else None
    pending = {}  # first fetches held back (not written) until the date guard passes
    def write_raw(w, txt):
        p = os.path.join(rawdir, w + ".csv"); tmp = p + ".tmp"
        open(tmp, "w", encoding="utf-8").write(txt); os.replace(tmp, p)
    def work(w):
        if stop.is_set(): return
        if deadline and time.time() > deadline:
            if not stop.is_set(): state["reason"] = state["reason"] or "budget"; stop.set()
            return
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
        if stop.is_set() and state["reason"] == "expired": return
        rows = parse(txt) if txt is not None else []
        buy = sum(r[3] for r in rows); sell = sum(r[4] for r in rows)
        v = info.get(w, {}).get("vol")
        # Date guard: BSR shows no date, so compare against that day's MI_INDEX volume.
        # Every warrant in warrant_list traded (vol>0), so "查無資料" (txt None) also counts as a mismatch.
        with lock:
            if len(probe) < PROBE_N and v:
                probe.append(txt is not None and buy == v)
                pending[w] = txt  # None = 查無資料 -> becomes .empty if the guard passes
                if len(probe) >= PROBE_N:
                    bad = probe.count(False)
                    if bad >= PROBE_BAD * PROBE_N:
                        state["reason"] = "expired"; stop.set()
                        print(f"EXPIRED: {bad}/{PROBE_N} first fetches mismatch MI_INDEX vol for {date}; "
                              f"BSR is serving another day. Discarding {len(pending)} held fetches.", flush=True)
                        return
                    for pw, ptxt in pending.items():  # guard passed -> flush held fetches
                        pp = os.path.join(rawdir, pw + ".csv")
                        if ptxt is None: open(pp + ".empty", "w").close()
                        else: write_raw(pw, ptxt)
                    stats["ok"] += sum(1 for x in pending.values() if x is not None)
                    stats["empty"] += sum(1 for x in pending.values() if x is None)
                    print(f"date guard OK: {bad}/{PROBE_N} mismatches; flushed {len(pending)} held fetches", flush=True)
                    pending.clear()
                return
        if txt is None:
            with lock: stats["empty"] += 1
            print("EMPTY", w, flush=True); open(p + ".empty", "w").close(); return
        if buy != sell or (v and buy != v):
            with lock: stats["vol_mismatch"] += 1
            print(f"WARN {w} buy={buy} sell={sell} MI_INDEX vol={v}", flush=True)
        write_raw(w, txt)
        with lock: stats["ok"] += 1; n = stats["ok"]
        if n % 50 == 0:
            print(f"[{n}/{len(todo)}] {w} elapsed={(time.time()-t0)/60:.1f}m {stats}", flush=True)
        time.sleep(a.delay)
    todo = [w for w in ids if not os.path.exists(os.path.join(rawdir, w + ".csv"))
            and not os.path.exists(os.path.join(rawdir, w + ".csv.empty"))]
    todo.sort(key=lambda w: -int(info.get(w, {}).get("amt", 0) or 0))  # biggest money first
    print(f"{len(ids)} warrants, {len(todo)} to fetch, workers={a.workers}, max_minutes={a.max_minutes or '-'}", flush=True)
    if not a.csv_only:
        with ThreadPoolExecutor(a.workers) as ex: list(ex.map(work, todo))
        with lock:  # run ended before PROBE_N samples: judge on what we have
            if pending and state["reason"] != "expired":
                bad = probe.count(False)
                if len(probe) >= 5 and bad >= PROBE_BAD * len(probe):
                    state["reason"] = "expired"
                    print(f"EXPIRED: {bad}/{len(probe)} fetches mismatch; discarding {len(pending)} held fetches", flush=True)
                else:
                    for pw, ptxt in pending.items():
                        pp = os.path.join(rawdir, pw + ".csv")
                        if ptxt is None: open(pp + ".empty", "w").close()
                        else: write_raw(pw, ptxt)
                    print(f"flushed {len(pending)} held fetches ({bad}/{len(probe)} mismatches)", flush=True)
                pending.clear()
    if a.ids: print("DONE (ids mode)", stats, state["reason"] or ""); sys.exit(EXIT_EXPIRED if state["reason"] == "expired" else 0)
    write_csv(a.out, date, ids, info, rawdir)
    left = [w for w in ids if not os.path.exists(os.path.join(rawdir, w + ".csv"))
            and not os.path.exists(os.path.join(rawdir, w + ".csv.empty"))]
    tot = sum(int(i.get("amt", 0) or 0) for i in info.values()) or 1
    got = sum(int(info[w].get("amt", 0) or 0) for w in ids if w not in set(left))
    status = "EXPIRED" if state["reason"] == "expired" else ("DONE" if not left else "PARTIAL")
    print(f"STATUS {status} fetched={len(ids)-len(left)}/{len(ids)} amt_pct={100*got/tot:.1f} "
          f"{stats} {(time.time()-t0)/60:.1f} min", flush=True)
    if a.csv_only: return
    sys.exit({"EXPIRED": EXIT_EXPIRED, "DONE": EXIT_DONE, "PARTIAL": EXIT_PARTIAL}[status])

def write_csv(outdir, date, ids, info, rawdir):
    out = os.path.join(outdir, f"warrant_branch_{date}.csv")
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
    print("CSV written", out, flush=True)

if __name__ == "__main__":
    main()
