"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import type { MediaAsset } from "@/lib/amazon/types";
import { isMediaUrl } from "@/lib/amazon/url";
import { downloadAsset } from "@/lib/media";

export function MediaPreview({ asset }: { asset: MediaAsset }) {
  const [source, setSource] = useState(
    asset.format !== "hls" && isMediaUrl(asset.url) ? asset.url : "",
  );
  const [error, setError] = useState("");
  const [progress, setProgress] = useState({
    value: 0,
    label: "正在准备视频…",
  });

  useEffect(() => {
    if (!isMediaUrl(asset.url) || asset.format !== "hls") return;
    const controller = new AbortController();
    let objectUrl = "";

    void downloadAsset(asset, controller.signal, (done, total, label) => {
      if (!controller.signal.aborted)
        setProgress({ value: total ? (done / total) * 100 : 0, label });
    })
      .then((file) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(
          new Blob([file.bytes], { type: "video/mp4" }),
        );
        setSource(objectUrl);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error ? error.message : "视频预览加载失败。",
          );
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [asset]);

  const message = !isMediaUrl(asset.url)
    ? "素材地址不在支持的亚马逊媒体域名内。"
    : error;

  if (message)
    return (
      <Alert variant="destructive" className="mx-14 w-auto">
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    );

  if (!source)
    return (
      <div
        className="flex w-full flex-col justify-center gap-4 px-14"
        role="status"
      >
        <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 shrink-0 animate-spin" />
          {progress.label}
        </p>
        <Progress value={progress.value} className="h-1.5" />
      </div>
    );

  if (asset.kind === "video")
    return (
      <PreviewVideo
        source={source}
        asset={asset}
        onError={() => setError("视频暂时无法播放，请稍后重新打开预览。")}
      />
    );

  return (
    <img
      src={source}
      alt={asset.title}
      referrerPolicy="no-referrer"
      className="size-full object-contain"
      onError={() => setError("图片加载失败，请稍后重新打开预览。")}
    />
  );
}

function PreviewVideo({
  source,
  asset,
  onError,
}: {
  source: string;
  asset: MediaAsset;
  onError: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.src = source;
    return () => {
      if (!video) return;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [source]);

  return (
    <video
      ref={videoRef}
      src={source}
      poster={isMediaUrl(asset.thumbnail) ? asset.thumbnail : undefined}
      aria-label={asset.title}
      controls
      autoPlay
      playsInline
      preload="metadata"
      className="max-h-full max-w-full rounded-md bg-black object-contain"
      onError={onError}
    />
  );
}
