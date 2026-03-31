const request = require('supertest');
const { app } = require('../server');
const { pool } = require('../db');

describe('Listings API', () => {
    let token;
    let listingId;
    const providerUser = {
        name: 'Provider User',
        email: `provider_${Date.now()}@example.com`,
        password: 'password123'
    };

    beforeAll(async () => {
        // Register and login to get token
        await request(app).post('/api/auth/register').send(providerUser);
        const loginRes = await request(app).post('/api/auth/login').send({
            email: providerUser.email,
            password: providerUser.password
        });
        token = loginRes.body.token;
    });

    afterAll(async () => {
        await pool.query('DELETE FROM listings WHERE provider_id IN (SELECT id FROM users WHERE email = $1)', [providerUser.email]);
        await pool.query('DELETE FROM users WHERE email = $1', [providerUser.email]);
    });

    it('TC-04: Should create a new listing', async () => {
        const res = await request(app)
            .post('/api/listings')
            .set('Authorization', `Bearer ${token}`)
            .send({
                type: 'Cargo Split',
                capacity: '1000kg',
                price_per_unit: 50,
                location: 'City A -> City B',
                date: '2026-05-01',
                details: { info: 'Test listing' },
                base_cost: 100
            });
        
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty('id');
        listingId = res.body.id;
    });

    it('TC-05: Should get provider listings', async () => {
        const res = await request(app)
            .get('/api/listings/my')
            .set('Authorization', `Bearer ${token}`);
        
        expect(res.statusCode).toEqual(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
    });

    it('TC-06: Should update an existing listing', async () => {
        const res = await request(app)
            .put(`/api/listings/${listingId}`)
            .set('Authorization', `Bearer ${token}`)
            .send({
                capacity: '1200kg',
                price_per_unit: 55
            });
        
        expect(res.statusCode).toEqual(200);
        expect(res.body.capacity).toBe('1200kg');
    });

    it('TC-07: Should delete a listing', async () => {
        const res = await request(app)
            .delete(`/api/listings/${listingId}`)
            .set('Authorization', `Bearer ${token}`);
        
        expect(res.statusCode).toEqual(200);
        expect(res.body.message).toBe('Listing deleted successfully');
    });
});
