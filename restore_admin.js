const { pool } = require('./db.js');
const bcrypt = require('bcrypt');

async function restoreAdmin() {
  try {
    const password = 'admin';
    const email = 'nevedh12345@gmail.com';
    const name = 'Admin User';
    const role = 'admin';
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    await pool.query('DELETE FROM users WHERE email = $1', [email]);
    
    await pool.query(
      'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4)',
      [name, email, hashedPassword, role]
    );
    
    console.log(`Admin account ${email} restored successfully.`);
  } catch (error) {
    console.error('Error restoring admin:', error);
  } finally {
    await pool.end();
  }
}

restoreAdmin();
