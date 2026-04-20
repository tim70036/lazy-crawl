import { Rettiwt } from 'rettiwt-api';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { log } from './logger';

// --- Types ---

interface UserCrawlConfig {
  users: string[];
  keywords: string[];
  startDate: string;
  endDate: string;
  tweetsPerPage: number;
  maxPages: number;
}

interface CrawledTweet {
  id: string;
  createdAt: string;
  username: string;
  content: string;
  quotedAuthor?: string;
  quotedContent?: string;
  retweetedAuthor?: string;
  retweetedContent?: string;
}

// --- Config ---

const CONFIG_FILE = process.env.USER_CRAWL_CONFIG ?? './user-crawl-config.json';
const OUTPUT_DIR = process.env.USER_CRAWL_OUTPUT_DIR ?? './data/user-crawl';

function loadConfig(): UserCrawlConfig {
  if (!existsSync(CONFIG_FILE)) {
    log.fatal(`Config file not found: ${CONFIG_FILE}`);
    process.exit(1);
  }
  const raw = readFileSync(CONFIG_FILE, 'utf-8');
  const cfg = JSON.parse(raw) as Partial<UserCrawlConfig>;

  if (!cfg.users?.length) { log.fatal('Config: "users" array is required'); process.exit(1); }
  if (!cfg.keywords?.length) { log.fatal('Config: "keywords" array is required'); process.exit(1); }

  return {
    users: cfg.users,
    keywords: cfg.keywords.map(k => k.toLowerCase()),
    startDate: cfg.startDate ?? '2025-01-01',
    endDate: cfg.endDate ?? new Date().toISOString().split('T')[0]!,
    tweetsPerPage: Math.min(cfg.tweetsPerPage ?? 20, 20),
    maxPages: cfg.maxPages ?? 5,
  };
}

// --- Rate limiting ---

const REQUEST_DELAY_MS = Number(process.env.USER_CRAWL_DELAY_MS) || 5000;
const MAX_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function searchWithRetry<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const is429 = err instanceof Error && (
        err.message.includes('429') || err.message.toLowerCase().includes('rate limit')
      );
      if (is429 && attempt < MAX_RETRIES) {
        const backoff = REQUEST_DELAY_MS * Math.pow(2, attempt);
        log.warn(`  ${label} rate-limited (429), waiting ${(backoff / 1000).toFixed(0)}s before retry ${attempt + 1}/${MAX_RETRIES}...`);
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
  throw new Error('unreachable');
}

// --- Crawl ---

async function searchKeyword(
  rettiwt: InstanceType<typeof Rettiwt>,
  user: string,
  keyword: string,
  config: UserCrawlConfig,
): Promise<CrawledTweet[]> {
  const tweets: CrawledTweet[] = [];
  let cursor: string | undefined;
  let page = 0;

  while (page < config.maxPages) {
    page++;
    log.info(`  [${user}/${keyword}] page ${page}...`);

    const result = await searchWithRetry(
      () => rettiwt.tweet.search(
        {
          fromUsers: [user],
          includeWords: [keyword],
          startDate: new Date(config.startDate),
          endDate: new Date(config.endDate),
        },
        config.tweetsPerPage,
        cursor,
      ),
      `[${user}/${keyword}]`,
    );

    if (!result.list || result.list.length === 0) {
      log.info(`  [${user}/${keyword}] no more results`);
      break;
    }

    for (const t of result.list) {
      tweets.push({
        id: t.id,
        createdAt: t.createdAt ? new Date(t.createdAt).toISOString() : '',
        username: t.tweetBy?.userName || user,
        content: t.fullText || '',
        quotedAuthor: t.quoted?.tweetBy?.userName,
        quotedContent: t.quoted?.fullText,
        retweetedAuthor: t.retweetedTweet?.tweetBy?.userName,
        retweetedContent: t.retweetedTweet?.fullText,
      });
    }

    log.info(`  [${user}/${keyword}] got ${result.list.length} tweets (total ${tweets.length})`);

    if (!result.next || result.list.length < config.tweetsPerPage) break;
    cursor = result.next;

    log.debug(`  sleeping ${REQUEST_DELAY_MS}ms...`);
    await sleep(REQUEST_DELAY_MS);
  }

  return tweets;
}

async function crawlUser(
  rettiwt: InstanceType<typeof Rettiwt>,
  user: string,
  config: UserCrawlConfig,
): Promise<CrawledTweet[]> {
  const seen = new Map<string, CrawledTweet>();

  for (let i = 0; i < config.keywords.length; i++) {
    const keyword = config.keywords[i]!;
    if (i > 0) {
      log.debug(`  sleeping ${REQUEST_DELAY_MS}ms between keywords...`);
      await sleep(REQUEST_DELAY_MS);
    }
    log.start(`Searching @${user} for "${keyword}"...`);
    const results = await searchKeyword(rettiwt, user, keyword, config);
    for (const tweet of results) {
      if (!seen.has(tweet.id)) {
        seen.set(tweet.id, tweet);
      }
    }
    log.success(`  "${keyword}": ${results.length} tweets (unique so far: ${seen.size})`);
  }

  const tweets = Array.from(seen.values());
  tweets.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return tweets;
}

// --- Output ---

function formatDate(iso: string): string {
  return iso.split('T')[0] ?? iso;
}

function generateMarkdown(
  tweets: CrawledTweet[],
  user: string,
  config: UserCrawlConfig,
  crawlTime: string,
): string {
  const frontmatter = [
    '---',
    'query:',
    `  users: [${config.users.join(', ')}]`,
    `  keywords: [${config.keywords.join(', ')}]`,
    `  dateRange: ${config.startDate} ~ ${config.endDate}`,
    `  tweetCount: ${tweets.length}`,
    `  crawlTime: "${crawlTime}"`,
    '---',
  ].join('\n');

  if (tweets.length === 0) {
    return `${frontmatter}\n\nNo tweets found.\n`;
  }

  const body = tweets.map(t => {
    const lines: string[] = [];
    lines.push(`[${formatDate(t.createdAt)}] @${t.username}`);
    lines.push(t.content);

    if (t.quotedContent) {
      const author = t.quotedAuthor ? `@${t.quotedAuthor}` : 'unknown';
      lines.push('');
      lines.push(`> QT ${author}:`);
      for (const line of t.quotedContent.split('\n')) {
        lines.push(`> ${line}`);
      }
    }

    if (t.retweetedContent) {
      const author = t.retweetedAuthor ? `@${t.retweetedAuthor}` : 'unknown';
      lines.push('');
      lines.push(`> RT ${author}:`);
      for (const line of t.retweetedContent.split('\n')) {
        lines.push(`> ${line}`);
      }
    }

    return lines.join('\n');
  }).join('\n\n---\n\n');

  return `${frontmatter}\n\n${body}\n`;
}

function writeOutput(user: string, content: string): string {
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  const today = new Date().toISOString().split('T')[0];
  const path = join(OUTPUT_DIR, `${user}-${today}.md`);
  writeFileSync(path, content, 'utf-8');
  return path;
}

// --- Main ---

async function main() {
  const config = loadConfig();
  log.start(`User Crawl: ${config.users.length} user(s), ${config.keywords.length} keyword(s)`);
  log.info(`Keywords: ${config.keywords.join(', ')}`);
  log.info(`Date range: ${config.startDate} ~ ${config.endDate}`);

  const apiKey = process.env.RETTIWT_API_KEY;
  if (!apiKey) {
    log.fatal('RETTIWT_API_KEY not found in .env');
    process.exit(1);
  }

  const rettiwt = new Rettiwt({ apiKey });
  const crawlTime = new Date().toISOString();

  for (const user of config.users) {
    log.start(`\nCrawling @${user}...`);
    const tweets = await crawlUser(rettiwt, user, config);
    const md = generateMarkdown(tweets, user, config, crawlTime);
    const outPath = writeOutput(user, md);

    const size = Buffer.byteLength(md, 'utf-8');
    const sizeStr = size < 1024 ? `${size}B` : `${(size / 1024).toFixed(1)}KB`;
    log.success(`@${user}: ${tweets.length} tweets → ${outPath} (${sizeStr})`);
  }

  log.success('Done.');
}

main().catch((e) => { log.fatal(e); process.exit(1); });
