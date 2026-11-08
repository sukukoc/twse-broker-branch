import path from "node:path";
import { fileURLToPath } from "node:url";
import { defaultPaths, runUpdate } from "../src/lib/run-update";

async function main(): Promise<void> {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const args = process.argv.slice(2);
  let fromVendor: string | undefined;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--from-vendor") fromVendor = path.resolve(root, args[i + 1] ?? "");
  }

  const schedulingEnabled = process.env.CB_SCHEDULING === "github-actions";
  const report = await runUpdate({
    paths: defaultPaths(root),
    fromVendor,
    now: new Date(),
    schedulingEnabled,
  });

  console.log(
    `STATUS ${report.runStatus} complete=${report.complete} coded_bonds=${report.codedBonds} stock_bars=${report.stockBars} cb_daily_bars=${report.cbDailyBars}`,
  );
  for (const line of report.verifiedFailures) console.log(`FAILED ${line}`);
  console.log("CB_DAILY_QUOTE unavailable");
  console.log("EFFECTIVE_CONVERSION_PRICE unavailable");
  console.log(`SCHEDULING enabled=${schedulingEnabled}`);
  console.log(`CB_RADAR_RESULT ${JSON.stringify(report)}`);
  if (report.verifiedFailures.length) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
