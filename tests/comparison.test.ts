import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assessHtml,
  chooseBrowserAssessment,
  summarize,
  type Assessment,
  type Trial,
} from "../scripts/lib/comparison";
import { normalizeProductUrl } from "../src/lib/amazon/url";

const target = normalizeProductUrl("B0DW1FVPK8");
const good = `<title>Product</title><input id="ASIN" value="B0DW1FVPK8"><span id="productTitle">Laptop</span><script>var x={colorImages:{initial:[{hiRes:"https://m.media-amazon.com/images/I/TEST.jpg"}]}};</script>`;

test("对比实验不把 HTTP 200 验证页或错误商品算成功", () => {
  assert.equal(assessHtml(good, 200, target, target.url).outcome, "success");
  assert.equal(
    assessHtml("<title>Robot Check</title>", 200, target, target.url).outcome,
    "blocked",
  );
  assert.equal(
    assessHtml(
      good.replace('value="B0DW1FVPK8"', 'value="B0DW1FVPK9"'),
      200,
      target,
      target.url,
    ).outcome,
    "wrong_product",
  );
  assert.equal(
    assessHtml(good, 500, target, target.url).outcome,
    "upstream_error",
  );
});

test("渲染后遇到验证页会否决初始成功，动态素材成功可挽回初始空结果", () => {
  const initial = assessHtml(good, 200, target, target.url);
  const blocked: Assessment = {
    ...initial,
    outcome: "blocked",
    images: 0,
    assetUrls: [],
  };
  const empty: Assessment = {
    ...initial,
    outcome: "no_media",
    images: 0,
    assetUrls: [],
  };
  assert.equal(
    chooseBrowserAssessment(initial, blocked).assessment.outcome,
    "blocked",
  );
  assert.equal(chooseBrowserAssessment(empty, initial).source, "rendered-dom");
});

test("成功率包含失败尝试，配对挽回与退化分别统计", () => {
  const trial = (
    round: number,
    method: Trial["method"],
    outcome: Trial["outcome"],
  ): Trial => ({
    round,
    method,
    outcome,
    product: "Example",
    asin: target.asin,
    marketplace: target.marketplace,
    orderInPair: 1,
    startedAt: new Date(0).toISOString(),
    elapsedMs: 100,
  });
  const summary = summarize([
    trial(1, "fetch", "blocked"),
    trial(1, "playwright", "success"),
    trial(2, "fetch", "success"),
    trial(2, "playwright", "timeout"),
    trial(3, "fetch", "success"),
    trial(3, "playwright", "success"),
    trial(4, "fetch", "navigation_error"),
    trial(4, "playwright", "blocked"),
  ]);
  assert.equal(summary.methods[0].successRate, 0.5);
  assert.equal(summary.methods[1].successRate, 0.5);
  assert.equal(summary.methods[1].errors, 1);
  assert.equal(summary.improvementPercentagePoints, 0);
  assert.deepEqual(summary.paired, {
    count: 4,
    bothSucceeded: 1,
    playwrightRescued: 1,
    playwrightRegressed: 1,
    bothFailed: 1,
  });
});
