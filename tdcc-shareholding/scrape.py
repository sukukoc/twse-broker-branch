import requests,re,csv,os,sys,time,random,html,threading,datetime
BASE='https://www.tdcc.com.tw/portal/zh/smWeb/qryStock'
D='/workspace/tdcc'; RAW=f'{D}/raw'; os.makedirs(RAW,exist_ok=True)
NW=int(sys.argv[1]) if len(sys.argv)>1 else 4
UA='Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
stocks=list(csv.reader(open(f'{D}/stock_list.csv',encoding='utf-8-sig')))[1:]
lock=threading.Lock(); stats={'ok':0,'empty':0,'err':0}; slow=[0.6]
def log(*a):
    with lock:
        print(datetime.datetime.now().strftime('%m-%d %H:%M:%S'),*a,flush=True)
class Sess:
    def __init__(s): s.new()
    def new(s):
        s.s=requests.Session(); s.s.headers.update({'User-Agent':UA,'Referer':BASE})
        r=s.s.get(BASE,timeout=30); r.raise_for_status(); s.upd(r.text)
    def upd(s,t):
        m=re.search(r'name="SYNCHRONIZER_TOKEN" value="([^"]+)"',t)
        if not m: raise RuntimeError('no token')
        s.tok=m.group(1)
        s.dates=re.findall(r'<option value="(\d{8})"',t); s.fir=re.search(r'name="firDate" value="(\d+)"',t).group(1)
    def q(s,code,date):
        r=s.s.post(BASE,data={'SYNCHRONIZER_TOKEN':s.tok,'SYNCHRONIZER_URI':'/portal/zh/smWeb/qryStock','method':'submit','firDate':s.fir,'scaDate':date,'sqlMethod':'StockNo','stockNo':code,'stockName':''},timeout=40)
        if r.status_code!=200: raise RuntimeError(f'http {r.status_code}')
        t=r.text
        if re.search(r'captcha|SECURITY REASONS',t,re.I): raise RuntimeError('blocked')
        s.upd(t)
        m=re.search(r'證券代號：(.*?)<br>\s*證券名稱：(.*?)</p>\s*<span[^>]*>資料日期：(\d+)年(\d+)月(\d+)日',t,re.S)
        if not m: return None,None
        c=m.group(1).strip(); nm=html.unescape(m.group(2).strip())
        dt='%d%02d%02d'%(int(m.group(3))+1911,int(m.group(4)),int(m.group(5)))
        if c!=code or dt!=date: raise RuntimeError(f'mismatch {c} {dt}')
        tb=t[m.end():t.find('</table>',m.end())]
        rows=[]
        for tr in re.findall(r'<tr>(.*?)</tr>',tb,re.S):
            td=[re.sub(r'<[^>]+>','',x).strip() for x in re.findall(r'<td[^>]*>(.*?)</td>',tr,re.S)]
            if len(td)==5: rows.append(td)
        if not rows: raise RuntimeError('no rows')
        return nm,rows
def done_set(code):
    p=f'{RAW}/{code}.csv'; s=set()
    if os.path.exists(p):
        for l in open(p,encoding='utf-8'):
            s.add(l.split(',',1)[0])
    p2=f'{RAW}/{code}.empty'
    if os.path.exists(p2): s|=set(open(p2).read().split())
    return s
idx=[0]
def worker(wid):
    sess=None
    while True:
        with lock:
            if idx[0]>=len(stocks): return
            code,name,mk,cat=stocks[idx[0]]; idx[0]+=1
        done=done_set(code)
        while sess is None:
            try: sess=Sess()
            except Exception as e: log(wid,'init err',e); time.sleep(30)
        todo=[d for d in sess.dates if d not in done]
        for d in todo:
            for att in range(6):
                try:
                    nm,rows=sess.q(code,d)
                    if rows is None:
                        open(f'{RAW}/{code}.empty','a').write(d+'\n'); stats['empty']+=1
                    else:
                        with open(f'{RAW}/{code}.csv','a',encoding='utf-8',newline='') as f:
                            w=csv.writer(f)
                            for r in rows: w.writerow([d,code,nm,mk,cat]+r)
                        stats['ok']+=1
                    slow[0]=max(0.6,slow[0]*0.97)
                    break
                except Exception as e:
                    stats['err']+=1; hard=any(k in repr(e) for k in ('blocked','403','429','503','no token'))
                    slow[0]=min(30,slow[0]*2+2) if hard else min(5,slow[0]+0.2)
                    log(wid,code,d,'err',repr(e)[:120],'att',att,'delay',round(slow[0],1))
                    time.sleep(min(600,(60 if hard else 5)*(2**att)))
                    try: sess=Sess()
                    except Exception as e2: log(wid,'reinit err',e2)
            else:
                open(f'{D}/failed.txt','a').write(f'{code},{d}\n')
            time.sleep(slow[0]+random.uniform(0,0.4))
def mon():
    t0=time.time();n0=None
    while True:
        time.sleep(300)
        log('PROGRESS stock_idx',idx[0],'/',len(stocks),stats,'delay',round(slow[0],2))
th=[threading.Thread(target=worker,args=(i,)) for i in range(NW)]
threading.Thread(target=mon,daemon=True).start()
log('start',len(stocks),'stocks, workers',NW)
for t in th: t.start(); time.sleep(2)
for t in th: t.join()
log('DONE',stats)
