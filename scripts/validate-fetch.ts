import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { fetchProductPage } from "../src/lib/amazon/collector";
import { parseProductHtml } from "../src/lib/amazon/parser";
import { normalizeProductUrl } from "../src/lib/amazon/url";
import type { MediaAsset } from "../src/lib/amazon/types";
import { assessHtml, PRODUCTS, summarize, type Trial } from "./lib/comparison";

// Optional parser baseline recorded BEFORE editing, against saved Fetch HTML.
const baselinePath = process.argv[2];
const dir = resolve("work", `fetch-lazy-${new Date().toISOString().replace(/[:.]/g, "-")}`);
await mkdir(dir, { recursive: true });
const replay: {
  file: string; asin: string; marketplace: string; round: number;
  before: { images: number; videos: number };
  after: { images: number; videos: number };
  added: MediaAsset[]; removed: MediaAsset[];
}[] = [];
if (baselinePath) {
  const baseline: {
    dir: string;
    results: { file: string; asin: string; marketplace: string; round: number;
      images: number; videos: number; assets: MediaAsset[] }[];
  } = JSON.parse(await readFile(baselinePath, "utf8"));
  await writeFile(`${dir}/baseline.json`, JSON.stringify(baseline, null, 2));
  for (const before of baseline.results) {
    const html = await readFile(resolve(baseline.dir, before.file), "utf8");
    const target = normalizeProductUrl(before.asin, before.marketplace);
    const after = parseProductHtml(html, target);
    const previous = new Set(before.assets.map((a) => a.url));
    const current = new Set(after.assets.map((a) => a.url));
    const result = {
      file: before.file, asin: before.asin, marketplace: before.marketplace, round: before.round,
      before: { images: before.images, videos: before.videos },
      after: { images: after.assets.filter((a) => a.kind === "image").length,
        videos: after.assets.filter((a) => a.kind === "video").length },
      added: after.assets.filter((a) => !previous.has(a.url)),
      removed: before.assets.filter((a) => !current.has(a.url)),
    };
    replay.push(result);
    console.log(JSON.stringify({ phase: "snapshot-replay", asin: before.asin, round: before.round,
      before: result.before, after: result.after, added: result.added.length, removed: result.removed.length }));
  }
}
const trials: Trial[] = [];
const assets: { round: number; asin: string; assets: MediaAsset[] }[] = [];
const cooldown = new Map<string, number>();
const startedAt = new Date().toISOString();
async function save() {
  const report = {
    startedAt, updatedAt: new Date().toISOString(),
    protocol: { rounds: 4, concurrency: 1, intervalMs: 4000, challengeCooldownMs: 30000,
      retries: 0, method: "existing Fetch", success: "Matching product page with at least one extracted asset",
      scope: "Local acquisition and parsing only; no deployment or full media download" },
    baselinePath: baselinePath ? resolve(baselinePath) : null,
    replay, trials, assets, summary: summarize(trials).methods.find((m) => m.method === "fetch"),
  };
  await writeFile(`${dir}/results.json`, JSON.stringify(report, null, 2));
}
await save();
for (let round = 1; round <= 4; round++) {
  // Rotate products like the preceding experiment, with no browser requests.
  const order = PRODUCTS.map((_, i) => PRODUCTS[(i + round - 1) % PRODUCTS.length]);
  for (const product of order) {
    if (trials.length) await pause(4000);
    const target = normalizeProductUrl(product.url);
    const remaining = (cooldown.get(target.marketplace) || 0) - Date.now();
    if (remaining > 0) await pause(remaining);
    const start = performance.now();
    const trial: Trial = { round, product: product.label, asin: target.asin,
      marketplace: target.marketplace, method: "fetch", orderInPair: 1,
      startedAt: new Date().toISOString(), elapsedMs: 0, outcome: "navigation_error" };
    try {
      const page = await fetchProductPage(target);
      const assessment = assessHtml(page.html, page.status, target, target.url);
      trial.elapsedMs = Math.round(performance.now() - start);
      trial.status = page.status;
      trial.htmlBytes = page.bytes;
      trial.assessment = assessment;
      trial.outcome = assessment.outcome;
      const filename = `r${round}-${target.marketplace}-${target.asin}-fetch.html`;
      trial.files = { response: filename };
      await writeFile(`${dir}/${filename}`, page.html);
      if (assessment.outcome === "success")
        assets.push({ round, asin: target.asin, assets: parseProductHtml(page.html, target).assets });
      if (assessment.outcome === "blocked") cooldown.set(target.marketplace, Date.now() + 30000);
    } catch (error) {
      trial.elapsedMs = Math.round(performance.now() - start);
      trial.error = error instanceof Error ? error.message : String(error);
      trial.outcome = /timeout|aborted/i.test(trial.error) ? "timeout"
        : /6 MB/.test(trial.error) ? "oversized" : "navigation_error";
    }
    trials.push(trial);
    await save();
    console.log(JSON.stringify({ phase: "live-fetch", round, asin: target.asin, status: trial.status,
      outcome: trial.outcome, images: trial.assessment?.images, videos: trial.assessment?.videos,
      elapsedMs: trial.elapsedMs, error: trial.error }));
  }
}
console.log(JSON.stringify({ dir, summary: summarize(trials).methods.find((m) => m.method === "fetch") }));
