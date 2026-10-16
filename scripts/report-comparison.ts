import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { load } from "cheerio";
import { summarize, PRODUCTS, type Trial } from "./lib/comparison";

const directory = resolve(process.argv[2] || "");
if (!process.argv[2])
  throw new Error(
    "Usage: pnpm exec tsx scripts/report-comparison.ts work/comparison-<run>",
  );
const data = JSON.parse(
  await readFile(join(directory, "results.json"), "utf8"),
);
const trials = data.trials as Trial[];
const summary = summarize(trials);
const output = resolve(
  process.env.COMPARISON_OUTPUT_DIR || "work/comparison-report",
);
await mkdir(output, { recursive: true });
const escape = (value: unknown) =>
  String(value ?? "—").replace(
    /[&<>"']/g,
    (s) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        s
      ]!,
  );
const percent = (value: number | null) =>
  value === null ? "—" : `${(value * 100).toFixed(1)}%`;
const seconds = (value: number | null) =>
  value === null ? "—" : `${(value / 1000).toFixed(2)} s`;
const localTime = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
const outcomes: Record<string, string> = {
  success: "成功提取",
  blocked: "验证页/访问限制",
  upstream_error: "上游错误",
  unavailable: "页面不可用",
  wrong_product: "站点/商品不匹配",
  no_media: "未提取到素材",
  timeout: "超时",
  navigation_error: "请求/导航错误",
  oversized: "页面超限",
};
const chosen = (trial: Trial) =>
  trial.chosenSource === "rendered-dom" ? trial.rendered : trial.assessment;
const range = (values: number[]) =>
  values.length
    ? Math.min(...values) === Math.max(...values)
      ? String(values[0])
      : `${Math.min(...values)}–${Math.max(...values)}`
    : "—";
const table = (headers: string[], rows: unknown[][]) =>
  `<div class="table"><table><thead><tr>${headers.map((h) => `<th>${escape(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((v) => `<td>${escape(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const delta = summary.improvementPercentagePoints;
const verdict =
  delta === 0
    ? "本轮未观察到采集成功率提升。"
    : delta !== null && delta > 0
      ? `本轮成功率提高 ${delta.toFixed(1)} 个百分点。`
      : delta !== null
        ? `本轮 Playwright 成功率低 ${Math.abs(delta).toFixed(1)} 个百分点。`
        : "样本不足，无法比较。";
const expected = data.rounds * PRODUCTS.length * 2;
const complete = trials.length === expected;
const productRows = PRODUCTS.map((product) => {
  const related = trials.filter((t) => t.product === product.label);
  const fetchTrials = related.filter((t) => t.method === "fetch");
  const browserTrials = related.filter((t) => t.method === "playwright");
  return [
    product.label,
    related[0]?.asin || "—",
    `${fetchTrials.filter((t) => t.outcome === "success").length}/${fetchTrials.length}`,
    `${browserTrials.filter((t) => t.outcome === "success").length}/${browserTrials.length}`,
    range(
      fetchTrials
        .filter((t) => t.outcome === "success")
        .map((t) => chosen(t)?.images || 0),
    ),
    range(
      fetchTrials
        .filter((t) => t.outcome === "success")
        .map((t) => chosen(t)?.videos || 0),
    ),
    range(
      browserTrials
        .filter((t) => t.outcome === "success")
        .map((t) => t.assessment?.images || 0),
    ),
    range(
      browserTrials
        .filter((t) => t.outcome === "success")
        .map((t) => t.assessment?.videos || 0),
    ),
    range(
      browserTrials
        .filter((t) => t.outcome === "success")
        .map((t) => t.rendered?.images || 0),
    ),
    range(
      browserTrials
        .filter((t) => t.outcome === "success")
        .map((t) => t.rendered?.videos || 0),
    ),
  ];
});

const dynamicTrials = trials.filter(
  (t) =>
    t.method === "playwright" &&
    t.outcome === "success" &&
    t.assessment &&
    t.rendered &&
    t.rendered.assetUrls.some((url) => !t.assessment!.assetUrls.includes(url)),
);
const dynamicAssets = new Set(
  dynamicTrials.flatMap((t) =>
    t.rendered!.assetUrls.filter(
      (url) => !t.assessment!.assetUrls.includes(url),
    ),
  ),
);
const lazyAttributeEvidence: {
  round: number;
  method: string;
  asin: string;
  urls: string[];
}[] = [];
for (const trial of trials) {
  if (!trial.files?.response || trial.outcome !== "success") continue;
  const initialHtml = await readFile(
    join(directory, trial.files.response),
    "utf8",
  );
  const $ = load(initialHtml);
  const lazyUrls = $("video[data-src], video source[data-src]")
    .map((_, element) => $(element).attr("data-src") || "")
    .get()
    .filter((url) => dynamicAssets.has(url));
  if (lazyUrls.length)
    lazyAttributeEvidence.push({
      round: trial.round,
      method: trial.method,
      asin: trial.asin,
      urls: [...new Set(lazyUrls)],
    });
}
const lazyUrls = new Set(lazyAttributeEvidence.flatMap((e) => e.urls));
const lazyExplanation = lazyUrls.size
  ? `其中 ${lazyUrls.size} 个 URL 已存在原始 HTML 的 video[data-src] 中，在 ${lazyAttributeEvidence.filter((e) => e.method === "fetch").length} 次 Fetch 响应中也能找到。这是解析器覆盖缺口，不能算作浏览器独占增量。`
  : "本轮未发现可由 video[data-src] 解释的渲染增量。";
const reportData = {
  ...data,
  summary,
  complete,
  expected,
  dynamicAssetObservations: {
    trialsWithAdditionalSources: dynamicTrials.length,
    uniqueAdditionalUrls: dynamicAssets.size,
    uniqueAlreadyInLazyAttributes: lazyUrls.size,
    lazyAttributeEvidence,
  },
  reportedAt: new Date().toISOString(),
};
await writeFile(
  join(output, "fetch-playwright-comparison.json"),
  JSON.stringify(reportData, null, 2),
);
const csvRows: unknown[][] = [
  [
    "round",
    "product",
    "asin",
    "marketplace",
    "method",
    "order_in_pair",
    "started_at",
    "outcome",
    "http_status",
    "elapsed_ms",
    "initial_images",
    "initial_videos",
    "rendered_images",
    "rendered_videos",
    "browser_session_visit",
    "final_url",
    "error",
  ],
  ...trials.map((t) => [
    t.round,
    t.product,
    t.asin,
    t.marketplace,
    t.method,
    t.orderInPair,
    t.startedAt,
    t.outcome,
    t.status,
    t.elapsedMs,
    t.assessment?.images,
    t.assessment?.videos,
    t.rendered?.images,
    t.rendered?.videos,
    t.sessionVisit,
    t.finalUrl,
    t.error,
  ]),
];
await writeFile(
  join(output, "fetch-playwright-comparison.csv"),
  "\uFEFF" +
    csvRows
      .map((row) =>
        row
          .map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\r\n"),
);

const images = [];
for (const product of PRODUCTS) {
  const first = trials.find(
    (t) =>
      t.product === product.label &&
      t.method === "playwright" &&
      t.files?.screenshot,
  );
  if (first?.files?.screenshot) {
    const name = `comparison-${first.asin}.jpg`;
    await copyFile(join(directory, first.files.screenshot), join(output, name));
    images.push(
      `<figure><a href="${name}"><img loading="lazy" src="${name}" alt="${escape(product.label)}首轮浏览器采集页面"></a><figcaption>${escape(product.label)} · 首轮截图</figcaption></figure>`,
    );
  }
}

const failureTrial = trials.find(
  (t) => t.outcome === "blocked" && t.files?.screenshot,
);
let failureEvidence = "";
if (failureTrial?.files?.screenshot) {
  const name = `comparison-blocked-${failureTrial.asin}.jpg`;
  await copyFile(
    join(directory, failureTrial.files.screenshot),
    join(output, name),
  );
  failureEvidence = `<h2>访问受限页面证据</h2><p>第 ${failureTrial.round} 轮 · ${escape(failureTrial.marketplace)} · HTTP ${failureTrial.status} · 页面标题：${escape(failureTrial.assessment?.documentTitle)}。原始 HTML 包含 validateCaptcha 表单，任务停止采集并记录为受限，没有点击验证入口。</p><figure><a href="${name}"><img style="max-width:800px" src="${name}" alt="HTTP 200 验证入口页面"></a></figure>`;
}

const limitations = [
  "成功指拿到目标商品页面并提取到至少一个素材，不表示覆盖全部变体、全部评论，也不表示完整文件下载成功。",
  `每种方法仅 ${data.rounds * data.products.length} 次、${data.products.length} 个固定商品的重复测量；这些尝试并非独立随机样本，不能推算亚马逊全站成功率。`,
  "测试在同一台本地电脑执行，没有配置实验专用代理，但没有核验两种进程的实际公网出口。不能用本地结果推断 Vercel 上的成功率或 IP 根因。",
  "两种方法共用同一解析器。Fetch 使用当前生产实现的 Chrome/131 请求头、不保留 Cookie；Playwright 使用默认 HeadlessChrome 请求头、执行页面脚本、保留本轮匿名站点会话，差异涉及多个因素，不能单独归因于 JavaScript 或 Cookie。",
  "Playwright HTTP 缓存关闭，未使用个人浏览器资料、登录账号、付费 API、代理轮换、隐身补丁或验证码处理。浏览器会话只存在于本次进程内。",
  "每次试验不重试；全程并发 1，间隔 4 秒；遇到验证页，同方法同站点冷却 30 秒。两种方法的先后顺序按轮次交替。",
  "耗时包含获取和解析。Playwright 额外包含固定 2.5 秒渲染等待与原始/渲染两次提取；启动、间隔、冷却、截图和证据写入不计入单次耗时。耗时差异不能全部归为浏览器本身开销。",
  "渲染后增加的项目仅称为“素材源”；同一视频的不同格式可能对应多个源。未在本实验中逐个下载和播放。",
];

const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fetch vs Playwright · 本地采集对比</title><style>body{font:14px/1.75 system-ui,"PingFang SC",sans-serif;max-width:1200px;margin:48px auto;padding:0 24px;color:#171717}h1{font-size:30px;letter-spacing:-.04em;line-height:1.3}h2{font-size:18px;margin:32px 0 12px}p,li{color:#525252}a{color:#171717}code{font-size:12px}.note{border:1px solid #ddd;border-radius:10px;padding:20px;background:#fafafa}.table{overflow:auto;border:1px solid #ddd;border-radius:10px}table{border-collapse:collapse;width:100%;white-space:nowrap}td,th{padding:10px 12px;border-bottom:1px solid #eee;text-align:left;font-size:12px}th{background:#fafafa}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}figure{margin:0}img{width:100%;border:1px solid #ddd;border-radius:8px}figcaption{font-size:12px;color:#737373}small{color:#737373}</style></head><body><h1>Fetch vs Playwright<br>本地亚马逊素材采集对比</h1><p>${escape(localTime(data.startedAt))} 起 · Asia/Shanghai · ${escape(data.environment)} · ${trials.length}/${expected} 次完成</p><div class="note"><strong>${escape(verdict)}</strong><p>Playwright 挽回 ${summary.paired.playwrightRescued} 个配对失败，退化 ${summary.paired.playwrightRegressed} 次；${dynamicTrials.length} 次浏览器试验在渲染后发现额外素材源，共 ${dynamicAssets.size} 个不同 URL。</p><p>${escape(lazyExplanation)}</p>${!complete ? "<p>注意：这是未完成实验，分母与计划不同。</p>" : ""}</div><p><a href="fetch-playwright-comparison.csv">下载逐次 CSV</a> · <a href="fetch-playwright-comparison.json">下载完整 JSON</a></p><h2>采集成功率与耗时</h2>${table(
  [
    "方法",
    "成功/尝试",
    "成功率",
    "验证页/限制",
    "其他失败",
    "全部尝试耗时中位数",
    "成功尝试耗时中位数",
  ],
  summary.methods.map((m) => [
    m.method,
    `${m.successes}/${m.attempts}`,
    percent(m.successRate),
    m.blocked,
    m.errors,
    seconds(m.medianAllMs),
    seconds(m.medianSuccessMs),
  ]),
)}<p>成功率差：${delta === null ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} 个百分点`}。完整配对 ${summary.paired.count} 组：共同成功 ${summary.paired.bothSucceeded}，Playwright 挽回 ${summary.paired.playwrightRescued}，Playwright 退化 ${summary.paired.playwrightRegressed}，共同失败 ${summary.paired.bothFailed}。</p><h2>按商品比较素材数量</h2>${table(["商品", "ASIN", "Fetch 成功", "PW 成功", "Fetch 图片", "Fetch 视频源", "PW 原始图片", "PW 原始视频源", "PW 渲染图片", "PW 渲染视频源"], productRows)}<p>数字范围表示各轮观测值，不是总和。浏览器原始响应和渲染 DOM 分开记录，避免把格式重复或 DOM 增量混作成功率提升。</p><h2>逐次记录</h2>${table(
  [
    "轮次",
    "方法",
    "ASIN",
    "配对顺序",
    "结果",
    "HTTP",
    "耗时",
    "原始图/视频",
    "渲染图/视频",
    "浏览器会话访问次序",
  ],
  trials.map((t) => [
    t.round,
    t.method,
    t.asin,
    t.orderInPair,
    outcomes[t.outcome] || t.outcome,
    t.status ?? "—",
    seconds(t.elapsedMs),
    t.assessment ? `${t.assessment.images}/${t.assessment.videos}` : "—",
    t.rendered ? `${t.rendered.images}/${t.rendered.videos}` : "—",
    t.sessionVisit ?? "—",
  ]),
)}<h2>方法与解释边界</h2><ul>${limitations.map((line) => `<li>${escape(line)}</li>`).join("")}</ul><p>浏览器：Google Chrome ${escape(data.browserVersion)}，headless；Node.js ${escape(data.nodeVersion)}。完整原始 HTML、渲染快照和逐次截图保存在项目忽略目录 <code>${escape(directory)}</code>。</p><h2>首轮浏览器页面证据</h2><div class="gallery">${images.join("")}</div>${failureEvidence}<h2>复现</h2><pre><code>cd /Users/deno/Desktop/deno/amazon-media-lab\npnpm compare:local\n# 使用新的 work/comparison-* 目录中的 results.json 查看结果</code></pre><p><small>报告生成时间：${escape(localTime(new Date().toISOString()))}。本轮仅本地验证，未修改或重新部署 Vercel 网站。</small></p></body></html>`;
await writeFile(join(output, "fetch-playwright-comparison.html"), html);
console.log(
  JSON.stringify({
    report: join(output, "fetch-playwright-comparison.html"),
    complete,
    summary,
    dynamicTrials: dynamicTrials.length,
    uniqueDynamicSources: dynamicAssets.size,
  }),
);
