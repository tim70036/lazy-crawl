import { chromium, type Page } from 'playwright';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  readCrawlState,
  updateFacebookState,
  generateOutputPath,
  generateFacebookMD,
  writeMDFile,
  extractFacebookPostId,
  createContentHash,
  isPostSeen,
  type FacebookPost,
  type CrawlResult,
  type StoppedReason,
  type SeenPost,
} from './utils';

const AUTH_DIR = './fb-auth';
const STATE_FILE = join(AUTH_DIR, 'state.json');
const FAVORITES_URL = 'https://www.facebook.com/?filter=favorites&sk=h_chr';

// Re-export for backwards compatibility
type Post = FacebookPost;

async function ensureAuthDir(): Promise<void> {
  if (!existsSync(AUTH_DIR)) {
    mkdirSync(AUTH_DIR, { recursive: true });
  }
}

async function login(): Promise<void> {
  console.log('Opening browser for manual login...');
  console.log('Please log in to Facebook manually.');
  console.log('After logging in, press Enter in this terminal to save the session.\n');

  await ensureAuthDir();

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://www.facebook.com/');

  // Wait for user to complete login
  console.log('Waiting for you to log in...');
  console.log('Press Enter when you have successfully logged in.');

  // Read from stdin to wait for user confirmation
  const reader = Bun.stdin.stream().getReader();
  await reader.read();
  reader.releaseLock();

  // Save the session state
  await context.storageState({ path: STATE_FILE });
  console.log(`\nSession saved to ${STATE_FILE}`);

  await browser.close();
  console.log('Browser closed. You can now run: bun run fb.ts');
}

async function extractPosts(page: Page, seenPosts: SeenPost[]): Promise<CrawlResult<Post>> {
  const posts: Post[] = [];
  const seenContent = new Set<string>();
  let stoppedReason: StoppedReason = 'scroll_limit';

  await page.waitForSelector('[data-ad-rendering-role="story_message"]', { timeout: 10000 }).catch(() => {});

  const scrollCount = 10;

  outerLoop:
  for (let scroll = 0; scroll < scrollCount; scroll++) {
    // Click "Show more" buttons currently visible
    const showMoreButtons = await page.$$('[role="button"]:has-text("查看更多"), [role="button"]:has-text("See more")');
    for (const btn of showMoreButtons) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(100);
    }

    await page.waitForTimeout(500);

    const storyMessages = await page.$$('[data-ad-rendering-role="story_message"]');

    for (const storyEl of storyMessages) {
      try {
        const content = await storyEl.innerText().catch(() => '');
        const cleanContent = content.replace(/查看更多|See more|顯示更多/g, '').trim();

        if (!cleanContent) continue;

        const contentKey = cleanContent.substring(0, 100);
        if (seenContent.has(contentKey)) continue;
        seenContent.add(contentKey);

        const container = await storyEl.evaluateHandle((el) => {
          let parent = el.parentElement;
          for (let i = 0; i < 10 && parent; i++) {
            if (parent.querySelector('[data-ad-rendering-role="profile_name"]')) return parent;
            parent = parent.parentElement;
          }
          return null;
        });

        let author = 'Unknown';
        let url = '';
        if (container.asElement()) {
          const authorEl = await container.asElement()!.$('[data-ad-rendering-role="profile_name"] span span');
          if (authorEl) author = await authorEl.innerText().catch(() => 'Unknown');

          // Extract post URL from timestamp link (links containing /posts/, story_fbid, or pfbid)
          const urlEl = await container.asElement()!.$('a[href*="/posts/"], a[href*="story_fbid"], a[href*="pfbid"]');
          if (urlEl) {
            const href = await urlEl.getAttribute('href').catch(() => '');
            if (href) {
              url = href.startsWith('http') ? href : `https://www.facebook.com${href}`;
            }
          }
        }

        // Check if we've reached a previously seen post using multi-post matching
        const postId = extractFacebookPostId(url);
        const contentHash = createContentHash(cleanContent);
        
        if (seenPosts.length > 0 && isPostSeen(postId, contentHash, seenPosts)) {
          const matchType = postId ? `post ID: ${postId}` : `content hash: ${contentHash}`;
          console.log(`\nReached previously seen post (${matchType})`);
          stoppedReason = 'reached_previous';
          break outerLoop;
        }

        posts.push({
          author: author.trim(),
          content: cleanContent.substring(0, 500),
          url
        });

        console.log(`Captured post ${posts.length}: ${author} - ${cleanContent.substring(0, 30)}...`);
      } catch {
        continue;
      }
    }

    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.7));
    await page.waitForTimeout(1000);
  }

  return { posts, stoppedReason };
}

async function crawl(): Promise<void> {
  if (!existsSync(STATE_FILE)) {
    console.error('No saved session. Run: bun run fb.ts --login');
    process.exit(1);
  }

  // Read previous crawl state
  const state = readCrawlState();
  const seenPosts = state.facebook.lastSeenPosts || [];

  if (seenPosts.length > 0) {
    console.log(`Incremental crawl: tracking ${seenPosts.length} previously seen posts\n`);
  } else {
    console.log('First crawl: no previous state found\n');
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: STATE_FILE });
  const page = await context.newPage();

  console.log('Navigating to Facebook favorites...');
  await page.goto(FAVORITES_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  if (page.url().includes('/login') || page.url().includes('checkpoint')) {
    console.error('Session expired. Run: bun run fb.ts --login');
    process.exit(1);
  }

  await page.waitForTimeout(2000);

  console.log('Scrolling and capturing posts...\n');
  const { posts, stoppedReason } = await extractPosts(page, seenPosts);

  console.log('\n--- Results ---');
  if (posts.length === 0) {
    console.log('No posts found.');
  } else {
    for (const post of posts) {
      console.log('---');
      console.log(`Author: ${post.author}`);
      console.log(`URL: ${post.url || 'N/A'}`);
      console.log(`Content: ${post.content}\n`);
    }
    console.log(`Total: ${posts.length} posts`);
    console.log(`Stopped reason: ${stoppedReason}`);

    // Generate and write MD file
    const crawlTime = new Date().toISOString();
    const mdContent = generateFacebookMD(posts, { crawlTime, stoppedReason });
    const outputPath = generateOutputPath('fb');
    writeMDFile(outputPath, mdContent);

    // Update state with all captured posts
    updateFacebookState(posts.map(p => ({ url: p.url, content: p.content })));
    console.log(`State updated with ${posts.length} new posts`);
  }

  await browser.close();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--login')) {
    await login();
  } else {
    await crawl();
  }
}

main().catch(console.error);
