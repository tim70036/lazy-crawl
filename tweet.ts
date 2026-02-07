import { Rettiwt } from 'rettiwt-api';
import {
  readCrawlState,
  updateTwitterState,
  generateOutputPath,
  generateTwitterMD,
  writeMDFile,
  type TwitterPost,
  type StoppedReason,
} from './utils';
import { log } from './logger';

// Configuration (via environment variables)
const LIST_ID = process.env.TWITTER_LIST_ID;
const MAX_PAGES = Number(process.env.TWITTER_MAX_PAGES) || 2;
const TWEETS_PER_PAGE = Number(process.env.TWITTER_TWEETS_PER_PAGE) || 50;

if (!LIST_ID) {
  log.fatal('TWITTER_LIST_ID is required in .env');
  process.exit(1);
}

async function crawl(): Promise<void> {
  const apiKey = process.env.RETTIWT_API_KEY;
  if (!apiKey) {
    log.fatal('RETTIWT_API_KEY not found in .env');
    process.exit(1);
  }

  const rettiwt = new Rettiwt({ apiKey });

  // Read previous crawl state
  const state = readCrawlState();
  const lastSeenId = state.twitter.lastSeenId;

  if (lastSeenId) {
    log.info(`Incremental crawl: will stop at tweet ID ${lastSeenId}`);
  } else {
    log.info('First crawl: no previous state found');
  }

  const posts: TwitterPost[] = [];
  let stoppedReason: StoppedReason = 'scroll_limit'; // Default: hit MAX_PAGES threshold
  let cursor = '';
  let pageCount = 0;

  // Paginate through the list
  while (pageCount < MAX_PAGES) {
    pageCount++;
    log.info(`Fetching page ${pageCount}...`);

    const result = await rettiwt.list.tweets(LIST_ID!, TWEETS_PER_PAGE, cursor);

    if (!result.list || result.list.length === 0) {
      log.warn('No more tweets found.');
      stoppedReason = 'query_exhausted';
      break;
    }

    let foundPrevious = false;

    for (const tweet of result.list) {
      // Check if we've reached a previously seen tweet
      if (lastSeenId && tweet.id === lastSeenId) {
        log.info(`Reached previously seen tweet: ${tweet.id}`);
        stoppedReason = 'reached_previous';
        foundPrevious = true;
        break;
      }

      const post: TwitterPost = {
        id: tweet.id,
        createdAt: tweet.createdAt ? new Date(tweet.createdAt).toISOString() : 'Unknown',
        author: tweet.tweetBy?.fullName || 'Unknown',
        username: tweet.tweetBy?.userName || 'unknown',
        url: tweet.url || `https://twitter.com/i/status/${tweet.id}`,
        content: tweet.fullText || '',
        quotedContent: tweet.quoted?.fullText,
        retweetedContent: tweet.retweetedTweet?.fullText,
      };

      posts.push(post);

      log.info(`Captured tweet ${posts.length}: ${post.author} - ${post.content.substring(0, 30)}...`);
    }

    if (foundPrevious) {
      break;
    }

    // Check if there's a next page
    if (!result.next) {
      log.warn('No more pages available.');
      stoppedReason = 'query_exhausted';
      break;
    }

    cursor = result.next;
  }

  if (posts.length === 0) {
    log.warn('No tweets found.');
  } else {
    log.success(`Total: ${posts.length} tweets (stopped: ${stoppedReason})`);

    // Generate and write MD file
    const crawlTime = new Date().toISOString();
    const mdContent = generateTwitterMD(posts, { crawlTime, stoppedReason });
    const outputPath = generateOutputPath('tweet');
    writeMDFile(outputPath, mdContent);

    // Update state with the first (newest) tweet's ID
    if (posts[0]) {
      updateTwitterState(posts[0].id);
      log.success(`State updated with newest tweet ID: ${posts[0].id}`);
    }
  }
}

crawl().catch((e) => { log.fatal(e); process.exit(1); });
