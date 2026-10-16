import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { chromium, type BrowserContext } from "playwright";
import { fetchProductPage } from "../src/lib/amazon/collector";
import { normalizeProductUrl } from "../src/lib/amazon/url";
import {
  assessHtml,
  chooseBrowserAssessment,
  PRODUCTS,
  summarize,
  type Method,
  type Trial,
} from "./lib/comparison";

const rounds = Number(process.env.COMPARE_ROUNDS || 4);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 6)
  throw new Error("COMPARE_ROUNDS must be between 1 and 6.");
const gapMs = 4_000;
const cooldownMs = 30_000;
const renderWaitMs = 2_500;
const timeoutMs = 20_000;
const maxHtmlBytes = 6 * 1024 * 1024;
const runId = new Date()
  .toISOString()
  .replaceAll(":", "-")
  .replace(/\.\d+Z$/, "Z");
const directory = resolve("work", `comparison-${runId}`);
await mkdir(directory, { recursive: true });

const browserStart = performance.now();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const browserStartupMs = Math.round(performance.now() - browserStart);
const contexts = new Map<string, { context: BrowserContext; visits: number }>();
const cooldownUntil = new Map<string, number>();
const trials: Trial[] = [];
const experiment = {
  runId,
  directory,
  startedAt: new Date().toISOString(),
  environment: "local macOS",
  nodeVersion: process.version,
  browserVersion: browser.version(),
  browserChannel: "chrome",
  headless: true,
  browserStartupMs,
  rounds,
  products: PRODUCTS,
  gapMs,
  cooldownMs,
  renderWaitMs,
  timeoutMs,
  maxHtmlBytes,
  protocol: {
    concurrency: 1,
    retriesPerTrial: 0,
    order:
      "Rotate product order each round; alternate fetch-first and playwright-first for every product, balanced over four rounds.",
    fetch:
      "Use existing production fetchProductPage; Chrome/131 User-Agent; no cookie jar; cache:no-store.",
    playwright:
      "Dedicated anonymous in-memory context per marketplace; preserve cookies during run; default browser User-Agent; HTTP cache disabled through pass-through routing; no personal profile, stealth patches, proxies or challenge solving.",
    success:
      "A normal page with matching product identity and at least one image/video extracted by the shared parser. HTTP 200 alone is insufficient. Success does not imply complete listing coverage or downloadable media.",
    scope:
      "Compare collectors on this local computer. Transport, headers, session and rendering differ together. No causal attribution to one factor; no inference about Vercel success rates.",
    timing:
      "End-to-end acquisition+shared parsing; browser includes fixed render wait and two extractions. Startup, cooldown/gap, screenshots and evidence writes excluded. No cache fallback.",
  },
};

async function checkpoint() {
  await writeFile(
    join(directory, "results.json"),
    JSON.stringify(
      {
        ...experiment,
        updatedAt: new Date().toISOString(),
        trials,
        summary: summarize(trials),
      },
      null,
      2,
    ),
  );
}

async function run(
  method: Method,
  round: number,
  product: (typeof PRODUCTS)[number],
  orderInPair: number,
) {
  const target = normalizeProductUrl(product.url);
  const key = `${method}:${target.marketplace}`;
  const cooling = (cooldownUntil.get(key) || 0) - Date.now();
  if (cooling > 0) {
    console.log(
      JSON.stringify({
        event: "cooldown",
        method,
        marketplace: target.marketplace,
        waitMs: cooling,
      }),
    );
    await delay(cooling);
  }
  const trial: Trial = {
    round,
    product: product.label,
    asin: target.asin,
    marketplace: target.marketplace,
    method,
    orderInPair,
    startedAt: new Date().toISOString(),
    elapsedMs: 0,
    outcome: "navigation_error",
    files: {},
  };
  const stem = `r${round}-${target.marketplace}-${target.asin}-${method}`;
  const start = performance.now();
  let browserPage: Awaited<ReturnType<BrowserContext["newPage"]>> | undefined;
  try {
    if (method === "fetch") {
      const page = await fetchProductPage(target);
      trial.status = page.status;
      trial.htmlBytes = page.bytes;
      trial.finalUrl = target.url;
      trial.assessment = assessHtml(page.html, page.status, target, target.url);
      trial.outcome = trial.assessment.outcome;
      trial.chosenSource = "response-html";
      trial.elapsedMs = Math.round(performance.now() - start);
      trial.files!.response = `${stem}-response.html`;
      await writeFile(join(directory, trial.files!.response), page.html);
    } else {
      let session = contexts.get(target.marketplace);
      if (!session) {
        const context = await browser.newContext({
          locale: "en-US",
          viewport: { width: 1280, height: 800 },
          serviceWorkers: "block",
          acceptDownloads: false,
        });
        // Pass through every request unchanged. Routing disables HTTP cache.
        await context.route("**/*", (route) => route.continue());
        session = { context, visits: 0 };
        contexts.set(target.marketplace, session);
      }
      trial.sessionVisit = ++session.visits;
      browserPage = await session.context.newPage();
      const response = await browserPage.goto(target.url, {
        timeout: timeoutMs,
        waitUntil: "domcontentloaded",
      });
      if (!response)
        throw new Error("Navigation did not return a main-document response.");
      trial.status = response.status();
      const initial = await response.text();
      trial.htmlBytes = Buffer.byteLength(initial);
      if (trial.htmlBytes > maxHtmlBytes) throw new Error("HTML_SIZE_LIMIT");
      trial.assessment = assessHtml(
        initial,
        trial.status,
        target,
        response.url(),
      );
      if (trial.assessment.outcome !== "blocked" && trial.status < 400)
        await browserPage.waitForTimeout(renderWaitMs);
      const rendered = await browserPage.content();
      if (Buffer.byteLength(rendered) > maxHtmlBytes)
        throw new Error("HTML_SIZE_LIMIT");
      trial.finalUrl = browserPage.url();
      trial.rendered = assessHtml(
        rendered,
        trial.status,
        target,
        trial.finalUrl,
      );
      const chosen = chooseBrowserAssessment(trial.assessment, trial.rendered);
      trial.outcome = chosen.assessment.outcome;
      trial.chosenSource = chosen.source;
      trial.elapsedMs = Math.round(performance.now() - start);
      trial.files!.response = `${stem}-response.html`;
      trial.files!.rendered = `${stem}-rendered.html`;
      await writeFile(join(directory, trial.files!.response), initial);
      await writeFile(join(directory, trial.files!.rendered), rendered);
      if (round === 1 || trial.outcome !== "success") {
        const screenshot = `${stem}.jpg`;
        try {
          await browserPage.screenshot({
            path: join(directory, screenshot),
            type: "jpeg",
            quality: 70,
            timeout: 5_000,
            animations: "disabled",
          });
          trial.files!.screenshot = screenshot;
        } catch {
          /* A failed screenshot does not change acquisition outcome. */
        }
      }
    }
  } catch (error) {
    trial.elapsedMs = Math.round(performance.now() - start);
    trial.error = error instanceof Error ? error.message : String(error);
    trial.outcome =
      trial.error === "HTML_SIZE_LIMIT"
        ? "oversized"
        : /timeout|timed out/i.test(trial.error)
          ? "timeout"
          : "navigation_error";
  } finally {
    await browserPage?.close().catch(() => {});
  }
  if (trial.outcome === "blocked" || trial.status === 429)
    cooldownUntil.set(key, Date.now() + cooldownMs);
  trials.push(trial);
  await checkpoint();
  const chosen =
    trial.chosenSource === "rendered-dom" ? trial.rendered : trial.assessment;
  console.log(
    JSON.stringify({
      event: "trial",
      completed: trials.length,
      planned: rounds * PRODUCTS.length * 2,
      round,
      method,
      asin: trial.asin,
      marketplace: trial.marketplace,
      outcome: trial.outcome,
      status: trial.status,
      elapsedMs: trial.elapsedMs,
      images: chosen?.images,
      videos: chosen?.videos,
      renderedImages: trial.rendered?.images,
      renderedVideos: trial.rendered?.videos,
      sessionVisit: trial.sessionVisit,
      error: trial.error,
    }),
  );
}

try {
  await checkpoint();
  for (let round = 1; round <= rounds; round++) {
    for (let offset = 0; offset < PRODUCTS.length; offset++) {
      const productIndex = (offset + round - 1) % PRODUCTS.length;
      const order: Method[] =
        (round + productIndex) % 2 === 0
          ? ["playwright", "fetch"]
          : ["fetch", "playwright"];
      for (let index = 0; index < order.length; index++) {
        await run(order[index], round, PRODUCTS[productIndex], index + 1);
        if (trials.length < rounds * PRODUCTS.length * 2) await delay(gapMs);
      }
    }
  }
} finally {
  await browser.close();
  await checkpoint();
}
console.log(
  JSON.stringify({ event: "complete", directory, ...summarize(trials) }),
);
