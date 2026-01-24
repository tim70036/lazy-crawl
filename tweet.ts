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

const LIST_ID = '2012423364175143267';
const MAX_PAGES = 10; // Maximum number of API pages to fetch
const TWEETS_PER_PAGE = 30;

async function crawl(): Promise<void> {
  const apiKey = process.env.RETTIWT_API_KEY;
  if (!apiKey) {
    console.error('RETTIWT_API_KEY not found in .env');
    process.exit(1);
  }

  const rettiwt = new Rettiwt({ apiKey });

  // Read previous crawl state
  const state = readCrawlState();
  const lastSeenId = state.twitter.lastSeenId;

  if (lastSeenId) {
    console.log(`Incremental crawl: will stop at tweet ID ${lastSeenId}\n`);
  } else {
    console.log('First crawl: no previous state found\n');
  }

  const posts: TwitterPost[] = [];
  let stoppedReason: StoppedReason = 'api_limit';
  let cursor = '';
  let pageCount = 0;

  // Paginate through the list
  while (pageCount < MAX_PAGES) {
    pageCount++;
    console.log(`Fetching page ${pageCount}...`);

    const result = await rettiwt.list.tweets(LIST_ID, TWEETS_PER_PAGE, cursor);

    if (!result.list || result.list.length === 0) {
      console.log('No more tweets found.');
      break;
    }

    let foundPrevious = false;

    for (const tweet of result.list) {
      // Check if we've reached a previously seen tweet
      if (lastSeenId && tweet.id === lastSeenId) {
        console.log(`\nReached previously seen tweet: ${tweet.id}`);
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

      console.log(`Captured tweet ${posts.length}: ${post.author} - ${post.content.substring(0, 30)}...`);
    }

    if (foundPrevious) {
      break;
    }

    // Check if there's a next page
    if (!result.next) {
      console.log('No more pages available.');
      break;
    }

    cursor = result.next;
  }

  console.log('\n--- Results ---');
  if (posts.length === 0) {
    console.log('No tweets found.');
  } else {
    for (const post of posts) {
      console.log('---');
      console.log(`${post.createdAt} - ${post.id}`);
      console.log(`${post.author} - @${post.username}`);
      console.log(`URL: ${post.url}`);

      if (post.quotedContent) {
        console.log('Quoted tweet:');
        console.log(post.quotedContent);
      }

      if (post.retweetedContent) {
        console.log('Retweeted tweet:');
        console.log(post.retweetedContent);
      }

      console.log('Tweet:');
      console.log(post.content);
      console.log('--------------------------------');
    }

    console.log(`Total: ${posts.length} tweets`);
    console.log(`Stopped reason: ${stoppedReason}`);

    // Generate and write MD file
    const crawlTime = new Date().toISOString();
    const mdContent = generateTwitterMD(posts, { crawlTime, stoppedReason });
    const outputPath = generateOutputPath('tweet');
    writeMDFile(outputPath, mdContent);

    // Update state with the first (newest) tweet's ID
    if (posts[0]) {
      updateTwitterState(posts[0].id);
      console.log(`State updated with newest tweet ID: ${posts[0].id}`);
    }
  }
}

crawl().catch(console.error);
