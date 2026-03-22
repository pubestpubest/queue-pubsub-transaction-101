// producer.js
const amqp = require('amqplib');

async function main() {
  const conn = await amqp.connect('amqp://localhost');
  const channel = await conn.createChannel();

  const queue = 'orders';
  await channel.assertQueue(queue, { durable: true });

  let id = 1;
  setInterval(() => {
    const order = { id: id++, item: 'shoes', qty: 2 };
    channel.sendToQueue(queue, Buffer.from(JSON.stringify(order)));
    console.log('Sent:', order);
  }, 500); // ส่งทุก 500ms
}

main();