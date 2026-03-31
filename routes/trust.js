const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/authMiddleware');

// Helper: check if rater is eligible to rate the ratee
async function hasSharedExperience(raterId, rateeId) {
    // Check shared bookings (any listing they both booked)
    const sharedBooking = await pool.query(`
        SELECT 1 FROM bookings b1
        JOIN bookings b2 ON b1.listing_id = b2.listing_id
        WHERE b1.user_id = $1 AND b2.user_id = $2
        LIMIT 1
    `, [raterId, rateeId]);
    if (sharedBooking.rows.length > 0) return true;

    // Check marketplace: buyer chatted with seller (or vice versa)
    const sharedMarket = await pool.query(`
        SELECT 1 FROM marketplace_chats
        WHERE (buyer_id = $1 AND seller_id = $2)
           OR (buyer_id = $2 AND seller_id = $1)
        LIMIT 1
    `, [raterId, rateeId]);
    if (sharedMarket.rows.length > 0) return true;

    // Check accepted friendship
    const areFriends = await pool.query(`
        SELECT 1 FROM friends
        WHERE ((user_id1 = $1 AND user_id2 = $2) OR (user_id1 = $2 AND user_id2 = $1))
          AND status = 'accepted'
        LIMIT 1
    `, [raterId, rateeId]);
    return areFriends.rows.length > 0;
}

// Rate (or Update) a User — UPSERT
router.post('/rate', authenticateToken, async (req, res) => {
    try {
        const { rateeId, score, comment } = req.body;
        const raterId = req.user.id;

        if (raterId === parseInt(rateeId)) {
            return res.status(400).json({ message: 'Cannot rate yourself' });
        }
        if (!score || score < 1 || score > 5) {
            return res.status(400).json({ message: 'Score must be between 1 and 5' });
        }

        const eligible = await hasSharedExperience(raterId, parseInt(rateeId));
        if (!eligible) {
            return res.status(403).json({ message: 'You can only rate friends, split partners, or marketplace contacts' });
        }

        // Try UPSERT — gracefully handle missing UNIQUE constraint
        try {
            await pool.query(
                `INSERT INTO trust_scores (rater_id, ratee_id, score, comment)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (rater_id, ratee_id)
                 DO UPDATE SET score = $3, comment = $4, updated_at = NOW()`,
                [raterId, parseInt(rateeId), score, comment || '']
            );
        } catch (upsertErr) {
            // Fallback if UNIQUE constraint missing on old DB: DELETE then INSERT
            await pool.query(
                `DELETE FROM trust_scores WHERE rater_id = $1 AND ratee_id = $2`,
                [raterId, parseInt(rateeId)]
            );
            await pool.query(
                `INSERT INTO trust_scores (rater_id, ratee_id, score, comment) VALUES ($1, $2, $3, $4)`,
                [raterId, parseInt(rateeId), score, comment || '']
            );
        }

        res.json({ message: 'Rating submitted successfully' });
    } catch (err) {
        console.error('Rate error:', err.message);
        res.status(500).json({ message: 'Server error: ' + err.message });
    }
});


// Get ratings I've given to others
router.get('/my-ratings', authenticateToken, async (req, res) => {
    try {
        const raterId = req.user.id;
        const result = await pool.query(
            `SELECT ts.*, u.name as ratee_name, u.email as ratee_email
             FROM trust_scores ts
             JOIN users u ON ts.ratee_id = u.id
             WHERE ts.rater_id = $1
             ORDER BY ts.created_at DESC`,
            [raterId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Get a specific rating I gave to a user
router.get('/my-rating/:rateeId', authenticateToken, async (req, res) => {
    try {
        const raterId = req.user.id;
        const { rateeId } = req.params;
        const result = await pool.query(
            `SELECT * FROM trust_scores WHERE rater_id = $1 AND ratee_id = $2`,
            [raterId, rateeId]
        );
        res.json(result.rows[0] || null);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Public: Get any user's average trust score + name
router.get('/user/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `SELECT u.id, u.name, u.email,
                    COALESCE(AVG(ts.score), 0) as avg_score,
                    COUNT(ts.id) as rating_count
             FROM users u
             LEFT JOIN trust_scores ts ON ts.ratee_id = u.id
             WHERE u.id = $1
             GROUP BY u.id`,
            [id]
        );
        if (result.rows.length === 0) return res.status(404).json({ message: 'User not found' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Public: All users with their trust scores (for community page)
router.get('/all-users', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT u.id, u.name, u.email,
                    COALESCE(AVG(ts.score), 0) as avg_score,
                    COUNT(ts.id) as rating_count
             FROM users u
             LEFT JOIN trust_scores ts ON ts.ratee_id = u.id
             GROUP BY u.id
             ORDER BY avg_score DESC`
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// People I can rate (shared experience OR friends, not myself)
router.get('/rateable', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // People shared bookings with (co-consumers)
        const bookingPartners = await pool.query(`
            SELECT DISTINCT u.id, u.name, u.email,
                            COALESCE(AVG(ts2.score), 0) as avg_score,
                            COUNT(ts2.id) as rating_count,
                            ts_mine.score as my_rating,
                            ts_mine.comment as my_comment
            FROM bookings b1
            JOIN bookings b2 ON b1.listing_id = b2.listing_id AND b2.user_id != $1
            JOIN users u ON u.id = b2.user_id
            LEFT JOIN trust_scores ts2 ON ts2.ratee_id = u.id
            LEFT JOIN trust_scores ts_mine ON ts_mine.rater_id = $1 AND ts_mine.ratee_id = u.id
            WHERE b1.user_id = $1
            GROUP BY u.id, ts_mine.id
        `, [userId]);

        // Consumers who joined MY split (I am the provider)
        const myConsumers = await pool.query(`
            SELECT DISTINCT u.id, u.name, u.email,
                            COALESCE(AVG(ts2.score), 0) as avg_score,
                            COUNT(ts2.id) as rating_count,
                            ts_mine.score as my_rating,
                            ts_mine.comment as my_comment
            FROM listings l
            JOIN bookings b ON l.id = b.listing_id
            JOIN users u ON u.id = b.user_id AND u.id != $1
            LEFT JOIN trust_scores ts2 ON ts2.ratee_id = u.id
            LEFT JOIN trust_scores ts_mine ON ts_mine.rater_id = $1 AND ts_mine.ratee_id = u.id
            WHERE l.provider_id = $1
            GROUP BY u.id, ts_mine.id
        `, [userId]);

        // Providers of the splits I joined (I am the consumer)
        const myProviders = await pool.query(`
            SELECT DISTINCT u.id, u.name, u.email,
                            COALESCE(AVG(ts2.score), 0) as avg_score,
                            COUNT(ts2.id) as rating_count,
                            ts_mine.score as my_rating,
                            ts_mine.comment as my_comment
            FROM bookings b
            JOIN listings l ON b.listing_id = l.id AND l.provider_id != $1
            JOIN users u ON u.id = l.provider_id
            LEFT JOIN trust_scores ts2 ON ts2.ratee_id = u.id
            LEFT JOIN trust_scores ts_mine ON ts_mine.rater_id = $1 AND ts_mine.ratee_id = u.id
            WHERE b.user_id = $1
            GROUP BY u.id, ts_mine.id
        `, [userId]);

        // People shared marketplace chats with
        const marketPartners = await pool.query(`
            SELECT DISTINCT u.id, u.name, u.email,
                            COALESCE(AVG(ts2.score), 0) as avg_score,
                            COUNT(ts2.id) as rating_count,
                            ts_mine.score as my_rating,
                            ts_mine.comment as my_comment
            FROM marketplace_chats mc
            JOIN users u ON u.id = CASE WHEN mc.buyer_id = $1 THEN mc.seller_id ELSE mc.buyer_id END
            LEFT JOIN trust_scores ts2 ON ts2.ratee_id = u.id
            LEFT JOIN trust_scores ts_mine ON ts_mine.rater_id = $1 AND ts_mine.ratee_id = u.id
            WHERE mc.buyer_id = $1 OR mc.seller_id = $1
            GROUP BY u.id, ts_mine.id
        `, [userId]);

        // Accepted friends (can also rate each other)
        const friendPartners = await pool.query(`
            SELECT DISTINCT u.id, u.name, u.email,
                            COALESCE(AVG(ts2.score), 0) as avg_score,
                            COUNT(ts2.id) as rating_count,
                            ts_mine.score as my_rating,
                            ts_mine.comment as my_comment
            FROM friends f
            JOIN users u ON u.id = CASE WHEN f.user_id1 = $1 THEN f.user_id2 ELSE f.user_id1 END
            LEFT JOIN trust_scores ts2 ON ts2.ratee_id = u.id
            LEFT JOIN trust_scores ts_mine ON ts_mine.rater_id = $1 AND ts_mine.ratee_id = u.id
            WHERE (f.user_id1 = $1 OR f.user_id2 = $1) AND f.status = 'accepted'
            GROUP BY u.id, ts_mine.id
        `, [userId]);

        // Merge and deduplicate
        const seen = new Set();
        const merged = [];
        for (const row of [...bookingPartners.rows, ...myConsumers.rows, ...myProviders.rows, ...marketPartners.rows, ...friendPartners.rows]) {
            if (!seen.has(row.id)) {
                seen.add(row.id);
                merged.push(row);
            }
        }

        res.json(merged);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;

