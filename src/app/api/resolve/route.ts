import { NextResponse } from "next/server";
import { z } from "zod";
import { collectProduct } from "@/lib/amazon/collector";

export const runtime = "nodejs";
export const maxDuration = 30;

const schema = z.object({
  url: z.string().trim().min(1).max(2048),
  marketplace: z.string().max(30).optional(),
});

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > 4096)
    return NextResponse.json({ error: "请求过大。" }, { status: 413 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "请输入有效的商品链接或 ASIN。" },
      { status: 400 },
    );
  try {
    const result = await collectProduct(
      parsed.data.url,
      parsed.data.marketplace,
      request.signal,
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "采集失败。" },
      { status: 400 },
    );
  }
}
