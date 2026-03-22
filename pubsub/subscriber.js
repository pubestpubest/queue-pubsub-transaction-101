const amqp = require('amqplib');

async function main() {
  const serviceName = process.argv[2] || 'unknown';
  const conn = await amqp.connect('amqp://localhost');
  const channel = await conn.createChannel();

  const exchange = 'gym.events';
  await channel.assertExchange(exchange, 'fanout', { durable: false });

  const q = await channel.assertQueue('', { exclusive: true });
  await channel.bindQueue(q.queue, exchange, '');

  console.log(`[${serviceName}] Waiting for events...`);
  channel.consume(q.queue, (msg) => {
    const event = JSON.parse(msg.content.toString());
    console.log(`[${serviceName}] Received:`, event);
  });
}

main();