import { Rettiwt } from 'rettiwt-api';

const apiKey = process.env.RETTIWT_API_KEY;
if (!apiKey) {
  console.error('RETTIWT_API_KEY not found in .env');
  process.exit(1);
}

const rettiwt = new Rettiwt({ apiKey });

const listId = '2012423364175143267'
// Fetching the details of the user whose username is <username>
const result = await rettiwt.list.tweets(listId, 3, '')

for (const tweet of result.list) {

    console.log(`${tweet.createdAt} - ${tweet.id}`);
    console.log(`${tweet.tweetBy.fullName} - ${tweet.tweetBy.userName}`);

    if (tweet.quoted) {
        console.log('Quoted tweet:');
        console.log(tweet.quoted.fullText);
    }

    if (tweet.retweetedTweet) {
        console.log('Retweeted tweet:');
        console.log(tweet.retweetedTweet.fullText);
    }

    console.log('Tweet:');
    console.log(tweet.fullText);
    console.log('--------------------------------');
}

console.log(`cursor: ${result.next}`);