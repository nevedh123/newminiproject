const { Pool } = require('pg');

const char1 = ['I', 'l', '1'];
const char3 = ['n', 'h', 'm'];
const char4 = ['0', 'O', 'o'];
const char5 = ['q', 'g', 'p'];

const combos = [];
for(let c1 of char1) {
  for(let c3 of char3) {
    for(let c4 of char4) {
      for(let c5 of char5) {
        combos.push(`A${c1}${c3}${c4}${c5}6QfxvXF`);
      }
    }
  }
}

async function testCombos() {
    console.log(`Testing ${combos.length} combinations...`);
    for (const pwd of combos) {
        const uri = `postgresql://miniproject_owner:${pwd}@ep-spring-bird-a18tt3s3.ap-southeast-1.aws.neon.tech/miniproject?sslmode=require`;
        const pool = new Pool({ connectionString: uri, connectionTimeoutMillis: 5000 });
        try {
            await pool.query('SELECT 1');
            console.log("SUCCESS! Password is:", pwd);
            process.exit(0);
        } catch (e) {
            // failed
        } finally {
            await pool.end();
        }
    }
    console.log("All combinations failed.");
}

testCombos();
