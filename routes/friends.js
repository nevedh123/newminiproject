const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/authMiddleware');

// Send Friend Request
router.post('/request', authenticateToken, async (req, res) => {
    try {
        const { friendId } = req.body;
        const userId = req.user.id;

        if (userId === parseInt(friendId)) return res.status(400).json({ message: "Cannot friend yourself" });

        const [id1, id2] = userId < parseInt(friendId) ? [userId, parseInt(friendId)] : [parseInt(friendId), userId];

        await pool.query(
            "INSERT INTO friends (user_id1, user_id2, status) VALUES ($1, $2, 'pending') ON CONFLICT DO NOTHING",
            [id1, id2]
        );

        // Look up requester's name
        const userRow = await pool.query("SELECT name FROM users WHERE id = $1", [userId]);
        const requesterName = userRow.rows[0]?.name || `User ${userId}`;

        // Create notification for the recipient — include requester ID at end for parsing
        await pool.query(
            "INSERT INTO notifications (user_id, type, content) VALUES ($1, 'friend_request', $2)",
            [parseInt(friendId), `${requesterName} wants to be your friend. [ID: ${userId}]`]
        );

        res.json({ message: "Friend request sent" });
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// Accept Friend Request
router.post('/accept', authenticateToken, async (req, res) => {
    try {
        const { requesterId } = req.body;
        const userId = req.user.id;
        const [id1, id2] = userId < requesterId ? [userId, requesterId] : [requesterId, userId];

        const result = await pool.query(
            "UPDATE friends SET status = 'accepted' WHERE user_id1 = $1 AND user_id2 = $2 RETURNING *",
            [id1, id2]
        );

        if (result.rows.length === 0) return res.status(404).json({ message: "Request not found" });

        res.json({ message: "Friend request accepted" });
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// Get My Friends
router.get('/my-friends', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await pool.query(`
            SELECT u.id, u.name, u.email, COALESCE(AVG(ts.score), 0) as trust_score
            FROM users u
            JOIN friends f ON (u.id = f.user_id1 OR u.id = f.user_id2)
            LEFT JOIN trust_scores ts ON u.id = ts.ratee_id
            WHERE (f.user_id1 = $1 OR f.user_id2 = $1) AND u.id != $1 AND f.status = 'accepted'
            GROUP BY u.id
        `, [userId]);
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// Get Recommendations (Users I've split with)
router.get('/recommendations', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        // Find users who are not friends yet but shared a listing
        const result = await pool.query(`
            SELECT DISTINCT u.id, u.name, u.email
            FROM users u
            JOIN bookings b1 ON u.id = b1.user_id
            JOIN bookings b2 ON b1.listing_id = b2.listing_id
            WHERE b2.user_id = $1 AND u.id != $1
            AND u.id NOT IN (
                SELECT CASE WHEN user_id1 = $1 THEN user_id2 ELSE user_id1 END
                FROM friends
                WHERE user_id1 = $1 OR user_id2 = $1
            )
        `, [userId]);
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// ---------------------------------------------------------
// FRIEND CHAT ENDPOINTS
// ---------------------------------------------------------

// Get or Create Chat with a Friend
router.post('/chats', authenticateToken, async (req, res) => {
    try {
        const { friend_id } = req.body;
        const userId = req.user.id;

        if (userId === parseInt(friend_id)) return res.status(400).json({ message: "Cannot chat with yourself" });

        // Verify they are accepted friends
        const [id1, id2] = userId < parseInt(friend_id) ? [userId, parseInt(friend_id)] : [parseInt(friend_id), userId];
        const friendCheck = await pool.query(
            "SELECT * FROM friends WHERE user_id1 = $1 AND user_id2 = $2 AND status = 'accepted'",
            [id1, id2]
        );

        if (friendCheck.rows.length === 0) return res.status(403).json({ message: "You can only chat with accepted friends" });

        // Create or get chat
        const chat = await pool.query(
            `INSERT INTO friend_chats (user_id1, user_id2) 
             VALUES ($1, $2)
             ON CONFLICT (user_id1, user_id2) DO UPDATE SET user_id1 = EXCLUDED.user_id1
             RETURNING *`,
            [id1, id2]
        );

        res.json(chat.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// Get Messages for a Friend Chat
router.get('/chats/:id/messages', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        // Verify the user is part of the chat
        const accessCheck = await pool.query(
            "SELECT * FROM friend_chats WHERE id = $1 AND (user_id1 = $2 OR user_id2 = $2)",
            [id, userId]
        );

        if (accessCheck.rows.length === 0) return res.status(403).json({ message: "Not authorized to view this chat" });

        const messages = await pool.query(
            `SELECT m.*, u.name as sender_name 
             FROM friend_messages m
             JOIN users u ON m.sender_id = u.id
             WHERE m.chat_id = $1 
             ORDER BY m.created_at ASC`,
            [id]
        );

        res.json(messages.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// Send Message to a Friend Chat
router.post('/messages', authenticateToken, async (req, res) => {
    try {
        const { chat_id, content } = req.body;
        const sender_id = req.user.id;

        const accessCheck = await pool.query(
            "SELECT * FROM friend_chats WHERE id = $1 AND (user_id1 = $2 OR user_id2 = $2)",
            [chat_id, sender_id]
        );

        if (accessCheck.rows.length === 0) return res.status(403).json({ message: "Not authorized to send to this chat" });

        const message = await pool.query(
            "INSERT INTO friend_messages (chat_id, sender_id, content) VALUES ($1, $2, $3) RETURNING *",
            [chat_id, sender_id, content]
        );

        res.json(message.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

module.exports = router;
