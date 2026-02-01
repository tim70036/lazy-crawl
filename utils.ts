import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { log } from './logger';

// Types
export interface SeenPost {
  postId: string | null;  // Extracted from URL (pfbid, story_fbid)
  contentHash: string;    // Hash of normalized content
}

export interface CrawlState {
  facebook: {
    lastSeenPosts: SeenPost[];
    lastCrawlTime: string | null;
    // Legacy field for backwards compatibility
    lastSeenUrl?: string | null;
  };
  twitter: { lastSeenId: string | null; lastCrawlTime: string | null };
  gmail: {
    seenIdsBySender: Record<string, string[]>;
    lastCrawlTime: string | null;
  };
}

export interface FacebookPost {
  author: string;
  content: string;
  url: string;
}

export interface TwitterPost {
  id: string;
  createdAt: string;
  author: string;
  username: string;
  url: string;
  content: string;
  quotedContent?: string;
  retweetedContent?: string;
}

export interface GmailEmail {
  id: string;
  threadId: string;
  date: string;
  from: string;
  subject: string;
  content: string;
  labels: string[];
}

export type StoppedReason = 'reached_previous' | 'scroll_limit' | 'api_limit' | 'query_exhausted';

export interface CrawlResult<T> {
  posts: T[];
  stoppedReason: StoppedReason;
}

// Constants (configurable via environment variables)
const STATE_FILE = process.env.CRAWL_STATE_FILE ?? './crawl-state.json';
const OUTPUT_DIR = process.env.CRAWL_OUTPUT_DIR ?? './data/raw';

// State management
const DEFAULT_STATE: CrawlState = {
  facebook: { lastSeenPosts: [], lastCrawlTime: null },
  twitter: { lastSeenId: null, lastCrawlTime: null },
  gmail: { seenIdsBySender: {}, lastCrawlTime: null },
};

export function readCrawlState(): CrawlState {
  if (!existsSync(STATE_FILE)) {
    return { ...DEFAULT_STATE };
  }
  try {
    const data = readFileSync(STATE_FILE, 'utf-8');
    return { ...DEFAULT_STATE, ...JSON.parse(data) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function writeCrawlState(state: CrawlState): void {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// Extract post ID from Facebook URL
export function extractFacebookPostId(url: string): string | null {
  if (!url) return null;

  // Try to extract pfbid
  const pfbidMatch = url.match(/pfbid([a-zA-Z0-9]+)/);
  if (pfbidMatch) return `pfbid${pfbidMatch[1].substring(0, 20)}`; // Truncate for consistency

  // Try to extract story_fbid
  const storyMatch = url.match(/story_fbid=(\d+)/);
  if (storyMatch) return `story_${storyMatch[1]}`;

  // Try to extract /posts/ ID
  const postsMatch = url.match(/\/posts\/(\d+)/);
  if (postsMatch) return `post_${postsMatch[1]}`;

  return null;
}

// Create a simple hash of content for comparison
export function createContentHash(content: string): string {
  const normalized = content
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .substring(0, 150);

  // Simple hash using character codes
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `h${Math.abs(hash).toString(36)}`;
}

// Check if a post was previously seen
export function isPostSeen(
  postId: string | null,
  contentHash: string,
  seenPosts: SeenPost[]
): boolean {
  for (const seen of seenPosts) {
    // Match by post ID if both have valid IDs
    if (postId && seen.postId && postId === seen.postId) {
      return true;
    }
    // Match by content hash
    if (contentHash === seen.contentHash) {
      return true;
    }
  }
  return false;
}

const MAX_SEEN_POSTS = 10; // Track last 10 posts

export function updateFacebookState(posts: Array<{ url: string; content: string }>): void {
  const state = readCrawlState();

  // Create SeenPost entries for new posts
  const newSeenPosts: SeenPost[] = posts.map(post => ({
    postId: extractFacebookPostId(post.url),
    contentHash: createContentHash(post.content),
  }));

  // Merge with existing, keeping most recent at front, limit total
  const merged = [...newSeenPosts, ...state.facebook.lastSeenPosts];
  state.facebook.lastSeenPosts = merged.slice(0, MAX_SEEN_POSTS);
  state.facebook.lastCrawlTime = new Date().toISOString();

  writeCrawlState(state);
}

export function updateTwitterState(id: string): void {
  const state = readCrawlState();
  state.twitter.lastSeenId = id;
  state.twitter.lastCrawlTime = new Date().toISOString();
  writeCrawlState(state);
}

// Timestamp and path generation
export function generateTimestamp(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}-${hh}${min}${ss}`;
}

export function ensureOutputDir(): void {
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

export function generateOutputPath(platform: 'fb' | 'tweet' | 'gmail'): string {
  ensureOutputDir();
  return join(OUTPUT_DIR, `${platform}-${generateTimestamp()}.md`);
}

// Markdown generation
interface FacebookMDMetadata {
  crawlTime: string;
  stoppedReason: StoppedReason;
}

export function generateFacebookMD(posts: FacebookPost[], metadata: FacebookMDMetadata): string {
  const frontmatter = `---
platform: facebook
crawlTime: "${metadata.crawlTime}"
postCount: ${posts.length}
stoppedReason: "${metadata.stoppedReason}"
---`;

  const postsContent = posts
    .map((post, index) => {
      return `## Post ${index + 1}

**Author:** ${post.author}
**URL:** ${post.url || 'N/A'}

### Content

${post.content}`;
    })
    .join('\n\n---\n\n');

  return `${frontmatter}

# Facebook Favorites Crawl

${postsContent}
`;
}

interface TwitterMDMetadata {
  crawlTime: string;
  stoppedReason: StoppedReason;
}

export function generateTwitterMD(posts: TwitterPost[], metadata: TwitterMDMetadata): string {
  const frontmatter = `---
platform: twitter
crawlTime: "${metadata.crawlTime}"
postCount: ${posts.length}
stoppedReason: "${metadata.stoppedReason}"
---`;

  const postsContent = posts
    .map((post, index) => {
      let content = `## Post ${index + 1}

**Author:** ${post.author} (@${post.username})
**Date:** ${post.createdAt}
**URL:** ${post.url}

### Content

${post.content}`;

      if (post.quotedContent) {
        content += `

### Quoted Tweet

${post.quotedContent}`;
      }

      if (post.retweetedContent) {
        content += `

### Retweeted Tweet

${post.retweetedContent}`;
      }

      return content;
    })
    .join('\n\n---\n\n');

  return `${frontmatter}

# Twitter List Crawl

${postsContent}
`;
}

export function writeMDFile(path: string, content: string): void {
  writeFileSync(path, content, 'utf-8');
  log.success(`Output written to: ${path}`);
}

// Gmail state management
const MAX_GMAIL_SEEN_IDS_PER_SENDER = 5;

export function updateGmailState(emailsBySender: Map<string, GmailEmail[]>): void {
  const state = readCrawlState();

  // Ensure seenIdsBySender exists (handle legacy state)
  if (!state.gmail.seenIdsBySender) {
    state.gmail.seenIdsBySender = {};
  }

  // Update seen IDs for each sender pattern (using config pattern as key)
  for (const [senderPattern, emails] of emailsBySender) {
    const normalizedSender = senderPattern.toLowerCase();
    if (!state.gmail.seenIdsBySender[normalizedSender]) {
      state.gmail.seenIdsBySender[normalizedSender] = [];
    }
    const newIds = emails.map((e) => e.id);
    state.gmail.seenIdsBySender[normalizedSender] = [
      ...newIds,
      ...state.gmail.seenIdsBySender[normalizedSender],
    ].slice(0, MAX_GMAIL_SEEN_IDS_PER_SENDER);
  }

  state.gmail.lastCrawlTime = new Date().toISOString();
  writeCrawlState(state);
}

// Gmail markdown generation
interface GmailMDMetadata {
  crawlTime: string;
  stoppedReason: StoppedReason;
}

export function generateGmailMD(emails: GmailEmail[], metadata: GmailMDMetadata): string {
  const frontmatter = `---
platform: gmail
crawlTime: "${metadata.crawlTime}"
postCount: ${emails.length}
stoppedReason: "${metadata.stoppedReason}"
---`;

  const emailsContent = emails
    .map((email, index) => {
      return `## Email ${index + 1}

**From:** ${email.from}
**Subject:** ${email.subject}
**Date:** ${email.date}

### Content

${email.content}`;
    })
    .join('\n\n---\n\n');

  return `${frontmatter}

# Gmail Newsletter Crawl

${emailsContent}
`;
}
