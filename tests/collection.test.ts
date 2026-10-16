import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeProductUrl, isMediaUrl } from "../src/lib/amazon/url";
import { classifyPage, parseProductHtml } from "../src/lib/amazon/parser";
import { fetchProductPage } from "../src/lib/amazon/collector";
import { buildCsv } from "../src/lib/media";

const target = normalizeProductUrl("B0DW1FVPK8");
const image = "https://m.media-amazon.com/images/I/71TEST._AC_SL1500_.jpg";
const hls = "https://m.media-amazon.com/images/S/video/default.hls.m3u8";

test("商品输入只规范化受支持的 HTTPS 商品地址", () => {
  assert.deepEqual(normalizeProductUrl(" b0dw1fvpk8 ", "amazon.co.jp"), {
    asin: "B0DW1FVPK8",
    marketplace: "amazon.co.jp",
    url: "https://www.amazon.co.jp/dp/B0DW1FVPK8",
  });
  assert.equal(
    normalizeProductUrl(
      "https://www.amazon.de/name/gp/product/B0DW1FVPK8/ref=test?tag=x",
    ).url,
    "https://www.amazon.de/dp/B0DW1FVPK8",
  );
  for (const value of [
    "https://amazon.com.evil.test/dp/B0DW1FVPK8",
    "https://evilamazon.com/dp/B0DW1FVPK8",
    "https://127.0.0.1/dp/B0DW1FVPK8",
    "http://www.amazon.com/dp/B0DW1FVPK8",
    "https://user:pass@www.amazon.com/dp/B0DW1FVPK8",
    "https://www.amazon.com:8080/dp/B0DW1FVPK8",
    "https://www.amazon.com/dp/B0DW1FVPK8EXTRA",
    "https://www.amazon.com/s?k=laptop",
  ])
    assert.throws(() => normalizeProductUrl(value), value);
});

test("素材地址拒绝非亚马逊媒体域名、账号及自定义端口", () => {
  assert.equal(isMediaUrl(image), true);
  for (const url of [
    "https://m.media-amazon.com.evil.test/a.jpg",
    "https://www.amazon.com/a.jpg",
    "https://user:pass@m.media-amazon.com/a.jpg",
    "https://m.media-amazon.com:8080/a.jpg",
  ])
    assert.equal(isMediaUrl(url), false);
});

test("提取内嵌数据和变体，按物理图片去重，同时排除推荐区图片", () => {
  const html = `<title>Example</title><span id="productTitle">Product title</span><script>var state={colorImages:{Black:[{hiRes:"${image}",variant:"MAIN"}],White:[{hiRes:"${image}",variant:"MAIN"}]},dimensionValuesDisplayData:{B0DW1FVPK8:["Black"],B0DW1FVPK9:["White"]},videos:[{url:"${hls}",title:"Video",durationSeconds:12}]};</script><div id="recommendations"><img src="https://m.media-amazon.com/images/I/RECOMMEND.jpg"></div>`;
  const parsed = parseProductHtml(html, target);
  assert.equal(parsed.title, "Product title");
  assert.equal(parsed.assets.length, 2);
  assert.equal(parsed.assets[0].variant, "Black / White");
  assert.equal(parsed.assets[0].url, image);
  assert.equal(parsed.assets[0].width, undefined);
  assert.equal(parsed.assets[0].sizeHint, 1500);
  assert.equal(parsed.variants.length, 2);
  assert.equal(parsed.assets[1].format, "hls");
});

test("静态读取 parseJSON 数据，绝不执行商品页面脚本", () => {
  const data = { colorImages: { initial: [{ hiRes: image }] } };
  const script = `var state = A.$.parseJSON(${JSON.stringify(JSON.stringify(data))}); throw new Error("must never execute");`;
  const parsed = parseProductHtml(`<script>${script}</script>`, target);
  assert.equal(parsed.assets[0].url, image);
});

test("HTML 编码的视频卡片可提取，不把预览视频误当完整素材", () => {
  const data = JSON.stringify([
    {
      videoURL: hls,
      title: "Brand video",
      videoPreviewAssets: "https://m.media-amazon.com/preview.mp4",
    },
  ]).replaceAll('"', "&quot;");
  const parsed = parseProductHtml(
    `<button type="button" data-video-items="${data}" data-video-url="${hls}"></button>`,
    target,
  );
  assert.equal(parsed.assets.length, 1);
  assert.equal(parsed.assets[0].url, hls);
});

test("A+、当前评论素材与商品图片分别归类", () => {
  const parsed = parseProductHtml(
    `<img id="landingImage" data-old-hires="${image}"><div id="aplus"><img src="https://m.media-amazon.com/images/I/APLUS.jpg"></div><div data-hook="review"><div data-hook="review-image-tile"><img src="https://m.media-amazon.com/images/I/REVIEW.jpg"></div></div>`,
    target,
  );
  assert.deepEqual(
    parsed.assets.map((a) => a.group),
    ["product", "aplus", "review"],
  );
});

test("验证码与上游限制单独归类，正常商品提到 robot 不应被误拦", () => {
  assert.equal(
    classifyPage(
      '<title>Robot Check</title><form action="/errors/validateCaptcha"></form>',
      200,
    ),
    "blocked",
  );
  assert.equal(classifyPage("<title>Robot vacuum cleaner</title>", 200), "ok");
  assert.equal(classifyPage("", 429), "blocked");
  assert.equal(classifyPage("<title>Service unavailable</title>", 503), "ok");
  assert.equal(
    classifyPage("<title>Page Not Found</title>", 404),
    "unavailable",
  );
});

test("未知页面不伪造素材，CSV 转义公式与引号", () => {
  assert.equal(
    parseProductHtml("<html><title>Unknown page</title></html>", target).assets
      .length,
    0,
  );
  const asset = parseProductHtml(
    `<script>var data={videos:[{url:"${hls}",title:'=HYPERLINK("example")'}]};</script>`,
    target,
  ).assets[0];
  const csv = buildCsv([asset]);
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes('""example""'));
});

test("采集服务拒绝外部跳转，合法同商品跳转保留必要查询参数", async () => {
  const original = globalThis.fetch;
  const seen: string[] = [];
  try {
    globalThis.fetch = async (input) => {
      seen.push(String(input));
      return new Response(null, {
        status: 302,
        headers: { location: "https://evil.test/dp/B0DW1FVPK8" },
      });
    };
    await assert.rejects(fetchProductPage(target));
    assert.equal(seen.length, 1);
    seen.length = 0;
    globalThis.fetch = async (input) => {
      seen.push(String(input));
      return seen.length === 1
        ? new Response(null, {
            status: 302,
            headers: { location: "/dp/B0DW1FVPK8?th=1" },
          })
        : new Response("<title>Product</title>");
    };
    const page = await fetchProductPage(target);
    assert.equal(seen[1], "https://www.amazon.com/dp/B0DW1FVPK8?th=1");
    assert.equal(page.status, 200);
  } finally {
    globalThis.fetch = original;
  }
});

test("取消采集会将终止信号传递给上游请求", async () => {
  const original = globalThis.fetch;
  const abort = new AbortController();
  abort.abort();
  try {
    globalThis.fetch = async (_input, init) => {
      assert.equal(init?.signal?.aborted, true);
      throw init?.signal?.reason;
    };
    await assert.rejects(fetchProductPage(target, abort.signal));
  } finally {
    globalThis.fetch = original;
  }
});

test("懒加载视频与嵌套 source 保留原地址、封面及上下文，重复地址只计一次", () => {
  const extensionless = "https://m.media-amazon.com/images/G/01/product/cinemagraph";
  const parsed = parseProductHtml(
    `<div id="aplus"><video data-src="${extensionless}" src="${extensionless}" poster="${image}" aria-label="Product in use" width="1280" height="720"><source data-lazy-src="${hls}" type="application/vnd.apple.mpegurl"></video></div>
    <div data-hook="review"><video><source data-original="//m.media-amazon.com/review.mp4" type="video/mp4"></video></div>`,
    target,
  );
  assert.equal(parsed.assets.length, 3);
  assert.deepEqual(parsed.assets.map((a) => [a.url, a.group, a.format]), [
    [extensionless, "aplus", "mp4"], [hls, "aplus", "hls"],
    ["https://m.media-amazon.com/review.mp4", "review", "mp4"],
  ]);
  assert.equal(parsed.assets[0].thumbnail, image);
  assert.equal(parsed.assets[0].title, "Product in use");
  assert.equal(parsed.assets[0].width, 1280);
  assert.equal(parsed.assets[1].thumbnail, image);
  assert.equal(parsed.assets[1].title, "Product in use");
});

test("懒加载提取逐项校验域名，非法属性不遮挡合法回退，也不把 picture source 当视频", () => {
  const parsed = parseProductHtml(
    `<video data-src="https://m.media-amazon.com.evil.test/evil.mp4" src="https://m.media-amazon.com/good.mp4" data-poster="https://evil.test/poster.jpg"></video>
    <video data-src="javascript:alert(1)"></video><video data-src="http://m.media-amazon.com/insecure.mp4"></video>
    <div id="aplus"><picture><source src="${image}"><img data-src="data:image/gif;base64,AAAA" data-lazy-src="${image}"></picture></div>
    <video><source data-src="https://m.media-amazon.com/clip.webm" type="video/webm"></video>
    <div id="recommendations"><img data-src="https://m.media-amazon.com/related.jpg"></div>`, target,
  );
  assert.equal(parsed.assets.length, 2);
  assert.deepEqual(parsed.assets.map((a) => a.kind), ["video", "image"]);
  assert.equal(parsed.assets[0].url, "https://m.media-amazon.com/good.mp4");
  assert.equal(parsed.assets[0].thumbnail, "");
  assert.equal(parsed.assets[1].url, image);
});

test("图片支持懒加载 srcset、picture 和 data-original，选取已声明的大图而不计占位图", () => {
  const base = "https://m.media-amazon.com/images/I/";
  const parsed = parseProductHtml(
    `<div id="aplus">
    <img src="${base}PLACEHOLDER.jpg" data-srcset="https://evil.test/a.jpg 3000w, ${base}RESPONSIVE._SX300_.jpg 300w, ${base}RESPONSIVE._SX1200_.jpg 1200w">
    <picture><source data-lazy-srcset="${base}PICTURE.jpg 1x, ${base}PICTURE@2.jpg 2x"><img src="data:image/gif;base64,AAAA"></picture>
    <img data-original="//m.media-amazon.com/images/I/ORIGINAL.jpg">
    <img data-srcset="${base}COMMA,IMAGE.jpg 2x, ${base}SMALL.jpg 1x">
    <img data-srcset="${base}DEFAULT.jpg, ${base}DENSE.jpg 2x">
    </div>
    <div data-hook="review"><div data-hook="review-image-tile"><img srcset="${base}REVIEW.jpg 1x, ${base}REVIEW@2.jpg 2x"></div></div>`, target,
  );
  assert.deepEqual(parsed.assets.map((a) => a.url), [
    `${base}RESPONSIVE._SX1200_.jpg`, `${base}PICTURE@2.jpg`, `${base}ORIGINAL.jpg`,
    `${base}COMMA,IMAGE.jpg`, `${base}DENSE.jpg`, `${base}REVIEW@2.jpg`,
  ]);
  assert.equal(parsed.assets.at(-1)?.group, "review");
});

test("结构化原图优先于懒加载缩略图，无效 srcset 回退到有效 data-src", () => {
  const parsed = parseProductHtml(
    `<script>var state={colorImages:{initial:[{hiRes:"${image}"}]}};</script>
    <img id="landingImage" data-src="https://m.media-amazon.com/images/I/71TEST._SX100_.jpg">
    <div id="aplus"><img data-a-dynamic-image="null" data-srcset="https://m.media-amazon.com/invalid.jpg 0w, https://m.media-amazon.com/fraction.jpg 1.5w, https://evil.test/a.jpg 200w" data-src="https://m.media-amazon.com/fallback.jpg"></div>`, target,
  );
  assert.equal(parsed.assets.length, 2);
  assert.equal(parsed.assets[0].url, image);
  assert.equal(parsed.assets[1].url, "https://m.media-amazon.com/fallback.jpg");
});
