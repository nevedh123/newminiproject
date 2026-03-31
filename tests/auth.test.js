const request = require('supertest');
const { app } = require('../server');
const { pool } = require('../db');

describe('Auth Controller - Login', () => {
    const testUser = {
        name: 'Test User',
        email: `test_${Date.now()}@example.com`,
        password: 'password123'
    };

    afterAll(async () => {
        await pool.query('DELETE FROM users WHERE email = $1', [testUser.email]);
    });

    it('should register a new user successfully', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send(testUser);
        
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty('token');
    });

    it('should log in successfully with valid credentials', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({
                email: testUser.email,
                password: testUser.password
            });
        
        expect(res.statusCode).toEqual(200);
        expect(res.body).toHaveProperty('token');
    });

    it('should return 401 for invalid username or password', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({
                email: testUser.email,
                password: 'wrongpassword'
            });
        
        expect(res.statusCode).toEqual(401);
        expect(res.body).toHaveProperty('message', 'Invalid credentials');
    });

    it('should return 401 for non-existent user', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({
                email: 'nonexistent@example.com',
                password: 'password123'
            });
        
        expect(res.statusCode).toEqual(401);
        expect(res.body).toHaveProperty('message', 'Invalid credentials');
    });
});
