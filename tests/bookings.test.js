const request = require('supertest');
const { app } = require('../server');
const { pool } = require('../db');

describe('Bookings API', () => {
    let providerToken;
    let consumerToken;
    let providerId;
    let consumerId;
    let listingId;
    let bookingId;

    const provider = { name: 'P1', email: `p_${Date.now()}@test.com`, password: 'pw' };
    const consumer = { name: 'C1', email: `c_${Date.now()}@test.com`, password: 'pw' };

    beforeAll(async () => {
        // Setup Provider
        await request(app).post('/api/auth/register').send(provider);
        const pLogin = await request(app).post('/api/auth/login').send({ email: provider.email, password: provider.password });
        providerToken = pLogin.body.token;
        providerId = pLogin.body.user.id;

        // Setup Consumer
        await request(app).post('/api/auth/register').send(consumer);
        const cLogin = await request(app).post('/api/auth/login').send({ email: consumer.email, password: consumer.password });
        consumerToken = cLogin.body.token;
        consumerId = cLogin.body.user.id;

        // Create a Listing to book (and approve it)
        const listRes = await request(app)
            .post('/api/listings')
            .set('Authorization', `Bearer ${providerToken}`)
            .send({ type: 'Test', capacity: '100kg', price_per_unit: 10, location: 'X', date: 'Now', details: {} });
        listingId = listRes.body.id;
        
        // Force approve the listing for consumer to see it (or just book it directly since we have the ID)
        await pool.query('UPDATE listings SET approved = TRUE WHERE id = $1', [listingId]);
    });

    afterAll(async () => {
        await pool.query('DELETE FROM bookings WHERE user_id = $1', [consumerId]);
        await pool.query('DELETE FROM listings WHERE provider_id = $1', [providerId]);
        await pool.query('DELETE FROM users WHERE id IN ($1, $2)', [providerId, consumerId]);
    });

    it('TC-08: Should create a booking with sufficient capacity', async () => {
        const res = await request(app)
            .post('/api/bookings')
            .set('Authorization', `Bearer ${consumerToken}`)
            .send({ listing_id: listingId, quantity: 10, unit: 'kg' });
        
        expect(res.statusCode).toEqual(200);
        expect(res.body.message).toBe('Booking successful');
        expect(res.body.booking).toHaveProperty('id');
        bookingId = res.body.booking.id;
    });

    it('TC-09: Should verify accurate booking information', async () => {
        const res = await request(app)
            .get('/api/bookings')
            .set('Authorization', `Bearer ${consumerToken}`);
        
        expect(res.statusCode).toEqual(200);
        const booking = res.body.find(b => b.id === bookingId);
        expect(booking).toBeDefined();
        expect(parseInt(booking.quantity)).toBe(10);
    });

    it('TC-10: Should allow a consumer to request cancellation', async () => {
        const res = await request(app)
            .post(`/api/bookings/${bookingId}/cancel-request`)
            .set('Authorization', `Bearer ${consumerToken}`)
            .send({ reason: 'Test cancellation' });
        
        expect(res.statusCode).toEqual(200);
        expect(res.body.booking.cancellation_status).toBe('requested');
    });
});
