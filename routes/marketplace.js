const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/authMiddleware');

// Get All Marketplace Items
router.get('/', async (req, res) => {
    try {
        const { type, category, exclude_seller_id, seller_id } = req.query;
        let query = 'SELECT m.*, u.name as seller_name FROM marketplace_items m JOIN users u ON m.seller_id = u.id WHERE m.status = \'active\'';
        const params = [];

        if (type && type !== 'all' && type !== 'my') {
            params.push(type);
            query += ` AND m.type = $${params.length}`;
        }

        if (category && category !== 'All') {
            params.push(category);
            query += ` AND m.category = $${params.length}`;
        }

        if (exclude_seller_id) {
            params.push(parseInt(exclude_seller_id));
            query += ` AND m.seller_id != $${params.length}`;
        }

        if (seller_id) {
            params.push(parseInt(seller_id));
            query += ` AND m.seller_id = $${params.length}`;
        }

        query += ' ORDER BY m.created_at DESC';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// Create Listing
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { type, category, title, description, price, starting_bid, auction_end, images } = req.body;
        const seller_id = req.user.id;

        const parsedPrice = price === '' || price === undefined ? null : parseFloat(price);
        const parsedStartingBid = starting_bid === '' || starting_bid === undefined ? null : parseFloat(starting_bid);
        const parsedAuctionEnd = auction_end === '' || auction_end === undefined ? null : auction_end;

        const result = await pool.query(
            `INSERT INTO marketplace_items (seller_id, type, category, title, description, price, starting_bid, current_highest_bid, auction_end, images) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9) RETURNING *`,
            [seller_id, type, category, title, description, parsedPrice, parsedStartingBid, parsedAuctionEnd, JSON.stringify(images || [])]
        );

        res.json(result.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// Deactivate / Mark as Sold
router.patch('/:id/deactivate', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const sellerId = req.user.id;

        const item = await pool.query('SELECT seller_id FROM marketplace_items WHERE id = $1', [id]);
        if (item.rows.length === 0) return res.status(404).json({ message: 'Item not found' });
        if (item.rows[0].seller_id !== sellerId) return res.status(403).json({ message: 'Not authorized' });

        const updated = await pool.query(
            "UPDATE marketplace_items SET status = 'sold' WHERE id = $1 RETURNING *",
            [id]
        );
        res.json(updated.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// Place Bid
router.post('/:id/bid', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { amount } = req.body;
        const bidder_id = req.user.id;

        const item = await pool.query('SELECT * FROM marketplace_items WHERE id = $1 AND type = \'auction\'', [id]);
        if (item.rows.length === 0) return res.status(404).json({ message: "Auction item not found" });

        const currentBid = parseFloat(item.rows[0].current_highest_bid || item.rows[0].starting_bid);
        if (amount <= currentBid) {
            return res.status(400).json({ message: "Bid must be higher than current price" });
        }

        if (new Date(item.rows[0].auction_end) < new Date()) {
            return res.status(400).json({ message: "Auction has ended" });
        }

        // Transaction for bidding
        await pool.query('BEGIN');
        await pool.query('INSERT INTO bids (item_id, bidder_id, amount) VALUES ($1, $2, $3)', [id, bidder_id, amount]);
        const updated = await pool.query(
            'UPDATE marketplace_items SET current_highest_bid = $1, highest_bidder_id = $2 WHERE id = $3 RETURNING *',
            [amount, bidder_id, id]
        );
        await pool.query('COMMIT');

        res.json(updated.rows[0]);
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// Get My Activity (Bought and Bidded)
router.get('/my-activity', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // Items where user is the highest bidder or has bidded
        const auctions = await pool.query(
            `SELECT DISTINCT m.*, u.name as seller_name 
             FROM marketplace_items m 
             JOIN bids b ON m.id = b.item_id 
             JOIN users u ON m.seller_id = u.id 
             WHERE b.bidder_id = $1`,
            [userId]
        );

        // Items bought (placeholder until purchase logic is added, for now return nothing)
        const purchases = [];

        res.json({ auctions: auctions.rows, purchases });
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// Get User's Messaging Inbox
router.get('/chats/inbox', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const chats = await pool.query(
            `SELECT c.*, m.title as item_title, 
                    u_buyer.name as buyer_name, u_seller.name as seller_name,
                    (SELECT content FROM marketplace_messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
                    (SELECT created_at FROM marketplace_messages WHERE chat_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_time
             FROM marketplace_chats c
             JOIN marketplace_items m ON c.item_id = m.id
             JOIN users u_buyer ON c.buyer_id = u_buyer.id
             JOIN users u_seller ON c.seller_id = u_seller.id
             LEFT JOIN split_requests sr ON sr.item_id = c.item_id AND sr.creator_id = c.buyer_id
             LEFT JOIN split_members sm ON sm.split_id = sr.id AND sm.user_id = $1
             WHERE c.buyer_id = $1 OR c.seller_id = $1 OR sm.user_id IS NOT NULL
             ORDER BY last_message_time DESC NULLS LAST, c.created_at DESC`,
            [userId]
        );
        res.json(chats.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// --- Chat Logic ---

// Get or Create Chat
router.post('/chats', authenticateToken, async (req, res) => {
    try {
        const { item_id } = req.body;
        const buyer_id = req.user.id;

        const item = await pool.query('SELECT seller_id FROM marketplace_items WHERE id = $1', [item_id]);
        if (item.rows.length === 0) return res.status(404).json({ message: "Item not found" });
        const seller_id = item.rows[0].seller_id;

        if (buyer_id === seller_id) return res.status(400).json({ message: "You cannot chat with yourself" });

        // If user is in a split for this item, use the creator's chat rather than creating a duplicate
        const splitCheck = await pool.query(`
            SELECT sr.creator_id 
            FROM split_requests sr
            JOIN split_members sm ON sr.id = sm.split_id
            WHERE sr.item_id = $1 AND sm.user_id = $2
        `, [item_id, buyer_id]);

        let chatBuyerId = buyer_id;
        if (splitCheck.rows.length > 0) {
            chatBuyerId = splitCheck.rows[0].creator_id;
        }

        const chat = await pool.query(
            `INSERT INTO marketplace_chats (item_id, buyer_id, seller_id) 
             VALUES ($1, $2, $3) 
             ON CONFLICT (item_id, buyer_id) DO UPDATE SET item_id = EXCLUDED.item_id 
             RETURNING *`,
            [item_id, chatBuyerId, seller_id]
        );

        res.json(chat.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// Send Message
router.post('/messages', authenticateToken, async (req, res) => {
    try {
        const { chat_id, content } = req.body;
        const sender_id = req.user.id;

        // Verify Access
        const accessCheck = await pool.query(
            `SELECT c.id 
             FROM marketplace_chats c
             LEFT JOIN split_requests sr ON sr.item_id = c.item_id AND sr.creator_id = c.buyer_id
             LEFT JOIN split_members sm ON sm.split_id = sr.id AND sm.user_id = $2
             WHERE c.id = $1 AND (c.buyer_id = $2 OR c.seller_id = $2 OR sm.user_id IS NOT NULL)`,
            [chat_id, sender_id]
        );

        if (accessCheck.rows.length === 0) return res.status(403).json({ message: "Not authorized to write to this chat" });

        const message = await pool.query(
            'INSERT INTO marketplace_messages (chat_id, sender_id, content) VALUES ($1, $2, $3) RETURNING *',
            [chat_id, sender_id, content]
        );

        res.json(message.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// Get Messages for Chat
router.get('/chats/:id/messages', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        // Verify Access
        const accessCheck = await pool.query(
            `SELECT c.id 
             FROM marketplace_chats c
             LEFT JOIN split_requests sr ON sr.item_id = c.item_id AND sr.creator_id = c.buyer_id
             LEFT JOIN split_members sm ON sm.split_id = sr.id AND sm.user_id = $2
             WHERE c.id = $1 AND (c.buyer_id = $2 OR c.seller_id = $2 OR sm.user_id IS NOT NULL)`,
            [id, userId]
        );

        if (accessCheck.rows.length === 0) return res.status(403).json({ message: "Not authorized to view this chat" });

        const messages = await pool.query(
            `SELECT m.*, u.name as sender_name 
             FROM marketplace_messages m 
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

module.exports = router;
