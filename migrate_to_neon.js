const { Pool } = require('pg');
require('dotenv').config();

// The new Neon connection string
const NEON_URI = "postgresql://neondb_owner:npg_XYWSw9yGt4bs@ep-patient-mountain-amvifwqd-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require";

// Connect to local database
const localPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Connect to new Neon database
const neonPool = new Pool({
  connectionString: NEON_URI,
});

// We need to initialize the tables on Neon.
// Instead of rewriting all schemas, we will copy the exact table schemas manually or just run initDb from db.js against the Neon Pool.
// Since initDb in db.js uses the global `pool`, we'll just temporarily trick it or manually execute the schemas.
// For safety, I'll extract all table names we need to copy data for.
const TABLES = [
  'users',
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
  'friend_chats',
  'friend_messages',
  'notifications',
  'split_requests',
  'split_members',
  'dummy_payments',
  'payment_history',
  'site_inquiries'
];

async function migrate() {
    console.log("Starting Migration from Local to Neon...");
    try {
        // We assume tables are already created on Neon before running the data copy
        // I will initialize them separately via db.js pointed to neon in a different step.

        // First, let's disable foreign key checks temporarly if we can?
        // Postgres doesn't easily let us disable FKs globally without dropping constraints.
        // But since we copy in the order of dependencies, it should work.

        for (const table of TABLES) {
            console.log(`Reading local data from ${table}...`);
            let res;
            try {
                 res = await localPool.query(`SELECT * FROM ${table}`);
            } catch (e) {
                 console.log(`Table ${table} might not exist locally: ${e.message}`);
                 continue;
            }
            
            const rows = res.rows;
            console.log(`Found ${rows.length} rows in ${table}. Migrating...`);

            if (rows.length === 0) continue;

            const columns = Object.keys(rows[0]);
            const colNames = columns.join(', ');

            for (const row of rows) {
                const values = columns.map(c => row[c]);
                const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

                const query = `INSERT INTO ${table} (${colNames}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
                try {
                    await neonPool.query(query, values);
                } catch (err) {
                    console.error(`Error inserting into ${table}:`, err.message);
                }
            }
            console.log(`Migrated ${table} successfully.`);

            // Update sequences for SERIAL columns
            try {
                 const seqRes = await neonPool.query(`SELECT MAX(id) FROM ${table}`);
                 const maxId = seqRes.rows[0].max;
                 if (maxId) {
                     await neonPool.query(`SELECT setval('${table}_id_seq', ${maxId})`);
                     console.log(`Updated sequence for ${table} to ${maxId}`);
                 }
            } catch(e) {
                 // Might not have an 'id' column
            }
        }
        console.log("Migration completed.");
    } catch (e) {
        console.error("Migration failed:", e);
    } finally {
        await localPool.end();
        await neonPool.end();
    }
}

migrate();
