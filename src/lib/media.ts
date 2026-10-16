import type { MediaAsset } from "./amazon/types";
import { isMediaUrl } from "./amazon/url";

const MAX_DOWNLOAD_BYTES = 150 * 1024 * 1024;
export interface DirectCheck {
  status: "ok" | "failed";
  detail: string;
  elapsedMs: number;
}
export type DownloadProgress = (
  completed: number,
  total: number,
  label: string,
) => void;

async function mediaFetch(url: string, signal: AbortSignal) {
  if (!isMediaUrl(url)) throw new Error("素材地址不在支持的亚马逊媒体域名内。");
  const response = await fetch(url, {
    signal,
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw new Error(`素材请求返回 HTTP ${response.status}`);
  return response;
}

interface Playlist {
  playlists?: {
    uri: string;
    attributes: {
      BANDWIDTH?: number;
      RESOLUTION?: { width: number; height: number };
      AUDIO?: string;
    };
  }[];
  mediaGroups?: { AUDIO?: Record<string, Record<string, { uri?: string }>> };
  segments?: {
    uri: string;
    key?: { method?: string };
    map?: { uri: string; byterange?: unknown };
    byterange?: unknown;
    discontinuity?: boolean;
  }[];
  endList?: boolean;
}

export async function readPlaylist(
  url: string,
  signal: AbortSignal,
  depth = 0,
): Promise<{ manifest: Playlist; baseUrl: string }> {
  if (depth > 3) throw new Error("HLS 清单嵌套超过本轮验证范围。");
  const response = await mediaFetch(url, signal);
  const source = await response.text();
  if (!source.trimStart().startsWith("#EXTM3U"))
    throw new Error("视频响应不是有效的 HLS 清单。");
  const { Parser } = await import("m3u8-parser");
  const parser = new Parser();
  parser.push(source);
  parser.end();
  const manifest = parser.manifest as Playlist;
  if (manifest.playlists?.length) {
    const best = [...manifest.playlists].sort(
      (a, b) =>
        (b.attributes.RESOLUTION?.height || 0) -
          (a.attributes.RESOLUTION?.height || 0) ||
        (b.attributes.BANDWIDTH || 0) - (a.attributes.BANDWIDTH || 0),
    )[0];
    if (
      best.attributes.AUDIO &&
      Object.values(
        manifest.mediaGroups?.AUDIO?.[best.attributes.AUDIO] || {},
      ).some((group) => group.uri)
    )
      throw new Error("此视频使用独立音轨，本轮暂不合成，避免导出无声视频。");
    return readPlaylist(new URL(best.uri, url).href, signal, depth + 1);
  }
  if (!manifest.segments?.length) throw new Error("HLS 清单中没有视频分片。");
  return { manifest, baseUrl: url };
}

async function readSample(url: string, signal: AbortSignal) {
  const response = await mediaFetch(url, signal);
  const contentType = response.headers.get("content-type") || "";
  if (/text\/html|application\/json/.test(contentType)) {
    await response.body?.cancel();
    throw new Error("素材地址返回了页面或错误数据。");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("素材响应为空。");
  try {
    const { value } = await reader.read();
    if (!value?.byteLength) throw new Error("素材未返回有效字节。");
  } finally {
    await reader.cancel();
  }
}

export async function probeDirect(
  asset: MediaAsset,
  parentSignal?: AbortSignal,
): Promise<DirectCheck> {
  const start = performance.now();
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, AbortSignal.timeout(15_000)])
    : AbortSignal.timeout(15_000);
  try {
    if (asset.format === "hls") {
      const { manifest, baseUrl } = await readPlaylist(asset.url, signal);
      await readSample(
        new URL(manifest.segments![0].uri, baseUrl).href,
        signal,
      );
      return {
        status: "ok",
        detail: "清单与首分片可读取，完整合成待下载验证",
        elapsedMs: Math.round(performance.now() - start),
      };
    }
    await readSample(asset.url, signal);
    return {
      status: "ok",
      detail: "已读取素材首段字节，完整文件待下载验证",
      elapsedMs: Math.round(performance.now() - start),
    };
  } catch (error) {
    return {
      status: "failed",
      detail:
        error instanceof TypeError
          ? "浏览器请求失败，可能涉及跨域、网络或地址失效；具体原因请查看网络面板"
          : error instanceof Error
            ? error.message
            : "验证失败",
      elapsedMs: Math.round(performance.now() - start),
    };
  }
}

async function boundedBytes(response: Response, remaining: number) {
  if (Number(response.headers.get("content-length") || 0) > remaining) {
    await response.body?.cancel();
    throw new Error("素材超过本轮 150 MB 的本地处理上限。");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("素材响应为空。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > remaining)
        throw new Error("素材超过本轮 150 MB 的本地处理上限。");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return concat(chunks);
}

function concat(chunks: Uint8Array[]) {
  const result = new Uint8Array(
    chunks.reduce((size, c) => size + c.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function downloadAsset(
  asset: MediaAsset,
  signal: AbortSignal,
  progress: DownloadProgress,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; extension: string }> {
  if (asset.format !== "hls") {
    progress(0, 1, "正在获取素材");
    const response = await mediaFetch(asset.url, signal);
    if (
      /text\/html|application\/json/.test(
        response.headers.get("content-type") || "",
      )
    )
      throw new Error("素材地址返回了非媒体数据。");
    const bytes = await boundedBytes(response, MAX_DOWNLOAD_BYTES);
    if (!bytes.length) throw new Error("素材文件为空。");
    progress(1, 1, "下载完成");
    return {
      bytes,
      extension:
        asset.kind === "video"
          ? "mp4"
          : new URL(asset.url).pathname.match(
              /\.(jpe?g|png|webp|gif|avif)$/i,
            )?.[1] || "jpg",
    };
  }
  const { manifest, baseUrl } = await readPlaylist(asset.url, signal);
  const segments = manifest.segments!;
  if (!manifest.endList)
    throw new Error("本轮仅支持完整点播清单，暂不支持直播。");
  if (segments.length > 1500) throw new Error("视频分片数量超过本轮验证上限。");
  if (segments.some((s) => s.key && s.key.method !== "NONE"))
    throw new Error("此视频含加密分片，本轮不处理。");
  if (segments.some((s) => s.byterange || s.map?.byterange || s.discontinuity))
    throw new Error("此视频使用字节范围或时间线切换，本轮暂不合成。");
  const maps = new Set(segments.map((s) => s.map?.uri).filter(Boolean));
  if (maps.size > 1)
    throw new Error("此视频使用多个初始化片段，本轮暂不合成。");
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (segments[0].map) {
    const bytes = await boundedBytes(
      await mediaFetch(new URL(segments[0].map.uri, baseUrl).href, signal),
      MAX_DOWNLOAD_BYTES,
    );
    chunks.push(bytes);
    size += bytes.byteLength;
  }
  for (let index = 0; index < segments.length; index++) {
    progress(
      index,
      segments.length,
      `下载分片 ${index + 1} / ${segments.length}`,
    );
    const bytes = await boundedBytes(
      await mediaFetch(new URL(segments[index].uri, baseUrl).href, signal),
      MAX_DOWNLOAD_BYTES - size,
    );
    chunks.push(bytes);
    size += bytes.byteLength;
  }
  signal.throwIfAborted();
  const bytes = concat(chunks);
  if (segments[0].map) {
    progress(segments.length, segments.length, "MP4 合成完成");
    return { bytes, extension: "mp4" };
  }
  if (bytes[0] !== 0x47)
    throw new Error("发现尚未支持的视频容器，未生成文件。");
  progress(segments.length, segments.length, "正在转封装为 MP4");
  const mux = await import("mux.js");
  const transmuxer = new mux.default.mp4.Transmuxer({ remux: true });
  const output: Uint8Array[] = [];
  transmuxer.on("data", (segment) => {
    if (!output.length) output.push(segment.initSegment);
    output.push(segment.data);
  });
  transmuxer.push(bytes);
  transmuxer.flush();
  transmuxer.dispose();
  if (!output.length) throw new Error("转封装未产生有效 MP4，未生成文件。");
  return { bytes: concat(output), extension: "mp4" };
}

export function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 30_000);
}

export function assetFilename(
  asin: string,
  asset: MediaAsset,
  extension: string,
) {
  return `${asin}_${asset.group}_${asset.id}.${extension}`;
}

export function buildCsv(assets: MediaAsset[]) {
  const rows = [
    [
      "id",
      "kind",
      "group",
      "title",
      "variant",
      "format",
      "width",
      "height",
      "size_hint",
      "source",
      "url",
    ],
    ...assets.map((a) => [
      a.id,
      a.kind,
      a.group,
      a.title,
      a.variant,
      a.format,
      a.width || "",
      a.height || "",
      a.sizeHint || "",
      a.source,
      a.url,
    ]),
  ];
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => {
            let string = String(value);
            if (/^[=+@\-\t\r]/.test(string)) string = "'" + string;
            return `"${string.replaceAll('"', '""')}"`;
          })
          .join(","),
      )
      .join("\r\n")
  );
}
