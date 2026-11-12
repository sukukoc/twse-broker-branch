"""合併 raw/*.csv，輸出長格式 parquet、zip（內含 CSV）。"""
import pandas as pd, glob, os, zipfile

D = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(D, "raw")
if not os.path.isdir(RAW):
    RAW = os.environ.get("TDCC_RAW", RAW)

cols = ["資料日期", "證券代號", "證券名稱", "市場別", "類別", "序", "持股分級", "人數", "股數", "占集保庫存數比例%"]
fs = sorted(glob.glob(os.path.join(RAW, "*.csv")))
dfs = [pd.read_csv(f, header=None, names=cols, dtype=str, keep_default_na=False)
       for f in fs if os.path.getsize(f)]
df = pd.concat(dfs, ignore_index=True)
for c in ["人數", "股數"]:
    df[c] = pd.to_numeric(df[c].str.replace(",", ""), errors="coerce").astype("Int64")
df["占集保庫存數比例%"] = pd.to_numeric(df["占集保庫存數比例%"], errors="coerce")
df["持股分級"] = df["持股分級"].str.replace("\u3000", "")
df["序"] = df["序"].astype(int)
df = df.drop_duplicates(["資料日期", "證券代號", "序"]).sort_values(["資料日期", "證券代號", "序"])

csv_path = os.path.join(D, "tdcc_shareholding_1y.csv")
df.to_csv(csv_path, index=False, encoding="utf-8-sig")
df.to_parquet(os.path.join(D, "tdcc_shareholding_1y.parquet"), index=False)

sl_src = os.path.join(D, "stock_list.csv")
sl = pd.read_csv(sl_src, dtype=str)
g = df.groupby("證券代號")["資料日期"].nunique()
sl["有資料週數"] = sl["證券代號"].map(g).fillna(0).astype(int)
cov = os.path.join(D, "coverage_report.csv")
sl.to_csv(cov, index=False, encoding="utf-8-sig")

with zipfile.ZipFile(os.path.join(D, "tdcc_shareholding_1y.zip"), "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    z.write(csv_path, os.path.basename(csv_path))
    z.write(sl_src, "stock_list.csv")
    z.write(cov, "coverage_report.csv")

print(len(df), "rows", df["證券代號"].nunique(), "codes",
      df["資料日期"].nunique(), "dates", df["資料日期"].min(), df["資料日期"].max())
print("zero-data codes:", int((sl["有資料週數"] == 0).sum()),
      "partial:", int(((sl["有資料週數"] > 0) & (sl["有資料週數"] < 51)).sum()))
