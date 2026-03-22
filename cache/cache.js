const { Pool } = require('pg');
const Redis = require('ioredis');

const pool = new Pool({
  host: 'localhost',
  database: 'gymmate',
  user: 'postgres',
  password: 'secret',
  port: 5432,
});

const redis = new Redis({ host: 'localhost', port: 6379 });

async function getMemberProfile(memberId) {
  const cacheKey = `member:${memberId}`;

  // 1. เช็ค cache ก่อน
  const cached = await redis.get(cacheKey);
  if (cached) {
    console.log('Cache HIT:', memberId);
    return JSON.parse(cached);
  }

  // 2. cache miss → ไป DB
  console.log('Cache MISS:', memberId);
  const { rows } = await pool.query(
    'SELECT * FROM member_balance WHERE member_id = $1',
    [memberId]
  );

  // 3. เก็บใน Redis พร้อม TTL 60 วินาที
  await redis.set(cacheKey, JSON.stringify(rows[0]), 'EX', 60);

  return rows[0];
}
async function updateBalance(memberId, newBalance) {
    // update DB
    await pool.query(
      'UPDATE member_balance SET balance = $1 WHERE member_id = $2',
      [newBalance, memberId]
    );
  
    // invalidate cache
    await redis.del(`member:${memberId}`);
    console.log('Cache invalidated:', memberId);
  }

  async function main() {
    console.log('--- call 1 ---');
    await getMemberProfile(42); // MISS
  
    console.log('--- call 2 ---');
    await getMemberProfile(42); // HIT
  
    console.log('--- update balance ---');
    await updateBalance(42, 999);
  
    console.log('--- call 3 ---');
    await getMemberProfile(42); // ?
  }

main();