import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { log } from './logger';

// --- Types ---

export interface Frontmatter {
  platform: string;
  crawlTime: string;
  postCount: number;
  stoppedReason: string;
  [key: string]: string | number;
}

export interface Post {
  heading: string;       // e.g. "## Post 1"
  author: string;
  url: string;
  date?: string;
  subject?: string;      // Gmail
  from?: string;         // Gmail
  content: string;       // Everything after metadata lines
  extra: string;         // Quoted/Retweeted sections for Twitter
}

export interface ParsedFile {
  frontmatter: Frontmatter;
  title: string;         // e.g. "# Facebook Favorites Crawl"
  posts: Post[];
  raw: string;
}

// --- Constants ---

const RAW_DIR = './data/raw';
const LEAN_DIR = './data/lean';

// --- URL Cleaning ---

export function cleanFacebookUrl(url: string): string {
  if (!url || url === 'N/A') return url;
  try {
    const u = new URL(url);
    // Remove Facebook tracking parameters
    u.searchParams.delete('__cft__[0]');
    u.searchParams.delete('__tn__');
    // If no params left, return clean URL
    if ([...u.searchParams].length === 0) {
      return `${u.origin}${u.pathname}`;
    }
    return u.toString();
  } catch {
    // Fallback: strip query params with regex
    return url.replace(/\?__cft__\[0\]=.*$/, '');
  }
}

export function cleanGmailContent(content: string): string {
  // Remove markdown images: ![alt](url)
  let cleaned = content.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
  // Remove standalone image-link combos: [![...](...)(...)](...)
  cleaned = cleaned.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '');
  // Remove tracking links that wrap just icons/images (empty text links)
  cleaned = cleaned.replace(/\[\s*\]\([^)]+\)/g, '');
  // Remove links that wrap only whitespace/newlines
  cleaned = cleaned.replace(/\[\s*\n*\s*\]\([^)]+\)/g, '');
  // Collapse multiple blank lines into max 2
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  return cleaned.trim();
}

// --- Parsing ---

export function parseFrontmatter(raw: string): { frontmatter: Frontmatter; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error('No frontmatter found');

  const fm: Record<string, string | number> = {};
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: string | number = line.slice(colonIdx + 1).trim();
    // Strip surrounding quotes
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    // Parse numbers
    if (/^\d+$/.test(String(value))) {
      value = parseInt(String(value), 10);
    }
    fm[key] = value;
  }

  return { frontmatter: fm as unknown as Frontmatter, body: match[2] };
}

export function parsePosts(body: string, platform: string): { title: string; posts: Post[] } {
  const lines = body.split('\n');
  let title = '';
  const posts: Post[] = [];

  // Find title (# line)
  const titleIdx = lines.findIndex(l => l.startsWith('# '));
  if (titleIdx !== -1) title = lines[titleIdx];

  // Split by ## Post N or ## Email N
  const postSections = body.split(/(?=^## (?:Post|Email) \d+)/m).filter(s => s.match(/^## (?:Post|Email) \d+/));

  for (const section of postSections) {
    const sLines = section.split('\n');
    const heading = sLines[0];
    let author = '';
    let url = '';
    let date = '';
    let subject = '';
    let from = '';
    let contentStartIdx = 0;

    // Parse metadata lines
    for (let i = 1; i < sLines.length; i++) {
      const line = sLines[i];
      if (line.startsWith('**Author:**')) {
        author = line.replace('**Author:**', '').trim();
      } else if (line.startsWith('**URL:**')) {
        url = line.replace('**URL:**', '').trim();
      } else if (line.startsWith('**Date:**')) {
        date = line.replace('**Date:**', '').trim();
      } else if (line.startsWith('**From:**')) {
        from = line.replace('**From:**', '').trim();
      } else if (line.startsWith('**Subject:**')) {
        subject = line.replace('**Subject:**', '').trim();
      } else if (line === '### Content') {
        contentStartIdx = i + 1;
        break;
      }
    }

    // Everything after ### Content (skip leading blank line)
    let contentLines = sLines.slice(contentStartIdx);
    // Remove leading empty lines
    while (contentLines.length > 0 && contentLines[0].trim() === '') {
      contentLines.shift();
    }

    // For Twitter: split out extra sections (### Quoted Tweet, ### Retweeted Tweet)
    let extra = '';
    const mainContent: string[] = [];
    let inExtra = false;
    for (const cl of contentLines) {
      if (cl.startsWith('### Quoted Tweet') || cl.startsWith('### Retweeted Tweet')) {
        inExtra = true;
      }
      if (inExtra) {
        extra += cl + '\n';
      } else {
        mainContent.push(cl);
      }
    }

    // Trim trailing separator
    let content = mainContent.join('\n').replace(/\n---\s*$/, '').trim();

    posts.push({ heading, author, url, date, subject, from, content, extra: extra.trim() });
  }

  return { title, posts };
}

export function parseMdFile(raw: string): ParsedFile {
  const { frontmatter, body } = parseFrontmatter(raw);
  const { title, posts } = parsePosts(body, frontmatter.platform);
  return { frontmatter, title, posts, raw };
}

// --- Dedup ---

export function dedupPosts(posts: Post[]): Post[] {
  const seen = new Map<string, Post>();
  for (const post of posts) {
    const key = post.content.replace(/\s+/g, '').substring(0, 100);
    if (!key) continue; // skip empty
    const existing = seen.get(key);
    if (!existing || post.content.length > existing.content.length) {
      seen.set(key, post);
    }
  }
  return [...seen.values()];
}

// --- Lean markdown generation ---

export function generateLeanMd(parsed: ParsedFile, sourceFile: string): string {
  const platform = parsed.frontmatter.platform;
  let posts = parsed.posts;

  // Apply platform-specific cleaning
  if (platform === 'facebook') {
    posts = dedupPosts(posts);
    posts = posts.map(p => ({ ...p, url: cleanFacebookUrl(p.url) }));
  } else if (platform === 'gmail') {
    posts = posts.map(p => ({ ...p, content: cleanGmailContent(p.content) }));
  }
  // Twitter: no special cleaning needed (URLs are already short)

  // Build frontmatter
  const fm = [
    '---',
    `platform: ${platform}`,
    `crawlTime: "${parsed.frontmatter.crawlTime}"`,
    `postCount: ${posts.length}`,
    `stoppedReason: "${parsed.frontmatter.stoppedReason}"`,
    `sourceFile: "${sourceFile}"`,
    '---',
  ].join('\n');

  // Build posts
  const postsContent = posts.map((post, i) => {
    const lines: string[] = [];
    lines.push(`## Post ${i + 1}`);

    if (post.author) lines.push(`**Author:** ${post.author}`);
    if (post.from) lines.push(`**From:** ${post.from}`);
    if (post.subject) lines.push(`**Subject:** ${post.subject}`);
    if (post.date) lines.push(`**Date:** ${post.date}`);
    if (post.url && post.url !== 'N/A') lines.push(`**URL:** ${post.url}`);

    lines.push('');
    lines.push(post.content);

    if (post.extra) {
      lines.push('');
      lines.push(post.extra);
    }

    return lines.join('\n');
  }).join('\n\n---\n\n');

  return `${fm}\n\n${parsed.title}\n\n${postsContent}\n`;
}

// --- CLI ---

function getFilesToProcess(): string[] {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    // Process all files in data/raw/
    if (!existsSync(RAW_DIR)) {
      log.fatal(`Directory not found: ${RAW_DIR}`);
      process.exit(1);
    }
    return readdirSync(RAW_DIR)
      .filter(f => f.endsWith('.md') && /^(fb|tweet|gmail)-/.test(f))
      .map(f => join(RAW_DIR, f));
  }

  if (args[0] === '--today') {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const prefix = `${yyyy}-${mm}-${dd}`;
    return readdirSync(RAW_DIR)
      .filter(f => f.endsWith('.md') && f.includes(prefix))
      .map(f => join(RAW_DIR, f));
  }

  // Specific files passed as arguments
  return args.filter(f => existsSync(f));
}

function main() {
  const files = getFilesToProcess();
  if (files.length === 0) {
    log.warn('No files to process.');
    return;
  }

  if (!existsSync(LEAN_DIR)) {
    mkdirSync(LEAN_DIR, { recursive: true });
  }

  log.start(`Processing ${files.length} file(s)...`);

  for (const filePath of files) {
    const fileName = basename(filePath);
    const outPath = join(LEAN_DIR, fileName);

    try {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = parseMdFile(raw);
      const lean = generateLeanMd(parsed, fileName);

      writeFileSync(outPath, lean, 'utf-8');

      const rawSize = Buffer.byteLength(raw, 'utf-8');
      const leanSize = Buffer.byteLength(lean, 'utf-8');
      const reduction = ((1 - leanSize / rawSize) * 100).toFixed(1);
      const dedupInfo = parsed.frontmatter.platform === 'facebook'
        ? ` (dedup: ${parsed.posts.length} → ${lean.match(/^## Post \d+/gm)?.length ?? '?'})`
        : '';

      log.info(`  ${fileName}: ${formatBytes(rawSize)} → ${formatBytes(leanSize)} (-${reduction}%)${dedupInfo}`);
    } catch (err) {
      log.error(`  ${fileName}: ERROR - ${err instanceof Error ? err.message : err}`);
    }
  }

  log.success('Done.');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}KB`;
}

if (import.meta.main) {
  main();
}
