---
description: Use Bun instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## Project: lazy-crawl

Social media feed crawlers using Playwright.

### fb.ts - Facebook Favorites Crawler

Crawls Facebook favorites feed and extracts posts.

**Key learnings from implementation:**
- Facebook uses virtualized lists - posts are removed from DOM when scrolled out of view
- Must capture posts incrementally while scrolling, before they disappear
- Content is in `[data-ad-rendering-role="story_message"]` elements
- Full content requires clicking "Show more" buttons (`查看更多`, `See more`)
- Author is in `[data-ad-rendering-role="profile_name"] span span`
- `[role="article"]` exists but content elements are NOT inside it
- Session auth stored in `./fb-auth/state.json`

**Usage:**
```bash
bun fb.ts --login  # First time: manual login, saves session
bun fb.ts          # Crawl favorites feed
```

### tweet.ts - Twitter/X Crawler

(To be documented)
