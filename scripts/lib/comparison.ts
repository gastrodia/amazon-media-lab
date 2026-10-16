import * as cheerio from "cheerio";
import { classifyPage, parseProductHtml } from "../../src/lib/amazon/parser";
import { normalizeProductUrl } from "../../src/lib/amazon/url";
import type { CollectionTarget } from "../../src/lib/amazon/types";

export type Method = "fetch" | "playwright";
export interface Assessment {
  outcome:
    | "success"
    | "blocked"
    | "upstream_error"
    | "unavailable"
    | "wrong_product"
    | "no_media";
  title: string;
  documentTitle: string;
  pageAsin: string;
  images: number;
  videos: number;
  variants: number;
  assetUrls: string[];
}

export interface Trial {
  round: number;
  product: string;
  asin: string;
  marketplace: string;
  method: Method;
  orderInPair: number;
  startedAt: string;
  elapsedMs: number;
  outcome: Assessment["outcome"] | "timeout" | "navigation_error" | "oversized";
  status?: number;
  htmlBytes?: number;
  assessment?: Assessment;
  rendered?: Assessment;
  chosenSource?: "response-html" | "rendered-dom";
  finalUrl?: string;
  sessionVisit?: number;
  error?: string;
  files?: { response?: string; rendered?: string; screenshot?: string };
}

export const PRODUCTS = [
  {
    label: "ASUS 笔记本 · 美国站",
    url: "https://www.amazon.com/dp/B0DW1FVPK8",
  },
  { label: "Kindle · 美国站", url: "https://www.amazon.com/dp/B0CFPJYX7P" },
  { label: "磁贴 · 新加坡站", url: "https://www.amazon.sg/dp/B09DKPP92N" },
];

export function assessHtml(
  html: string,
  status: number,
  target: CollectionTarget,
  finalUrl: string,
): Assessment {
  const $ = cheerio.load(html);
  const base: Assessment = {
    outcome: "no_media",
    title: "",
    documentTitle: $("title").text().trim(),
    pageAsin: $("input#ASIN, input[name='ASIN']").first().attr("value") || "",
    images: 0,
    videos: 0,
    variants: 0,
    assetUrls: [],
  };
  const pageClass = classifyPage(html, status);
  if (pageClass === "blocked") return { ...base, outcome: "blocked" };
  if (pageClass === "unavailable") return { ...base, outcome: "unavailable" };
  if (status >= 400) return { ...base, outcome: "upstream_error" };
  try {
    const actual = normalizeProductUrl(finalUrl);
    if (
      actual.asin !== target.asin ||
      actual.marketplace !== target.marketplace
    )
      return { ...base, outcome: "wrong_product" };
  } catch {
    return { ...base, outcome: "wrong_product" };
  }
  if (base.pageAsin && base.pageAsin !== target.asin)
    return { ...base, outcome: "wrong_product" };
  const parsed = parseProductHtml(html, target);
  const hasProductIdentity =
    base.pageAsin === target.asin || !!$("#productTitle").text().trim();
  return {
    ...base,
    outcome:
      hasProductIdentity && !!parsed.title && parsed.assets.length > 0
        ? "success"
        : "no_media",
    title: parsed.title,
    images: parsed.assets.filter((a) => a.kind === "image").length,
    videos: parsed.assets.filter((a) => a.kind === "video").length,
    variants: parsed.variants.length,
    assetUrls: parsed.assets.map((a) => a.url),
  };
}

export function chooseBrowserAssessment(
  initial: Assessment,
  rendered: Assessment,
) {
  // A challenge or wrong-product redirect after rendering cannot count as success.
  if (
    ["blocked", "wrong_product", "upstream_error", "unavailable"].includes(
      rendered.outcome,
    )
  )
    return { assessment: rendered, source: "rendered-dom" as const };
  if (rendered.outcome === "success" && initial.outcome !== "success")
    return { assessment: rendered, source: "rendered-dom" as const };
  return { assessment: initial, source: "response-html" as const };
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarize(trials: Trial[]) {
  const methods = (["fetch", "playwright"] as const).map((method) => {
    const selected = trials.filter((t) => t.method === method);
    const success = selected.filter((t) => t.outcome === "success");
    return {
      method,
      attempts: selected.length,
      successes: success.length,
      successRate: selected.length ? success.length / selected.length : null,
      blocked: selected.filter((t) => t.outcome === "blocked").length,
      errors: selected.filter(
        (t) => !["success", "blocked"].includes(t.outcome),
      ).length,
      medianAllMs: median(selected.map((t) => t.elapsedMs)),
      medianSuccessMs: median(success.map((t) => t.elapsedMs)),
    };
  });
  const pairs = new Map<string, Partial<Record<Method, Trial>>>();
  for (const trial of trials) {
    const key = `${trial.round}:${trial.marketplace}:${trial.asin}`;
    const pair = pairs.get(key) || {};
    pair[trial.method] = trial;
    pairs.set(key, pair);
  }
  const completedPairs = [...pairs.values()].filter(
    (pair) => pair.fetch && pair.playwright,
  );
  const paired = {
    count: completedPairs.length,
    bothSucceeded: completedPairs.filter(
      (p) =>
        p.fetch!.outcome === "success" && p.playwright!.outcome === "success",
    ).length,
    playwrightRescued: completedPairs.filter(
      (p) =>
        p.fetch!.outcome !== "success" && p.playwright!.outcome === "success",
    ).length,
    playwrightRegressed: completedPairs.filter(
      (p) =>
        p.fetch!.outcome === "success" && p.playwright!.outcome !== "success",
    ).length,
    bothFailed: completedPairs.filter(
      (p) =>
        p.fetch!.outcome !== "success" && p.playwright!.outcome !== "success",
    ).length,
  };
  const improvementPercentagePoints = methods.every(
    (m) => m.successRate !== null,
  )
    ? (methods[1].successRate! - methods[0].successRate!) * 100
    : null;
  return { methods, paired, improvementPercentagePoints };
}
