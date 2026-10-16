import type { CollectionTarget } from "./types";

export const MARKETPLACES = [
  "amazon.com",
  "amazon.co.uk",
  "amazon.de",
  "amazon.co.jp",
  "amazon.ca",
  "amazon.fr",
  "amazon.it",
  "amazon.es",
  "amazon.com.au",
  "amazon.in",
  "amazon.sg",
  "amazon.com.mx",
  "amazon.com.br",
  "amazon.nl",
  "amazon.com.tr",
] as const;

export function normalizeProductUrl(
  input: string,
  defaultMarketplace = "amazon.com",
): CollectionTarget {
  const value = input.trim();
  if (
    !MARKETPLACES.includes(defaultMarketplace as (typeof MARKETPLACES)[number])
  ) {
    throw new Error("请选择受支持的亚马逊站点。");
  }
  if (/^[A-Z0-9]{10}$/i.test(value)) {
    const asin = value.toUpperCase();
    return {
      asin,
      marketplace: defaultMarketplace,
      url: `https://www.${defaultMarketplace}/dp/${asin}`,
    };
  }
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    throw new Error("请输入有效的亚马逊商品链接或 10 位 ASIN。");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new Error("请使用不包含账号信息的 HTTPS 商品链接。");
  }
  const marketplace = url.hostname
    .toLowerCase()
    .replace(/^(www\.|smile\.|m\.)/, "");
  if (!MARKETPLACES.includes(marketplace as (typeof MARKETPLACES)[number])) {
    throw new Error(
      "请使用受支持站点的完整亚马逊商品链接，短链接请先在浏览器中展开。",
    );
  }
  const asin = url.pathname
    .match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([a-z0-9]{10})(?=\/|$)/i)?.[1]
    ?.toUpperCase();
  if (!asin) throw new Error("链接中没有找到 ASIN，请使用商品详情页链接。");
  return { asin, marketplace, url: `https://www.${marketplace}/dp/${asin}` };
}

export function isMediaUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      /(^|\.)(media-amazon\.com|ssl-images-amazon\.com|images-amazon\.com)$/.test(
        url.hostname,
      )
    );
  } catch {
    return false;
  }
}
