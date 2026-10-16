# Amazon Media Lab

一个以纯网站方式验证亚马逊商品素材采集的原型。自建 Node.js 解析服务，不依赖 ASINCrate 或付费采集 API；UI 使用官方 shadcn/ui 组件与 Neutral 默认主题。

## 本地运行

要求 Node.js 22、pnpm 11.15.1。

```sh
pnpm install
pnpm dev
```

本项目开发时使用 `pnpm dev --hostname 127.0.0.1 --port 4317`。

## 当前能力

- 支持完整商品链接与 ASIN，识别 15 个亚马逊站点。站点识别支持不等于各站点采集已全部验证。
- 从 HTML 内嵌结构化数据中采集商品图片、视频、页面声明变体，以及当前响应中的 A+ 与评论素材。
- 静态读取 JavaScript 中的数据字面量与 JSON，不执行上游页面脚本。
- 精简素材工作区：链接 / ASIN 输入、素材分类、图片预览、选择、单个下载和本地 ZIP。
- 常规未加密 HLS 点播清单转封装为 MP4；支持 TS 与带单一初始化片段的 fMP4。
- 提取与下载进度、取消任务和必要的错误提示。首页不保留历史记录、示例入口或验证面板。

## 数据边界

- 当前采集只覆盖一次商品页面响应，未遍历每个变体、未翻页获取全部评论。结果 `partial` 表示范围受限，即使提取到素材也不宣称完整采集。
- 同一视频的 MP4 与 HLS 是不同素材源，不是不同视频数量。
- 独立验证工具的浏览器直连检查只读清单/素材首段，不代表整个文件下载成功；页面下载动作读取完整文件后才提示保存。
- 跨域读取失败不直接归因于 CORS，界面明确区分请求失败与已证实的 HTTP 错误。
- `width` / `height` 仅记录结构化数据的明确尺寸；URL 中的 SL / SX / SY 规格单列为 `sizeHint`，界面以“规格”标识，不把它伪装成实测宽度。
- 不支持加密分片、独立音轨、直播、多初始化片段、字节范围分片和时间线切换。遇到这些情况会明确报错，不输出伪装成 MP4 的文件。
- 单文件和整包限制为 150 MB。ZIP 在内存中生成，适用于验证规模的短视频与图片集合。
- 不提供媒体代理；验证浏览器直接从亚马逊 CDN 读取的可行性。
- 没有账号系统、持久化服务端缓存、分布式限流或大规模批量采集。
- 本地成功和 Vercel 成功分开记录。网络/IP、区域、商品和时间变化会影响采集结果。

## 结构

- `src/app/api/resolve/route.ts`：输入校验与 JSON API。
- `src/lib/amazon/url.ts`：站点、ASIN、媒体域名约束。
- `src/lib/amazon/collector.ts`：请求、跳转约束、超时、大小上限、诊断。
- `src/lib/amazon/parser.ts`：静态结构化数据提取与去重。
- `src/lib/media.ts`：浏览器直连验证、下载、HLS 转封装与导出。
- `src/components/ui/`：从 shadcn/ui 官方 registry 引入的组件。
- `src/components/media-lab.tsx`：素材工作区。

## 检查与真实采集

```sh
pnpm test
pnpm typecheck
pnpm build
pnpm validate:live
pnpm validate:live https://www.amazon.com/dp/B0DW1FVPK8
```

真实采集脚本将结果写入忽略的 `work/live-validation.json`。它只验证服务端采集；浏览器跨域、完整文件、播放和部署分别验证。

## Vercel

这是标准 Next.js App Router 项目，`/api/resolve` 使用 Node.js，最长执行 30 秒，内部上游超时 20 秒。API 仅返回元数据，媒体文件不经过函数。

项目通过 `packageManager` 固定 pnpm 版本。Vercel 构建需启用 `ENABLE_EXPERIMENTAL_COREPACK=1`，以使用锁文件对应版本。命令行预览部署：

```sh
pnpm dlx vercel deploy --yes --build-env ENABLE_EXPERIMENTAL_COREPACK=1
```

通过控制台导入时，请将同名构建环境变量添加到项目。部署后使用真实链接重新验证，不以本地结果代替云端结果。预览部署保持 Vercel 的默认访问保护。

## 使用范围

请保存和使用自己或已获授权的商品素材。工具与 Amazon 无关联，不支持 Prime Video 影视内容。

## 本地 Fetch / Playwright 对比实验

```sh
pnpm compare:local
# 重新生成指定实验的 HTML、CSV、JSON 报告
pnpm exec tsx scripts/report-comparison.ts work/comparison-<run-id>
```

比较脚本复用同一套商品 URL 校验、页面分类与素材解析器。默认对上述三个固定商品执行 4 轮配对测量，共 24 次、每种方法 12 次；轮换商品顺序并交替方法先后。并发为 1，尝试间隔 4 秒，遇到验证页按方法和站点冷却 30 秒，不处理验证入口，也不重试同一次尝试。

Playwright 为开发依赖，使用本机已安装的 Google Chrome (`channel: chrome`) 和独立匿名上下文，不读取个人浏览器资料。每个站点的会话在本轮实验内复用，关闭 HTTP 缓存。原始响应与渲染后 DOM 都交给同一个解析器，分别保留数量；渲染额外等待 2.5 秒。实验结果与原始页面写入忽略的 `work/comparison-*` 目录。

本地对比不等于 Vercel 环境验证；采集成功也不等于完整 listing 或媒体文件下载成功。报告同时区分成功率、配对挽回/退化、素材增量，以及原始 HTML 中已存在但被解析器漏读的懒加载属性。

2026-10-16 的首次对比结果见 `docs/LOCAL_COMPARISON.md`。


## Fetch 懒加载补齐后的本地复测

解析器支持视频及其 `source` 上的 `data-src`、`data-lazy-src`、`data-original`，保留封面、标题及所在区域；商品、A+、评论图片支持懒加载地址、`srcset`、`data-srcset`、`data-lazy-srcset` 与 `picture source`。只接收允许的 HTTPS 亚马逊媒体域名，不执行上游脚本、不拼接不存在的高分辨率地址。

```bash
# 同一组三件商品，每件 4 轮，Fetch 共 12 次，无重试
pnpm validate:fetch
# 可传入修改解析器之前保存的快照解析基线，先做相同 HTML 回放
pnpm validate:fetch work/lazy-baseline.json
# 生成本地 HTML / CSV / JSON 报告
pnpm exec tsx scripts/report-fetch-validation.ts <运行目录>/results.json <报告目录>
```

每次运行写入独立的 `work/fetch-lazy-<时间>/`，保留成功与失败尝试及原始 HTML。增量须通过相同 HTML 的旧、新解析结果计算，不能把不同时间上游页面变化当成解析器收益。2026-10-16 复测结果见 `docs/FETCH_LAZY_VALIDATION.md`。
