import { mkdir, writeFile } from "node:fs/promises";
import { collectProduct } from "../src/lib/amazon/collector";

const urls = process.argv.slice(2);
if (!urls.length)
  urls.push(
    "https://www.amazon.com/dp/B0DW1FVPK8",
    "https://www.amazon.com/dp/B0CFPJYX7P",
    "https://www.amazon.sg/dp/B09DKPP92N",
  );
const results = [];
for (const url of urls) {
  const result = await collectProduct(url);
  results.push(result);
  console.log(
    JSON.stringify({
      asin: result.asin,
      marketplace: result.marketplace,
      status: result.status,
      images: result.assets.filter((a) => a.kind === "image").length,
      videos: result.assets.filter((a) => a.kind === "video").length,
      elapsedMs: result.elapsedMs,
      environment: result.environment,
      upstreamStatus: result.upstreamStatus,
    }),
  );
}
await mkdir("work", { recursive: true });
await writeFile(
  "work/live-validation.json",
  JSON.stringify(
    {
      executedAt: new Date().toISOString(),
      scope:
        "Server acquisition only. Browser CORS, full downloads and Vercel deployment are separate checks.",
      results,
    },
    null,
    2,
  ),
);
