import { randomUUID } from "node:crypto";
import { normalizeProductUrl } from "./url";
import { classifyPage, parseProductHtml } from "./parser";
import type { CollectionResult, CollectionTarget } from "./types";

const MAX_HTML_BYTES = 6 * 1024 * 1024;

export async function fetchProductPage(
  target: CollectionTarget,
  parentSignal?: AbortSignal,
) {
  let url = target.url;
  const timeout = AbortSignal.timeout(20_000);
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, timeout])
    : timeout;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(url, {
      signal,
      redirect: "manual",
      cache: "no-store",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("商品页面返回了无效跳转。");
      const redirectUrl = new URL(location, url);
      const next = normalizeProductUrl(redirectUrl.href);
      if (next.asin !== target.asin || next.marketplace !== target.marketplace)
        throw new Error(
          "商品跳转到其他站点或 ASIN，请使用跳转后的完整商品链接重新采集。",
        );
      url = redirectUrl.href;
      continue;
    }
    if (!response.body) throw new Error("商品页面返回了空响应。");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let html = "";
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_HTML_BYTES)
          throw new Error("商品页面超过本轮验证的 6 MB 上限。");
        html += decoder.decode(value, { stream: true });
      }
      html += decoder.decode();
    } finally {
      await reader.cancel();
    }
    return { html, status: response.status, bytes };
  }
  throw new Error("商品页面跳转次数过多。");
}

export async function collectProduct(
  input: string,
  marketplace?: string,
  signal?: AbortSignal,
): Promise<CollectionResult> {
  const target = normalizeProductUrl(input, marketplace);
  const start = performance.now();
  const result: CollectionResult = {
    id: randomUUID(),
    status: "error",
    asin: target.asin,
    marketplace: target.marketplace,
    productUrl: target.url,
    title: "",
    assets: [],
    variants: [],
    warnings: [],
    steps: [
      {
        name: "识别商品",
        status: "ok",
        detail: `${target.marketplace} · ${target.asin}`,
      },
    ],
    fetchedAt: new Date().toISOString(),
    elapsedMs: 0,
    environment: process.env.VERCEL
      ? `Vercel · ${process.env.VERCEL_REGION || "unknown"}`
      : "本地 Node.js",
  };
  try {
    const fetched = await fetchProductPage(target, signal);
    result.upstreamStatus = fetched.status;
    result.htmlBytes = fetched.bytes;
    const pageClass = classifyPage(fetched.html, fetched.status);
    result.steps.push({
      name: "获取商品页",
      status: pageClass === "ok" && fetched.status < 400 ? "ok" : "error",
      detail: `HTTP ${fetched.status} · ${(fetched.bytes / 1024).toFixed(0)} KB`,
      durationMs: Math.round(performance.now() - start),
    });
    if (pageClass !== "ok") {
      result.status = pageClass;
      result.warnings.push(
        pageClass === "blocked"
          ? "亚马逊返回了访问限制或验证页面，本次未得到可解析的商品内容。"
          : "商品页面不存在或当前站点不可访问。",
      );
    } else if (fetched.status >= 400) {
      result.warnings.push(`上游返回 HTTP ${fetched.status}，本次未完成采集。`);
    } else {
      const parseStart = performance.now();
      const parsed = parseProductHtml(fetched.html, target);
      Object.assign(result, parsed);
      result.status = parsed.assets.length ? "partial" : "unavailable";
      result.steps.push({
        name: "提取页面素材",
        status: parsed.assets.length ? "ok" : "warning",
        detail: `${parsed.assets.filter((a) => a.kind === "image").length} 张图片 · ${parsed.assets.filter((a) => a.kind === "video").length} 个视频源`,
        durationMs: Math.round(performance.now() - parseStart),
      });
      result.warnings.push(
        "本轮仅采集当前响应中可见的商品、A+ 和评论素材；未逐个加载变体或翻页评论，不代表整条 listing 的全部素材。",
      );
      if (!parsed.assets.length)
        result.warnings.push(
          "响应中未发现受支持的素材结构；这不等于商品没有图片或视频。",
        );
      result.steps.push({
        name: "验证浏览器直连",
        status: "warning",
        detail: "待点击「验证直连」；发现地址不代表浏览器已能下载。",
      });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "未知采集错误";
    result.warnings.push(
      /timeout|aborted/i.test(detail)
        ? "请求超过 20 秒或被终止，请稍后重试。"
        : `采集失败：${detail}`,
    );
    result.steps.push({
      name: "采集请求",
      status: "error",
      detail: result.warnings.at(-1)!,
    });
  }
  result.elapsedMs = Math.round(performance.now() - start);
  return result;
}
