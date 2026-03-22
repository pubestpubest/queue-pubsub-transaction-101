const amqp = require('amqplib');

async function main() {
  const conn = await amqp.connect('amqp://localhost');
  const channel = await conn.createChannel();

  const exchange = 'gym.events';
  await channel.assertExchange(exchange, 'fanout', { durable: false });

  const event = { type: 'member.checked_in', memberId: 42, name: 'Pubest' };
  channel.publish(exchange, '', Buffer.from(JSON.stringify(event)));

  console.log('Published:', event);
  setTimeout(() => conn.close(), 500);
}

main();