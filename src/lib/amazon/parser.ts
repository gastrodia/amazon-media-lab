import * as cheerio from "cheerio";
import { parse } from "acorn-loose";
import { full } from "acorn-walk";
import type { Node } from "acorn";
import { isMediaUrl } from "./url";
import type { CollectionTarget, MediaAsset, MediaGroup } from "./types";

type AstNode = Node & { [key: string]: unknown };
type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : "");
const numeric = (value: unknown) =>
  Number(value) > 0 ? Number(value) : undefined;

// Read data literals only. Never evaluate scripts received from a product page.
function literal(node: AstNode | undefined, depth = 0): unknown {
  if (!node || depth > 30) return undefined;
  if (node.type === "Literal") return node.value;
  if (node.type === "ArrayExpression")
    return (node.elements as AstNode[]).map((n) => literal(n, depth + 1));
  if (node.type === "ObjectExpression") {
    const result: RecordValue = Object.create(null);
    for (const property of node.properties as AstNode[]) {
      if (
        property.type !== "Property" ||
        property.computed ||
        property.kind !== "init"
      )
        continue;
      const key = property.key as AstNode;
      const name = key.type === "Identifier" ? text(key.name) : text(key.value);
      if (name && !["__proto__", "constructor", "prototype"].includes(name))
        result[name] = literal(property.value as AstNode, depth + 1);
    }
    return result;
  }
  if (node.type === "CallExpression") {
    const callee = node.callee as AstNode;
    const property = callee?.property as AstNode | undefined;
    const method = property?.name ?? property?.value;
    if (
      method === "parseJSON" ||
      (method === "parse" && (callee.object as AstNode)?.name === "JSON")
    ) {
      const value = literal((node.arguments as AstNode[])[0], depth + 1);
      if (typeof value === "string") {
        try {
          return JSON.parse(value);
        } catch {
          /* Not a data literal. */
        }
      }
    }
  }
  return undefined;
}

function mediaIdentity(url: string) {
  const path = new URL(url).pathname;
  return path.match(/\/images\/I\/([^/.]+)/)?.[1] ?? path;
}

// Only accept declared media URLs; never synthesize a larger image or video URL.
function mediaUrl(value: unknown): string | undefined {
  const raw = text(value).trim();
  const url = raw.startsWith("//") ? `https:${raw}` : raw;
  return isMediaUrl(url) ? url : undefined;
}

function largestSrcset(value: string) {
  const candidates: { url: string; size: number; unit: string }[] = [];
  // Read URL tokens before descriptors so commas inside an Amazon URL survive.
  let rest = value.trim();
  while (rest) {
    rest = rest.replace(/^[\s,]+/, "");
    const token = rest.match(/^\S+/)?.[0];
    if (!token) break;
    rest = rest.slice(token.length);
    const trailingComma = token.endsWith(",");
    const url = mediaUrl(token.replace(/,+$/, ""));
    const end = trailingComma ? -1 : rest.indexOf(",");
    const descriptor = trailingComma ? "" : (end < 0 ? rest : rest.slice(0, end)).trim();
    if (!trailingComma) rest = end < 0 ? "" : rest.slice(end + 1);
    const match = descriptor.match(/^(?:(\d+(?:\.\d+)?)(w|x))?$/);
    if (url && match && (!match[1] || Number(match[1]) > 0) &&
      (match[2] !== "w" || Number.isInteger(Number(match[1]))))
      candidates.push({ url, size: Number(match[1] || 1), unit: match[2] || "x" });
  }
  // Mixed width/density descriptors are invalid; compare only like units.
  return candidates
    .filter((candidate) => candidate.unit === candidates[0]?.unit)
    .sort((a, b) => b.size - a.size)[0]?.url;
}

export function parseProductHtml(html: string, target: CollectionTarget) {
  const $ = cheerio.load(html);
  const assets: MediaAsset[] = [];
  const identities = new Map<string, number>();
  const roots: RecordValue[] = [];
  const variants = new Map<string, string>();
  let videoIndex = 0;
  let imageIndex = 0;
  const title =
    $("#productTitle").text().trim() ||
    $("meta[property='og:title']").attr("content") ||
    $("title")
      .text()
      .replace(/^Amazon\.[^:]+:\s*/, "")
      .trim();

  function add(asset: Omit<MediaAsset, "id">) {
    if (!isMediaUrl(asset.url)) return;
    const key = `${asset.kind}:${mediaIdentity(asset.url)}`;
    const existing = identities.get(key);
    if (existing !== undefined) {
      const previous = assets[existing];
      if (
        asset.variant &&
        !previous.variant.split(" / ").includes(asset.variant)
      )
        previous.variant = [previous.variant, asset.variant]
          .filter(Boolean)
          .join(" / ");
      return;
    }
    identities.set(key, assets.length);
    assets.push({
      ...asset,
      id: `${asset.kind === "image" ? "img" : "vid"}-${asset.kind === "image" ? ++imageIndex : ++videoIndex}`,
    });
  }

  function addImage(
    value: RecordValue,
    variant: string,
    source: string,
    group: MediaGroup = "product",
  ) {
    const sizes = object(value.main)
      ? Object.entries(value.main)
          .filter(
            (entry): entry is [string, unknown[]] =>
              isMediaUrl(entry[0]) && Array.isArray(entry[1]),
          )
          .sort(
            (a, b) =>
              Number(b[1][0]) * Number(b[1][1]) -
              Number(a[1][0]) * Number(a[1][1]),
          )
      : [];
    const url = [
      value.hiRes,
      sizes[0]?.[0],
      value.large,
      value.url,
      value.src,
    ].find(isMediaUrl);
    if (!url) return;
    const dimensions = sizes.find(([s]) => s === url)?.[1];
    const declaredSize = url.match(/_S[LXY](\d+)_/i)?.[1];
    add({
      kind: "image",
      group,
      title:
        text(value.variant) ||
        (group === "aplus"
          ? "A+ 图片"
          : group === "review"
            ? "评论图片"
            : "商品图片"),
      url,
      thumbnail: [value.large, value.thumb, url].find(isMediaUrl)!,
      format: "image",
      variant: variant === "initial" ? "当前商品" : variant,
      source,
      width: numeric(dimensions?.[0]) || numeric(value.width),
      height: numeric(dimensions?.[1]) || numeric(value.height),
      sizeHint: numeric(declaredSize),
    });
  }

  // Parse the structured image/video state embedded by Amazon's own page.
  $("script").each((_, element) => {
    const source = $(element).html() || "";
    if (
      !/colorImages|hiRes|videoURL|\bvideos\b|dimensionValuesDisplayData/.test(
        source,
      )
    )
      return;
    if (($(element).attr("type") || "").includes("json")) {
      try {
        const data = JSON.parse(source);
        if (object(data)) roots.push(data);
      } catch {
        /* Some scripts are not JSON. */
      }
      return;
    }
    const ast = parse(source, { ecmaVersion: "latest", sourceType: "script" });
    full(ast, (node) => {
      if (node.type === "CallExpression") {
        const value = literal(node as unknown as AstNode);
        if (
          object(value) &&
          (value.colorImages ||
            value.videos ||
            value.dimensionValuesDisplayData)
        )
          roots.push(value);
        return;
      }
      if (node.type !== "ObjectExpression") return;
      const dataNode = node as unknown as AstNode;
      const props = dataNode.properties as AstNode[];
      const keys = props.map(
        (p) => (p.key as AstNode)?.name ?? (p.key as AstNode)?.value,
      );
      if (
        keys.some((k) =>
          ["colorImages", "videos", "dimensionValuesDisplayData"].includes(
            String(k),
          ),
        )
      ) {
        const value = literal(dataNode);
        if (object(value)) roots.push(value);
      }
    });
  });

  // Prefer the full variation gallery before the duplicate "initial" gallery.
  roots.sort(
    (a, b) =>
      Number(object(b.colorImages) && !("initial" in b.colorImages)) -
      Number(object(a.colorImages) && !("initial" in a.colorImages)),
  );
  for (const root of roots) {
    if (object(root.dimensionValuesDisplayData)) {
      for (const [asin, labels] of Object.entries(
        root.dimensionValuesDisplayData,
      )) {
        if (/^[A-Z0-9]{10}$/.test(asin))
          variants.set(asin, Array.isArray(labels) ? labels.join(" · ") : asin);
      }
    }
    if (object(root.colorImages)) {
      for (const [variant, images] of Object.entries(root.colorImages)) {
        if (Array.isArray(images))
          for (const image of images)
            if (object(image)) addImage(image, variant, "商品图片数据");
      }
    }
    if (Array.isArray(root.videos)) {
      // HLS and MP4 renditions have different URLs; keep both as explicit options.
      for (const video of root.videos) {
        if (!object(video) || !isMediaUrl(video.url)) continue;
        add({
          kind: "video",
          group: "product",
          title: text(video.title) || "商品视频",
          url: video.url,
          thumbnail:
            [video.slateUrl, video.thumbUrl, video.thumb].find(isMediaUrl) ||
            "",
          format: /\.m3u8(?:\?|$)/i.test(video.url) ? "hls" : "mp4",
          variant: "当前商品",
          source: "商品视频数据",
          duration: numeric(video.durationSeconds),
          width: numeric(video.videoWidth),
          height: numeric(video.videoHeight),
        });
      }
    }
  }

  function groupOf(el: ReturnType<typeof $>): MediaGroup {
    return el.closest("[data-hook='review']").length
      ? "review"
      : el.closest("#aplus, #aplus_feature_div").length
        ? "aplus"
        : "product";
  }

  // Video cards contain HTML-encoded JSON in data attributes.
  $("[data-video-details], [data-video-items]").each((_, element) => {
    const el = $(element);
    for (const attribute of ["data-video-details", "data-video-items"]) {
      const raw = el.attr(attribute);
      if (!raw) continue;
      try {
        const data = JSON.parse(raw);
        for (const video of Array.isArray(data) ? data : [data]) {
          if (!object(video)) continue;
          const url = [video.videoURL, video.url].map(mediaUrl).find(Boolean);
          if (url)
            add({
              kind: "video",
              group: groupOf(el),
              title: text(video.title) || "页面视频",
              url,
              thumbnail:
                [video.hiResVideoImageUrl, video.videoImageUrl, video.thumb]
                  .map(mediaUrl).find(Boolean) || "",
              format: /\.m3u8(?:\?|$)/i.test(url) ? "hls" : "mp4",
              variant: "当前商品",
              source: "页面视频卡片",
              duration: numeric(video.durationSeconds),
            });
        }
      } catch {
        /* Attribute isn't valid structured video data. */
      }
    }
  });

  // Native and lazy video sources are available without executing page scripts.
  $("video, video source, [data-video-url]").each((_, element) => {
    const el = $(element);
    const video = el.is("video") ? el : el.closest("video");
    const mime = (el.is("video, source") ? el.attr("type") || "" : "")
      .split(";")[0].trim().toLowerCase();
    if (mime && !["video/mp4", "application/x-mpegurl", "application/vnd.apple.mpegurl"].includes(mime)) return;
    const attributes = el.is("video, source")
      ? ["data-video-url", "data-src", "data-lazy-src", "data-original", "src"]
      : ["data-video-url"];
    for (const attribute of attributes) {
      const url = mediaUrl(el.attr(attribute));
      if (!url || /\.(?:webm|mov|ogg|ogv)(?:[?#]|$)/i.test(url)) continue;
      add({
        kind: "video",
        group: groupOf(el),
        title: el.attr("title") || video.attr("title") || video.attr("aria-label") || "页面视频",
        url,
        thumbnail: mediaUrl(video.attr("poster")) || mediaUrl(video.attr("data-poster")) || "",
        format: /\.m3u8(?:[?#]|$)/i.test(url) || mime.includes("mpegurl") ? "hls" : "mp4",
        variant: "当前商品",
        source: `视频元素 ${attribute}`,
        width: numeric(video.attr("width")),
        height: numeric(video.attr("height")),
      });
    }
  });

  $(
    "#landingImage, #imgBlkFront, #ebooksImgBlkFront, #aplus img, #aplus_feature_div img, [data-hook='review-image-tile'] img",
  ).each((_, element) => {
    const el = $(element);
    const group = groupOf(el);
    let sizes: RecordValue = {};
    try {
      const data: unknown = JSON.parse(el.attr("data-a-dynamic-image") || "{}");
      if (object(data)) sizes = data;
    } catch {
      /* Optional dimensions. */
    }
    const srcsetAttributes = ["data-srcset", "data-lazy-srcset", "srcset"];
    const responsive = srcsetAttributes
      .map((attribute) => largestSrcset(el.attr(attribute) || ""))
      .find(Boolean) || el.closest("picture").find("source").toArray()
        .flatMap((source) => srcsetAttributes.map((attribute) => largestSrcset($(source).attr(attribute) || "")))
        .find(Boolean);
    const src = [responsive, ...["data-src", "data-lazy-src", "data-original", "src"].map((attribute) => el.attr(attribute))]
      .map(mediaUrl).find(Boolean);
    addImage(
      {
        hiRes: mediaUrl(el.attr("data-old-hires")),
        main: sizes,
        src,
      },
      "当前商品",
      group === "aplus"
        ? "A+ 内容"
        : group === "review"
          ? "当前页评论"
          : "商品图片元素",
      group,
    );
  });

  if (!variants.size) variants.set(target.asin, "当前商品");
  return {
    title,
    assets,
    variants: [...variants].map(([asin, label]) => ({ asin, label })),
  };
}

export function classifyPage(
  html: string,
  status: number,
): "blocked" | "unavailable" | "ok" {
  const $ = cheerio.load(html);
  if (
    $(
      "form[action*='validateCaptcha'], #captchacharacters, #challenge-container",
    ).length ||
    /robot check|sorry, we just need to make sure|automated access to amazon|api-services-support@amazon/i.test(
      $("title").text() + " " + $("body").text().slice(0, 25000),
    ) ||
    [403, 429].includes(status)
  )
    return "blocked";
  if (
    status === 404 ||
    /page not found|sorry! we couldn't find that page/i.test($("title").text())
  )
    return "unavailable";
  return "ok";
}
