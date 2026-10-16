"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Box,
  Check,
  CheckCheck,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  Clock3,
  Copy,
  FileJson,
  FileSpreadsheet,
  FileVideo,
  FlaskConical,
  Globe2,
  ImageIcon,
  Link2,
  Loader2,
  Moon,
  PackageOpen,
  Play,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Sun,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { MARKETPLACES } from "@/lib/amazon/url";
import type { CollectionResult, MediaAsset } from "@/lib/amazon/types";
import {
  assetFilename,
  buildCsv,
  downloadAsset,
  probeDirect,
  saveBlob,
  type DirectCheck,
} from "@/lib/media";

type HistoryItem = Pick<
  CollectionResult,
  | "id"
  | "asin"
  | "marketplace"
  | "productUrl"
  | "title"
  | "status"
  | "fetchedAt"
  | "elapsedMs"
> & { count: number };
const EXAMPLES = [
  { label: "笔记本 · 美国站", url: "https://www.amazon.com/dp/B0DW1FVPK8" },
  { label: "Kindle · 美国站", url: "https://www.amazon.com/dp/B0CFPJYX7P" },
  { label: "磁贴 · 新加坡站", url: "https://www.amazon.sg/dp/B09DKPP92N" },
];
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
  const [checks, setChecks] = useState<Record<string, DirectCheck>>({});
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState({ value: 0, label: "" });
  const [notice, setNotice] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [dark, setDark] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLElement | null>(null);
  const working = collecting || !!busy;

  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("amazon-media-lab:history") || "[]",
      );
      if (Array.isArray(saved))
        setHistory(
          saved
            .filter(
              (item) =>
                item &&
                typeof item.asin === "string" &&
                typeof item.productUrl === "string",
            )
            .slice(0, 8),
        );
      const isDark = localStorage.getItem("amazon-media-lab:theme") === "dark";
      setDark(isDark);
      document.documentElement.classList.toggle("dark", isDark);
    } catch {
      /* Storage is optional. */
    }
    return () => controller.current?.abort();
  }, []);

  const images = result?.assets.filter((a) => a.kind === "image") || [];
  const videos = result?.assets.filter((a) => a.kind === "video") || [];
  const visible = (tab === "videos" ? videos : images).filter(
    (a) => group === "all" || a.group === group,
  );
  const picked = result?.assets.filter((a) => selected.has(a.id)) || [];
  const verified = Object.values(checks).filter(
    (c) => c.status === "ok",
  ).length;

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("amazon-media-lab:theme", next ? "dark" : "light");
    } catch {
      /* Optional. */
    }
  }

  async function collect(value = input) {
    if (!value.trim() || working) return;
    const abort = new AbortController();
    controller.current = abort;
    setCollecting(true);
    setResult(null);
    setChecks({});
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
      const item: HistoryItem = {
        id: data.id,
        asin: data.asin,
        marketplace: data.marketplace,
        productUrl: data.productUrl,
        title: data.title,
        status: data.status,
        fetchedAt: data.fetchedAt,
        elapsedMs: data.elapsedMs,
        count: data.assets.length,
      };
      setHistory((previous) => {
        const next = [
          item,
          ...previous.filter(
            (h) => h.asin !== item.asin || h.marketplace !== item.marketplace,
          ),
        ].slice(0, 8);
        try {
          localStorage.setItem(
            "amazon-media-lab:history",
            JSON.stringify(next),
          );
        } catch {
          /* Optional. */
        }
        return next;
      });
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

  async function verify() {
    const assets = picked.length ? picked : visible;
    if (!assets.length || working) return;
    setBusy("verify");
    setProgress({ value: 0, label: "准备验证…" });
    setNotice(null);
    const abort = new AbortController();
    controller.current = abort;
    let index = 0;
    let complete = 0;
    try {
      await Promise.all(
        Array.from({ length: Math.min(3, assets.length) }, async () => {
          while (index < assets.length && !abort.signal.aborted) {
            const asset = assets[index++];
            const check = await probeDirect(asset, abort.signal);
            if (abort.signal.aborted) break;
            setChecks((previous) => ({ ...previous, [asset.id]: check }));
            complete++;
            setProgress({
              value: (complete / assets.length) * 100,
              label: `验证直连 ${complete} / ${assets.length}`,
            });
          }
        }),
      );
      setNotice({
        text: abort.signal.aborted
          ? "验证已取消，已完成的结果保留。"
          : "直连验证完成。通过表示首段可读取，完整文件仍需下载验证。",
      });
    } finally {
      setBusy("");
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
            : "下载失败，请检查网络或直连结果。",
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

  async function copyLinks() {
    try {
      await navigator.clipboard.writeText(
        (picked.length ? picked : visible).map((a) => a.url).join("\n"),
      );
      setNotice({ text: "素材链接已复制。" });
    } catch {
      setNotice({
        text: "浏览器未允许复制，请通过 CSV 导出链接。",
        error: true,
      });
    }
  }

  function exportReport() {
    if (result)
      saveBlob(
        new Blob(
          [JSON.stringify({ ...result, directChecks: checks }, null, 2)],
          { type: "application/json" },
        ),
        `${result.asin}-validation.json`,
      );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <a
            href="#"
            className="flex items-center gap-2.5 text-sm font-semibold tracking-tight"
          >
            <Box className="size-6" strokeWidth={1.7} />
            Amazon Media Lab
          </a>
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#collect" className="text-foreground">
              采集工具
            </a>
            <a href="#history" className="hover:text-foreground">
              验证记录
            </a>
            <a href="#about" className="hover:text-foreground">
              使用说明
            </a>
          </nav>
          <div className="flex items-center gap-3">
            <Badge
              variant="outline"
              className="hidden gap-1.5 font-normal sm:inline-flex"
            >
              <FlaskConical className="size-3" />
              采集验证版
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              aria-label={dark ? "切换浅色模式" : "切换深色模式"}
              onClick={toggleTheme}
            >
              {dark ? <Sun /> : <Moon />}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-5 sm:px-8">
        <section id="collect" className="pt-14 pb-9 sm:pt-20 sm:pb-12">
          <Badge
            variant="secondary"
            className="mb-6 gap-1.5 rounded-full px-3 py-1 font-normal"
          >
            <span className="size-1.5 rounded-full bg-foreground" />
            免费使用 · 无需安装扩展
            <ArrowRight className="ml-1 size-3" />
          </Badge>
          <h1 className="max-w-3xl text-4xl leading-[1.18] font-semibold tracking-tight sm:text-5xl">
            把商品素材，
            <br className="sm:hidden" />
            整理到一起。
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
            粘贴亚马逊商品链接，发现高清图片与视频。
            <br className="hidden sm:block" />
            先预览，再验证，最后把需要的素材保存到本地。
          </p>
          <Card className="mt-9 gap-0 shadow-none">
            <CardContent className="p-5 sm:p-6">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void collect();
                }}
              >
                <label
                  htmlFor="product-url"
                  className="mb-3 block text-sm font-medium"
                >
                  商品链接或 ASIN
                </label>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="relative min-w-0 flex-1">
                    <Link2 className="absolute top-3.5 left-3.5 size-4 text-muted-foreground" />
                    <Input
                      id="product-url"
                      placeholder="https://www.amazon.com/dp/… 或输入 10 位 ASIN"
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      disabled={working}
                      className="h-11 pl-10 text-sm shadow-none"
                      autoComplete="off"
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
                    {collecting ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <ScanLine />
                    )}
                    {collecting ? "正在采集" : "开始采集"}
                    {!collecting && <ArrowRight />}
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    完整链接会自动识别站点；仅输入 ASIN 时使用所选站点。
                  </span>
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="size-3.5" />
                    无需亚马逊账号
                  </span>
                </div>
              </form>
              <Separator className="my-5" />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
                <span className="text-muted-foreground">没有链接？试试</span>
                {EXAMPLES.map((example) => (
                  <button
                    key={example.url}
                    disabled={working}
                    onClick={() => {
                      setInput(example.url);
                      void collect(example.url);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 transition-colors hover:bg-accent disabled:opacity-50"
                  >
                    {example.label}
                    <ArrowUpRight className="size-3" />
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <ImageIcon className="size-3.5" />
              高清图片
            </span>
            <span className="flex items-center gap-1.5">
              <FileVideo className="size-3.5" />
              商品视频
            </span>
            <span className="flex items-center gap-1.5">
              <PackageOpen className="size-3.5" />
              本地打包
            </span>
            <span className="flex items-center gap-1.5">
              <Globe2 className="size-3.5" />
              多站点链接识别
            </span>
          </div>
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
          <Card className="mb-12 gap-0 shadow-none" aria-live="polite">
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Loader2 className="size-4 animate-spin" />
                  <span className="text-sm">正在获取商品页面并提取素材…</span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => controller.current?.abort()}
                >
                  取消
                </Button>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="aspect-square rounded-lg" />
                ))}
              </div>
            </CardContent>
          </Card>
        )}
        {result ? (
          <section
            ref={resultRef}
            className="scroll-mt-6 pb-12"
            aria-label="采集结果"
          >
            <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="font-mono font-normal">
                    {result.asin}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {result.marketplace}
                  </span>
                  <Badge variant="secondary" className="font-normal">
                    {result.assets.length
                      ? "页面采集完成"
                      : result.status === "blocked"
                        ? "访问受限"
                        : "未获取素材"}
                  </Badge>
                </div>
                <h2 className="max-w-3xl text-lg leading-7 font-semibold">
                  {result.title || "本次采集结果"}
                </h2>
              </div>
              <Button variant="outline" size="sm" asChild>
                <a href={result.productUrl} target="_blank" rel="noreferrer">
                  查看商品
                  <ArrowUpRight />
                </a>
              </Button>
            </div>
            <div className="mb-6 grid grid-cols-2 rounded-xl border sm:grid-cols-4">
              {[
                { label: "发现图片", value: images.length, icon: ImageIcon },
                { label: "视频源", value: videos.length, icon: FileVideo },
                { label: "页面变体", value: result.variants.length, icon: Box },
                {
                  label: "采集耗时",
                  value: `${(result.elapsedMs / 1000).toFixed(1)}s`,
                  icon: Clock3,
                },
              ].map((stat, index) => (
                <div
                  key={stat.label}
                  className={`flex items-start justify-between p-4 sm:p-5 ${index % 2 === 0 ? "border-r" : ""} ${index < 2 ? "border-b sm:border-b-0" : ""} ${index === 1 ? "sm:border-r" : ""}`}
                >
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {stat.label}
                    </p>
                    <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
                      {stat.value}
                    </p>
                  </div>
                  <stat.icon className="mt-1 size-4 text-muted-foreground" />
                </div>
              ))}
            </div>
            <Tabs
              value={tab}
              onValueChange={(value) => {
                setTab(value);
                setGroup("all");
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
                <TabsList className="h-10">
                  <TabsTrigger value="images" className="gap-2">
                    <ImageIcon className="size-4" />
                    图片
                    <span className="text-xs text-muted-foreground">
                      {images.length}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="videos" className="gap-2">
                    <FileVideo className="size-4" />
                    视频
                    <span className="text-xs text-muted-foreground">
                      {videos.length}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="diagnostics" className="gap-2">
                    <FlaskConical className="size-4" />
                    采集诊断
                  </TabsTrigger>
                </TabsList>
                <Button size="sm" variant="ghost" onClick={exportReport}>
                  <FileJson />
                  导出验证报告
                </Button>
              </div>
              {["images", "videos"].map((kind) => (
                <TabsContent key={kind} value={kind} className="mt-0">
                  <div className="flex flex-wrap items-center justify-between gap-3 py-5">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        id={`select-${kind}`}
                        aria-label="选择当前列表全部素材"
                        checked={
                          visible.length > 0 &&
                          visible.every((a) => selected.has(a.id))
                        }
                        disabled={working || !visible.length}
                        onCheckedChange={(value) =>
                          setSelected((previous) => {
                            const next = new Set(previous);
                            for (const asset of visible)
                              if (value) next.add(asset.id);
                              else next.delete(asset.id);
                            return next;
                          })
                        }
                      />
                      <label htmlFor={`select-${kind}`} className="text-sm">
                        全选
                        <span className="ml-2 text-xs text-muted-foreground">
                          已选 {picked.length}
                        </span>
                      </label>
                      <select
                        aria-label="素材分类"
                        className={`${selectClass} h-8 text-xs`}
                        value={group}
                        onChange={(event) => setGroup(event.target.value)}
                      >
                        <option value="all">全部类型</option>
                        <option value="product">商品素材</option>
                        <option value="aplus">A+ 内容</option>
                        <option value="review">评论素材</option>
                      </select>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          working || (!visible.length && !picked.length)
                        }
                        onClick={verify}
                      >
                        <CheckCheck />
                        验证直连
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={
                          working || (!visible.length && !picked.length)
                        }
                        onClick={() =>
                          saveBlob(
                            new Blob(
                              [buildCsv(picked.length ? picked : visible)],
                              { type: "text/csv;charset=utf-8" },
                            ),
                            `${result.asin}-media.csv`,
                          )
                        }
                      >
                        <FileSpreadsheet />
                        CSV
                      </Button>
                      <Button
                        size="sm"
                        disabled={working || !picked.length}
                        onClick={downloadZip}
                      >
                        <ArrowDownToLine />
                        下载所选
                      </Button>
                    </div>
                  </div>
                  {busy && (
                    <div
                      className="mb-5 rounded-lg border p-4"
                      aria-live="polite"
                    >
                      <div className="mb-3 flex items-center justify-between gap-3 text-sm">
                        <span className="flex items-center gap-2">
                          <Loader2 className="size-3.5 animate-spin" />
                          {progress.label || "准备任务…"}
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
                  {visible.length ? (
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                      {visible.map((asset) => (
                        <AssetCard
                          key={asset.id}
                          asset={asset}
                          checked={selected.has(asset.id)}
                          check={checks[asset.id]}
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
                    <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
                      <PackageOpen className="mb-4 size-8 text-muted-foreground" />
                      <h3 className="text-sm font-medium">
                        本次未发现{kind === "images" ? "图片" : "视频"}素材
                      </h3>
                      <p className="mt-2 max-w-md text-xs leading-6 text-muted-foreground">
                        这仅代表当前响应的采集结果。查看「采集诊断」了解访问状态与提取范围。
                      </p>
                      <Button
                        className="mt-4"
                        variant="outline"
                        size="sm"
                        onClick={() => setTab("diagnostics")}
                      >
                        查看采集诊断
                        <ArrowRight />
                      </Button>
                    </div>
                  )}
                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span>
                      {Object.keys(checks).length
                        ? `直连首段通过 ${verified} / 已验证 ${Object.keys(checks).length}`
                        : "尚未验证浏览器直连"}{" "}
                      · 下载前可先验证可读性
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!visible.length || working}
                      onClick={copyLinks}
                    >
                      <Copy />
                      复制链接
                    </Button>
                  </div>
                </TabsContent>
              ))}
              <TabsContent value="diagnostics" className="mt-5">
                <Card className="gap-4 shadow-none">
                  <CardHeader>
                    <CardTitle className="text-base">本次验证记录</CardTitle>
                    <CardDescription>
                      记录真实的获取与提取结果，浏览器直连单独验证。
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-5">
                      {result.steps.map((step, index) => (
                        <div key={index} className="flex gap-3">
                          {step.status === "ok" ? (
                            <CircleCheck className="mt-0.5 size-4 shrink-0" />
                          ) : (
                            <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex justify-between gap-3 text-sm font-medium">
                              <span>{step.name}</span>
                              {step.durationMs !== undefined && (
                                <span className="font-mono text-xs font-normal text-muted-foreground">
                                  {step.durationMs} ms
                                </span>
                              )}
                            </div>
                            <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
                              {step.name === "验证浏览器直连" &&
                              Object.keys(checks).length
                                ? `已验证 ${Object.keys(checks).length} 个素材，首段可读取 ${verified} 个。完整下载需另行确认。`
                                : step.detail}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <Separator className="my-6" />
                    <dl className="grid gap-4 text-xs sm:grid-cols-3">
                      <div>
                        <dt className="text-muted-foreground">运行环境</dt>
                        <dd className="mt-1.5">{result.environment}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">页面响应</dt>
                        <dd className="mt-1.5">
                          {result.upstreamStatus
                            ? `HTTP ${result.upstreamStatus}`
                            : "未收到响应"}
                          {result.htmlBytes
                            ? ` · ${(result.htmlBytes / 1024).toFixed(0)} KB`
                            : ""}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">采集时间</dt>
                        <dd className="mt-1.5">
                          {new Date(result.fetchedAt).toLocaleString("zh-CN")}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-6 rounded-lg bg-muted p-4 text-xs leading-6 text-muted-foreground">
                      {result.warnings.map((warning, i) => (
                        <p key={i}>{warning}</p>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
            <p className="mt-6 text-xs leading-6 text-muted-foreground">
              当前响应范围内发现 {result.assets.length} 个素材源；同一视频的 MP4
              与 HLS
              作为不同来源展示。变体数量表示页面声明数量，不代表已逐个采集。
            </p>
          </section>
        ) : (
          !collecting && (
            <section className="pb-12">
              <div className="flex items-center justify-between border-b pb-4">
                <h2 className="text-sm font-medium">素材工作区</h2>
                <span className="font-mono text-xs text-muted-foreground">
                  等待采集
                </span>
              </div>
              <div className="mt-5 flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed bg-muted/20 p-8 text-center">
                <div className="mb-4 flex size-12 items-center justify-center rounded-xl border bg-background">
                  <PackageOpen className="size-5 text-muted-foreground" />
                </div>
                <h3 className="text-sm font-medium">
                  你的下一组素材，从一个链接开始
                </h3>
                <p className="mt-2 max-w-sm text-xs leading-6 text-muted-foreground">
                  采集后在这里预览、选择和下载。图片、视频与验证结果会分开展示。
                </p>
                <div className="mt-6 flex flex-wrap justify-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Check className="size-3.5" />
                    保留来源
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Check className="size-3.5" />
                    智能去重
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Check className="size-3.5" />
                    本地导出
                  </span>
                </div>
              </div>
            </section>
          )
        )}
        <section id="history" className="scroll-mt-6 border-t py-9">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium">最近验证</h2>
              <p className="mt-1.5 text-xs text-muted-foreground">
                记录仅保存在当前浏览器，点击可重新采集。
              </p>
            </div>
            <Clock3 className="size-4 text-muted-foreground" />
          </div>
          {history.length ? (
            <div className="divide-y rounded-lg border">
              {history.map((item) => (
                <button
                  key={item.id}
                  disabled={working}
                  onClick={() => {
                    setInput(item.productUrl);
                    void collect(item.productUrl);
                  }}
                  className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/50 disabled:opacity-50"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md border">
                    <Box className="size-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {item.title || item.asin}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                      {item.asin} · {item.marketplace}
                    </p>
                  </div>
                  <span className="hidden text-xs text-muted-foreground sm:block">
                    {item.count
                      ? `${item.count} 个素材源`
                      : item.status === "blocked"
                        ? "访问受限"
                        : "未获取素材"}
                  </span>
                  <RefreshCw className="size-3.5 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border p-6 text-center text-xs text-muted-foreground">
              还没有验证记录，开始一次采集后会出现在这里。
            </div>
          )}
        </section>
        <section
          id="about"
          className="grid scroll-mt-6 gap-8 border-t py-10 sm:grid-cols-3"
        >
          {[
            {
              number: "01",
              title: "粘贴商品链接",
              text: "支持完整商品链接或 ASIN，无需安装扩展，也无需提供亚马逊登录信息。",
            },
            {
              number: "02",
              title: "预览并验证",
              text: "查看当前页面发现的素材，验证浏览器是否能读取，访问失败会明确显示。",
            },
            {
              number: "03",
              title: "选择并保存",
              text: "单独下载或在浏览器里打包导出。素材处理留在本地，本轮上限为 150 MB。",
            },
          ].map((step) => (
            <div key={step.number}>
              <span className="font-mono text-xs text-muted-foreground">
                {step.number}
              </span>
              <h3 className="mt-3 text-sm font-medium">{step.title}</h3>
              <p className="mt-2 text-xs leading-6 text-muted-foreground">
                {step.text}
              </p>
            </div>
          ))}
        </section>
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col justify-between gap-3 px-5 py-6 text-[11px] text-muted-foreground sm:flex-row sm:px-8">
          <span>Amazon Media Lab · 独立开发的商品素材工具</span>
          <span>请仅保存和使用你有权使用的素材。与 Amazon 无关联。</span>
        </div>
      </footer>
    </div>
  );
}

function AssetCard({
  asset,
  checked,
  check,
  disabled,
  onToggle,
  onDownload,
}: {
  asset: MediaAsset;
  checked: boolean;
  check?: DirectCheck;
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
        <div className="mt-3 flex items-center justify-between gap-2">
          <span
            title={check?.detail}
            className={`flex min-w-0 items-center gap-1 text-[10px] ${check?.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}
          >
            {check?.status === "ok" ? (
              <CircleCheck className="size-3 shrink-0" />
            ) : (
              <CircleDashed className="size-3 shrink-0" />
            )}
            <span className="truncate">
              {check?.status === "ok"
                ? "首段可读取"
                : check?.status === "failed"
                  ? "直连未通过"
                  : "未验证直连"}
            </span>
          </span>
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
