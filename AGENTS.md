# Amazon Media Lab

- Workspace: `/Users/deno/Desktop/deno/amazon-media-lab`.
- Product: a website for collecting Amazon product media and validating direct browser downloads. Keep extraction independent from delivery and presentation.
- Use official shadcn/ui components and the default Neutral visual language. Avoid decorative custom themes, gradients or fake example results.
- Extract structured data without evaluating upstream JavaScript. Restrict acquisition to supported Amazon product hosts and downloads to explicit Amazon media hosts.
- Report observed assets, declared variants, browser first-byte checks, full downloads, playable output and Vercel results separately. Do not claim complete listing coverage.
- Keep raw HTML, downloaded media and temporary evidence under ignored `work/`.
- Relevant commands: `pnpm test`, `pnpm typecheck`, `pnpm build`; `pnpm validate:live` makes real external acquisition requests.
- Preserve unrelated changes. Do not introduce paid APIs or a browser extension unless requested.
