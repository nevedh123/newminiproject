const { pool } = require('./db.js');

async function cleanDatabase() {
  try {
    console.log('Connecting to database...');
    
    // Truncate all tables except users
    const tablesToTruncate = [
      'listings',
      'bookings',
      'feedback',
      'tracking_updates',
      'marketplace_items',
      'bids',
      'marketplace_chats',
      'marketplace_messages',
      'trust_scores',
      'friends',
      'notifications',
      'split_requests',
      'split_members',
      'dummy_payments',
      'payment_history',
      'site_inquiries'
    ];
    
    console.log('Truncating tables: ' + tablesToTruncate.join(', '));
    await pool.query(`TRUNCATE TABLE ${tablesToTruncate.join(', ')} CASCADE;`);
    console.log('Successfully truncated all data tables.');

    // Delete users not in dummy_accounts.txt
    const dummyEmails = [
      'john@provider.com',
      'global@provider.com',
      'alice@consumer.com',
      'bob@consumer.com',
      'charlie@consumer.com'
    ];
    
    const emailList = dummyEmails.map(e => `'${e}'`).join(', ');
    
    const deleteResult = await pool.query(`
      DELETE FROM users WHERE email NOT IN (${emailList});
    `);
    
    console.log(`Deleted ${deleteResult.rowCount} non-dummy users.`);
    
    // Let's verify what's left
    const remainingUsers = await pool.query('SELECT id, name, email, role FROM users');
    console.log('Remaining dummy users:');
    console.table(remainingUsers.rows);

    console.log('Database cleanup completed perfectly.');
  } catch (error) {
    console.error('Error cleaning database:', error);
  } finally {
    await pool.end();
  }
}

cleanDatabase();
