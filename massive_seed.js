const { pool } = require('./db.js');

async function massiveSeed() {
  try {
    console.log('Starting massive seed...');

    // 1. Clear all data EXCEPT users
    const tablesToTruncate = [
      'listings', 'bookings', 'feedback', 'tracking_updates',
      'marketplace_items', 'bids', 'marketplace_chats', 'marketplace_messages',
      'trust_scores', 'friends', 'notifications', 'split_requests',
      'split_members', 'dummy_payments', 'payment_history', 'site_inquiries'
    ];
    await pool.query(`TRUNCATE TABLE ${tablesToTruncate.join(', ')} CASCADE;`);
    console.log('Truncated all data tables.');

    // Delete any users except the known 5 dummies and the admin
    const keepEmails = [
      'john@provider.com', 'global@provider.com', 'alice@consumer.com',
      'bob@consumer.com', 'charlie@consumer.com', 'nevedh12345@gmail.com'
    ];
    const emailList = keepEmails.map(e => `'${e}'`).join(', ');
    await pool.query(`DELETE FROM users WHERE email NOT IN (${emailList})`);
    
    // Fetch remaining users
    const resUsers = await pool.query("SELECT id, email, name FROM users");
    const users = resUsers.rows;
    const dummyUsers = users.filter(u => u.email !== 'nevedh12345@gmail.com');

    console.log(`Found ${dummyUsers.length} dummy users.`);

    // Arrays to store IDs to use for relationships
    const allListingIds = [];
    const allSplitIds = [];
    const allBookingIds = [];

    // Loop through each dummy user to guarantee they have 3 of EVERYTHING
    for (const u of dummyUsers) {
      
      // --- LOGISTICS (CARGO) ---
      for (let i=1; i<=3; i++) {
        const res = await pool.query(
          `INSERT INTO listings (provider_id, type, capacity, price_per_unit, location, date, details, approved, status) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'approved') RETURNING id`,
          [u.id, 'cargo', `${i*1000} kg`, 10.00 + i*2, `Logistics Hub ${i}`, '2025-06-01', JSON.stringify({type: 'Heavy Cargo'})]
        );
        allListingIds.push(res.rows[0].id);
      }

      // --- STORAGE (WAREHOUSE / COLD) ---
      for (let i=1; i<=3; i++) {
        const type = i % 2 === 0 ? 'cold' : 'warehouse';
        const res = await pool.query(
          `INSERT INTO listings (provider_id, type, capacity, price_per_unit, location, date, details, approved, status) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'approved') RETURNING id`,
          [u.id, type, `${i*500} sqft/kg`, 20.00 + i*5, `Storage Center ${i}`, '2025-07-01', JSON.stringify({temperature: type === 'cold' ? '-2C' : 'Normal'})]
        );
        allListingIds.push(res.rows[0].id);
      }

      // --- DIGITAL SUBSCRIPTIONS ---
      for (let i=1; i<=3; i++) {
        const resM = await pool.query(
          `INSERT INTO marketplace_items (seller_id, type, category, title, description, price, status) 
           VALUES ($1, 'split', 'digital', $2, $3, $4, 'active') RETURNING id`,
          [u.id, `Digital Sub Plan ${i} by ${u.name}`, 'Looking to split digital subscription.', 30.00 * i]
        );
        const pp = (30.00 * i / 4).toFixed(2);
        const resS = await pool.query(
          `INSERT INTO split_requests (item_id, creator_id, total_slots, filled_slots, price_per_person, status, payment_required)
           VALUES ($1, $2, $4, 1, $3, 'open', true) RETURNING id`,
          [resM.rows[0].id, u.id, pp, 4]
        );
        allSplitIds.push(resS.rows[0].id);
        
        // Add creator as member
        await pool.query(`INSERT INTO split_members (split_id, user_id) VALUES ($1, $2)`, [resS.rows[0].id, u.id]);
      }

      // --- CUSTOM SPLITS ---
      for (let i=1; i<=3; i++) {
        const resM = await pool.query(
          `INSERT INTO marketplace_items (seller_id, type, category, title, description, price, status) 
           VALUES ($1, 'split', 'custom', $2, $3, $4, 'active') RETURNING id`,
          [u.id, `Custom Sharing ${i} by ${u.name}`, 'Custom item pooling.', 120.00 * i]
        );
        const pp = (120.00 * i / 3).toFixed(2);
        const resS = await pool.query(
          `INSERT INTO split_requests (item_id, creator_id, total_slots, filled_slots, price_per_person, status, payment_required)
           VALUES ($1, $2, $4, 1, $3, 'open', true) RETURNING id`,
          [resM.rows[0].id, u.id, pp, 3]
        );
        allSplitIds.push(resS.rows[0].id);
        
        await pool.query(`INSERT INTO split_members (split_id, user_id) VALUES ($1, $2)`, [resS.rows[0].id, u.id]);
      }

      // --- ADD 1 PENDING LISTING PER USER (so Admin has pending listings) ---
      await pool.query(
        `INSERT INTO listings (provider_id, type, capacity, price_per_unit, location, date, details, approved, status) 
         VALUES ($1, 'cargo', '5000 kg', 50.00, 'Pending Port', '2025-08-01', '{}', false, 'pending')`,
        [u.id]
      );
    }
    console.log('Inserted all base data.');

    // 2. Cross-interactions (Bookings, Joining Splits, Feedbacks)
    for (const u of dummyUsers) {
      // Each user books a random listing from someone else
      const otherListing = allListingIds[Math.floor(Math.random() * allListingIds.length)];
      const bRes = await pool.query(
        `INSERT INTO bookings (user_id, listing_id, status, payment_status, total_price)
         VALUES ($1, $2, 'confirmed', 'paid', 100.00) RETURNING id`,
        [u.id, otherListing]
      );
      allBookingIds.push(bRes.rows[0].id);

      // Each user joins a split they didn't create
      // For simplicity, just pick a random split and try to insert (handle unique constraint constraint if they are creator by ignoring)
      try {
        const randomSplit = allSplitIds[Math.floor(Math.random() * allSplitIds.length)];
        await pool.query(
          `INSERT INTO split_members (split_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [randomSplit, u.id]
        );
        // increment filled slots
        await pool.query(`UPDATE split_requests SET filled_slots = filled_slots + 1 WHERE id = $1`, [randomSplit]);
      } catch (e) {
        // ignore if already joined
      }

      // Each user leaves a feedback for a successful booking
      await pool.query(
        `INSERT INTO feedback (user_id, booking_id, rating, comment) VALUES ($1, $2, 5, 'Excellent service!')`,
        [u.id, bRes.rows[0].id]
      );
    }

    // Add extra feedback just in case to show in admin panel
    if (allBookingIds.length >= 2) {
      await pool.query(
        `INSERT INTO feedback (user_id, booking_id, rating, comment) VALUES ($1, $2, 4, 'Very good overall.')`,
        [dummyUsers[0].id, allBookingIds[1]]
      );
    }

    console.log('Finished inserting meaningful data for all users.');

  } catch (err) {
    console.error('Error in massive seed:', err);
  } finally {
    pool.end();
  }
}

massiveSeed();
