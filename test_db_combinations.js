const { Pool } = require('pg');

const combos = [
  "AIn0q6QfxvXF",
  "Aln0q6QfxvXF",
  "AInOq6QfxvXF",
  "AlnOq6QfxvXF",
  "AInoq6QfxvXF",
  "A1n0q6QfxvXF",
  "A1nOq6QfxvXF",
  "AIn0q6QfxvXf"
];

async function testCombos() {
    for (const pwd of combos) {
        const uri = `postgresql://miniproject_owner:${pwd}@ep-spring-bird-a18tt3s3.ap-southeast-1.aws.neon.tech/miniproject?sslmode=require`;
        const pool = new Pool({ connectionString: uri, connectionTimeoutMillis: 3000 });
        try {
            await pool.query('SELECT 1');
            console.log("SUCCESS! Password is:", pwd);
            process.exit(0);
        } catch (e) {
            console.log("Failed for:", pwd);
        } finally {
            await pool.end();
        }
    }
    console.log("All combinations failed.");
}

testCombos();
