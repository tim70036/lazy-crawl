import { describe, expect, test } from 'bun:test';
import {
  buildSenderQuery,
  extractHeader,
  decodeBase64Url,
  cleanMarkdown,
  type GmailConfig,
} from './gmail';

// --- buildSenderQuery ---

describe('buildSenderQuery', () => {
  const config: GmailConfig = {
    allowedSenders: ['newsletter@example.com'],
    excludeLabels: ['SPAM', 'TRASH'],
    maxAgeDays: 30,
    maxEmails: 100,
  };

  test('builds query with sender, excluded labels, and age', () => {
    const query = buildSenderQuery('newsletter@example.com', config);
    expect(query).toContain('from:newsletter@example.com');
    expect(query).toContain('-label:SPAM');
    expect(query).toContain('-label:TRASH');
    expect(query).toContain('newer_than:30d');
  });

  test('handles empty excludeLabels', () => {
    const noExclude: GmailConfig = { ...config, excludeLabels: [] };
    const query = buildSenderQuery('test@test.com', noExclude);
    expect(query).toBe('from:test@test.com newer_than:30d');
  });

  test('uses custom maxAgeDays', () => {
    const custom: GmailConfig = { ...config, maxAgeDays: 7 };
    const query = buildSenderQuery('x@y.com', custom);
    expect(query).toContain('newer_than:7d');
  });
});

// --- extractHeader ---

describe('extractHeader', () => {
  const headers = [
    { name: 'From', value: 'Substack <no-reply@substack.com>' },
    { name: 'Subject', value: 'New notes posted' },
    { name: 'Date', value: 'Sat, 24 Jan 2026 23:41:20 +0000' },
  ];

  test('extracts existing header (case-insensitive)', () => {
    expect(extractHeader(headers, 'from')).toBe('Substack <no-reply@substack.com>');
    expect(extractHeader(headers, 'FROM')).toBe('Substack <no-reply@substack.com>');
    expect(extractHeader(headers, 'Subject')).toBe('New notes posted');
  });

  test('returns empty string for missing header', () => {
    expect(extractHeader(headers, 'X-Custom')).toBe('');
  });

  test('returns empty string for empty headers array', () => {
    expect(extractHeader([], 'From')).toBe('');
  });
});

// --- decodeBase64Url ---

describe('decodeBase64Url', () => {
  test('decodes standard base64url string', () => {
    // "Hello, World!" in base64url
    const encoded = Buffer.from('Hello, World!').toString('base64url');
    expect(decodeBase64Url(encoded)).toBe('Hello, World!');
  });

  test('handles base64url with - and _ chars', () => {
    // base64url uses - instead of + and _ instead of /
    const text = 'subjects?with+special/chars';
    const encoded = Buffer.from(text).toString('base64url');
    expect(decodeBase64Url(encoded)).toBe(text);
  });

  test('decodes UTF-8 content', () => {
    const text = '你好世界';
    const encoded = Buffer.from(text).toString('base64url');
    expect(decodeBase64Url(encoded)).toBe(text);
  });
});

// --- cleanMarkdown ---

describe('cleanMarkdown', () => {
  test('collapses multiple blank lines to max 2', () => {
    const input = 'Line 1\n\n\n\n\nLine 2';
    expect(cleanMarkdown(input)).toBe('Line 1\n\nLine 2');
  });

  test('trims leading and trailing whitespace', () => {
    const input = '  \n\nHello\n\n  ';
    expect(cleanMarkdown(input)).toBe('Hello');
  });

  test('removes lines with only invisible characters', () => {
    // Zero-width space (U+200B) on its own line
    const input = 'Before\n\u200B\nAfter';
    expect(cleanMarkdown(input)).toBe('Before\n\nAfter');
  });

  test('preserves normal content', () => {
    const input = '# Heading\n\nParagraph with **bold** and [link](url).';
    expect(cleanMarkdown(input)).toBe(input);
  });
});
