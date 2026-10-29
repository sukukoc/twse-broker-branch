"""Per-warrant branch top-10 (buy amount / net buy). Usage: python3 warrant_rank.py YYYY-MM-DD"""
import csv, json, collections, zipfile, os, sys
os.chdir(os.path.dirname(os.path.abspath(__file__)))
D = sys.argv[1]
info = json.load(open(f"{D}/warrant_list.json", encoding="utf-8"))
agg = collections.defaultdict(lambda: [0, 0, 0, 0])  # buy_amt, sell_amt, buy_sh, sell_sh
for r in csv.DictReader(open(f"warrant_branch_{D}.csv", encoding="utf-8-sig")):
    k = (r["type"], r["warrant_id"], r["broker_id"], r["broker_branch"])
    a = agg[k]; a[0] += int(r["buy_amount"]); a[1] += int(r["sell_amount"]); a[2] += int(r["buy_shares"]); a[3] += int(r["sell_shares"])
out = []
for typ in ("認購", "認售"):
    items = [(k, v) for k, v in agg.items() if k[0] == typ]
    for metric, key in (("buy_amount", lambda kv: kv[1][0]), ("net_buy_amount", lambda kv: kv[1][0] - kv[1][1])):
        for rank, (k, v) in enumerate(sorted(items, key=key, reverse=True)[:10], 1):
            w = info[k[1]]
            out.append([D, typ, metric, rank, k[1], w["name"], w["sub"], w["und_id"], w["und_name"], k[2], k[3],
                        v[2], v[3], v[0], v[1], v[0] - v[1]])
hdr = ["date", "type", "ranking", "rank", "warrant_id", "warrant_name", "subtype", "underlying_id", "underlying_name",
       "broker_id", "broker_branch", "buy_shares", "sell_shares", "buy_amount", "sell_amount", "net_amount"]
with open(f"warrant_top10_{D}.csv", "w", newline="", encoding="utf-8-sig") as f:
    w = csv.writer(f); w.writerow(hdr); w.writerows(out)
for typ in ("認購", "認售"):
    for m in ("buy_amount", "net_buy_amount"):
        print(f"\n== {typ} {m} ==")
        for r in out:
            if r[1] == typ and r[2] == m:
                print(f"{r[3]:>2}. {r[4]} {r[5]} (標的 {r[7]} {r[8]}) | {r[9]} {r[10]} | 買 {r[13]:,} 賣 {r[14]:,} 淨 {r[15]:,}")
with zipfile.ZipFile(f"warrant_branch_{D}.zip", "w", zipfile.ZIP_DEFLATED) as z:
    z.write(f"warrant_branch_{D}.csv")
print(os.path.getsize(f"warrant_branch_{D}.csv"), os.path.getsize(f"warrant_branch_{D}.zip"))
