"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  Box,
  ChevronDown,
  FileVideo,
  Link2,
  Loader2,
  Play,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { MARKETPLACES } from "@/lib/amazon/url";
import type { CollectionResult, MediaAsset } from "@/lib/amazon/types";
import { assetFilename, downloadAsset, saveBlob } from "@/lib/media";

const groupLabel = {
  product: "商品素材",
  aplus: "A+ 内容",
  review: "评论素材",
};
const selectClass =
  "h-9 max-w-full appearance-none rounded-md border border-input bg-background py-1 pl-3 pr-8 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function MediaLab() {
  const [input, setInput] = useState("");
  const [marketplace, setMarketplace] = useState("amazon.com");
  const [result, setResult] = useState<CollectionResult | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [tab, setTab] = useState("images");
  const [group, setGroup] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState({ value: 0, label: "" });
  const [notice, setNotice] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLElement | null>(null);
  const working = collecting || !!busy;

  useEffect(() => () => controller.current?.abort(), []);

  const images = result?.assets.filter((a) => a.kind === "image") || [];
  const videos = result?.assets.filter((a) => a.kind === "video") || [];
  const visible = (tab === "videos" ? videos : images).filter(
    (a) => group === "all" || a.group === group,
  );
  const picked = result?.assets.filter((a) => selected.has(a.id)) || [];
  async function collect(value = input) {
    if (!value.trim() || working) return;
    const abort = new AbortController();
    controller.current = abort;
    setCollecting(true);
    setResult(null);
    setSelected(new Set());
    setNotice(null);
    setGroup("all");
    setTab("images");
    try {
      const response = await fetch("/api/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: value, marketplace }),
        signal: abort.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "采集请求失败。");
      setResult(data);
      if (!data.assets.some((asset: MediaAsset) => asset.kind === "image"))
        setTab("videos");
      setTimeout(
        () =>
          resultRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          }),
        80,
      );
    } catch (error) {
      setNotice({
        text: abort.signal.aborted
          ? "采集已取消。"
          : error instanceof Error
            ? error.message
            : "采集失败。",
        error: true,
      });
    } finally {
      setCollecting(false);
      controller.current = null;
    }
  }

  async function download(asset: MediaAsset) {
    if (!result || working) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(asset.id);
    setProgress({ value: 0, label: "准备下载…" });
    setNotice(null);
    try {
      const file = await downloadAsset(
        asset,
        abort.signal,
        (done, total, label) =>
          setProgress({ value: total ? (done / total) * 100 : 0, label }),
      );
      saveBlob(
        new Blob([file.bytes], {
          type:
            asset.kind === "image"
              ? `image/${file.extension === "jpg" ? "jpeg" : file.extension}`
              : "video/mp4",
        }),
        assetFilename(result.asin, asset, file.extension),
      );
      setNotice({ text: "完整素材已获取，文件已交给浏览器保存。" });
    } catch (error) {
      setNotice({
        text: abort.signal.aborted
          ? "下载已取消。"
          : error instanceof Error
            ? error.message
            : "下载失败，请检查网络后重试。",
        error: true,
      });
    } finally {
      setBusy("");
      controller.current = null;
    }
  }

  async function downloadZip() {
    if (!result || !picked.length || working) return;
    setBusy("zip");
    setProgress({ value: 0, label: "准备打包…" });
    setNotice(null);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const files: Record<string, Uint8Array> = {};
      let bytes = 0;
      for (let i = 0; i < picked.length; i++) {
        const asset = picked[i];
        const file = await downloadAsset(
          asset,
          abort.signal,
          (done, total, label) =>
            setProgress({
              value: ((i + done / (total || 1)) / picked.length) * 100,
              label: `${i + 1} / ${picked.length} · ${label}`,
            }),
        );
        bytes += file.bytes.byteLength;
        if (bytes > 150 * 1024 * 1024)
          throw new Error("所选素材合计超过本轮 150 MB 上限，请减少选择。");
        files[
          `${asset.group}/${assetFilename(result.asin, asset, file.extension)}`
        ] = file.bytes;
      }
      abort.signal.throwIfAborted();
      const { zipSync } = await import("fflate");
      saveBlob(
        new Blob([new Uint8Array(zipSync(files, { level: 0 }))], {
          type: "application/zip",
        }),
        `${result.asin}-media.zip`,
      );
      setNotice({
        text: `${picked.length} 个完整素材已打包，ZIP 已交给浏览器保存。`,
      });
    } catch (error) {
      setNotice({
        text: abort.signal.aborted
          ? "打包已取消。"
          : error instanceof Error
            ? error.message
            : "打包失败，本次未生成 ZIP。",
        error: true,
      });
    } finally {
      setBusy("");
      controller.current = null;
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-2.5 px-5 text-sm font-semibold tracking-tight sm:px-8">
          <Box className="size-5" strokeWidth={1.7} />
          Amazon Media Lab
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 sm:px-8">
        <section className="py-10 sm:py-14" aria-labelledby="collect-title">
          <h1
            id="collect-title"
            className="text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            亚马逊商品素材下载
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            粘贴商品链接，提取并下载图片和视频。
          </p>
          <form
            className="mt-7"
            onSubmit={(event) => {
              event.preventDefault();
              void collect();
            }}
          >
            <label
              htmlFor="product-url"
              className="mb-2.5 block text-sm font-medium"
            >
              商品链接或 ASIN
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative min-w-0 flex-1">
                <Link2 className="pointer-events-none absolute top-3.5 left-3.5 size-4 text-muted-foreground" />
                <Input
                  id="product-url"
                  placeholder="粘贴亚马逊商品链接或输入 10 位 ASIN"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  disabled={working}
                  className="h-11 pl-10 text-sm shadow-none"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-describedby="product-url-help"
                />
              </div>
              <div className="relative">
                <select
                  aria-label="ASIN 默认站点"
                  value={marketplace}
                  onChange={(event) => setMarketplace(event.target.value)}
                  disabled={working}
                  className={`${selectClass} h-11 w-full sm:w-36`}
                >
                  {MARKETPLACES.map((site) => (
                    <option key={site} value={site}>
                      {site}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute top-4 right-3 size-3.5 text-muted-foreground" />
              </div>
              <Button
                type="submit"
                className="h-11 px-6"
                disabled={!input.trim() || working}
              >
                {collecting && <Loader2 className="animate-spin" />}
                {collecting ? "正在提取" : "提取素材"}
              </Button>
            </div>
            <p
              id="product-url-help"
              className="mt-2.5 text-xs leading-5 text-muted-foreground"
            >
              链接自动识别站点；输入 ASIN 时使用所选站点。
            </p>
          </form>
        </section>

        {notice && (
          <Alert
            variant={notice.error ? "destructive" : "default"}
            className="mb-6"
          >
            <AlertDescription className="flex items-start justify-between gap-4">
              <span role="status">{notice.text}</span>
              <button aria-label="关闭提示" onClick={() => setNotice(null)}>
                <X className="size-4" />
              </button>
            </AlertDescription>
          </Alert>
        )}
        {collecting && (
          <section
            className="mb-10 border-t pt-5"
            aria-live="polite"
            aria-label="正在提取素材"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm">
                <Loader2 className="size-4 shrink-0 animate-spin" />
                正在获取商品页面并提取素材…
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => controller.current?.abort()}
              >
                取消
              </Button>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="aspect-square rounded-lg" />
              ))}
            </div>
          </section>
        )}
        {result && (
          <section
            ref={resultRef}
            className="scroll-mt-6 border-t pt-6 pb-10"
            aria-label="采集结果"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-base leading-7 font-semibold break-words">
                  {result.title || "本次提取结果"}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {result.asin} · {result.marketplace}
                </p>
              </div>
              <Button variant="ghost" size="sm" className="shrink-0" asChild>
                <a href={result.productUrl} target="_blank" rel="noreferrer">
                  查看商品
                  <ArrowUpRight />
                </a>
              </Button>
            </div>
            {!result.assets.length ? (
              <div className="rounded-lg border p-6 text-center" role="status">
                <p className="text-sm font-medium">
                  {result.status === "blocked"
                    ? "商品页面访问受限"
                    : "本次未提取到素材"}
                </p>
                <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
                  {result.warnings.at(-1) || "请检查商品链接，或稍后重试。"}
                </p>
              </div>
            ) : (
              <Tabs
                value={tab}
                onValueChange={(value) => {
                  setTab(value);
                  setGroup("all");
                }}
              >
                <TabsList>
                  <TabsTrigger value="images">
                    图片{" "}
                    <span className="text-muted-foreground">
                      {images.length}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="videos">
                    视频源{" "}
                    <span className="text-muted-foreground">
                      {videos.length}
                    </span>
                  </TabsTrigger>
                </TabsList>
                <div className="flex flex-wrap items-center justify-between gap-3 py-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="select-all"
                        checked={
                          visible.length > 0 &&
                          visible.every((a) => selected.has(a.id))
                            ? true
                            : visible.some((a) => selected.has(a.id))
                              ? "indeterminate"
                              : false
                        }
                        disabled={working || !visible.length}
                        onCheckedChange={(value) =>
                          setSelected((previous) => {
                            const next = new Set(previous);
                            for (const asset of visible) {
                              if (value) next.add(asset.id);
                              else next.delete(asset.id);
                            }
                            return next;
                          })
                        }
                      />
                      <label htmlFor="select-all" className="text-sm">
                        全选
                      </label>
                    </div>
                    <select
                      aria-label="素材分类"
                      className={`${selectClass} h-8 text-xs`}
                      value={group}
                      disabled={working}
                      onChange={(event) => setGroup(event.target.value)}
                    >
                      <option value="all">全部类型</option>
                      <option value="product">商品素材</option>
                      <option value="aplus">A+ 内容</option>
                      <option value="review">评论素材</option>
                    </select>
                  </div>
                  <Button
                    size="sm"
                    disabled={working || !picked.length}
                    onClick={downloadZip}
                  >
                    <ArrowDownToLine />
                    下载所选{picked.length > 0 && `（${picked.length}）`}
                  </Button>
                </div>
                {busy && (
                  <div
                    className="mb-5 rounded-lg border p-4"
                    aria-live="polite"
                  >
                    <div className="mb-3 flex items-center justify-between gap-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <Loader2 className="size-3.5 shrink-0 animate-spin" />
                        {progress.label || "准备下载…"}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => controller.current?.abort()}
                      >
                        取消
                      </Button>
                    </div>
                    <Progress value={progress.value} className="h-1.5" />
                  </div>
                )}
                {["images", "videos"].map((kind) => (
                  <TabsContent key={kind} value={kind} className="mt-0">
                    {visible.length ? (
                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                        {visible.map((asset) => (
                          <AssetCard
                            key={asset.id}
                            asset={asset}
                            checked={selected.has(asset.id)}
                            disabled={working}
                            onToggle={() =>
                              setSelected((previous) => {
                                const next = new Set(previous);
                                if (next.has(asset.id)) next.delete(asset.id);
                                else next.add(asset.id);
                                return next;
                              })
                            }
                            onDownload={() => void download(asset)}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-lg border py-10 text-center text-sm text-muted-foreground">
                        当前分类未发现{kind === "images" ? "图片" : "视频源"}
                      </p>
                    )}
                  </TabsContent>
                ))}
                <p className="mt-5 text-xs leading-5 text-muted-foreground">
                  仅展示本次页面发现的素材，不代表商品全部素材。视频源可能包含同一视频的不同格式。
                </p>
              </Tabs>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function AssetCard({
  asset,
  checked,
  disabled,
  onToggle,
  onDownload,
}: {
  asset: MediaAsset;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  onDownload: () => void;
}) {
  return (
    <Card
      className={`gap-0 overflow-hidden py-0 shadow-none transition-colors ${checked ? "border-foreground" : ""}`}
    >
      <div className="relative aspect-square overflow-hidden bg-muted/30">
        <button
          type="button"
          aria-label={`选择 ${asset.id}`}
          onClick={onToggle}
          disabled={disabled}
          className="h-full w-full p-5 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        >
          {asset.thumbnail ? (
            <img
              src={asset.thumbnail}
              alt={asset.title}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="h-full w-full object-contain transition-transform duration-200 hover:scale-105"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <FileVideo className="size-10 text-muted-foreground" />
            </div>
          )}
        </button>
        <div className="absolute top-3 left-3">
          <Checkbox
            aria-label={`勾选 ${asset.id}`}
            checked={checked}
            onCheckedChange={onToggle}
            disabled={disabled}
            className="bg-background"
          />
        </div>
        <Badge
          variant="secondary"
          className="pointer-events-none absolute top-3 right-3 border bg-background/90 text-[10px] font-normal"
        >
          {asset.format === "hls"
            ? "HLS → MP4"
            : asset.format === "mp4"
              ? "MP4"
              : groupLabel[asset.group]}
        </Badge>
        {asset.kind === "video" && (
          <span className="pointer-events-none absolute right-3 bottom-3 flex items-center gap-1 rounded bg-foreground/80 px-2 py-1 text-[10px] text-background">
            <Play className="size-2.5 fill-current" />
            {asset.duration
              ? `${Math.floor(asset.duration / 60)}:${String(Math.round(asset.duration % 60)).padStart(2, "0")}`
              : "视频"}
          </span>
        )}
      </div>
      <CardContent className="border-t p-3.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="truncate text-xs font-medium" title={asset.title}>
            {asset.title}
          </span>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
            {asset.width
              ? `${asset.width}px`
              : asset.sizeHint
                ? `${asset.sizeHint}px 规格`
                : asset.kind === "image"
                  ? "原始链接"
                  : "视频源"}
          </span>
        </div>
        <p
          className="truncate text-[10px] text-muted-foreground"
          title={asset.variant}
        >
          {asset.variant || "当前商品"}
        </p>
        <div className="mt-3 flex justify-end">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`下载 ${asset.id}`}
            disabled={disabled}
            onClick={onDownload}
          >
            <ArrowDownToLine className="size-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
