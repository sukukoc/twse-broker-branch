/**
 * Serve dist/ the way GitHub Pages serves a project subsite and check the
 * three URL shapes plus relative assets and snapshot.json.
 *
 * Usage: node scripts/verify-pages-subpath.mjs [distDir]
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.resolve(appRoot, process.argv[2] ?? "dist");
const prefix = "/twse-broker-branch/convertible-bonds";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const indexHtml = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
if (!indexHtml.includes("./assets/")) fail("dist/index.html is missing relative ./assets/");
if (indexHtml.includes('src="/assets/') || indexHtml.includes('href="/assets/')) {
  fail("dist/index.html uses site-root asset paths");
}

const assetMatch = indexHtml.match(/\.\/assets\/[^"']+/);
if (!assetMatch) fail("could not find an asset URL in dist/index.html");
const assetRel = assetMatch[0].replace(/^\.\//, "");

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  if (file.endsWith(".csv")) return "text/csv; charset=utf-8";
  return "application/octet-stream";
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === prefix) {
    res.writeHead(302, { Location: `${prefix}/` });
    res.end();
    return;
  }
  if (!pathname.startsWith(`${prefix}/`)) {
    res.writeHead(404);
    res.end("not the subsite");
    return;
  }
  let rel = pathname.slice(prefix.length + 1);
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const file = path.resolve(distDir, rel);
  if (!file.startsWith(`${distDir}${path.sep}`) && file !== distDir) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    res.end("missing");
    return;
  }
  res.writeHead(200, { "Content-Type": contentType(file) });
  fs.createReadStream(file).pipe(res);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const origin = `http://127.0.0.1:${port}`;

async function get(urlPath, redirect = "follow") {
  const response = await fetch(`${origin}${urlPath}`, { redirect });
  const text = await response.text();
  return { status: response.status, url: response.url, text, headers: response.headers };
}

const noSlash = await get(prefix, "manual");
if (noSlash.status !== 302 && noSlash.status !== 301) fail(`no-slash status ${noSlash.status}`);
if (noSlash.headers.get("location") !== `${prefix}/`) fail(`no-slash location ${noSlash.headers.get("location")}`);

const withSlash = await get(`${prefix}/`);
if (withSlash.status !== 200 || !withSlash.text.includes('src="./assets/')) fail("slash URL did not serve relative index.html");

const indexPage = await get(`${prefix}/index.html`);
if (indexPage.status !== 200 || !indexPage.text.includes("./assets/")) fail("index.html URL failed");

const asset = await get(`${prefix}/${assetRel}`);
if (asset.status !== 200 || asset.text.length < 100) fail(`asset ${assetRel} status ${asset.status}`);

const snapshotResponse = await get(`${prefix}/data/snapshot.json`);
if (snapshotResponse.status !== 200) fail(`snapshot status ${snapshotResponse.status}`);
const snapshot = JSON.parse(snapshotResponse.text);
if (snapshot.complete !== false) fail("snapshot.complete is not false");
if (snapshot.coverage?.premiumComputed !== 0) fail("premiumComputed is not 0");
const china = snapshot.instruments.find((item) => item.shortName?.includes("中砂") || item.cbCode === "15602");
const tcc = snapshot.instruments.find((item) => item.cbCode === "11011");
if (!china) fail("snapshot has no 中砂 bond");
if (!tcc) fail("snapshot has no 11011");
if (tcc.effectiveConversionPrice != null || tcc.cbClose != null || tcc.conversionPremium != null) {
  fail("11011 has a fabricated CB price or effective K");
}
const csv = await get(`${prefix}/data/market.csv`);
if (csv.status !== 200 || !csv.text.includes("11011")) fail("market.csv missing 11011");

console.log(
  JSON.stringify({
    ok: true,
    port,
    noSlash: noSlash.status,
    withSlash: withSlash.status,
    indexHtml: indexPage.status,
    asset: assetRel,
    codedBonds: snapshot.coverage?.codedBonds,
    quarantined: snapshot.coverage?.quarantined,
    cbMasterAsOf: snapshot.coverage?.cbMasterAsOf,
    issuerEquityAsOf: snapshot.coverage?.issuerEquityAsOf,
    revenueYearMonth: snapshot.coverage?.revenueYearMonth,
    complete: snapshot.complete,
    china: china.cbCode,
    bond11011: tcc.cbCode,
  }),
);

server.close();
process.exit(0);
