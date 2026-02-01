import { describe, expect, test } from 'bun:test';
import {
  extractFacebookPostId,
  createContentHash,
  isPostSeen,
  generateFacebookMD,
  generateTwitterMD,
  generateGmailMD,
  type SeenPost,
  type FacebookPost,
  type TwitterPost,
  type GmailEmail,
} from './utils';

// --- extractFacebookPostId ---

describe('extractFacebookPostId', () => {
  test('extracts pfbid from URL', () => {
    const url = 'https://www.facebook.com/intleconobserve/posts/pfbid02FAxxSwssmbdoQJvaAwMYUR1fUqhT3DcVxXiDTcqfkz1MWvtqinrWZfA5atPwzXrvl';
    const id = extractFacebookPostId(url);
    expect(id).toStartWith('pfbid');
  });

  test('extracts story_fbid from URL', () => {
    const url = 'https://www.facebook.com/permalink.php?story_fbid=123456789&id=987';
    expect(extractFacebookPostId(url)).toBe('story_123456789');
  });

  test('extracts /posts/ numeric ID', () => {
    const url = 'https://www.facebook.com/someone/posts/123456789';
    expect(extractFacebookPostId(url)).toBe('post_123456789');
  });

  test('returns null for empty URL', () => {
    expect(extractFacebookPostId('')).toBeNull();
  });

  test('returns null for unrecognized URL', () => {
    expect(extractFacebookPostId('https://www.facebook.com/photo')).toBeNull();
  });
});

// --- createContentHash ---

describe('createContentHash', () => {
  test('returns consistent hash for same content', () => {
    const hash1 = createContentHash('Hello world');
    const hash2 = createContentHash('Hello world');
    expect(hash1).toBe(hash2);
  });

  test('normalizes whitespace before hashing', () => {
    const hash1 = createContentHash('Hello   world');
    const hash2 = createContentHash('Hello world');
    expect(hash1).toBe(hash2);
  });

  test('is case-insensitive', () => {
    const hash1 = createContentHash('Hello World');
    const hash2 = createContentHash('hello world');
    expect(hash1).toBe(hash2);
  });

  test('returns different hash for different content', () => {
    const hash1 = createContentHash('Content A');
    const hash2 = createContentHash('Content B');
    expect(hash1).not.toBe(hash2);
  });

  test('hash starts with h prefix', () => {
    expect(createContentHash('test')).toMatch(/^h[a-z0-9]+$/);
  });
});

// --- isPostSeen ---

describe('isPostSeen', () => {
  const seenPosts: SeenPost[] = [
    { postId: 'pfbid02FAxx', contentHash: 'habc123' },
    { postId: null, contentHash: 'hdef456' },
  ];

  test('matches by postId', () => {
    expect(isPostSeen('pfbid02FAxx', 'hunrelated', seenPosts)).toBe(true);
  });

  test('matches by contentHash when postId is null', () => {
    expect(isPostSeen(null, 'hdef456', seenPosts)).toBe(true);
  });

  test('returns false when nothing matches', () => {
    expect(isPostSeen('pfbidOther', 'hxyz789', seenPosts)).toBe(false);
  });

  test('returns false for empty seenPosts', () => {
    expect(isPostSeen('pfbid02FAxx', 'habc123', [])).toBe(false);
  });
});

// --- generateFacebookMD ---

describe('generateFacebookMD', () => {
  test('generates valid markdown with frontmatter', () => {
    const posts: FacebookPost[] = [
      { author: 'Test Author', content: 'Hello Facebook', url: 'https://fb.com/post/1' },
      { author: 'Author 2', content: 'Second post', url: '' },
    ];

    const md = generateFacebookMD(posts, {
      crawlTime: '2026-01-26T14:17:11.802Z',
      stoppedReason: 'reached_previous',
    });

    expect(md).toContain('platform: facebook');
    expect(md).toContain('postCount: 2');
    expect(md).toContain('stoppedReason: "reached_previous"');
    expect(md).toContain('# Facebook Favorites Crawl');
    expect(md).toContain('**Author:** Test Author');
    expect(md).toContain('Hello Facebook');
    expect(md).toContain('**URL:** N/A'); // empty URL becomes N/A
  });

  test('handles empty posts array', () => {
    const md = generateFacebookMD([], {
      crawlTime: '2026-01-26T00:00:00.000Z',
      stoppedReason: 'scroll_limit',
    });

    expect(md).toContain('postCount: 0');
    expect(md).toContain('# Facebook Favorites Crawl');
  });
});

// --- generateTwitterMD ---

describe('generateTwitterMD', () => {
  test('generates valid markdown with quoted tweet', () => {
    const posts: TwitterPost[] = [
      {
        id: '123',
        createdAt: '2026-01-26T09:46:20.000Z',
        author: 'Test User',
        username: 'testuser',
        url: 'https://x.com/testuser/status/123',
        content: 'Main tweet content',
        quotedContent: 'This is a quoted tweet',
      },
    ];

    const md = generateTwitterMD(posts, {
      crawlTime: '2026-01-26T14:15:18.111Z',
      stoppedReason: 'reached_previous',
    });

    expect(md).toContain('platform: twitter');
    expect(md).toContain('postCount: 1');
    expect(md).toContain('**Author:** Test User (@testuser)');
    expect(md).toContain('Main tweet content');
    expect(md).toContain('### Quoted Tweet');
    expect(md).toContain('This is a quoted tweet');
  });

  test('generates markdown with retweeted tweet', () => {
    const posts: TwitterPost[] = [
      {
        id: '456',
        createdAt: '2026-01-26T04:30:08.000Z',
        author: 'Retweeter',
        username: 'retweeter',
        url: 'https://x.com/retweeter/status/456',
        content: 'RT comment',
        retweetedContent: 'Original tweet content',
      },
    ];

    const md = generateTwitterMD(posts, {
      crawlTime: '2026-01-26T14:15:18.111Z',
      stoppedReason: 'query_exhausted',
    });

    expect(md).toContain('### Retweeted Tweet');
    expect(md).toContain('Original tweet content');
  });

  test('omits quoted/retweeted sections when absent', () => {
    const posts: TwitterPost[] = [
      {
        id: '789',
        createdAt: '2026-01-26T00:00:00.000Z',
        author: 'Plain',
        username: 'plain',
        url: 'https://x.com/plain/status/789',
        content: 'Just a plain tweet',
      },
    ];

    const md = generateTwitterMD(posts, {
      crawlTime: '2026-01-26T00:00:00.000Z',
      stoppedReason: 'scroll_limit',
    });

    expect(md).not.toContain('### Quoted Tweet');
    expect(md).not.toContain('### Retweeted Tweet');
  });
});

// --- generateGmailMD ---

describe('generateGmailMD', () => {
  test('generates valid markdown with email metadata', () => {
    const emails: GmailEmail[] = [
      {
        id: 'msg1',
        threadId: 'thread1',
        date: 'Sat, 24 Jan 2026 23:41:20 +0000',
        from: 'Substack <no-reply@substack.com>',
        subject: 'Katie posted new notes',
        content: 'Email body content here',
        labels: ['INBOX'],
      },
    ];

    const md = generateGmailMD(emails, {
      crawlTime: '2026-01-26T14:18:11.724Z',
      stoppedReason: 'query_exhausted',
    });

    expect(md).toContain('platform: gmail');
    expect(md).toContain('postCount: 1');
    expect(md).toContain('# Gmail Newsletter Crawl');
    expect(md).toContain('## Email 1');
    expect(md).toContain('**From:** Substack <no-reply@substack.com>');
    expect(md).toContain('**Subject:** Katie posted new notes');
    expect(md).toContain('Email body content here');
  });

  test('generates multiple emails with separators', () => {
    const emails: GmailEmail[] = [
      {
        id: 'msg1', threadId: 't1', date: 'Mon, 1 Jan 2026',
        from: 'a@test.com', subject: 'First', content: 'Content 1', labels: [],
      },
      {
        id: 'msg2', threadId: 't2', date: 'Tue, 2 Jan 2026',
        from: 'b@test.com', subject: 'Second', content: 'Content 2', labels: [],
      },
    ];

    const md = generateGmailMD(emails, {
      crawlTime: '2026-01-26T00:00:00.000Z',
      stoppedReason: 'reached_previous',
    });

    expect(md).toContain('postCount: 2');
    expect(md).toContain('## Email 1');
    expect(md).toContain('## Email 2');
    expect(md).toContain('---'); // separator between emails
  });
});
