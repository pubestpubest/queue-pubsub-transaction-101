const Redis = require('ioredis');
const redis = new Redis();

async function isAllowed(userId, limit = 5, windowSec = 60) {
    const key = `ratelimit:${userId}`;
  
    // atomic — set + expire ในคำสั่งเดียว
    const count = await redis.incr(key);
    await redis.expire(key, windowSec, 'NX'); // NX = set expire เฉพาะตอนที่ยังไม่มี
  
    console.log(`User ${userId}: ${count}/${limit}`);
    return count <= limit;
  }

async function main() {
  for (let i = 0; i < 7; i++) {
    const allowed = await isAllowed('user:42', 5, 60);
    console.log(allowed ? 'ALLOWED' : 'BLOCKED');
  }
  redis.disconnect();
}

main();