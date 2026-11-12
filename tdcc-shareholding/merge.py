import pandas as pd,glob,os,csv,zipfile
D='/workspace/tdcc'
cols=['資料日期','證券代號','證券名稱','市場別','類別','序','持股分級','人數','股數','占集保庫存數比例%']
fs=sorted(glob.glob(f'{D}/raw/*.csv'))
df=pd.concat([pd.read_csv(f,header=None,names=cols,dtype=str,keep_default_na=False) for f in fs if os.path.getsize(f)])
for c in ['人數','股數']: df[c]=pd.to_numeric(df[c].str.replace(',',''),errors='coerce').astype('Int64')
df['占集保庫存數比例%']=pd.to_numeric(df['占集保庫存數比例%'],errors='coerce')
df['持股分級']=df['持股分級'].str.replace('\u3000','')
df['序']=df['序'].astype(int)
df=df.drop_duplicates(['資料日期','證券代號','序']).sort_values(['資料日期','證券代號','序'])
out=f'{D}/tdcc_shareholding_1y.csv'
df.to_csv(out,index=False,encoding='utf-8-sig')
try: df.to_parquet(f'{D}/tdcc_shareholding_1y.parquet',index=False)
except Exception as e: print('parquet skip',e)
with zipfile.ZipFile(f'{D}/tdcc_shareholding_1y.zip','w',zipfile.ZIP_DEFLATED) as z:
    z.write(out,os.path.basename(out)); z.write(f'{D}/stock_list.csv','stock_list.csv')
    if os.path.exists(f'{D}/coverage_report.csv'): pass
# coverage
sl=pd.read_csv(f'{D}/stock_list.csv',dtype=str)
g=df.groupby('證券代號')['資料日期'].nunique()
sl['有資料週數']=sl['證券代號'].map(g).fillna(0).astype(int)
sl.to_csv(f'{D}/coverage_report.csv',index=False,encoding='utf-8-sig')
print(len(df),'rows',df['證券代號'].nunique(),'codes',df['資料日期'].nunique(),'dates',df['資料日期'].min(),df['資料日期'].max())
print(sl.groupby('類別')['有資料週數'].describe())
print('zero-data codes:',(sl['有資料週數']==0).sum())
