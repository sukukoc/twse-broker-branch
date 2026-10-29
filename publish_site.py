#!/usr/bin/env python3
"""把某一天的權證標的分點排行資料發佈到 GitHub Pages（docs/data），並 commit + push。

用法:
  python3 publish_site.py [YYYY-MM-DD] [--src 資料目錄] [--no-push]

- 讀取 <src>/warrant_branch_<D>.csv 與 <src>/<D>/warrant_list.json，用 scripts/site_data.py
  計算投資人買賣超、發行商分點、標的漲跌（MI_INDEX）與自營比（T86），寫入 docs/data/<D>.json，更新 docs/data/index.json
- 用 scripts/branch_radar.py 把當天分點明細累積進 <src>/history.db，算出分點大戶分數與戰績，寫入 docs/data/branches/<D>.json
- push 時從 ~/.secrets/github_pat（或環境變數 GITHUB_TOKEN）讀 token，只透過環境變數傳給 git，
  不會寫進 .git/config、remote URL 或指令列參數。
"""
import argparse, base64, json, os, re, subprocess, sys

REPO = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(REPO, "docs", "data")

def git(*args, env=None):
    subprocess.run(["git", "-C", REPO, *args], check=True, env=env)

def token():
    t = os.environ.get("GITHUB_TOKEN")
    if not t:
        p = os.path.expanduser("~/.secrets/github_pat")
        t = open(p).read().strip() if os.path.exists(p) else ""
    if not t: sys.exit("找不到 GitHub token（~/.secrets/github_pat 或 GITHUB_TOKEN）")
    return t

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("date", nargs="?")
    ap.add_argument("--src", default=os.environ.get("BROKER_DATA_DIR", os.path.join(REPO, "scripts")),
                    help="抓資料程式的輸出目錄（含 warrant_branch_<D>.csv 與 <D>/warrant_list.json）")
    ap.add_argument("--no-push", action="store_true")
    a = ap.parse_args()
    src = os.path.abspath(a.src)
    D = a.date or max((m.group(1) for f in os.listdir(src)
                       for m in [re.match(r"warrant_branch_(\d{4}-\d{2}-\d{2})\.csv$", f)] if m), default=None)
    if not D: sys.exit(f"{src} 裡找不到 warrant_branch_*.csv")
    sys.path.insert(0, os.path.join(REPO, "scripts"))
    import site_data
    page = site_data.build(D, src)
    os.makedirs(DATA, exist_ok=True)
    json.dump(page, open(os.path.join(DATA, f"{D}.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    ip = os.path.join(DATA, "index.json")
    idx = json.load(open(ip, encoding="utf-8")) if os.path.exists(ip) else {"dates": []}
    dates = sorted(set(idx.get("dates", [])) | {D}, reverse=True)
    json.dump({"latest": dates[0], "dates": dates}, open(ip, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"docs/data/{D}.json 已更新；可用日期 {len(dates)} 天，最新 {dates[0]}")
    try:  # 分點大戶雷達：累積進 <src>/history.db（永久保存），輸出 docs/data/branches/<D>.json
        import branch_radar
        branch_radar.ingest(D, src)
        br = branch_radar.build(D, src)
        os.makedirs(os.path.join(DATA, "branches"), exist_ok=True)
        json.dump(br, open(os.path.join(DATA, "branches", f"{D}.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print(f"docs/data/branches/{D}.json 已更新：{br['n_all']} 個分點、⭐ {br['n_star']} 個、歷史 {br['ndays']} 天")
    except Exception as e:
        import traceback; traceback.print_exc(); print("分點大戶雷達失敗（標的排行仍照常發布）:", e)
    git("add", "docs/data")
    if subprocess.run(["git", "-C", REPO, "diff", "--cached", "--quiet"]).returncode == 0:
        print("沒有變更，不需 commit"); 
    else:
        git("commit", "-q", "-m", f"資料：{D} 權證標的分點排行＋分點大戶")
    if a.no_push: return
    auth = base64.b64encode(f"x-access-token:{token()}".encode()).decode()
    env = dict(os.environ, GIT_CONFIG_COUNT="1", GIT_CONFIG_KEY_0="http.https://github.com/.extraheader",
               GIT_CONFIG_VALUE_0=f"AUTHORIZATION: basic {auth}", GIT_TERMINAL_PROMPT="0")
    git("pull", "-q", "--rebase", "origin", "main", env=env)  # pick up any newer commits (e.g. page edits) before pushing
    git("push", "-q", "origin", "HEAD:main", env=env)
    print("已 push，GitHub Pages 約 1 分鐘後更新")

if __name__ == "__main__":
    main()
