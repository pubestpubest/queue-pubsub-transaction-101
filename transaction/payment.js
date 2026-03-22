const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  database: 'gymmate',
  user: 'postgres',
  password: 'secret',
  port: 5432,
});

async function processPayment(paymentId, memberId, amount) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // idempotency check
    const exists = await client.query(
      'SELECT id FROM payments WHERE payment_id = $1',
      [paymentId]
    );
    if (exists.rows.length > 0) {
      console.log('Already processed, skipping:', paymentId);
      await client.query('ROLLBACK');
      return;
    }

    // เช็ค balance
    const { rows } = await client.query(
      'SELECT balance FROM member_balance WHERE member_id = $1 FOR UPDATE',
      [memberId]
    );
    if (rows[0].balance < amount) throw new Error('Insufficient balance');

    // ตัดเงิน
    await client.query(
      'UPDATE member_balance SET balance = balance - $1 WHERE member_id = $2',
      [amount, memberId]
    );

    // บันทึก payment
    await client.query(
      'INSERT INTO payments (payment_id, member_id, amount, status) VALUES ($1, $2, $3, $4)',
      [paymentId, memberId, amount, 'success']
    );

    await client.query('COMMIT');
    console.log('Payment success:', paymentId);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Payment failed, rolled back:', err.message);
  } finally {
    client.release();
  }
}

Promise.all([
    processPayment('PAY-002', 42, 200),
    processPayment('PAY-003', 42, 200),
  ]);
// // ทดสอบ double charge
// processPayment('PAY-001', 42, 200);
// processPayment('PAY-001', 42, 200); // paymentId เดิม