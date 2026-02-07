import { describe, expect, test } from 'bun:test';
import {
  cleanFacebookUrl,
  cleanGmailContent,
  parseFrontmatter,
  parsePosts,
  parseMdFile,
  dedupPosts,
  generateLeanMd,
  formatBytes,
  type Post,
  type ParsedFile,
} from './lean';

// --- cleanFacebookUrl ---

describe('cleanFacebookUrl', () => {
  test('strips __cft__ and __tn__ tracking params', () => {
    const dirty =
      'https://www.facebook.com/intleconobserve/posts/pfbid02FAxx?__cft__[0]=AZZwr9eN9j4&__tn__=%2CP-R';
    expect(cleanFacebookUrl(dirty)).toBe(
      'https://www.facebook.com/intleconobserve/posts/pfbid02FAxx',
    );
  });

  test('returns N/A as-is', () => {
    expect(cleanFacebookUrl('N/A')).toBe('N/A');
  });

  test('leaves clean URLs untouched', () => {
    const clean = 'https://www.facebook.com/photo?fbid=123';
    // fbid is not a tracking param, so the full URL should be preserved
    expect(cleanFacebookUrl(clean)).toBe(clean);
  });
});

// --- cleanGmailContent ---

describe('cleanGmailContent', () => {
  test('removes markdown images', () => {
    const input = 'Hello\n\n![alt text](https://example.com/img.png)\n\nWorld';
    expect(cleanGmailContent(input)).toBe('Hello\n\nWorld');
  });

  test('removes empty tracking links', () => {
    const input = 'Before\n[](https://tracking.example.com/click)\nAfter';
    expect(cleanGmailContent(input)).toBe('Before\n\nAfter');
  });

  test('collapses multiple blank lines to max 2', () => {
    const input = 'Line 1\n\n\n\n\nLine 2';
    expect(cleanGmailContent(input)).toBe('Line 1\n\nLine 2');
  });
});

// --- parseFrontmatter ---

describe('parseFrontmatter', () => {
  test('parses valid frontmatter', () => {
    const raw = `---
platform: facebook
crawlTime: "2026-01-26T14:17:11.802Z"
postCount: 87
stoppedReason: "reached_previous"
---

# Facebook Favorites Crawl`;

    const { frontmatter, body } = parseFrontmatter(raw);
    expect(frontmatter.platform).toBe('facebook');
    expect(frontmatter.postCount).toBe(87);
    expect(frontmatter.crawlTime).toBe('2026-01-26T14:17:11.802Z');
    expect(frontmatter.stoppedReason).toBe('reached_previous');
    expect(body).toContain('# Facebook Favorites Crawl');
  });

  test('throws on missing frontmatter', () => {
    expect(() => parseFrontmatter('no frontmatter here')).toThrow(
      'No frontmatter found',
    );
  });
});

// --- parsePosts ---

describe('parsePosts', () => {
  test('parses Facebook posts', () => {
    const body = `
# Facebook Favorites Crawl

## Post 1

**Author:** IEObserve 國際經濟觀察
**URL:** https://www.facebook.com/intleconobserve/posts/pfbid02FAxx

### Content

親兒子～！黃爸爸又來給零用錢花了
Nvidia注資20億買CoreWeave股票

---`;

    const { title, posts } = parsePosts(body, 'facebook');
    expect(title).toBe('# Facebook Favorites Crawl');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.author).toBe('IEObserve 國際經濟觀察');
    expect(posts[0]!.url).toContain('facebook.com');
    expect(posts[0]!.content).toContain('Nvidia注資20億');
  });

  test('parses Twitter posts with quoted tweet', () => {
    const body = `
# Twitter List Crawl

## Post 1

**Author:** vivienna.btc (@viviennaBTC)
**Date:** 2026-01-26T09:46:20.000Z
**URL:** https://x.com/viviennaBTC/status/123

### Content

学习了

### Quoted Tweet

给最近炒有色金属的朋友们分享一个指标

---`;

    const { posts } = parsePosts(body, 'twitter');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.content).toBe('学习了');
    expect(posts[0]!.extra).toContain('Quoted Tweet');
    expect(posts[0]!.extra).toContain('有色金属');
  });

  test('parses Gmail emails', () => {
    const body = `
# Gmail Newsletter Crawl

## Email 1

**From:** Substack <no-reply@substack.com>
**Subject:** Katie posted new notes
**Date:** Sat, 24 Jan 2026 23:41:20 +0000

### Content

Email from Substack

Katie posted new notes

---`;

    const { posts } = parsePosts(body, 'gmail');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.from).toBe('Substack <no-reply@substack.com>');
    expect(posts[0]!.subject).toBe('Katie posted new notes');
    expect(posts[0]!.content).toContain('Email from Substack');
  });
});

// --- dedupPosts ---

describe('dedupPosts', () => {
  test('keeps longer version when content prefix matches', () => {
    // dedup key = content.replace(/\s+/g, '').substring(0, 100)
    // Both posts share the same first 100 whitespace-stripped chars
    const prefix = 'A'.repeat(100);
    const short: Post = {
      heading: '## Post 1',
      author: 'A',
      url: '',
      content: prefix,
      extra: '',
    };
    const long: Post = {
      heading: '## Post 2',
      author: 'A',
      url: '',
      content: prefix + ' plus extra content that makes this longer',
      extra: '',
    };
    const result = dedupPosts([short, long]);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toContain('plus extra content');
  });

  test('keeps all posts when content differs', () => {
    const a: Post = {
      heading: '## Post 1',
      author: 'A',
      url: '',
      content: '完全不同的內容 A',
      extra: '',
    };
    const b: Post = {
      heading: '## Post 2',
      author: 'B',
      url: '',
      content: '完全不同的內容 B',
      extra: '',
    };
    expect(dedupPosts([a, b])).toHaveLength(2);
  });
});

// --- generateLeanMd ---

describe('generateLeanMd', () => {
  test('generates lean markdown for Facebook with sourceFile and no ### Content', () => {
    const parsed: ParsedFile = {
      frontmatter: {
        platform: 'facebook',
        crawlTime: '2026-01-26T14:17:11.802Z',
        postCount: 2,
        stoppedReason: 'reached_previous',
      },
      title: '# Facebook Favorites Crawl',
      posts: [
        {
          heading: '## Post 1',
          author: 'Author A',
          url: 'https://www.facebook.com/post/1?__cft__[0]=tracking&__tn__=R',
          content: '內容 A',
          extra: '',
        },
        {
          heading: '## Post 2',
          author: 'Author A',
          url: 'N/A',
          content: '內容 B',
          extra: '',
        },
      ],
      raw: '',
    };

    const result = generateLeanMd(parsed, 'fb-2026-01-26-221711.md');
    expect(result).toContain('sourceFile: "fb-2026-01-26-221711.md"');
    expect(result).not.toContain('### Content');
    // Facebook URL should be cleaned
    expect(result).not.toContain('__cft__');
    // N/A URLs should be omitted
    expect(result).not.toContain('N/A');
    // postCount in frontmatter should reflect actual post count
    expect(result).toContain('postCount: 2');
  });

  test('generates lean markdown for Gmail with cleaned content', () => {
    const parsed: ParsedFile = {
      frontmatter: {
        platform: 'gmail',
        crawlTime: '2026-01-26T14:18:11.724Z',
        postCount: 1,
        stoppedReason: 'query_exhausted',
      },
      title: '# Gmail Newsletter Crawl',
      posts: [
        {
          heading: '## Email 1',
          from: 'Substack <no-reply@substack.com>',
          subject: 'New notes',
          author: '',
          url: '',
          content:
            'Hello\n\n![image](https://example.com/img.png)\n\n[](https://tracking.link)\n\nReal content here',
          extra: '',
        },
      ],
      raw: '',
    };

    const result = generateLeanMd(parsed, 'gmail-2026-01-26-221811.md');
    expect(result).not.toContain('![image]');
    expect(result).not.toContain('tracking.link');
    expect(result).toContain('Real content here');
    expect(result).toContain('**From:** Substack');
  });
});

// --- formatBytes ---

describe('formatBytes', () => {
  test('formats bytes under 1024', () => {
    expect(formatBytes(500)).toBe('500B');
  });

  test('formats kilobytes', () => {
    expect(formatBytes(2048)).toBe('2.0KB');
  });
});
