const { pool } = require('./db.js');

async function clearBookings() {
  try {
    console.log('Clearing all joined splits (bookings) to reset Amount Saved...');
    // We use CASCADE to safely remove dependent rows (like feedback linked to bookings)
    await pool.query(`TRUNCATE TABLE bookings CASCADE;`);
    console.log('All bookings have been successfully deleted.');
  } catch (err) {
    console.error('Error clearing bookings:', err);
  } finally {
    pool.end();
  }
}

clearBookings();
