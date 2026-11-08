import type { SourceId } from "./types";

export interface SourceDef {
  id: SourceId;
  title: string;
  role: string;
  url: string;
  documentationUrl: string;
  licenseMetadataUrl: string | null;
  provider: string;
  cadence: string;
  partOfVerifiedNine: boolean;
  requiredKeys: string[];
  dateFields: string[];
}

const LICENSE = "政府資料開放授權條款－第1版";
const LICENSE_URL = "https://data.gov.tw/license";
const TPEx_DOC = "https://www.tpex.org.tw/openapi/swagger.json";
const TWSE_DOC = "https://openapi.twse.com.tw/v1/swagger.json";

export const LICENSE_NAME = LICENSE;
export const LICENSE_URL_PUBLIC = LICENSE_URL;

export const FETCHABLE_SOURCES: SourceDef[] = [
  {
    id: "cb-master",
    title: "轉(交)換債發行資料",
    role: "CB 發行主檔。Date 是主檔資料日，不是個券成交日。",
    url: "https://www.tpex.org.tw/openapi/v1/bond_ISSBD5_data",
    documentationUrl: TPEx_DOC,
    licenseMetadataUrl: "https://data.gov.tw/dataset/11406",
    provider: "金融監督管理委員會證券期貨局／證券櫃檯買賣中心",
    cadence: "每日快照（政府資料開放平臺標每 1 日）。沒有已驗證的歷史查詢參數。",
    partOfVerifiedNine: true,
    requiredKeys: ["Date", "IssuerCode", "BondCode", "Conversion/ExchangePriceAtIssuance"],
    dateFields: ["Date"],
  },
  {
    id: "listed-stock-quotes",
    title: "上市個股日成交資訊",
    role: "發行人若代碼落在這份清單，只當發行人股票觀察，不是已核對的轉換標的。",
    url: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
    documentationUrl: TWSE_DOC,
    licenseMetadataUrl: "https://data.gov.tw/dataset/11549",
    provider: "金融監督管理委員會證券期貨局／臺灣證券交易所",
    cadence: "盤後每日快照。Swagger 此 GET 未列日期參數，不能加 date= 當成指定歷史日。",
    partOfVerifiedNine: true,
    requiredKeys: ["Date", "Code", "Name", "ClosingPrice", "TradeVolume"],
    dateFields: ["Date"],
  },
  {
    id: "otc-stock-quotes",
    title: "上櫃股票行情",
    role: "含大量非普通股。只依發行機構代碼精確取出需要的列。",
    url: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
    documentationUrl: TPEx_DOC,
    licenseMetadataUrl: "https://data.gov.tw/dataset/11370",
    provider: "金融監督管理委員會證券期貨局／證券櫃檯買賣中心",
    cadence: "盤後每日快照。成交股數欄名即為股，不是張。",
    partOfVerifiedNine: true,
    requiredKeys: ["Date", "SecuritiesCompanyCode", "CompanyName", "Close", "TradingShares"],
    dateFields: ["Date"],
  },
  {
    id: "listed-margin",
    title: "上市融資融券",
    role: "融券現券償還可作線索。回應沒有交易日欄，不得填成行情日。",
    url: "https://openapi.twse.com.tw/v1/exchangeReport/MI_MARGN",
    documentationUrl: TWSE_DOC,
    licenseMetadataUrl: "https://data.gov.tw/dataset/11680",
    provider: "金融監督管理委員會證券期貨局／臺灣證券交易所",
    cadence: "每日快照，但原始列沒有日期。數量單位未在規格標明。",
    partOfVerifiedNine: true,
    requiredKeys: ["股票代號", "融券現券償還", "融券買進", "融券賣出"],
    dateFields: [],
  },
  {
    id: "otc-margin",
    title: "上櫃融資融券餘額",
    role: "StockRedemption 是券償，ShortConvering 是券買。兩者不可互換。",
    url: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance",
    documentationUrl: TPEx_DOC,
    licenseMetadataUrl: "https://data.gov.tw/dataset/11387",
    provider: "金融監督管理委員會證券期貨局／證券櫃檯買賣中心",
    cadence: "每日快照。數量單位未標明。",
    partOfVerifiedNine: true,
    requiredKeys: ["Date", "SecuritiesCompanyCode", "StockRedemption", "ShortConvering", "ShortSale"],
    dateFields: ["Date"],
  },
  {
    id: "listed-events",
    title: "上市重大訊息",
    role: "當期快照。沒有列到不代表歷史上沒有該公告。",
    url: "https://openapi.twse.com.tw/v1/opendata/t187ap04_L",
    documentationUrl: TWSE_DOC,
    licenseMetadataUrl: "https://data.gov.tw/dataset/18415",
    provider: "金融監督管理委員會證券期貨局／臺灣證券交易所",
    cadence: "每日重大訊息快照，不是完整歷史庫，也不是法說行事曆。",
    partOfVerifiedNine: true,
    requiredKeys: ["出表日期", "發言日期", "發言時間", "公司代號", "主旨", "事實發生日"],
    dateFields: ["出表日期", "發言日期", "事實發生日"],
  },
  {
    id: "otc-events",
    title: "上櫃重大訊息",
    role: "可轉債與法說線索的當期來源。事實發生日可以是未來日期。",
    url: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O",
    documentationUrl: TPEx_DOC,
    licenseMetadataUrl: "https://data.gov.tw/dataset/18418",
    provider: "金融監督管理委員會證券期貨局／證券櫃檯買賣中心",
    cadence: "每日重大訊息快照。",
    partOfVerifiedNine: true,
    requiredKeys: ["Date", "發言日期", "發言時間", "SecuritiesCompanyCode", "主旨", "事實發生日"],
    dateFields: ["Date", "發言日期", "事實發生日"],
  },
  {
    id: "listed-revenue",
    title: "上市月營收",
    role: "月營收快照。資料年月以回應的「資料年月」欄為準，不把出表月或抓取月當成營收月。",
    url: "https://openapi.twse.com.tw/v1/opendata/t187ap05_L",
    documentationUrl: TWSE_DOC,
    licenseMetadataUrl: "https://data.gov.tw/dataset/18420",
    provider: "金融監督管理委員會證券期貨局／臺灣證券交易所",
    cadence: "月營收。百分比欄位已是百分數。金額單位未標明。",
    partOfVerifiedNine: true,
    requiredKeys: ["出表日期", "資料年月", "公司代號", "營業收入-當月營收", "營業收入-上月比較增減(%)"],
    dateFields: ["出表日期", "資料年月"],
  },
  {
    id: "otc-revenue",
    title: "上櫃月營收",
    role: "與上市月營收同一資料年月。顯示來源年月，不把出表月當成營收月。",
    url: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O",
    documentationUrl: TPEx_DOC,
    licenseMetadataUrl: "https://data.gov.tw/dataset/56510",
    provider: "金融監督管理委員會證券期貨局／證券櫃檯買賣中心",
    cadence: "月營收。百分比欄位已是百分數。金額單位未標明。",
    partOfVerifiedNine: true,
    requiredKeys: ["出表日期", "資料年月", "公司代號", "營業收入-當月營收", "營業收入-上月比較增減(%)"],
    dateFields: ["出表日期", "資料年月"],
  },
  {
    id: "twse-holiday",
    title: "集中市場開休市日期",
    role: "只用來判斷交易日。不是九個市場資料集之一。",
    url: "https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule",
    documentationUrl: TWSE_DOC,
    licenseMetadataUrl: null,
    provider: "臺灣證券交易所 OpenAPI",
    cadence: "年度開休市表。某一日同時寫開始交易與放假時，視為無法判斷。",
    partOfVerifiedNine: false,
    requiredKeys: ["Name", "Date"],
    dateFields: ["Date"],
  },
];

export const BLOCKED_CB_DAILY_QUOTE = {
  id: "cb-daily-quote",
  title: "可轉債個券日行情",
  pageUrl: "https://www.tpex.org.tw/zh-tw/bond/info/statistics-cb/day-quotes.html",
  reason:
    "公開頁面有「下載 CSV」按鈕，但沒有可直接引用的靜態 CSV 網址，也還沒有對到政府資料開放授權的個券日行情資料集。頁面腳本裡的 bond/cbDayQry 不是 OpenAPI 規格路徑，本程式不呼叫它。bond_cb_daily 是券商買賣日報，不是個券 OHLC。",
};

export function sourceById(id: SourceId): SourceDef {
  const found = FETCHABLE_SOURCES.find((item) => item.id === id);
  if (!found) throw new Error(`unknown source ${id}`);
  return found;
}

export function verifiedNine(): SourceDef[] {
  return FETCHABLE_SOURCES.filter((item) => item.partOfVerifiedNine);
}

export { LICENSE, LICENSE_URL };
