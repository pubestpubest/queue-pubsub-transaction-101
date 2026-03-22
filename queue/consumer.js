const amqp = require('amqplib');

async function main() {
  const conn = await amqp.connect('amqp://localhost');
  const channel = await conn.createChannel();

  const queue = 'orders';
  await channel.assertQueue(queue, { durable: true });

  // consumer.js — เพิ่ม worker id
const workerId = process.argv[2] || 'W1'; // รับ argument จาก command line
channel.prefetch(1);
channel.consume(queue, async (msg) => {
    try {
      const order = JSON.parse(msg.content.toString());
      const delay = workerId === 'W1' ? 2000 : 200; // W1 ช้ากว่า 10x
      await new Promise(r => setTimeout(r, delay));
      console.log(`[${workerId}] Done:`, order.id);
      channel.ack(msg);
    } catch (err) {
      channel.nack(msg, false, false);
    }
  });
console.log(`[${workerId}] Waiting for orders...`);
}

main();