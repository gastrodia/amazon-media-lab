export type MediaKind = "image" | "video";
export type MediaGroup = "product" | "aplus" | "review";

export interface MediaAsset {
  id: string;
  kind: MediaKind;
  group: MediaGroup;
  title: string;
  url: string;
  thumbnail: string;
  format: "image" | "mp4" | "hls";
  variant: string;
  source: string;
  width?: number;
  height?: number;
  sizeHint?: number;
  duration?: number;
}

export interface CollectionStep {
  name: string;
  status: "ok" | "warning" | "error";
  detail: string;
  durationMs?: number;
}

export interface CollectionResult {
  id: string;
  status: "success" | "partial" | "blocked" | "unavailable" | "error";
  asin: string;
  marketplace: string;
  productUrl: string;
  title: string;
  assets: MediaAsset[];
  variants: { asin: string; label: string }[];
  warnings: string[];
  steps: CollectionStep[];
  fetchedAt: string;
  elapsedMs: number;
  environment: string;
  upstreamStatus?: number;
  htmlBytes?: number;
}

export interface CollectionTarget {
  asin: string;
  marketplace: string;
  url: string;
}
