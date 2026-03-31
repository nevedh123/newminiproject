/* =========================================
   DB.JS - THE DATABASE BLUEPRINT & CONNECTION (THE KITCHEN BACKEND)
   =========================================
   This file connects node.js to PostgreSQL using the 'pg' module.
   When the server starts (via server.js calling initDb()), it checks
   if tables like Users, Listings, Bookings exist. If they don't,
   it runs these SQL queries to CREATE them.

   If a teacher asks: "Add a phone number to users"
   You can add \`phone_number VARCHAR(15)\` inside the users CREATE TABLE block below.
========================================= */
const { Pool } = require('pg');
require('dotenv').config();

// Here we create the connection POOL. It grabs details from the .env file (passwords).
// In production (Render/Vercel), it uses process.env.DATABASE_URL
const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        user: process.env.DB_USER,
        host: process.env.DB_HOST,
        database: process.env.DB_NAME,
        password: process.env.DB_PASSWORD,
        port: process.env.DB_PORT,
      }
);

const initDb = async () => {
  try {
    // Users Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'consumer',
        is_banned BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Migration: add is_banned to users if missing
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE;`);

    // Listings Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS listings (
        id SERIAL PRIMARY KEY,
        provider_id INTEGER REFERENCES users(id),
        type VARCHAR(50) NOT NULL,
        capacity VARCHAR(50) NOT NULL,
        price_per_unit DECIMAL(10, 2) NOT NULL,
        location TEXT,
        date TEXT,
        details JSONB,
        approved BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Migration: add missing columns to listings
    await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS base_cost DECIMAL(10, 2) DEFAULT 0.00;`);
    await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT FALSE;`);
    await pool.query(`ALTER TABLE listings ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending';`);

    // Bookings Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        listing_id INTEGER REFERENCES listings(id),
        status VARCHAR(50) DEFAULT 'pending',
        payment_status VARCHAR(50) DEFAULT 'unpaid',
        quantity INTEGER DEFAULT 1,
        total_price DECIMAL(10, 2),
        is_priority BOOLEAN DEFAULT FALSE,
        cancellation_status VARCHAR(50),
        cancellation_reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Migration: add missing columns to bookings
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancellation_status VARCHAR(50);`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_priority BOOLEAN DEFAULT FALSE;`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS eta VARCHAR(255);`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS details JSONB;`);
    await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;`);

    // Feedback Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS feedback (
        id SERIAL PRIMARY KEY,
        booking_id INTEGER REFERENCES bookings(id),
        user_id INTEGER REFERENCES users(id),
        rating INTEGER CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Tracking Updates Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tracking_updates (
        id SERIAL PRIMARY KEY,
        listing_id INTEGER REFERENCES listings(id) ON DELETE CASCADE,
        location_name VARCHAR(255) NOT NULL,
        lat DECIMAL(10, 6) NOT NULL,
        lng DECIMAL(10, 6) NOT NULL,
        is_confirmed BOOLEAN DEFAULT FALSE,
        reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Marketplace Items Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS marketplace_items (
        id SERIAL PRIMARY KEY,
        seller_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL,
        category VARCHAR(100),
        title VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(10, 2),
        starting_bid DECIMAL(10, 2),
        current_highest_bid DECIMAL(10, 2),
        highest_bidder_id INTEGER REFERENCES users(id),
        auction_end TIMESTAMP,
        images JSONB DEFAULT '[]',
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Bids Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bids (
        id SERIAL PRIMARY KEY,
        item_id INTEGER REFERENCES marketplace_items(id) ON DELETE CASCADE,
        bidder_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        amount DECIMAL(10, 2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Marketplace Chats Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS marketplace_chats (
        id SERIAL PRIMARY KEY,
        item_id INTEGER REFERENCES marketplace_items(id) ON DELETE CASCADE,
        buyer_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        seller_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(item_id, buyer_id)
      );
    `);

    // Marketplace Messages Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS marketplace_messages (
        id SERIAL PRIMARY KEY,
        chat_id INTEGER REFERENCES marketplace_chats(id) ON DELETE CASCADE,
        sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Trust Scores Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS trust_scores (
        id SERIAL PRIMARY KEY,
        rater_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        ratee_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        score INTEGER CHECK (score >= 1 AND score <= 5),
        comment TEXT DEFAULT '',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(rater_id, ratee_id)
      );
    `);

    // Add updated_at to trust_scores if missing (migration safety)
    await pool.query(`
      ALTER TABLE trust_scores ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);

    // Add comment to trust_scores if missing (migration safety)
    await pool.query(`
      ALTER TABLE trust_scores ADD COLUMN IF NOT EXISTS comment TEXT DEFAULT '';
    `);

    // Ensure UNIQUE constraint on trust_scores(rater_id, ratee_id) for UPSERT to work
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'trust_scores_rater_id_ratee_id_key'
            AND conrelid = 'trust_scores'::regclass
        ) THEN
          ALTER TABLE trust_scores ADD CONSTRAINT trust_scores_rater_id_ratee_id_key UNIQUE (rater_id, ratee_id);
        END IF;
      END $$;
    `);

    // Friends Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS friends (
        id SERIAL PRIMARY KEY,
        user_id1 INTEGER REFERENCES users(id) ON DELETE CASCADE,
        user_id2 INTEGER REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id1, user_id2)
      );
    `);

    // Friend Chats Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS friend_chats (
        id SERIAL PRIMARY KEY,
        user_id1 INTEGER REFERENCES users(id) ON DELETE CASCADE,
        user_id2 INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id1, user_id2)
      );
    `);

    // Friend Messages Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS friend_messages (
        id SERIAL PRIMARY KEY,
        chat_id INTEGER REFERENCES friend_chats(id) ON DELETE CASCADE,
        sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Notifications Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(100) NOT NULL,
        content TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Marketplace Split Requests
    await pool.query(`
      CREATE TABLE IF NOT EXISTS split_requests (
        id SERIAL PRIMARY KEY,
        item_id INTEGER REFERENCES marketplace_items(id) ON DELETE CASCADE,
        creator_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        total_slots INTEGER NOT NULL DEFAULT 2,
        filled_slots INTEGER DEFAULT 1,
        price_per_person DECIMAL(10,2),
        creator_terms TEXT,
        status VARCHAR(50) DEFAULT 'open',
        payment_required BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Add payment_required column if missing
    await pool.query(`
      ALTER TABLE split_requests ADD COLUMN IF NOT EXISTS payment_required BOOLEAN DEFAULT FALSE;
    `);

    // Add current_location to listings for split tracking
    await pool.query(`
      ALTER TABLE listings ADD COLUMN IF NOT EXISTS current_location TEXT;
    `);

    // Marketplace Split Members
    await pool.query(`
      CREATE TABLE IF NOT EXISTS split_members (
        id SERIAL PRIMARY KEY,
        split_id INTEGER REFERENCES split_requests(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        terms TEXT,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(split_id, user_id)
      );
    `);

    // Dummy Payments Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS dummy_payments (
        id SERIAL PRIMARY KEY,
        split_id INTEGER REFERENCES split_requests(id) ON DELETE CASCADE,
        booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
        item_id INTEGER REFERENCES marketplace_items(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        payment_amount DECIMAL(10,2) NOT NULL,
        payment_method VARCHAR(50) NOT NULL,
        confirmation_id VARCHAR(255) UNIQUE NOT NULL,
        qr_code_data TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        confirmed_at TIMESTAMP
      );
    `);

    // Add item_id to dummy_payments if missing
    await pool.query(`
      ALTER TABLE dummy_payments ADD COLUMN IF NOT EXISTS item_id INTEGER REFERENCES marketplace_items(id) ON DELETE CASCADE;
    `);

    // Payment History Table (for audit trail)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS payment_history (
        id SERIAL PRIMARY KEY,
        payment_id INTEGER REFERENCES dummy_payments(id) ON DELETE CASCADE,
        action VARCHAR(50) NOT NULL,
        details JSONB,
        actor_id INTEGER REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Site Inquiries Table (Contact Form)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS site_inquiries (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        subject VARCHAR(255),
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("Database tables checked/created successfully.");
  } catch (error) {
    console.error("Error initializing database:", error);
  }
};

module.exports = { pool, initDb };
