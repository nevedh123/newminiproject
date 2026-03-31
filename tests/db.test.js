const { pool } = require('../db');

describe('Database Connection', () => {
    it('Should connect to PostgreSQL and run a simple query', async () => {
        const res = await pool.query('SELECT NOW()');
        expect(res.rows.length).toBe(1);
    });

    it('Should have the users table', async () => {
        const res = await pool.query("SELECT to_regclass('public.users')");
        expect(res.rows[0].to_regclass).not.toBeNull();
    });

    it('Should have the listings table', async () => {
        const res = await pool.query("SELECT to_regclass('public.listings')");
        expect(res.rows[0].to_regclass).not.toBeNull();
    });
});
