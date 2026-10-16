# 采集验证记录

日期：2026-10-16（Asia/Shanghai）

项目：`/Users/deno/Desktop/deno/amazon-media-lab`

最终预览：https://amazon-media-h3o4la6sj-deno-me.vercel.app

## 本地真实采集

| ASIN | 站点 | 采集状态 | 上游 HTTP | 图片 | 视频源 | 环境 | 上海时间 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B0DW1FVPK8 | amazon.com | partial | 200 | 29 | 16 | 本地 Node.js | 11:16:36 |
| B0CFPJYX7P | amazon.com | partial | 200 | 12 | 0 | 本地 Node.js | 11:16:39 |
| B09DKPP92N | amazon.sg | partial | 200 | 6 | 2 | 本地 Node.js | 11:16:41 |

## Vercel 首轮采集

| ASIN | 站点 | 采集状态 | 上游 HTTP | 图片 | 视频源 | 环境 | 上海时间 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B0DW1FVPK8 | amazon.com | blocked | 200 | 0 | 0 | Vercel · iad1 | 11:23:33 |
| B0CFPJYX7P | amazon.com | partial | 200 | 12 | 0 | Vercel · iad1 | 11:24:40 |
| B09DKPP92N | amazon.sg | partial | 200 | 6 | 2 | Vercel · iad1 | 11:23:32 |

## Vercel 最终版本复测

| ASIN | 站点 | 采集状态 | 上游 HTTP | 图片 | 视频源 | 环境 | 上海时间 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B0DW1FVPK8 | amazon.com | blocked | 200 | 0 | 0 | Vercel · iad1 | 11:26:51 |
| B0CFPJYX7P | amazon.com | blocked | 200 | 0 | 0 | Vercel · iad1 | 11:26:51 |
| B09DKPP92N | amazon.sg | error | 500 | 0 | 0 | Vercel · iad1 | 11:26:51 |

## 验证边界

- 本地运行：三件真实商品均提取到素材，结果为 partial，表示仅覆盖当前响应，不宣称整条 listing 完整采集。
- 浏览器实际下载：1500×1030 JPG（144780 字节）；包含两张图片的 ZIP 通过 CRC 校验；CSV 导出成功。
- HLS 导出：MP4 919711 字节，浏览器识别为 1080×1080、11.51147 秒，readyState 4，无加载错误，文件包含 vide 与 soun 两条轨道。
- 10 项自动化测试通过；最终源码的 Next.js 生产构建与 TypeScript 检查通过。
- Vercel 最终预览构建成功，保留 Vercel Authentication 保护，未晋升为生产部署。
- 云端先前曾成功采集 Kindle 与新加坡商品，但最终同一组样本出现验证页面和上游 500，说明服务器直抓尚不稳定。
- blocked + HTTP 200 指识别到验证页面；HTTP 500 单独记录为上游错误，不归因为验证码。
- 这些结果不足以证明具体 IP、网络或地域是根因，也不足以推算全站成功率。
- 当前未使用付费采集 API、Chrome 扩展、媒体代理或逐个变体/评论翻页采集。
