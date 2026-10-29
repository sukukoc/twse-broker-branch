#!/usr/bin/env python3
"""把某一天的權證標的分點排行資料發佈到 GitHub Pages（docs/data），並 commit + push。

用法:
  python3 publish_site.py [YYYY-MM-DD] [--src 資料目錄] [--no-push]

- 讀取 <src>/warrant_page_data_<D>.json（若不存在但有 warrant_branch_<D>.csv，會先執行 <src>/warrant_page_data.py 產生）
- 寫入 docs/data/<D>.json，更新 docs/data/index.json
- push 時從 ~/.secrets/github_pat（或環境變數 GITHUB_TOKEN）讀 token，只透過環境變數傳給 git，
  不會寫進 .git/config、remote URL 或指令列參數。
"""
import argparse, base64, json, os, re, shutil, subprocess, sys

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
                    help="抓資料程式的輸出目錄（含 warrant_page_data_<D>.json）")
    ap.add_argument("--no-push", action="store_true")
    a = ap.parse_args()
    src = os.path.abspath(a.src)
    D = a.date or max((m.group(1) for f in os.listdir(src)
                       for m in [re.match(r"warrant_(?:page_data|branch)_(\d{4}-\d{2}-\d{2})\.(?:json|csv)$", f)] if m), default=None)
    if not D: sys.exit(f"{src} 裡找不到 warrant_page_data_*.json 或 warrant_branch_*.csv")
    pj = os.path.join(src, f"warrant_page_data_{D}.json")
    if not os.path.exists(pj):
        subprocess.run([sys.executable, os.path.join(src, "warrant_page_data.py"), D], check=True, cwd=src)
    page = json.load(open(pj, encoding="utf-8"))
    assert page.get("date") == D and page.get("call") is not None, "資料格式不對"
    os.makedirs(DATA, exist_ok=True)
    shutil.copyfile(pj, os.path.join(DATA, f"{D}.json"))
    ip = os.path.join(DATA, "index.json")
    idx = json.load(open(ip, encoding="utf-8")) if os.path.exists(ip) else {"dates": []}
    dates = sorted(set(idx.get("dates", [])) | {D}, reverse=True)
    json.dump({"latest": dates[0], "dates": dates}, open(ip, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"docs/data/{D}.json 已更新；可用日期 {len(dates)} 天，最新 {dates[0]}")
    git("add", "docs/data")
    if subprocess.run(["git", "-C", REPO, "diff", "--cached", "--quiet"]).returncode == 0:
        print("沒有變更，不需 commit"); 
    else:
        git("commit", "-q", "-m", f"資料：{D} 權證標的分點排行")
    if a.no_push: return
    auth = base64.b64encode(f"x-access-token:{token()}".encode()).decode()
    env = dict(os.environ, GIT_CONFIG_COUNT="1", GIT_CONFIG_KEY_0="http.https://github.com/.extraheader",
               GIT_CONFIG_VALUE_0=f"AUTHORIZATION: basic {auth}", GIT_TERMINAL_PROMPT="0")
    git("push", "-q", "origin", "HEAD:main", env=env)
    print("已 push，GitHub Pages 約 1 分鐘後更新")

if __name__ == "__main__":
    main()
