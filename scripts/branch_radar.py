#!/usr/bin/env python3
"""分點大戶雷達：把每天的權證分點明細累積進 SQLite（永久保存），找出值得研究的分點並反推戰績。

ingest(D, src)  把 <src>/warrant_branch_<D>.csv、<src>/<D>/warrant_list.json、<src>/broker_branch_<D>.csv（若有）
                寫入 <src>/history.db（同一天重跑會先刪再寫，可重複執行）
build(D, src)   讀 history.db 算出分點分數與戰績，回傳網頁用 JSON（docs/data/branches/<D>.json）

只用免費、公開的 TWSE 資料；分點歷史只有我們實際抓過的日子（TWSE BSR 只提供當日）。
"""
import collections, csv, json, math, os, re, sqlite3, sys, time
from datetime import date
import requests
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from site_data import ISSUER_HQ, issuer_of, clean, und_name, subtype, num, twse, SIDE, UA

ISSUER_IDS = set(ISSUER_HQ.values())
# 公開媒體點名過的短線／權證大戶分點（只收錄實際查到出處的）：
#  財訊/科技新報 2021-08「不只凱基台北分點，全台隔日沖大戶還有這些人」：凱基松山、土城永寧、富邦建國、群益大安、凱基台北、國泰敦北、康和永和、凱基虎尾、富邦虎尾、富邦嘉義
#  CMoney 權證小哥筆記 nid=178291：權證隔日沖分點「康和」「凱基-三重」「元富」
#  CMoney 投資小學堂 權證 topic/2664：「群益金鼎-上新莊」大額權證買超
FAMOUS = {"凱基松山": "財訊:隔日沖", "土城永寧": "財訊:隔日沖", "富邦建國": "財訊:隔日沖", "群益大安": "財訊:短線",
          "凱基台北": "財訊:隔日沖", "國泰敦北": "財訊:短線", "康和永和": "財訊:短線", "凱基虎尾": "財訊:虎尾幫",
          "富邦虎尾": "財訊:虎尾幫", "富邦嘉義": "財訊:隔日沖", "凱基三重": "CMoney:權證隔日沖", "上新莊": "CMoney:權證大戶"}
HORIZONS = (1, 3, 5, 10)
ENTRY_MIN = 500_000      # 一筆「進場」= 某分點當天在某標的某方向的權證淨買 ≥ 50 萬

SCHEMA = """
CREATE TABLE IF NOT EXISTS days(date TEXT PRIMARY KEY, n_warrants INT, n_rows INT, has_stock INT, ingested TEXT);
CREATE TABLE IF NOT EXISTS brokers(id TEXT PRIMARY KEY, name TEXT);
CREATE TABLE IF NOT EXISTS winfo(id TEXT PRIMARY KEY, name TEXT, side TEXT, sub TEXT, issuer TEXT, und_id TEXT, und_name TEXT,
  strike REAL, ratio REAL, last_trade TEXT);
CREATE TABLE IF NOT EXISTS wtrade(date TEXT, broker TEXT, wid TEXT, buy_sh INT, sell_sh INT, buy_amt REAL, sell_amt REAL,
  PRIMARY KEY(date, broker, wid));
CREATE TABLE IF NOT EXISTS wclose(date TEXT, wid TEXT, close REAL, vol INT, PRIMARY KEY(date, wid));
CREATE TABLE IF NOT EXISTS sclose(date TEXT, sid TEXT, close REAL, PRIMARY KEY(date, sid));
CREATE TABLE IF NOT EXISTS strade(date TEXT, broker TEXT, sid TEXT, buy_sh INT, sell_sh INT, buy_amt REAL, sell_amt REAL,
  PRIMARY KEY(date, broker, sid));
CREATE INDEX IF NOT EXISTS wtrade_b ON wtrade(broker, date);
"""

def db(src):
    c = sqlite3.connect(os.path.join(src, "history.db")); c.executescript(SCHEMA); return c

def roc(s):
    s = (s or "").strip()
    return f"{int(s[:-4]) + 1911}-{s[-4:-2]}-{s[-2:]}" if len(s) >= 7 else ""

def ap37(src):
    """TWSE OpenAPI 上市權證基本資料（履約價、行使比例、最後交易日），失敗時用快取。"""
    p = os.path.join(src, "market_cache", "t187ap37_L.json")
    try:
        j = requests.get("https://openapi.twse.com.tw/v1/opendata/t187ap37_L", headers=UA, timeout=(5, 60)).json()
        if len(j) > 1000: json.dump(j, open(p, "w", encoding="utf-8"), ensure_ascii=False)
    except Exception as e:
        print("t187ap37_L failed, cache:", e, file=sys.stderr); j = json.load(open(p, encoding="utf-8")) if os.path.exists(p) else []
    return {r["權證代號"].strip(): r for r in j}

def ingest(D, src):
    c = db(src); cache = os.path.join(src, "market_cache")
    info = json.load(open(os.path.join(src, D, "warrant_list.json"), encoding="utf-8"))
    basic = ap37(src)
    for t in ("wtrade", "wclose", "sclose", "strade"): c.execute(f"DELETE FROM {t} WHERE date=?", (D,))
    agg = collections.defaultdict(lambda: [0, 0, 0.0, 0.0]); names = {}; wn = {}
    for r in csv.DictReader(open(os.path.join(src, f"warrant_branch_{D}.csv"), encoding="utf-8-sig")):
        a = agg[(r["broker_id"], r["warrant_id"])]; b, s = int(r["buy_shares"]), int(r["sell_shares"])
        a[0] += b; a[1] += s; a[2] += float(r["buy_amount"]); a[3] += float(r["sell_amount"])
        names[r["broker_id"]] = clean(r["broker_branch"]); wn[r["warrant_id"]] = (r["warrant_name"], r["type"])
    c.executemany("INSERT OR REPLACE INTO brokers VALUES(?,?)", names.items())
    c.executemany("INSERT INTO wtrade VALUES(?,?,?,?,?,?,?)", [(D, b, w, *a) for (b, w), a in agg.items()])
    rows = []
    for wid, i in info.items():
        bb = basic.get(wid, {}); nm = i.get("name") or wn.get(wid, ("",))[0]
        rows.append((wid, nm, SIDE.get(i.get("type"), "call"), subtype(nm, i.get("sub")), issuer_of(nm), i.get("und_id") or "",
                     und_name(i.get("und_name")), num(bb.get("最新履約價格(元)/履約指數")),
                     num(bb.get("最新標的履約配發數量(每仟單位權證)")), roc(bb.get("最後交易日"))))
    c.executemany("""INSERT INTO winfo VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
       strike=COALESCE(excluded.strike,strike), ratio=COALESCE(excluded.ratio,ratio), last_trade=COALESCE(NULLIF(excluded.last_trade,''),last_trade),
       und_id=COALESCE(NULLIF(excluded.und_id,''),und_id), und_name=COALESCE(NULLIF(excluded.und_name,''),und_name)""", rows)
    c.executemany("INSERT INTO wclose VALUES(?,?,?,?)", [(D, w, num(i.get("close")), i.get("vol") or 0) for w, i in info.items()
                                                          if num(i.get("close"))])
    mi = twse(cache, "MI", D.replace("-", "")) or {}
    c.executemany("INSERT INTO sclose VALUES(?,?,?)", [(D, k, v[0]) for k, v in mi.items() if v[0] is not None])
    sp = os.path.join(src, f"broker_branch_{D}.csv"); has = os.path.exists(sp)
    if has:
        sa = collections.defaultdict(lambda: [0, 0, 0.0, 0.0])
        with open(sp, encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                a = sa[(r["broker_id"], r["stock_id"])]; p = float(r["price"]); b, s = int(r["buy_shares"]), int(r["sell_shares"])
                a[0] += b; a[1] += s; a[2] += b * p; a[3] += s * p
                names.setdefault(r["broker_id"], clean(r["broker_branch"]))
        c.executemany("INSERT INTO strade VALUES(?,?,?,?,?,?,?)", [(D, b, s, *a) for (b, s), a in sa.items()])
        c.executemany("INSERT OR IGNORE INTO brokers VALUES(?,?)", names.items())
    c.execute("INSERT OR REPLACE INTO days VALUES(?,?,?,?,?)", (D, len(wn), len(agg), int(has), time.strftime("%F %T")))
    c.commit(); c.close()
    print(f"history.db: {D} 權證 {len(wn)} 檔、分點×權證 {len(agg)} 筆、現股分點 {'有' if has else '無'}")

# ---------------------------------------------------------------- build
def build(D, src, top=150):
    c = db(src)
    days = [r[0] for r in c.execute("SELECT date FROM days WHERE date<=? ORDER BY date", (D,))]
    alld = [r[0] for r in c.execute("SELECT date FROM days ORDER BY date")]
    names = dict(c.execute("SELECT id,name FROM brokers"))
    WI = {r[0]: dict(name=r[1], side=r[2], sub=r[3], iss=r[4], uid=r[5] or "?", uname=r[6] or r[5] or "?", K=r[7], ratio=r[8], lt=r[9])
          for r in c.execute("SELECT * FROM winfo")}
    WC = collections.defaultdict(dict); SC = collections.defaultdict(dict)
    for d, w, p in c.execute("SELECT date,wid,close FROM wclose"): WC[w][d] = p
    for d, s, p in c.execute("SELECT date,sid,close FROM sclose"): SC[s][d] = p
    def last(series, d):  # 最近一個 <= d 的收盤
        ks = [k for k in series if k <= d]; return series[max(ks)] if ks else None
    def iss_trade(b, w): return b in ISSUER_IDS or ISSUER_HQ.get(WI.get(w, {}).get("iss")) == b
    T = collections.defaultdict(list)  # broker -> [(date,wid,bs,ss,ba,sa)]
    for row in c.execute("SELECT * FROM wtrade WHERE date<=? ORDER BY date", (D,)):
        if not iss_trade(row[1], row[2]): T[row[1]].append((row[0],) + row[2:])
    ST = {}  # (broker,sid) -> net amount today
    for b, s, ba, sa in c.execute("SELECT broker,sid,buy_amt,sell_amt FROM strade WHERE date=?", (D,)): ST[(b, s)] = ba - sa
    has_stock = bool(c.execute("SELECT has_stock FROM days WHERE date=?", (D,)).fetchone()[0])
    recent = days[-5:]
    out = []
    for b, rows in T.items():
        today = [r for r in rows if r[0] == D]
        if not today: continue
        buy = sum(r[4] for r in today); sell = sum(r[5] for r in today); net = buy - sell
        if buy < 300_000 and abs(net) < 300_000: continue
        # 今日按標的/方向彙總
        U = collections.defaultdict(lambda: dict(buy=0.0, sell=0.0, bsh=0, ssh=0, w=collections.Counter(), agg=0.0, aggw=0.0))
        for d, w, bs, ss, ba, sa in today:
            i = WI.get(w, {}); k = (i.get("uid", "?"), i.get("side", "call")); u = U[k]
            u["buy"] += ba; u["sell"] += sa; u["bsh"] += bs; u["ssh"] += ss; u["w"][w] += ba - sa
            if ba > sa:  # 積極度：價外程度 + 剩餘天數
                S = last(SC.get(i.get("uid"), {}), D); K = i.get("K"); a = 0.0
                if S and K: m = S / K if i["side"] == "call" else K / S; a += 0.5 if m < 0.95 else 0.25 if m < 1 else 0
                if i.get("lt"):
                    dte = (date.fromisoformat(i["lt"]) - date.fromisoformat(D)).days
                    a += 0.5 if dte <= 30 else 0.3 if dte <= 60 else 0
                u["agg"] += a * (ba - sa); u["aggw"] += ba - sa
        hold = sorted(U.items(), key=lambda kv: -abs(kv[1]["buy"] - kv[1]["sell"]))
        pos = [(k, v) for k, v in hold if v["buy"] - v["sell"] > 0]; posnet = sum(v["buy"] - v["sell"] for k, v in pos)
        conc = (pos[0][1]["buy"] - pos[0][1]["sell"]) / posnet if posnet > 0 else 0
        aggr = sum(v["agg"] for k, v in pos) / max(1, sum(v["aggw"] for k, v in pos))
        # 現股同步：當天也買超該標的現股（認購）或賣超（認售）
        cross = []
        for (uid, side), v in pos[:5]:
            sn = ST.get((b, uid))
            if sn and ((side == "call" and sn > 0) or (side == "put" and sn < 0)): cross.append([uid, round(sn / 1e4)])
        # 連續買：最近 5 個資料日中，在同一標的同方向淨買的天數
        rep = 0
        if pos:
            k0 = pos[0][0]; dn = collections.Counter()
            for d, w, bs, ss, ba, sa in rows:
                if d in recent and (WI.get(w, {}).get("uid"), WI.get(w, {}).get("side")) == k0: dn[d] += ba - sa
            rep = sum(1 for v in dn.values() if v > 0)
        fam = next((v for k, v in FAMOUS.items() if k in names.get(b, "")), "")
        tr = track(rows, WI, WC, SC, D, alld)
        s1 = 30 * min(1, math.log10(1 + max(net, 0) / 5e5) / 2)
        s2 = 15 * conc if net >= 1e6 else 0
        s3 = 15 * aggr if net >= 1e6 else 0
        s4 = (15 if cross and pos and cross[0][0] == pos[0][0][0] else 8 if cross else 0) if net >= 1e6 else 0
        s5 = 10 * min(1, max(0, rep - 1) / 3)
        s6 = 10 if fam else 0
        s7 = 0
        w1 = tr["win"].get("1")
        if w1 and w1[1] >= 5: s7 = 15 * (w1[0] / w1[1] - 0.5) * 2
        score = round(s1 + s2 + s3 + s4 + s5 + s6 + s7, 1)
        why = []
        if net >= 1e7: why.append(f"大額淨買 {net/1e8:.2f} 億" if net >= 1e8 else f"大額淨買 {net/1e4:,.0f} 萬")
        if s2 >= 10: why.append(f"集中 {WI.get(next(iter(pos[0][1]['w'])),{}).get('uname','')}({'購' if pos[0][0][1]=='call' else '售'}) {conc*100:.0f}%")
        if s3 >= 7: why.append("偏好價外/短天期")
        if s4 >= 15: why.append("現股同步買超")
        elif s4: why.append("現股同步")
        if s5: why.append(f"連{rep}日加碼")
        if fam: why.append("媒體點名 " + fam)
        if s7: why.append(f"隔日勝率 {w1[0]}/{w1[1]}")
        hist = collections.defaultdict(lambda: [0.0, 0.0])
        for d, w, bs, ss, ba, sa in rows: hist[d][0] += ba; hist[d][1] += sa
        out.append(dict(id=b, n=names.get(b, b), score=score, net=round(net), buy=round(buy), sell=round(sell), conc=round(conc, 3),
            aggr=round(aggr, 2), nund=len({k[0] for k, v in hold}), fam=fam, why=why, cross=cross, rep=rep,
            parts=[round(x, 1) for x in (s1, s2, s3, s4, s5, s6, s7)],
            hold=[dict(uid=k[0], un=WI.get(next(iter(v["w"])), {}).get("uname", k[0]), side=k[1], net=round(v["buy"] - v["sell"]),
                       buy=round(v["buy"]), sell=round(v["sell"]), nw=len(v["w"]),
                       sn=round(ST[(b, k[0])]) if (b, k[0]) in ST else None,
                       w=[[w, WI.get(w, {}).get("name", w), round(x), WC[w].get(D)] for w, x in v["w"].most_common()[:8]])
                  for k, v in hold[:12]],
            hist=[[d, round(v[0]), round(v[1])] for d, v in sorted(hist.items())], tr=tr))
    out.sort(key=lambda x: -x["score"])
    for i, x in enumerate(out): x["star"] = x["score"] >= 45 and x["net"] >= 3e6
    keep = [x for x in out[:top]] + [x for x in out[top:] if x["star"]]
    c.close()
    return dict(date=D, ndays=len(days), days=days, has_stock=has_stock, horizons=HORIZONS, n_all=len(out),
                n_star=sum(x["star"] for x in out), br=keep)

def track(rows, WI, WC, SC, D, alld):
    """FIFO 部位與戰績。rows: 某分點所有日子（<=D）的權證成交（已排除發行商自家）。"""
    lots = collections.defaultdict(collections.deque); realized = 0.0; unknown_sell = 0; dt = 0.0
    held_days = []; turnover = 0.0
    bydate = collections.defaultdict(list)
    for r in rows: bydate[r[0]].append(r)
    for d in sorted(bydate):
        for _, w, bs, ss, ba, sa in bydate[d]:
            turnover += ba + sa
            if bs: lots[w].append([bs, ba / bs, d])
            q = ss; px = sa / ss if ss else 0
            if bs and ss: dt += min(bs, ss) * (px - ba / bs)  # 當日來回（當沖）損益
            while q and lots[w]:
                L = lots[w][0]; t = min(q, L[0]); realized += t * (px - L[1]); q -= t; L[0] -= t
                held_days.append((alld.index(d) - alld.index(L[2])) if L[2] in alld and d in alld else 0)
                if not L[0]: lots[w].popleft()
            unknown_sell += q
    unreal = 0.0; openv = 0.0
    for w, dq in lots.items():
        p = None
        for k in sorted(WC.get(w, {})):
            if k <= D: p = WC[w][k]
        for q, c0, d0 in dq:
            if p is not None: unreal += q * (p - c0); openv += q * (p if p is not None else c0)
    # 進場勝率：某日某標的某方向淨買 ≥ ENTRY_MIN，之後 h 個資料日的標的漲跌（認售取反）與權證籃子價格變化
    E = collections.defaultdict(lambda: [0.0, collections.Counter()])
    for d, w, bs, ss, ba, sa in rows:
        i = WI.get(w, {}); e = E[(d, i.get("uid"), i.get("side"))]; e[0] += ba - sa
        if bs > ss: e[1][w] += bs - ss
    win = {}; ent = []
    for (d, uid, side), (amt, ws) in sorted(E.items()):
        if amt < ENTRY_MIN or d not in alld: continue
        di = alld.index(d); rec = [d, uid, side, round(amt)]
        for h in HORIZONS:
            if di + h >= len(alld) or alld[di + h] > D: rec.append(None); continue
            d2 = alld[di + h]; s0, s1 = SC.get(uid, {}).get(d), SC.get(uid, {}).get(d2)
            v0 = sum(q * (WC.get(w, {}).get(d) or 0) for w, q in ws.items()); v1 = sum(q * (last(WC.get(w, {}), d2) or 0) for w, q in ws.items())
            r_w = (v1 / v0 - 1) if v0 else None
            r_s = ((s1 / s0 - 1) * (1 if side == "call" else -1)) if s0 and s1 else None
            rec.append([None if r_s is None else round(r_s * 100, 2), None if r_w is None else round(r_w * 100, 2)])
            r = r_w if r_w is not None else r_s
            if r is not None: k = str(h); win.setdefault(k, [0, 0]); win[k][1] += 1; win[k][0] += r > 0
        ent.append(rec)
    return dict(realized=round(realized), unreal=round(unreal), dt=round(dt), openv=round(openv), unknown_sell=unknown_sell,
                hold=round(sum(held_days) / len(held_days), 1) if held_days else None, turnover=round(turnover),
                win=win, ent=ent[-15:])

def last(series, d):
    ks = [k for k in series if k <= d]; return series[max(ks)] if ks else None

if __name__ == "__main__":
    D, src = sys.argv[1], os.path.abspath(sys.argv[2] if len(sys.argv) > 2 else ".")
    if "--no-ingest" not in sys.argv: ingest(D, src)
    j = build(D, src)
    print(f"{j['n_all']} 個分點、⭐ {j['n_star']} 個")
    for x in j["br"][:15]: print(x["score"], x["id"], x["n"], round(x["net"] / 1e4), x["parts"], x["why"])
