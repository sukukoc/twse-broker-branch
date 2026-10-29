#!/usr/bin/env python3
"""Warrant broker-branch data aggregated by UNDERLYING, split 認購(incl. 牛證) / 認售(incl. 熊證).
Usage: python3 warrant_page_data.py [YYYY-MM-DD] [--top N] [--max-branches M]
Inputs : warrant_branch_<D>.csv, <D>/warrant_list.json (underlying + subtype per warrant)
Outputs: warrant_underlying_rank_<D>.csv  all underlyings ranked per side
         warrant_rank_by_total_<D>.csv    per-warrant ranking (kept for reference)
         warrant_page_data_<D>.json       top N underlyings per side with branch + warrant detail
JSON per underlying: rank, uid, uname, idx(1=index), nw, amt, shares, opp_amt, opp_nw,
  br: [broker_id, branch, buy_amt, sell_amt, net, buy_sh, sell_sh, own_gross, own_flag]
      (own_gross = buy+sell amount in warrants this branch's firm issued, when branch is the issuer head office;
       own_flag = 1 if own_gross > half of the branch's buy+sell on this underlying/side)
  ws: [warrant_id, name, subtype, issuer, amt, shares, n_branches]
"""
import csv, json, os, re, collections, argparse
BASE = os.path.dirname(os.path.abspath(__file__))
ISSUER_HQ = {"群益": "9100", "凱基": "9200", "永豐": "9A00", "台新": "9B00", "元大": "9800", "富邦": "9600",
             "國票": "7790", "國泰": "8880", "統一": "5850", "元富": "5920", "兆豐": "7000", "第一": "5380",
             "華南": "9300", "康和": "8450", "玉山": "8840", "新光": "8560", "宏遠": "1260", "中信": "6160"}
ISSUER_RE = re.compile("(" + "|".join(ISSUER_HQ) + ")(?=[0-9][0-9A-Z][購售牛熊])")  # issuer sits right before the year code, e.g. 國泰金台新5C售03
SIDE = {"認購": "call", "認售": "put"}

def clean(s): return re.sub(r"\s+", "", s or "")
def und_name(n): return re.sub(r"\(原名：.*?\)", "", n or "").rstrip("*")
def subtype(name, sub):
    t = name[-4:] + (sub or "")
    return "牛證" if "牛" in t else "熊證" if "熊" in t else "一般"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("date", nargs="?"); ap.add_argument("--top", type=int, default=10)
    ap.add_argument("--max-branches", type=int, default=0, help="0 = all")
    a = ap.parse_args()
    D = a.date or sorted(f[15:25] for f in os.listdir(BASE) if f.startswith("warrant_branch_") and f.endswith(".csv"))[-1]
    p = os.path.join(BASE, D, "warrant_list.json")
    info = json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {}
    W = {}
    WB = collections.defaultdict(set)
    UB = collections.defaultdict(lambda: collections.defaultdict(lambda: [0] * 5))  # (side,uid) -> (bid,bname) -> buy,sell,bs,ss,own
    for r in csv.DictReader(open(os.path.join(BASE, f"warrant_branch_{D}.csv"), encoding="utf-8-sig")):
        wid = r["warrant_id"]
        if wid not in W:
            i = info.get(wid, {}); m = ISSUER_RE.search(r["warrant_name"])
            uid = i.get("und_id") or ("?" + wid)
            W[wid] = {"id": wid, "name": r["warrant_name"], "side": SIDE[r["type"]], "sub": subtype(r["warrant_name"], i.get("sub")),
                      "issuer": m.group(1) if m else "", "uid": uid, "uname": und_name(i.get("und_name")) or uid, "amt": 0, "shares": 0}
        w = W[wid]
        ba, sa, bs, ss = int(r["buy_amount"]), int(r["sell_amount"]), int(r["buy_shares"]), int(r["sell_shares"])
        w["amt"] += ba; w["shares"] += bs; WB[wid].add(r["broker_id"])
        b = UB[(w["side"], w["uid"])][(r["broker_id"], clean(r["broker_branch"]))]
        b[0] += ba; b[1] += sa; b[2] += bs; b[3] += ss
        if ISSUER_HQ.get(w["issuer"]) == r["broker_id"]: b[4] += ba + sa
    U = {}
    for w in W.values():
        u = U.setdefault((w["side"], w["uid"]), {"uid": w["uid"], "uname": w["uname"], "idx": 1 if w["uid"].startswith("IX") else 0,
                                                  "amt": 0, "shares": 0, "ws": []})
        u["amt"] += w["amt"]; u["shares"] += w["shares"]; u["ws"].append(w)
    page, rows = {"date": D, "call": [], "put": []}, []
    for side, opp in (("call", "put"), ("put", "call")):
        us = sorted((u for k, u in U.items() if k[0] == side), key=lambda u: (-u["amt"], u["uid"]))
        for rank, u in enumerate(us, 1):
            o = U.get((opp, u["uid"]), {"amt": 0, "ws": []})
            rows.append([D, "認購" if side == "call" else "認售", rank, u["uid"], u["uname"], u["idx"], len(u["ws"]),
                         u["amt"], u["shares"], u["shares"] // 1000, o["amt"], len(o["ws"])])
            if rank > a.top: continue
            br = [[bid, bn, v[0], v[1], v[0] - v[1], v[2], v[3], v[4], 1 if v[4] * 2 > v[0] + v[1] else 0]
                  for (bid, bn), v in UB[(side, u["uid"])].items()]
            br.sort(key=lambda x: (-max(x[2], x[3]), x[0]))
            if a.max_branches: br = br[:a.max_branches]
            ws = sorted(u["ws"], key=lambda w: -w["amt"])
            page[side].append({"rank": rank, "uid": u["uid"], "uname": u["uname"], "idx": u["idx"], "nw": len(ws), "amt": u["amt"],
                               "shares": u["shares"], "opp_amt": o["amt"], "opp_nw": len(o["ws"]), "br": br,
                               "ws": [[w["id"], w["name"], w["sub"], w["issuer"], w["amt"], w["shares"], len(WB[w["id"]])] for w in ws]})
    with open(os.path.join(BASE, f"warrant_underlying_rank_{D}.csv"), "w", newline="", encoding="utf-8-sig") as f:
        cw = csv.writer(f)
        cw.writerow(["date", "side", "rank", "underlying_id", "underlying_name", "is_index", "warrant_count", "turnover_amount",
                     "volume_shares", "volume_lots", "opposite_side_amount", "opposite_side_warrant_count"])
        cw.writerows(rows)
    with open(os.path.join(BASE, f"warrant_rank_by_total_{D}.csv"), "w", newline="", encoding="utf-8-sig") as f:
        cw = csv.writer(f)
        cw.writerow(["date", "type", "rank", "warrant_id", "warrant_name", "subtype", "issuer", "underlying_id", "underlying_name",
                     "turnover_amount", "volume_shares", "volume_lots", "branch_count"])
        for side in ("call", "put"):
            for rank, w in enumerate(sorted((w for w in W.values() if w["side"] == side), key=lambda w: (-w["amt"], w["id"])), 1):
                cw.writerow([D, "認購" if side == "call" else "認售", rank, w["id"], w["name"], w["sub"], w["issuer"], w["uid"], w["uname"],
                             w["amt"], w["shares"], w["shares"] // 1000, len(WB[w["id"]])])
    out = os.path.join(BASE, f"warrant_page_data_{D}.json")
    json.dump(page, open(out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    for side in ("call", "put"):
        print(f"== {side} ==")
        for u in page[side]:
            print(f'{u["rank"]:>2}. {u["uid"]} {u["uname"]} 權證{u["nw"]}檔 金額 {u["amt"]:,} 張 {u["shares"]//1000:,} 分點 {len(u["br"])} 對側 {u["opp_amt"]:,}')
    print(out, os.path.getsize(out))

if __name__ == "__main__":
    main()
