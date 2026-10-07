require('dotenv').config();

const Redis = require('ioredis');

const url = process.env.REDIS_URL;

console.log('REDIS_URL exists:', !!url);

const sub = new Redis(url, {
  lazyConnect: true,
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});

const pub = new Redis(url, {
  lazyConnect: true,
  maxRetriesPerRequest: null,
  enableReadyCheck: false
});

const timer = setTimeout(() => {
  console.error('TIMEOUT: Redis Pub/Sub did not complete within 10 seconds');
  process.exit(1);
}, 10000);

async function test() {
  try {
    await sub.connect();
    console.log('SUB connected');

    await pub.connect();
    console.log('PUB connected');

    await sub.subscribe('codejudge:test');
    console.log('SUBSCRIBE succeeded');

    await pub.publish('codejudge:test', 'hello');
    console.log('PUBLISH succeeded');

    clearTimeout(timer);

    await sub.quit();
    await pub.quit();

    console.log('REDIS PUB/SUB TEST PASSED');
    process.exit(0);
  } catch (err) {
    clearTimeout(timer);
    console.error('REDIS ERROR:', err.message);
    process.exit(1);
  }
}

test();
