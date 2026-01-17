# lazy-crawl

Social media feed crawlers using Playwright and Bun.

## Setup

```bash
bun install
```

## Facebook Crawler

Crawls your Facebook favorites feed and extracts post content.

### First time login

```bash
bun fb.ts --login
```

This opens a browser for manual login. After logging in, press Enter to save the session.

### Crawl posts

```bash
bun fb.ts
```

Scrolls through the favorites feed, captures posts incrementally (to handle Facebook's virtualized list), and outputs author + content for each post.

## Twitter/X Crawler

```bash
bun tweet.ts
```

(Documentation TBD)
