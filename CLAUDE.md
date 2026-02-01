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
bun fb.ts          # Crawl favorites feed, outputs to data/raw/fb-{timestamp}.md
```

### tweet.ts - Twitter/X Crawler

Crawls a Twitter list using the rettiwt-api package.

**Requirements:**
- `RETTIWT_API_KEY` environment variable in `.env`

**Usage:**
```bash
bun tweet.ts  # Crawl Twitter list, outputs to data/raw/tweet-{timestamp}.md
```

### utils.ts - Shared Utilities

Common utilities for state management and markdown generation.

**Features:**
- `crawl-state.json`: Tracks last seen post/tweet for incremental crawling
- `data/raw/`: Raw crawl output (timestamped markdown files with YAML frontmatter)
- `data/lean/`: Cleaned output (deduped + URL trimmed, via `lean.ts`)
- Incremental crawling: Stops when reaching previously seen content

### lean.ts - Data Pipeline (raw → lean)

Reads `data/raw/` and writes cleaned versions to `data/lean/`.

**Cleaning rules:**
- **Facebook:** Remove tracking params (`__cft__`, `__tn__`) from URLs; deduplicate posts by first 100 chars of content (keeps longest version)
- **Gmail:** Strip markdown images `![...](...)` and empty tracking links
- **Twitter:** No special cleaning (URLs already short)
- **All:** Remove `### Content` subheading for compactness; add `sourceFile` to frontmatter

**Usage:**
```bash
bun lean.ts                            # Process all files in data/raw/
bun lean.ts data/raw/fb-2026-01-26-221711.md  # Process specific file
bun lean.ts --today                    # Process today's files only
```

### logger.ts - Shared Logger

All files use a shared `consola` logger from `logger.ts` instead of `console.log`/`console.error`.

- Import: `import { log } from './logger'`
- Methods: `log.start()`, `log.info()`, `log.success()`, `log.warn()`, `log.error()`, `log.fatal()`, `log.debug()`
- Level controlled by `LOG_LEVEL` env var (default: `info`)
- `LOG_LEVEL=debug` shows debug output (e.g. Gmail query strings)
- `LOG_LEVEL=error` suppresses everything below error

### Output Format

Crawl results are saved to `data/raw/{platform}-{timestamp}.md` with YAML frontmatter containing:
- `platform`: facebook, twitter, or gmail
- `crawlTime`: ISO timestamp
- `postCount`: Number of posts captured
- `stoppedReason`: "reached_previous", "scroll_limit", "api_limit", or "query_exhausted"
