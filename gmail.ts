import { gmail, type gmail_v1 } from '@googleapis/gmail';
import { OAuth2Client } from 'google-auth-library';
import { createServer } from 'http';
import open from 'open';
import TurndownService from 'turndown';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import {
  type GmailEmail,
  type StoppedReason,
  readCrawlState,
  updateGmailState,
  generateOutputPath,
  generateGmailMD,
  writeMDFile,
} from './utils';
import { log } from './logger';

// Configuration (via environment variables)
const AUTH_DIR = process.env.GMAIL_AUTH_DIR ?? './gmail-auth';
const TOKENS_FILE = `${AUTH_DIR}/tokens.json`;
const CONFIG_FILE = process.env.GMAIL_CONFIG_FILE ?? './gmail-config.json';
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const REDIRECT_URI = 'http://localhost:3000/callback';

export interface GmailConfig {
  allowedSenders: string[];
  excludeLabels: string[];
  maxAgeDays: number;
  maxEmails: number;
}

interface Tokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

const DEFAULT_CONFIG: GmailConfig = {
  allowedSenders: [
    'verify@x.com',
  ],
  excludeLabels: ['SPAM', 'TRASH'],
  maxAgeDays: Number(process.env.GMAIL_MAX_AGE_DAYS) || 30,
  maxEmails: Number(process.env.GMAIL_MAX_EMAILS) || 100,
};

// Initialize turndown for HTML to markdown conversion
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

// Remove style, script, and head tags completely
turndown.remove(['style', 'script', 'head', 'meta', 'link', 'noscript']);

// Remove tracking pixels (images with no alt text or data: URLs or tracking URLs)
turndown.addRule('removeTrackingPixels', {
  filter: (node) => {
    if (node.nodeName !== 'IMG') return false;
    const src = node.getAttribute('src') || '';
    const alt = node.getAttribute('alt') || '';
    const width = node.getAttribute('width');
    const height = node.getAttribute('height');

    // Remove 1x1 tracking pixels
    if (width === '1' || height === '1') return true;
    // Remove images with tracking-like URLs
    if (src.includes('/open?token=') || src.includes('track') || src.includes('pixel')) return true;
    // Remove base64 data URIs (often spacer images)
    if (src.startsWith('data:')) return true;

    return false;
  },
  replacement: () => '',
});

// Clean up excessive whitespace in output
turndown.addRule('cleanWhitespace', {
  filter: (node) => {
    // Remove nodes that are just whitespace/invisible characters
    if (node.nodeType === 3) { // Text node
      const text = node.textContent || '';
      // Check for strings that are just zero-width spaces, soft hyphens, etc.
      if (/^[\s\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u2000-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\u3000\uFEFF\uFFA0]+$/.test(text)) {
        return true;
      }
    }
    return false;
  },
  replacement: () => '',
});

function ensureAuthDir(): void {
  if (!existsSync(AUTH_DIR)) {
    mkdirSync(AUTH_DIR, { recursive: true });
  }
}

function getOAuth2Client(): OAuth2Client {
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    log.fatal('GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET must be set in .env');
    process.exit(1);
  }

  return new OAuth2Client(clientId, clientSecret, REDIRECT_URI);
}

function loadTokens(): Tokens | null {
  if (!existsSync(TOKENS_FILE)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(TOKENS_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function saveTokens(tokens: Tokens): void {
  ensureAuthDir();
  writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
}

function loadConfig(): GmailConfig {
  if (!existsSync(CONFIG_FILE)) {
    return DEFAULT_CONFIG;
  }
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_FILE, 'utf-8')) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveDefaultConfig(): void {
  if (!existsSync(CONFIG_FILE)) {
    writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
    log.success(`Created ${CONFIG_FILE} - edit it to add your newsletter senders`);
  }
}

async function performOAuthLogin(): Promise<void> {
  const oauth2Client = getOAuth2Client();

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  log.start('Starting OAuth flow...');
  log.info('Opening browser for Google authorization...');

  return new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url!, `http://localhost:3000`);
        if (url.pathname === '/callback') {
          const code = url.searchParams.get('code');
          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end('<h1>Error: No authorization code received</h1>');
            reject(new Error('No authorization code'));
            return;
          }

          const { tokens } = await oauth2Client.getToken(code);
          saveTokens(tokens as Tokens);
          saveDefaultConfig();

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <h1>Authorization successful!</h1>
            <p>You can close this window and return to the terminal.</p>
          `);

          log.success(`OAuth tokens saved to ${TOKENS_FILE}`);
          server.close();
          resolve();
        }
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end('<h1>Error during authorization</h1>');
        reject(error);
      }
    });

    server.listen(3000, async () => {
      log.info('Callback server listening on http://localhost:3000');
      await open(authUrl);
    });
  });
}

async function getAuthenticatedClient(): Promise<OAuth2Client> {
  const oauth2Client = getOAuth2Client();
  const tokens = loadTokens();

  if (!tokens) {
    log.fatal('No tokens found. Run with --login first.');
    process.exit(1);
  }

  oauth2Client.setCredentials(tokens);

  // Check if token is expired and refresh if needed
  if (tokens.expiry_date && tokens.expiry_date < Date.now()) {
    log.info('Token expired, refreshing...');
    const { credentials } = await oauth2Client.refreshAccessToken();
    saveTokens(credentials as Tokens);
    oauth2Client.setCredentials(credentials);
  }

  return oauth2Client;
}

export function buildSenderQuery(sender: string, config: GmailConfig): string {
  const excludeLabels = config.excludeLabels.map((label) => `-label:${label}`);

  return [
    `from:${sender}`,
    ...excludeLabels,
    `newer_than:${config.maxAgeDays}d`,
  ].join(' ');
}

export function extractHeader(headers: gmail_v1.Schema$MessagePartHeader[], name: string): string {
  const header = headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return header?.value || '';
}

export function decodeBase64Url(data: string): string {
  // Convert base64url to regular base64
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64').toString('utf-8');
}

export function cleanMarkdown(md: string): string {
  return md
    // Remove lines that are just invisible characters
    .replace(/^[\s\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u2000-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\u3000\uFEFF\uFFA0­ ]+$/gm, '')
    // Collapse multiple blank lines into max 2
    .replace(/\n{3,}/g, '\n\n')
    // Remove leading/trailing whitespace
    .trim();
}

function extractContent(payload: gmail_v1.Schema$MessagePart): string {
  // First, try to find text/plain
  const plainText = findMimePart(payload, 'text/plain');
  if (plainText?.body?.data) {
    return cleanMarkdown(decodeBase64Url(plainText.body.data));
  }

  // Fallback to text/html and convert to markdown
  const htmlPart = findMimePart(payload, 'text/html');
  if (htmlPart?.body?.data) {
    const html = decodeBase64Url(htmlPart.body.data);
    return cleanMarkdown(turndown.turndown(html));
  }

  // If no content found in parts, check body directly
  if (payload.body?.data) {
    const content = decodeBase64Url(payload.body.data);
    if (payload.mimeType === 'text/html') {
      return cleanMarkdown(turndown.turndown(content));
    }
    return cleanMarkdown(content);
  }

  return '[No content found]';
}

function findMimePart(
  part: gmail_v1.Schema$MessagePart,
  mimeType: string
): gmail_v1.Schema$MessagePart | null {
  if (part.mimeType === mimeType) {
    return part;
  }

  if (part.parts) {
    for (const subpart of part.parts) {
      const found = findMimePart(subpart, mimeType);
      if (found) return found;
    }
  }

  return null;
}

async function fetchEmail(
  gmailClient: gmail_v1.Gmail,
  messageId: string
): Promise<GmailEmail> {
  const fullMessage = await gmailClient.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  const headers = fullMessage.data.payload?.headers || [];
  return {
    id: messageId,
    threadId: fullMessage.data.threadId || '',
    date: extractHeader(headers, 'Date'),
    from: extractHeader(headers, 'From'),
    subject: extractHeader(headers, 'Subject'),
    content: extractContent(fullMessage.data.payload!),
    labels: fullMessage.data.labelIds || [],
  };
}

async function crawlSender(
  gmailClient: gmail_v1.Gmail,
  sender: string,
  seenIds: string[],
  config: GmailConfig
): Promise<{ emails: GmailEmail[]; stoppedReason: StoppedReason }> {
  const seenSet = new Set(seenIds);
  const emails: GmailEmail[] = [];

  const query = buildSenderQuery(sender, config);
  log.debug(`  Query: ${query}`);

  let pageToken: string | undefined;
  let stoppedReason: StoppedReason = 'query_exhausted';

  while (emails.length < config.maxEmails) {
    const response = await gmailClient.users.messages.list({
      userId: 'me',
      q: query,
      maxResults: 20,
      pageToken,
    });

    const messages = response.data.messages || [];
    if (messages.length === 0) break;

    for (const msg of messages) {
      if (!msg.id) continue;

      // Stop when we hit a seen email for this sender
      if (seenSet.has(msg.id)) {
        log.info(`  Reached seen email for ${sender}, stopping.`);
        stoppedReason = 'reached_previous';
        return { emails, stoppedReason };
      }

      // Fetch and process email
      const email = await fetchEmail(gmailClient, msg.id);
      emails.push(email);
      log.info(`    [${emails.length}] ${email.subject.substring(0, 50)}...`);

      if (emails.length >= config.maxEmails) {
        stoppedReason = 'scroll_limit';
        return { emails, stoppedReason };
      }
    }

    pageToken = response.data.nextPageToken || undefined;
    if (!pageToken) break;
  }

  return { emails, stoppedReason };
}

async function crawlNewsletters(): Promise<void> {
  const config = loadConfig();
  const auth = await getAuthenticatedClient();
  const gmailClient = gmail({ version: 'v1', auth });
  const state = readCrawlState();

  // Ensure seenIdsBySender exists (handle legacy state)
  const seenIdsBySender = state.gmail.seenIdsBySender || {};

  const allEmails: GmailEmail[] = [];
  const emailsBySender = new Map<string, GmailEmail[]>();
  let finalStoppedReason: StoppedReason = 'query_exhausted';

  // Crawl each sender independently
  for (const sender of config.allowedSenders) {
    log.start(`Crawling sender: ${sender}`);

    // Normalize sender for lookup (use config pattern as key)
    const normalizedSender = sender.toLowerCase();
    const senderSeenIds = seenIdsBySender[normalizedSender] || [];

    try {
      const { emails, stoppedReason } = await crawlSender(
        gmailClient,
        sender,
        senderSeenIds,
        config
      );

      log.info(`  Found ${emails.length} new emails from ${sender}`);
      allEmails.push(...emails);
      emailsBySender.set(sender, emails);

      // Track if any sender hit a limit
      if (stoppedReason === 'scroll_limit') {
        finalStoppedReason = 'scroll_limit';
      }
    } catch (error) {
      log.error(`  Error crawling ${sender}:`, error);
    }
  }

  log.success(`Total crawled: ${allEmails.length} emails`);

  if (allEmails.length > 0) {
    // Update state with new email IDs (per sender pattern)
    updateGmailState(emailsBySender);

    // Generate and save markdown
    const crawlTime = new Date().toISOString();
    const md = generateGmailMD(allEmails, { crawlTime, stoppedReason: finalStoppedReason });
    const outputPath = generateOutputPath('gmail');
    writeMDFile(outputPath, md);
  } else {
    log.warn('No new emails to save.');
  }

  log.info(`Stopped reason: ${finalStoppedReason}`);
}

// Main
if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args.includes('--login')) {
    performOAuthLogin()
      .then(() => {
        log.success('Login complete! You can now run: bun gmail.ts');
        process.exit(0);
      })
      .catch((error) => {
        log.fatal('Login failed:', error);
        process.exit(1);
      });
  } else {
    crawlNewsletters()
      .then(() => process.exit(0))
      .catch((error) => {
        log.fatal('Crawl failed:', error);
        process.exit(1);
      });
  }
}
