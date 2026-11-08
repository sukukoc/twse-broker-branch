#!/usr/bin/env bash
# Copy the built subsite into docs/convertible-bonds only.
# Does not read or write docs/data, docs/index.html, or the broker scripts.
set -euo pipefail

APP="$(cd "$(dirname "$0")/.." && pwd)"
ROOT="$(cd "$APP/.." && pwd)"
DIST="$APP/dist"
DEST="$ROOT/docs/convertible-bonds"

test -f "$DIST/index.html"
test -f "$DIST/data/snapshot.json"
test -f "$ROOT/docs/index.html"
test -f "$ROOT/docs/.nojekyll"
test -f "$ROOT/docs/data/index.json"

node --input-type=module -e '
import fs from "node:fs";
const snap = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (snap.complete !== false) {
  console.error("refusing snapshot with complete !== false");
  process.exit(1);
}
const coded = Array.isArray(snap.instruments) ? snap.instruments.filter((item) => !item.quarantined).length : 0;
if (coded < 300) {
  console.error(`refusing snapshot with only ${coded} coded bonds`);
  process.exit(1);
}
if (snap.coverage?.premiumComputed !== 0 || snap.coverage?.cbQuoteAsOf != null || snap.coverage?.effectiveConversionPriceCovered !== 0) {
  console.error("refusing snapshot that filled CB quotes, effective K, or premiums");
  process.exit(1);
}
const html = fs.readFileSync(process.argv[2], "utf8");
if (!html.includes("./assets/")) {
  console.error("built index.html is missing relative ./assets/");
  process.exit(1);
}
if (html.includes("src=\"/assets/") || html.includes("href=\"/assets/")) {
  console.error("built index.html uses site-root asset paths");
  process.exit(1);
}
' "$DIST/data/snapshot.json" "$DIST/index.html"

STAGE="$(mktemp -d)"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT
cp -a "$DIST"/. "$STAGE"/
mkdir -p "$DEST"
find "$DEST" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp -a "$STAGE"/. "$DEST"/
test -f "$DEST/index.html"
test -f "$DEST/data/snapshot.json"
test -f "$ROOT/docs/data/index.json"
echo "staged $DEST"
