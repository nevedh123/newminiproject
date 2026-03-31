const { pool } = require('./db.js');

async function massiveSeedV2() {
  try {
    console.log('Starting precise massive seed v2...');

    // 1. Clear all data EXCEPT users
    const tablesToTruncate = [
      'listings', 'bookings', 'feedback', 'tracking_updates',
      'marketplace_items', 'bids', 'marketplace_chats', 'marketplace_messages',
      'trust_scores', 'friends', 'notifications', 'split_requests',
      'split_members', 'dummy_payments', 'payment_history', 'site_inquiries'
    ];
    await pool.query(`TRUNCATE TABLE ${tablesToTruncate.join(', ')} CASCADE;`);
    console.log('Truncated all data tables.');

    // 2. Clear non-dummy users
    const keepEmails = [
      'john@provider.com', 'global@provider.com', 'alice@consumer.com',
      'bob@consumer.com', 'charlie@consumer.com', 'nevedh12345@gmail.com'
    ];
    const emailList = keepEmails.map(e => `'${e}'`).join(', ');
    await pool.query(`DELETE FROM users WHERE email NOT IN (${emailList})`);
    
    const resUsers = await pool.query("SELECT id, email, name, role FROM users");
    const users = resUsers.rows;
    // We seed for the 5 dummy users
    const dummyUsers = users.filter(u => u.email !== 'nevedh12345@gmail.com');

    console.log(`Found ${dummyUsers.length} dummy users.`);

    const allListingIds = [];
    const allBookingIds = [];

    // Helper arrays to ensure uniqueness and good formatting
    const digitalApps = ['Netflix Premium 4K', 'Spotify Family Plan', 'Adobe Creative Cloud', 'YouTube Premium', 'Amazon Prime', 'ChatGPT Plus', 'Apple Music', 'Disney+', 'Microsoft 365', 'GitHub Copilot'];
    const customTitles = ['Weekend Turf Booking', 'Roadtrip Fuel Share', 'Apartment Cleaning Cost', 'Beach House Rent', 'Trekking Gear Rental', 'Party Decorations Share', 'Festival Passes', 'Conference Booth Split', 'Wedding Setup Cost', 'Photography Equipment'];
    const cargoTitles = ['Heavy Machinery Parts', 'Electronic Components', 'Textile Export', 'Furniture Transportation', 'Automobile Parts', 'Medical Supplies Ship', 'Construction Materials', 'Agricultural Products', 'Luxury Goods Transit', 'Consumer Electronics'];
    const storageLocations = ['Chicago Storage Hub', 'NY Cold Warehouse', 'Dallas Climate Controlled', 'Miami Port Storage', 'Seattle Logistics Base', 'Denver Freeze Hub', 'Boston Warehouse Sector 9'];

    let digitalIdx = 0, customIdx = 0, cargoIdx = 0, storageIdx = 0;

    // Loop through each dummy user
    for (const u of dummyUsers) {
      
      // --- LOGISTICS (3 per user) ---
      // Type must be 'cargo_split' for logistics
      for (let i=0; i<3; i++) {
        const title = cargoTitles[cargoIdx % cargoTitles.length]; cargoIdx++;
        const res = await pool.query(
          `INSERT INTO listings (provider_id, type, capacity, price_per_unit, location, date, details, approved, status) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'approved') RETURNING id`,
           [
             u.id, 
             'cargo_split', 
             `${(Math.floor(Math.random()*10)+1)*500} kg`, 
             (Math.random()*50 + 10).toFixed(2), 
             `Logistics Hub ${cargoIdx}`, 
             '2025-06-01', 
             JSON.stringify({ 
               activity: title,
               info: `Sharing cargo space for ${title}. Looking for trusted partners.` 
             })
           ]
        );
        allListingIds.push(res.rows[0].id);
      }

      // --- STORAGE (3 per user) ---
      // Type must be 'cold_storage' or 'warehouse'
      for (let i=0; i<3; i++) {
        const type = i % 2 === 0 ? 'cold_storage' : 'warehouse';
        const loc = storageLocations[storageIdx % storageLocations.length]; storageIdx++;
        const res = await pool.query(
          `INSERT INTO listings (provider_id, type, capacity, price_per_unit, location, date, details, approved, status) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'approved') RETURNING id`,
           [
             u.id, 
             type, 
             `${(Math.floor(Math.random()*5)+1)*100} sqft`, 
             (Math.random()*20 + 5).toFixed(2), 
             loc, 
             '2025-07-15', 
             JSON.stringify({ 
               activity: `${type === 'cold_storage' ? 'Refrigerated Storage' : 'Dry Warehouse'} Capacity`,
               info: `Secure ${type.replace('_', ' ')} available for prompt bookings.` 
             })
           ]
        );
        allListingIds.push(res.rows[0].id);
      }

      // --- DIGITAL SUBSCRIPTIONS (3 per user) ---
      // Type must be 'digital_subscriptions'
      for (let i=0; i<3; i++) {
        const appName = digitalApps[digitalIdx % digitalApps.length]; digitalIdx++;
        const isPaymentEnabled = true; // Digital usually requires payment
        const res = await pool.query(
          `INSERT INTO listings (provider_id, type, capacity, price_per_unit, location, date, details, approved, status) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'approved') RETURNING id`,
           [
             u.id, 
             'digital_subscriptions', 
             `4 slots`, 
             (Math.random()*15 + 5).toFixed(2), 
             `Remote`, 
             'Recurring', 
             JSON.stringify({ 
               app: appName,
               info: `Splitting the cost of ${appName}. Let's save together!`,
               payment_enabled: isPaymentEnabled
             })
           ]
        );
        allListingIds.push(res.rows[0].id);
      }

      // --- CUSTOM SPLITS (3 per user) ---
      // Type must be 'sports', 'travel', or 'other'
      for (let i=0; i<3; i++) {
        const customCategories = ['sports', 'travel', 'other'];
        const type = customCategories[i % 3];
        const activityName = customTitles[customIdx % customTitles.length]; customIdx++;
        
        // We ensure BOTH payment and non-payment custom splits are created.
        // E.g., i == 0 -> No Payment. i == 1 -> Payment. i == 2 -> Random.
        let isPaymentEnabled = i === 1 ? true : (i === 0 ? false : Math.random() > 0.5);

        const res = await pool.query(
          `INSERT INTO listings (provider_id, type, capacity, price_per_unit, location, date, details, approved, status) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'approved') RETURNING id`,
           [
             u.id, 
             type, 
             `${Math.floor(Math.random()*5)+2} slots`, 
             (Math.random()*40 + 10).toFixed(2), 
             `Local/Community`, 
             'Recurring', 
             JSON.stringify({ 
               activity: activityName,
               info: `A custom split for ${activityName}. ${isPaymentEnabled ? 'Payment via UNIO is required.' : 'We will settle payments manually offline.'}`,
               payment_enabled: isPaymentEnabled
             })
           ]
        );
        allListingIds.push(res.rows[0].id);
      }

      // --- ADD 1 PENDING LISTING PER USER (so Admin has pending listings) ---
      await pool.query(
        `INSERT INTO listings (provider_id, type, capacity, price_per_unit, location, date, details, approved, status) 
         VALUES ($1, 'cargo_split', '5000 kg', 50.00, 'Pending Port Approval', '2025-08-01', $2, false, 'pending')`,
        [u.id, JSON.stringify({ activity: 'Pending Bulk Cargo Request', info: 'Waiting for admin approval.' })]
      );
    }
    console.log('Inserted all base data.');

    // 2. Cross-interactions (Bookings / Joining Splits)
    for (const u of dummyUsers) {
      // Each user joins (books) TWO random listings that don't belong to them
      const othersListings = allListingIds; // To keep it simple, we just pick from all, but could restrict
      for (let j=0; j<2; j++) {
         const targetListing = othersListings[Math.floor(Math.random() * othersListings.length)];
         const bRes = await pool.query(
           `INSERT INTO bookings (user_id, listing_id, status, payment_status, total_price)
            VALUES ($1, $2, 'confirmed', 'paid', 100.00) RETURNING id`,
           [u.id, targetListing]
         );
         allBookingIds.push(bRes.rows[0].id);

         // Leave a feedback for the booking so Admin sees "New Feedbacks"
         await pool.query(
           `INSERT INTO feedback (user_id, booking_id, rating, comment) VALUES ($1, $2, $3, $4)`,
           [u.id, bRes.rows[0].id, 4 + (Math.random() > 0.5 ? 1 : 0), 'Very smooth process, highly recommended!']
         );
      }
    }

    console.log('Finished inserting accurate meaningful data for all tabs.');

  } catch (err) {
    console.error('Error in massive seed v2:', err);
  } finally {
    pool.end();
  }
}

massiveSeedV2();
