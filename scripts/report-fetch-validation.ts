import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PRODUCTS, type Trial } from "./lib/comparison";
import type { MediaAsset } from "../src/lib/amazon/types";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: tsx scripts/report-fetch-validation.ts <results.json> <output-directory>");
const data = JSON.parse(await readFile(input, "utf8")) as {
  startedAt: string; updatedAt: string; protocol: Record<string, unknown>;
  replay: { asin: string; round: number; file: string;
    before: { images: number; videos: number }; after: { images: number; videos: number };
    added: MediaAsset[]; removed: MediaAsset[] }[];
  trials: Trial[]; summary: { attempts: number; successes: number; successRate: number;
    blocked: number; errors: number; medianAllMs: number };
};
if (data.trials.length !== 12) throw new Error("Expected all 12 local Fetch attempts before reporting");
const added = [...new Map(data.replay.flatMap((r) => r.added).map((a) => [a.url, a])).values()];
const removed = [...new Set(data.replay.flatMap((r) => r.removed).map((a) => a.url))];
const escape = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const range = (values: number[]) => [...new Set(values)].sort((a, b) => a - b).join(" / ");
const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const productRows = PRODUCTS.map((p) => {
  const asin = p.url.split("/").at(-1)!;
  const replay = data.replay.filter((r) => r.asin === asin);
  const live = data.trials.filter((t) => t.asin === asin);
  const successful = live.filter((t) => t.outcome === "success");
  return `<tr><td>${escape(p.label)}<small>${asin}</small></td><td>${range(replay.map((r) => r.before.images))} 图 / ${range(replay.map((r) => r.before.videos))} 视频源</td><td>${range(replay.map((r) => r.after.images))} 图 / ${range(replay.map((r) => r.after.videos))} 视频源</td><td>${range(successful.map((t) => t.assessment!.images))} 图 / ${range(successful.map((t) => t.assessment!.videos))} 视频源</td><td>${successful.length} / ${live.length}</td></tr>`;
}).join("");
const attemptRows = data.trials.map((t) => `<tr><td>${t.round}</td><td>${t.asin}</td><td>${t.status ?? "—"}</td><td>${escape(t.outcome)}</td><td>${t.assessment?.images ?? 0}</td><td>${t.assessment?.videos ?? 0}</td><td>${t.elapsedMs} ms</td></tr>`).join("");
const addedRows = added.map((a) => `<li><strong>${escape(a.title)}</strong><p>${escape(a.group)} · ${escape(a.source)}</p><a href="${escape(a.url)}">${escape(a.url)}</a></li>`).join("");
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fetch 懒加载提取 · 本地验证</title><style>
:root{font-family:system-ui,-apple-system,sans-serif;color:#171717;background:#fff}body{max-width:1100px;margin:48px auto;padding:0 24px;line-height:1.65}h1{font-size:28px;letter-spacing:-.6px}h2{font-size:20px;margin-top:36px}p,li{color:#404040}a{color:inherit;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:12px;border-bottom:1px solid #e5e5e5;vertical-align:top}th{background:#fafafa;font-weight:600}small{display:block;color:#737373}.metrics{display:flex;flex-wrap:wrap;gap:16px;margin:28px 0}.metric{border:1px solid #e5e5e5;border-radius:10px;padding:16px 24px;min-width:180px}.metric strong{font-size:28px;display:block}.muted{color:#737373}.scroll{overflow-x:auto}code{background:#f5f5f5;padding:2px 5px;border-radius:4px}li{margin:12px 0}footer{margin:36px 0;color:#737373;font-size:13px;border-top:1px solid #e5e5e5;padding-top:20px}
</style><body><p class="muted">Amazon Media Lab · 2026-10-16 · 本地 Node.js</p><h1>Fetch 懒加载素材提取验证</h1><p>补齐 <code>data-src</code>、<code>data-lazy-src</code>、<code>data-original</code>、图片 <code>srcset</code> / <code>data-srcset</code> / <code>data-lazy-srcset</code> 及嵌套 <code>source</code> 的静态提取。保留媒体域名校验、素材去重和原有图片范围；不执行商品页面脚本。</p>
<div class="metrics"><div class="metric">旧快照新增 · 去重后<strong>${added.length} 条视频源</strong>新增图片 ${added.filter((a) => a.kind === "image").length}；移除原有素材 ${removed.length}</div><div class="metric">新一轮 Fetch 成功率<strong>${pct(data.summary.successRate)}</strong>${data.summary.successes} / ${data.summary.attempts} 次尝试</div><div class="metric">相对上一轮 Fetch<strong>${((data.summary.successRate - 1) * 100).toFixed(1)} 个百分点</strong>上一轮为 12 / 12 · 100%</div></div>
<h2>固定页面回放与真实采集分开看</h2><p>“旧解析”和“补齐后回放”使用完全相同的 12 份历史 Fetch HTML，能隔离解析器改动带来的增量。新一轮列来自另外 12 次真实 Fetch 请求，上游内容可能变化。表内数量按每次响应统计，斜线表示各轮出现的不同数量。</p><div class="scroll"><table><thead><tr><th>商品</th><th>旧解析 · 历史 HTML</th><th>补齐后回放 · 相同 HTML</th><th>新一轮真实 Fetch</th><th>新一轮成功</th></tr></thead><tbody>${productRows}</tbody></table></div>
<p>Kindle 四轮回放均新增相同的两条视频地址：重复观测共 8 次，去重后为 2 条。其余两个商品的旧快照没有新增或丢失素材。这里统计的是视频源，不代表两个独立的完整商品视频。</p>
<h2>12 次真实 Fetch 明细</h2><p>4 轮 × 3 件商品；商品顺序轮换；并发 1、请求间隔 4 秒，遇到验证页同站点冷却 30 秒；无重试、无 Cookie 会话、无付费 API。本轮验证页 ${data.summary.blocked} 次，其他失败 ${data.summary.errors} 次，耗时中位数 ${(data.summary.medianAllMs / 1000).toFixed(2)} 秒。</p><div class="scroll"><table><thead><tr><th>轮次</th><th>ASIN</th><th>HTTP</th><th>结果</th><th>图片</th><th>视频源</th><th>耗时</th></tr></thead><tbody>${attemptRows}</tbody></table></div>
<h2>新增视频源</h2><ol>${addedRows}</ol><p>地址已从 HTML 提取；本轮未验证这些视频的完整下载、播放或浏览器 CORS。无扩展名的地址保持原样，不拼接 MP4 后缀。</p>
<h2>验证边界</h2><p>成功定义沿用上一轮：获得匹配的商品页并提取到至少一项素材；HTTP 200 验证页不算成功。${pct(data.summary.successRate)} 只描述这三个固定商品的本次重复测量，不能推算全站或 Vercel 的成功率。新增解析提高了覆盖范围，不能据此宣称解决了访问验证页。</p><p>17 项测试、TypeScript 检查、Next.js 生产构建通过；修改文件的 ESLint 检查通过。全项目 lint 仍有既有的 <code>src/components/media-lab.tsx:111</code> effect 内同步 setState 错误和 img 警告。本轮保持 Fetch，未运行 Playwright，未部署。</p>
<footer>运行区间（UTC）：${escape(data.startedAt)} — ${escape(data.updatedAt)}。<a href="fetch-lazy-results.json">JSON 原始统计</a> · <a href="fetch-lazy-trials.csv">CSV 尝试明细</a></footer></body></html>`;
await mkdir(output, { recursive: true });
await writeFile(resolve(output, "fetch-lazy-validation.html"), html);
await writeFile(resolve(output, "fetch-lazy-results.json"), JSON.stringify({ ...data, uniqueAdded: added, uniqueRemoved: removed }, null, 2));
const csv = ["round,asin,marketplace,status,outcome,images,videos,elapsedMs", ...data.trials.map((t) => [t.round,t.asin,t.marketplace,t.status || "",t.outcome,t.assessment?.images || 0,t.assessment?.videos || 0,t.elapsedMs].join(","))].join("\n");
await writeFile(resolve(output, "fetch-lazy-trials.csv"), `\ufeff${csv}\n`);
console.log(JSON.stringify({ output: resolve(output), uniqueAdded: added.length, uniqueRemoved: removed.length, summary: data.summary }));
