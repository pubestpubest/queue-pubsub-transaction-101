# Redis & Caching — Learning Notes

## What is Redis?

Redis คือ key-value store ที่เก็บข้อมูลใน RAM — อ่านเร็วกว่า PostgreSQL มากเพราะไม่ต้อง I/O disk แต่ข้อมูลหายถ้า process crash

ดังนั้น Redis ไม่ได้ใช้แทน PostgreSQL แต่ใช้ **ร่วมกัน**:
```
Request → Redis (fast) → ถ้าไม่มี → PostgreSQL (source of truth)
```

---

## Cache-Aside Pattern

Pattern หลักที่ใช้บ่อยที่สุด — application จัดการ cache เอง

```js
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
```

---

## Stale Cache — และวิธีแก้

ถ้าข้อมูลใน DB ถูกอัปเดตแต่ Redis ยังเก็บข้อมูลเก่าอยู่ = **stale cache**

### 1. TTL (Time To Live)
ตั้งเวลาให้ cache หมดอายุเอง — เหมาะกับข้อมูลที่อัปเดตไม่บ่อยและ accuracy ไม่ critical

```js
await redis.set(key, value, 'EX', 60); // หมดอายุใน 60 วินาที
```

### 2. Cache Invalidation
ลบ cache ทันทีเมื่ออัปเดต DB — เหมาะกับข้อมูลที่ต้องการ accuracy สูง

```js
async function updateBalance(memberId, newBalance) {
  await pool.query('UPDATE member_balance SET balance = $1 WHERE member_id = $2', [newBalance, memberId]);
  await redis.del(`member:${memberId}`); // invalidate ทันที
}
```

### เลือกยังไง?
| | TTL | Cache Invalidation |
|---|---|---|
| User profile | ✅ | |
| ราคาสินค้า | | ✅ |
| Session | | ✅ |
| Analytics summary | ✅ | |

> ถ้าข้อมูลเก่าไปสักครู่ยังรับได้ → TTL
> ถ้าต้องการ accuracy ทันที → Invalidation

---

## Cache Key Naming

### Pattern
```
{service}:{entity}:{id}:{variant}
```

### ตัวอย่าง
```
gymmate:user:42:profile
gymmate:user:42:balance
gymmate:product:99:detail
gymmate:session:abc123
```

### ทำไมต้อง prefix?
- ป้องกัน **key collision** — user id 42 กับ product id 42 จะไม่ overwrite กัน
- ง่ายต่อการ scan และ debug ใน production

### Versioning
```
gymmate:v1:user:42:profile  ← code เก่า
gymmate:v2:user:42:profile  ← code ใหม่ (เปลี่ยน structure)
```

ใช้เมื่อ deploy ระบบใหม่ที่เปลี่ยน cache structure — ป้องกัน code ใหม่อ่าน cache เก่าแล้วได้ shape ผิด ไม่ต้อง flush cache ทั้งหมดตอน deploy

---

## Rate Limiting with Redis

ป้องกัน user ส่ง request มากเกินไป — ทำที่ application level ด้วย Redis เพราะเป็น **shared counter** ทุก server นับที่เดียวกัน

```js
async function isAllowed(userId, limit = 5, windowSec = 60) {
  const key = `ratelimit:${userId}`;

  const count = await redis.incr(key);
  await redis.expire(key, windowSec, 'NX'); // NX = set เฉพาะตอนที่ยังไม่มี expire

  console.log(`User ${userId}: ${count}/${limit}`);
  return count <= limit;
}
```

### ทำไม expire ต้องใช้ NX flag?
- ถ้า set expire ทุกครั้ง → window จะ reset ทุก request → block ไม่ได้จริง
- `NX` → set expire แค่ครั้งแรกที่ key ถูกสร้าง ครั้งต่อไป skip อัตโนมัติ

### ทำไมไม่ทำ rate limiting ที่ server แต่ละตัว (in-memory)?
```
User A → Server 1 (นับ 40 reqs)
User A → Server 2 (นับ 40 reqs)  ← แต่ละตัวนับแยกกัน
User A → Server 3 (นับ 40 reqs)

จริงๆ ส่งไป 120 requests แต่ไม่โดน limit เลย ❌
```

Redis แก้ด้วยการเป็น shared counter — ทุก server นับที่เดียวกัน ✅

---

## Summary

| Concept | แก้ปัญหา |
|---|---|
| Cache-aside | ลด load DB สำหรับข้อมูลที่อ่านบ่อย |
| TTL | ป้องกัน stale cache โดยอัตโนมัติ |
| Cache invalidation | ความ accurate สูง อัปเดต cache ทันทีเมื่อ DB เปลี่ยน |
| Key naming convention | ป้องกัน collision, ง่ายต่อ debug |
| Key versioning | deploy ได้ปลอดภัยเมื่อเปลี่ยน cache structure |
| Rate limiting | ป้องกัน abuse ด้วย shared counter ข้าม servers |