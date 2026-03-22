# RabbitMQ & Message Queue — Learning Notes

## Why Message Queue?

การ call API ตรงๆ แบบ synchronous มีปัญหาคือถ้า server ไม่ว่าง request จะหายไปเลย และ client ต้องรอจนกว่าทุก operation จะเสร็จ

Message Queue แก้ปัญหานี้ด้วยการแยก producer ออกจาก consumer — producer โยน message เข้า queue แล้วไปทำงานอื่นได้เลย consumer ค่อยมารับไปประมวลผลทีหลัง

### Queue vs Async (spawn thread)

| | Async (thread) | Message Queue |
|---|---|---|
| Server crash แล้ว message หาย | ✅ หาย | ❌ ยังอยู่ใน queue |
| Producer รู้จัก consumer | ✅ รู้จัก | ❌ ไม่รู้จักกัน |
| Scale consumer อิสระ | ยาก | ง่าย |

---

## Core Concepts

### Durability
```js
await channel.assertQueue('orders', { durable: true });
```
- `assertQueue` — ถ้า queue มีอยู่แล้วใช้อันเดิม ถ้ายังไม่มีสร้างใหม่
- `durable: true` — queue ยังอยู่แม้ RabbitMQ จะ restart

### Acknowledgement (ACK / NACK)
```js
// บอก RabbitMQ ว่าประมวลผลสำเร็จ
channel.ack(msg);

// บอก RabbitMQ ว่าประมวลผลไม่สำเร็จ
channel.nack(msg, false, false); // requeue: false = ทิ้งเลย
```
- ถ้าไม่ ack → message ค้างเป็น **Unacked** ตลอดไป
- ถ้า `requeue: true` แล้ว message format ผิดทุกครั้ง → **poison message loop** → queue overflow

### Prefetch (Fair Dispatch)
```js
channel.prefetch(1);
```
- Default round robin แจก message เท่ากันทุก consumer ไม่ว่าจะเร็วหรือช้า
- `prefetch(1)` → consumer ที่ว่างจะได้ message ก่อนเลย — fair dispatch ตาม capacity จริง

---

## Work Queue vs Pub/Sub

### Work Queue
Message 1 อัน → ถูกรับโดย consumer **แค่ตัวเดียว**

```js
// producer
channel.sendToQueue('orders', Buffer.from(JSON.stringify(order)));

// consumer
channel.consume('orders', (msg) => {
  // ประมวลผล
  channel.ack(msg);
});
```

**ข้อดี:** durability สูง, retry/DLQ ทำได้, scale consumer ได้อิสระ  
**ข้อเสีย:** message ถูกรับแค่ตัวเดียว  
**Use cases:** order processing, payment, email sending, video transcoding

### Pub/Sub (fanout Exchange)
Message 1 อัน → **broadcast** ให้ทุก subscriber พร้อมกัน

```js
// publisher
await channel.assertExchange('gym.events', 'fanout', { durable: false });
channel.publish('gym.events', '', Buffer.from(JSON.stringify(event)));

// subscriber
const q = await channel.assertQueue('', { exclusive: true });
await channel.bindQueue(q.queue, 'gym.events', '');
channel.consume(q.queue, (msg) => { /* ... */ });
```

- `exclusive: true` → queue ผูกกับ connection นั้น พอ disconnect queue หายทันที
- `assertQueue('')` → RabbitMQ สร้าง queue ชื่อ random ให้แต่ละ subscriber

**ข้อดี:** broadcast ได้ทุกคนพร้อมกัน, publisher ไม่รู้ว่ามี subscriber กี่ตัว  
**ข้อเสีย:** message หายถ้า subscriber offline  
**Use cases:** notifications, analytics logging, real-time events, chat

### เลือกยังไง?
> message นี้ควรถูกประมวลผล **ครั้งเดียว** หรือ **ทุกคนต้องรู้**?
> - ครั้งเดียว → Work Queue
> - ทุกคนต้องรู้ → Pub/Sub

---

## Payment Processing — Why It's Special

Payment ต้องการ 3 layer ป้องกันพร้อมกัน:

### 1. Durable Queue
Message ไม่หายแม้ broker จะ crash ระหว่างที่รอ consumer

### 2. Idempotency
ป้องกัน **double charge** — ถ้า consumer crash หลัง commit แต่ก่อน ack RabbitMQ จะ requeue message ใหม่ consumer ตัวใหม่จะรับไปทำซ้ำ

แก้ด้วยการใส่ unique `paymentId` ใน message แล้วเช็คก่อนทุกครั้ง:
```js
const exists = await client.query(
  'SELECT id FROM payments WHERE payment_id = $1',
  [paymentId]
);
if (exists.rows.length > 0) {
  channel.ack(msg); // skip ไม่ตัดเงินซ้ำ
  return;
}
```

### 3. Transaction + FOR UPDATE
ป้องกัน **partial update** และ **race condition**

```js
await client.query('BEGIN');

// FOR UPDATE lock row ป้องกัน race condition
const { rows } = await client.query(
  'SELECT balance FROM member_balance WHERE member_id = $1 FOR UPDATE',
  [memberId]
);
if (rows[0].balance < amount) throw new Error('Insufficient balance');

await client.query('UPDATE member_balance SET balance = balance - $1 ...', [amount]);
await client.query('INSERT INTO payments ...', [...]);

await client.query('COMMIT');
```

- **Transaction** → all or nothing ภายใน operation เดียว (ตัดเงิน + บันทึก payment พร้อมกัน)
- **FOR UPDATE** → lock row ป้องกัน 2 consumer อ่าน balance เดิมพร้อมกัน (lost update problem)
- **Idempotency** → ป้องกัน double charge ข้าม attempts

---

## Balanced System

```
produce_rate ≤ consume_rate
```

Queue ช่วย **buffer spike ชั่วคราว** ได้ แต่ถ้า produce > consume ตลอดเวลา queue จะเต็มและ message จะถูก drop ไม่ว่า queue จะใหญ่แค่ไหน

- `consume_rate` → กำหนด throughput จริงของระบบ
- `queue` → absorb spike + durability
- `prefetch` → tune fair dispatch

---

## Summary

| Concept | แก้ปัญหา |
|---|---|
| Durable queue | message ไม่หายถ้า broker crash |
| ACK / NACK | confirm ว่าประมวลผลสำเร็จหรือไม่ |
| Prefetch(1) | fair dispatch ตาม capacity จริง |
| Pub/Sub fanout | broadcast ให้ทุก subscriber |
| Transaction | all or nothing ภายใน operation เดียว |
| Idempotency | same result ข้าม attempts |
| FOR UPDATE | ป้องกัน race condition |