const { pool } = require('./db.js');

async function seedData() {
  try {
    console.log('Connecting to database specifically for meaningful seeding...');

    // 1. Fetch Users
    const res = await pool.query("SELECT id, email, role FROM users");
    const users = res.rows;
    
    // Create map for easy access
    const uMap = {};
    users.forEach(u => uMap[u.email] = u);

    const john = uMap['john@provider.com'];
    const globalProvider = uMap['global@provider.com'];
    const alice = uMap['alice@consumer.com'];
    const bob = uMap['bob@consumer.com'];
    const charlie = uMap['charlie@consumer.com'];
    
    // Ensure all exist
    if (!john || !globalProvider || !alice || !bob || !charlie) {
      console.log('Cannot find some of the specified dummy accounts.');
      return;
    }

    // 2. Insert Listings (Logistics, Cold, Cargo, Warehouse)
    console.log('Inserting listings...');
    const listings = [
      // John's listings
      { provider: john.id, type: 'cargo', cap: '500 kg', price: 15.00, loc: 'New York Port', date: '2025-06-01', details: '{"type":"Dry Goods"}' },
      { provider: john.id, type: 'warehouse', cap: '1000 sqft', price: 200.00, loc: 'New York City Center', date: '2025-06-15', details: '{"type":"Standard Storage"}' },
      
      // Global's listings
      { provider: globalProvider.id, type: 'cold', cap: '300 kg', price: 25.00, loc: 'Chicago Logistics Hub', date: '2025-07-01', details: '{"type":"Perishables", "temp":"-5°C"}' },
      { provider: globalProvider.id, type: 'cargo', cap: '2000 kg', price: 12.00, loc: 'Chicago Train Yard', date: '2025-06-20', details: '{"type":"Heavy Machinery"}' }
    ];

    for (let l of listings) {
      await pool.query(
        `INSERT INTO listings (provider_id, type, capacity, price_per_unit, location, date, details, approved, status) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'approved')`,
        [l.provider, l.type, l.cap, l.price, l.loc, l.date, l.details]
      );
    }

    // 3. Insert Marketplace Items & Splits (Digital, Custom)
    console.log('Inserting marketplace items and splits...');
    const marketplaceItems = [
      { seller: alice.id, type: 'split', category: 'digital', title: 'Netflix Premium 4K Split', desc: 'Looking to split Netflix Premium with 3 others.', price: 20.00 },
      { seller: bob.id, type: 'split', category: 'custom', title: 'Car Pooling NY to Boston', desc: 'Gas money split for road trip.', price: 60.00 },
      { seller: charlie.id, type: 'split', category: 'digital', title: 'Spotify Family Subscription', desc: 'Yearly Spotify family plan sharing.', price: 120.00 },
      { seller: john.id, type: 'split', category: 'custom', title: 'Shared Cargo Container to Europe', desc: 'Splitting full container load.', price: 3000.00 }
    ];

    for (let item of marketplaceItems) {
      const resItem = await pool.query(
        `INSERT INTO marketplace_items (seller_id, type, category, title, description, price, status) 
         VALUES ($1, $2, $3, $4, $5, $6, 'active') RETURNING id`,
        [item.seller, item.type, item.category, item.title, item.desc, item.price]
      );
      const itemId = resItem.rows[0].id;

      let slots = 4;
      if (item.category === 'custom') slots = 3;

      const pp = (item.price / slots).toFixed(2);

      // Create the explicit split_request
      const resSplit = await pool.query(
        `INSERT INTO split_requests (item_id, creator_id, total_slots, filled_slots, price_per_person, creator_terms, status, payment_required)
         VALUES ($1, $2, $3, $4, $5, $6, 'open', true) RETURNING id`,
        [itemId, item.seller, slots, 1, pp, 'Must pay upfront via dummy payment.']
      );
      
      const splitId = resSplit.rows[0].id;
      
      // Auto-join the creator to the split members
      await pool.query(
        `INSERT INTO split_members (split_id, user_id, terms) VALUES ($1, $2, $3)`,
        [splitId, item.seller, 'Creator agreed']
      );
    }

    // 4. Insert Community Ratings (Trust Scores)
    console.log('Inserting trust scores...');
    const scores = [
      { rater: alice.id, ratee: john.id, score: 5, comment: 'Great provider, cargo arrived perfectly on time!' },
      { rater: bob.id, ratee: globalProvider.id, score: 4, comment: 'Nice cold storage but slightly expensive.' },
      { rater: charlie.id, ratee: alice.id, score: 5, comment: 'Trusted member on the Netflix split.' },
      { rater: globalProvider.id, ratee: bob.id, score: 5, comment: 'Pleasant to do business with.' },
      { rater: john.id, ratee: charlie.id, score: 4, comment: 'Prompt payment for the shared container.' }
    ];

    for (let s of scores) {
      await pool.query(
        `INSERT INTO trust_scores (rater_id, ratee_id, score, comment) 
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (rater_id, ratee_id) DO UPDATE SET score = EXCLUDED.score, comment = EXCLUDED.comment, updated_at = CURRENT_TIMESTAMP`,
        [s.rater, s.ratee, s.score, s.comment]
      );
    }

    console.log('Successfully seeded meaningful data!');
  } catch (error) {
    console.error('Error seeding data:', error);
  } finally {
    await pool.end();
  }
}

seedData();
