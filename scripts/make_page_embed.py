"""Compact warrant_page_data_<D>.json for embedding in the Page: top 30 branches (+ rest summary), shares in lots, top 12 warrants."""
import json, os, sys
D = sys.argv[1]; N = 30
BASE = os.path.dirname(os.path.abspath(__file__))
p = json.load(open(os.path.join(BASE, f"warrant_page_data_{D}.json"), encoding="utf-8"))
for s in ("call", "put"):
    for u in p[s]:
        br = u["br"]; u["nbr"] = len(br)
        rest = br[N:]; u["br"] = br[:N]
        u["rest"] = [len(rest), sum(b[2] for b in rest), sum(b[3] for b in rest), sum(b[5] for b in rest) // 1000, sum(b[6] for b in rest) // 1000] if rest else None
        for b in u["br"]: b[5] //= 1000; b[6] //= 1000; del b[7]
        u["shares"] //= 1000; u["nws"] = len(u["ws"]); u["ws"] = [[w[0], w[1], w[4]] for w in u["ws"][:12]]; del u["opp_nw"]
print(json.dumps(p, ensure_ascii=False, separators=(",", ":")))
