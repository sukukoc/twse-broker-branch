#!/usr/bin/env python3
"""產生網頁用的單日資料 docs/data/<D>.json（權證依標的加總、投資人 vs 發行商、標的漲跌、自營比）。

用法: python3 site_data.py YYYY-MM-DD --src 資料目錄 --out 輸出.json
輸入 (在 --src):
  warrant_branch_<D>.csv      fetch_warrants.py 輸出（每檔權證 × 分點 × 價位）
  <D>/warrant_list.json       權證清單（標的代號/名稱、類別）
另外會向證交所抓（並快取在 <src>/market_cache/）:
  MI_INDEX ALLBUT0999  近 11 個交易日收盤／漲跌 → 漲跌天數、1日、5日漲幅
  T86 ALLBUT0999       三大法人：自營商買賣超股數(避險) → 自營比

指標定義:
  發行商分點 = 權證發行券商的總公司（自營／造市）代號，只在「它自己發行的權證」上算發行商；
               買賣別家發行的權證時視為一般投資人。
  投資人買賣超金額 = 該標的（認購或認售一側）所有權證，排除發行商自家分點後的 買進金額 − 賣出金額
               （因為造市商是對手方，數值 ≈ −發行商買賣超）。
  自營比% = 標的股票當日 自營商買賣超股數(避險) ÷ 成交股數 × 100（證交所 T86 / MI_INDEX）。
  漲跌天數 = 標的連續上漲(+)／下跌(−)天數；1日、5日漲幅 = 以每日漲跌價差計算的報酬（%）。

JSON 結構 (v2):
{ "v":2, "date":D, "brn":{分點代號:名稱},
  "u":{ 標的代號: { "n":名稱, "idx":0/1, "px":[漲跌天數,1日%,5日%,收盤] 或 null, "hv":[自營避險買賣超股數,成交股數] 或 null,
        "call"/"put": { "amt":權證成交金額, "sh":成交股數, "inv":投資人買賣超, "nw":權證檔數,
                        "br":[[分點代號,買進金額,賣出金額,其中發行商自家買進,其中發行商自家賣出],...],
                        "ws":[[權證代號,名稱,類別,發行商,成交金額,成交股數,分點數],...] } } } }
"""
import argparse, collections, csv, json, os, re, sys, time
from datetime import date, timedelta
import requests

ISSUER_HQ = {"群益": "9100", "凱基": "9200", "永豐": "9A00", "台新": "9B00", "元大": "9800", "富邦": "9600",
             "國票": "7790", "國泰": "8880", "統一": "5850", "元富": "5920", "兆豐": "7000", "第一": "5380",
             "華南": "9300", "康和": "8450", "玉山": "8840", "新光": "8560", "宏遠": "1260", "中信": "6160",
             "亞東": "2180", "日盛": "9600"}
ISS = "|".join(ISSUER_HQ)
ISSUER_RE = re.compile(f"({ISS})(?=[0-9][0-9A-Z][購售牛熊])")
ISSUER_ANY = re.compile(f"({ISS})")
INDEX_NAME = {"IX0001": "發行量加權股價指數", "IX0027": "電子工業類指數", "IX0039": "金融保險類指數"}
SIDE = {"認購": "call", "認售": "put"}
UA = {"User-Agent": "Mozilla/5.0 personal-research"}

def issuer_of(name):
    m = ISSUER_RE.search(name)
    if m: return m.group(1)
    ms = ISSUER_ANY.findall(name)
    return ms[-1] if ms else ""

def clean(s): return re.sub(r"\s+", "", s or "")
def und_name(n): return re.sub(r"\(原名：.*?\)", "", n or "").rstrip("*")
def subtype(name, sub):
    t = name[-4:] + (sub or "")
    return "牛證" if "牛" in t else "熊證" if "熊" in t else "認購" if "購" in t else "認售"
def num(s):
    s = (s or "").replace(",", "").strip()
    try: return float(s)
    except ValueError: return None

def twse(cache, kind, ymd):
    """cached TWSE JSON; returns parsed dict or None (non-trading day)."""
    os.makedirs(cache, exist_ok=True)
    p = os.path.join(cache, f"{kind}_{ymd}.json")
    if os.path.exists(p): return json.load(open(p, encoding="utf-8"))
    url = {"MI": "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX",
           "T86": "https://www.twse.com.tw/rwd/zh/fund/T86"}[kind]
    for t in range(3):
        try:
            j = requests.get(url, params=dict(date=ymd, type="ALLBUT0999", selectType="ALLBUT0999", response="json"),
                             headers=UA, timeout=(5, 30)).json(); break
        except Exception as e:
            print("retry", kind, ymd, e, file=sys.stderr); time.sleep(3)
    else: raise RuntimeError(f"TWSE {kind} {ymd} failed")
    time.sleep(1.2)
    if j.get("stat") != "OK":
        out = None
    elif kind == "MI":
        out = {}
        for tb in j.get("tables", []):
            f = tb.get("fields") or []
            if f[:3] == ["證券代號", "證券名稱", "成交股數"]:
                for r in tb["data"]:
                    c, d = num(r[8]), num(r[10])
                    sg = -1 if "-" in r[9] else 1 if "+" in r[9] else 0
                    out[r[0].strip()] = [c, (d or 0) * sg, int(num(r[2]) or 0)]
            elif f[:2] == ["指數", "收盤指數"]:
                for r in tb["data"]:
                    c, d = num(r[1]), num(r[3]); sg = -1 if "-" in r[2] else 1 if "+" in r[2] else 0
                    out.setdefault("@" + r[0].strip(), [c, (d or 0) * sg, 0])
    else:
        f = j["fields"]; k = f.index("自營商買賣超股數(避險)")
        out = {r[0].strip(): int(num(r[k]) or 0) for r in j["data"]}
    if out is not None or ymd < date.today().strftime("%Y%m%d"):
        json.dump(out, open(p, "w", encoding="utf-8"), ensure_ascii=False)
    return out

def price_stats(cache, D, codes, ndays=11):
    """{code: [streak, chg1%, chg5%, close]} using up to `ndays` trading days ending at D."""
    days, d = [], date.fromisoformat(D)
    while len(days) < ndays and (date.fromisoformat(D) - d).days < 40:
        m = twse(cache, "MI", d.strftime("%Y%m%d"))
        if m: days.append(m)
        elif d.isoformat() == D: raise RuntimeError(f"MI_INDEX 沒有 {D} 的資料")
        d -= timedelta(days=1)
    res = {}
    for c in codes:
        key = "@" + INDEX_NAME[c] if c in INDEX_NAME else c
        rs = []
        for m in days:
            v = m.get(key)
            if not v or not v[0] or v[0] - v[1] == 0: break
            rs.append(v[1] / (v[0] - v[1]))
        if not rs: continue
        s = (rs[0] > 0) - (rs[0] < 0); n = 0
        for r in rs:
            if s and ((r > 0) - (r < 0)) == s: n += 1
            else: break
        g = 1.0
        for r in rs[:5]: g *= 1 + r
        res[c] = [n * s, round(rs[0] * 100, 2), round((g - 1) * 100, 2) if len(rs) >= 5 else None, days[0][key][0]]
    return res, days[0]

def build(D, src, cache=None):
    cache = cache or os.path.join(src, "market_cache")
    lp = os.path.join(src, D, "warrant_list.json")
    info = json.load(open(lp, encoding="utf-8")) if os.path.exists(lp) else {}
    brn, W = {}, {}
    U = collections.defaultdict(lambda: collections.defaultdict(lambda: [0, 0, 0, 0]))  # (uid,side)->bid->[buy,sell,ib,is]
    WB = collections.defaultdict(set)
    for r in csv.DictReader(open(os.path.join(src, f"warrant_branch_{D}.csv"), encoding="utf-8-sig")):
        wid = r["warrant_id"]
        if wid not in W:
            i = info.get(wid, {}); iss = issuer_of(r["warrant_name"])
            uid = i.get("und_id") or ("?" + wid)
            W[wid] = dict(id=wid, name=r["warrant_name"], side=SIDE[r["type"]], sub=subtype(r["warrant_name"], i.get("sub")),
                          iss=iss, hq=ISSUER_HQ.get(iss), uid=uid, uname=und_name(i.get("und_name")) or uid, amt=0, sh=0)
        w = W[wid]; bid = r["broker_id"]; brn.setdefault(bid, clean(r["broker_branch"]))
        ba, sa, bs = int(r["buy_amount"]), int(r["sell_amount"]), int(r["buy_shares"])
        w["amt"] += ba; w["sh"] += bs; WB[wid].add(bid)
        b = U[(w["uid"], w["side"])][bid]; b[0] += ba; b[1] += sa
        if bid == w["hq"]: b[2] += ba; b[3] += sa
    miss = sorted({w["name"] for w in W.values() if not w["hq"]})
    if miss: print("WARN 找不到發行商:", miss[:20], file=sys.stderr)
    uids = sorted({w["uid"] for w in W.values()})
    px, mi0 = price_stats(cache, D, uids)
    t86 = twse(cache, "T86", D.replace("-", "")) or {}
    out = {"v": 2, "date": D, "brn": brn, "u": {}}
    for w in W.values():
        u = out["u"].setdefault(w["uid"], {"n": w["uname"], "idx": 1 if w["uid"].startswith("IX") else 0,
                                           "px": px.get(w["uid"]),
                                           "hv": [t86[w["uid"]], mi0[w["uid"]][2]] if w["uid"] in t86 and mi0.get(w["uid"], [0, 0, 0])[2] else None})
        s = u.setdefault(w["side"], {"amt": 0, "sh": 0, "inv": 0, "nw": 0, "ws": []})
        s["amt"] += w["amt"]; s["sh"] += w["sh"]; s["nw"] += 1
        s["ws"].append([w["id"], w["name"], w["sub"], w["iss"], w["amt"], w["sh"], len(WB[w["id"]])])
    for (uid, side), br in U.items():
        s = out["u"][uid][side]
        s["br"] = sorted(([bid, *v] for bid, v in br.items()), key=lambda x: -(x[1] + x[2]))
        s["inv"] = sum(b[1] - b[3] - (b[2] - b[4]) for b in s["br"])
        s["ws"].sort(key=lambda x: -x[4])
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("date"); ap.add_argument("--src", required=True); ap.add_argument("--out", required=True)
    a = ap.parse_args()
    o = build(a.date, os.path.abspath(a.src))
    json.dump(o, open(a.out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    for side in ("call", "put"):
        L = sorted(((u[side]["inv"], k, u["n"], u["px"], u["hv"]) for k, u in o["u"].items() if side in u), reverse=True)
        for title, part in (("買超", L[:5]), ("賣超", L[::-1][:5])):
            print(f"== {side} 投資人{title} ==")
            for inv, k, n, p, hv in part:
                print(f"  {k} {n} {inv/1e4:,.0f}萬 px={p} 自營比={round(hv[0]/hv[1]*100,2) if hv else None}")
    print(a.out, os.path.getsize(a.out))

if __name__ == "__main__":
    main()
