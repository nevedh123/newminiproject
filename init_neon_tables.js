require('dotenv').config();
process.env.DATABASE_URL = "postgresql://neondb_owner:npg_XYWSw9yGt4bs@ep-patient-mountain-amvifwqd-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require";

const { initDb } = require('./db.js');

async function initialize() {
    console.log("Initializing Neon database tables...");
    await initDb();
    console.log("Neon Database initialized successfully.");
    process.exit(0);
}

initialize();
