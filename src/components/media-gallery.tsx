"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileVideo, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MediaPreview } from "@/components/media-preview";
import type { MediaAsset } from "@/lib/amazon/types";
import { isMediaUrl } from "@/lib/amazon/url";
import { cn } from "@/lib/utils";

export function MediaGallery({
  assets,
  initialAssetId,
  onClose,
  onRestoreFocus,
}: {
  assets: MediaAsset[];
  initialAssetId: string;
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      assets.findIndex((asset) => asset.id === initialAssetId),
    ),
  );
  const activeThumbnailRef = useRef<HTMLButtonElement>(null);
  const asset = assets[index];
  const keepActiveVisible = useCallback(() => {
    activeThumbnailRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, []);
  const observeThumbnailStrip = useCallback(
    (strip: HTMLElement | null) => {
      if (!strip) return;
      const observer = new ResizeObserver(keepActiveVisible);
      observer.observe(strip);
      return () => observer.disconnect();
    },
    [keepActiveVisible],
  );

  useEffect(() => {
    keepActiveVisible();
  }, [index, keepActiveVisible]);

  function navigate(offset: number) {
    setIndex((current) =>
      Math.max(0, Math.min(assets.length - 1, current + offset)),
    );
  }

  if (!asset) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="flex h-[min(90dvh,54rem)] w-[calc(100%-2rem)] min-w-0 flex-col overflow-hidden p-4 sm:max-w-5xl sm:p-6"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          activeThumbnailRef.current?.focus({ preventScroll: true });
          keepActiveVisible();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
        onKeyDown={(event) => {
          // Let the video controls keep their native seeking/volume shortcuts.
          if (
            event.target instanceof HTMLVideoElement ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey
          )
            return;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            navigate(event.key === "ArrowLeft" ? -1 : 1);
          }
        }}
      >
        <DialogHeader className="min-w-0 shrink-0 pr-6 text-left">
          <div className="flex items-center gap-3">
            <DialogTitle>
              {asset.kind === "image" ? "图片预览" : "视频预览"}
            </DialogTitle>
            <span
              className="text-xs tabular-nums text-muted-foreground"
              role="status"
              aria-live="polite"
            >
              {index + 1} / {assets.length}
            </span>
          </div>
          <DialogDescription className="line-clamp-2 break-words">
            {asset.title}
            {asset.variant && ` · ${asset.variant}`}
          </DialogDescription>
        </DialogHeader>

        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
          <MediaPreview key={asset.id} asset={asset} />
          {assets.length > 1 && (
            <>
              <Button
                variant="outline"
                size="icon"
                className="absolute top-1/2 left-2 -translate-y-1/2 bg-background/90"
                aria-label="上一个素材"
                disabled={index === 0}
                onClick={() => navigate(-1)}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="absolute top-1/2 right-2 -translate-y-1/2 bg-background/90"
                aria-label="下一个素材"
                disabled={index === assets.length - 1}
                onClick={() => navigate(1)}
              >
                <ChevronRight />
              </Button>
            </>
          )}
        </div>

        <nav
          ref={observeThumbnailStrip}
          aria-label="预览缩略图"
          className="flex shrink-0 gap-2 overflow-x-auto overscroll-x-contain p-1"
        >
          {assets.map((item, itemIndex) => {
            const thumbnail =
              item.thumbnail || (item.kind === "image" ? item.url : "");
            return (
              <Button
                key={item.id}
                ref={itemIndex === index ? activeThumbnailRef : undefined}
                variant="ghost"
                className={cn(
                  "relative h-16 w-20 shrink-0 overflow-hidden rounded-md border-2 p-1",
                  itemIndex === index
                    ? "border-foreground bg-muted"
                    : "border-transparent hover:border-input",
                )}
                aria-label={`预览第 ${itemIndex + 1} 项：${item.title}`}
                aria-current={itemIndex === index ? "true" : undefined}
                title={item.title}
                onClick={() => setIndex(itemIndex)}
              >
                {isMediaUrl(thumbnail) ? (
                  <img
                    src={thumbnail}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    draggable={false}
                    className="size-full object-contain"
                  />
                ) : (
                  <FileVideo className="size-6 text-muted-foreground" />
                )}
                {item.kind === "video" && (
                  <span className="absolute right-1 bottom-1 rounded bg-foreground/80 p-1 text-background">
                    <Play className="size-2.5 fill-current" />
                  </span>
                )}
              </Button>
            );
          })}
        </nav>
      </DialogContent>
    </Dialog>
  );
}
