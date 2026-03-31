const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/authMiddleware');
const { isAdmin } = require('../middleware/admin');

// Middleware to ensure all routes here require admin access
router.use(authenticateToken, isAdmin);

// ─── USERS ───────────────────────────────────────────────────────────────────

// GET /api/admin/users - All registered users
router.get('/users', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, name, email, role, created_at,
                   (SELECT COUNT(*) FROM bookings WHERE user_id = users.id) as booking_count,
                   (SELECT COUNT(*) FROM marketplace_items WHERE seller_id = users.id) as listing_count
            FROM users ORDER BY created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// PUT /api/admin/users/:id/role - Change user role
router.put('/users/:id/role', async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;
        if (!['consumer', 'provider', 'admin'].includes(role)) {
            return res.status(400).json({ message: 'Invalid role' });
        }
        await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, id]);
        res.json({ message: `User role updated to ${role}` });
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// DELETE /api/admin/users/:id - Remove a user
router.delete('/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        // SOFT BAN instead of DELETE to avoid foreign key issues
        await pool.query('UPDATE users SET is_banned = TRUE WHERE id = $1', [id]);
        res.json({ message: "User banned successfully" });
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// ─── LISTINGS ────────────────────────────────────────────────────────────────

// GET /api/admin/listings/pending - Fetch all pending listings
router.get('/listings/pending', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT l.*, u.name as provider_name, u.email as provider_email
            FROM listings l
            LEFT JOIN users u ON l.provider_id = u.id
            WHERE l.approved = FALSE ORDER BY l.created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// GET /api/admin/listings/all - All listings
router.get('/listings/all', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT l.*, u.name as provider_name, u.email as provider_email
            FROM listings l
            LEFT JOIN users u ON l.provider_id = u.id
            ORDER BY l.created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// PUT /api/admin/listings/:id/approve - Approve a listing
router.put('/listings/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query("UPDATE listings SET approved = TRUE, status = 'approved' WHERE id = $1", [id]);
        res.json({ message: "Listing approved successfully" });
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// DELETE /api/admin/listings/:id/reject - Reject (Soft-Delete) a listing
router.delete('/listings/:id/reject', async (req, res) => {
    try {
        const { id } = req.params;
        // Soft reject instead of delete to avoid foreign key errors
        await pool.query("UPDATE listings SET approved = FALSE, status = 'rejected' WHERE id = $1", [id]);
        res.json({ message: "Listing rejected successfully" });
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// ─── BOOKINGS ────────────────────────────────────────────────────────────────

// GET /api/admin/bookings - Fetch all bookings with details
router.get('/bookings', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT b.*, u.name as user_name, u.email as user_email, l.type as listing_type,
                   l.price_per_unit, l.base_cost,
                   dp.id as payment_table_id, dp.confirmation_id, dp.status as dp_status
            FROM bookings b
            JOIN users u ON b.user_id = u.id
            JOIN listings l ON b.listing_id = l.id
            LEFT JOIN dummy_payments dp ON dp.booking_id = b.id
            ORDER BY b.is_priority DESC, b.created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// PUT /api/admin/bookings/:id/prioritize - Toggle booking priority
router.put('/bookings/:id/prioritize', async (req, res) => {
    try {
        const { id } = req.params;
        const currentRes = await pool.query('SELECT is_priority FROM bookings WHERE id = $1', [id]);
        if (currentRes.rows.length === 0) return res.status(404).json({ message: "Booking not found" });

        const newPriority = !currentRes.rows[0].is_priority;
        await pool.query('UPDATE bookings SET is_priority = $1 WHERE id = $2', [newPriority, id]);

        res.json({ message: `Booking priority updated to ${newPriority}`, is_priority: newPriority });
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// PUT /api/admin/bookings/:id/status - Update booking status and ETA
router.put('/bookings/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, eta } = req.body;
        
        const result = await pool.query(
            'UPDATE bookings SET status = $1, eta = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *',
            [status, eta, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Booking not found" });
        }

        const booking = result.rows[0];
        
        // Emit real-time update via Socket.IO
        const io = req.app.get('io');
        if (io) {
            io.to(`user_${booking.user_id}`).emit('order_update', {
                orderId: booking.id,
                status: booking.status,
                eta: booking.eta,
                updatedAt: booking.updated_at
            });
            console.log(`[SOCKET] Emitted update for user_${booking.user_id}, booking ${booking.id}`);
        }

        res.json({ message: `Booking status updated to ${status}`, booking });
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// ─── MARKETPLACE POSTS ───────────────────────────────────────────────────────

// GET /api/admin/marketplace/posts - All marketplace items
router.get('/marketplace/posts', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT mi.*, u.name as seller_name, u.email as seller_email
            FROM marketplace_items mi
            LEFT JOIN users u ON mi.seller_id = u.id
            ORDER BY mi.created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// PUT /api/admin/marketplace/:id/approve - Approve marketplace item
router.put('/marketplace/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query("UPDATE marketplace_items SET status = 'active' WHERE id = $1", [id]);
        res.json({ message: "Marketplace item approved" });
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// PUT /api/admin/marketplace/:id/reject - Reject marketplace item
router.put('/marketplace/:id/reject', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query("UPDATE marketplace_items SET status = 'rejected' WHERE id = $1", [id]);
        res.json({ message: "Marketplace item rejected" });
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// ─── SPLIT REQUESTS ──────────────────────────────────────────────────────────

// GET /api/admin/splits/all - All split requests
router.get('/splits/all', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT sr.*, u.name as creator_name, u.email as creator_email,
                   mi.title as item_title, mi.type as item_type
            FROM split_requests sr
            LEFT JOIN users u ON sr.creator_id = u.id
            LEFT JOIN marketplace_items mi ON sr.item_id = mi.id
            ORDER BY sr.created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// PUT /api/admin/splits/:id/approve - Approve split request
router.put('/splits/:id/approve', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query("UPDATE split_requests SET status = 'open' WHERE id = $1", [id]);
        res.json({ message: "Split request approved" });
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// PUT /api/admin/splits/:id/reject - Reject split request
router.put('/splits/:id/reject', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query("UPDATE split_requests SET status = 'rejected' WHERE id = $1", [id]);
        res.json({ message: "Split request rejected" });
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// ─── TRACKING ────────────────────────────────────────────────────────────────

// GET /api/admin/tracking/pending - Fetch unconfirmed tracking updates
router.get('/tracking/pending', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT t.*, l.type as listing_type, l.location as route_details, u.name as provider_name
            FROM tracking_updates t
            JOIN listings l ON t.listing_id = l.id
            JOIN users u ON l.provider_id = u.id
            WHERE t.is_confirmed = FALSE
            ORDER BY t.reported_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// PUT /api/admin/tracking/:id/confirm - Confirm a tracking update
router.put('/tracking/:id/confirm', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('UPDATE tracking_updates SET is_confirmed = TRUE WHERE id = $1', [id]);
        res.json({ message: "Tracking update confirmed" });
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// DELETE /api/admin/tracking/:id/reject - Reject (Delete) a tracking update
router.delete('/tracking/:id/reject', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM tracking_updates WHERE id = $1', [id]);
        res.json({ message: "Tracking update rejected and removed" });
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// ─── SITE INQUIRIES ──────────────────────────────────────────────────────────

// GET /api/admin/inquiries - Fetch all site inquiries
router.get('/inquiries', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM site_inquiries ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// DELETE /api/admin/inquiries/:id - Remove an inquiry
router.delete('/inquiries/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM site_inquiries WHERE id = $1', [id]);
        res.json({ message: "Inquiry removed successfully" });
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// ─── STATS ───────────────────────────────────────────────────────────────────

// GET /api/admin/overview - Dashboard stats
router.get('/overview', async (req, res) => {
    try {
        const [users, bookings, listings, marketplace, splits, tracking, inquiries] = await Promise.all([
            pool.query('SELECT COUNT(*) FROM users'),
            pool.query('SELECT COUNT(*) FROM bookings'),
            pool.query('SELECT COUNT(*) FROM listings WHERE approved = FALSE'),
            pool.query("SELECT COUNT(*) FROM marketplace_items WHERE status NOT IN ('active', 'rejected')"),
            pool.query("SELECT COUNT(*) FROM split_requests WHERE status = 'pending'"),
            pool.query('SELECT COUNT(*) FROM tracking_updates WHERE is_confirmed = FALSE'),
            pool.query('SELECT COUNT(*) FROM site_inquiries'),
        ]);
        res.json({
            totalUsers: parseInt(users.rows[0].count),
            totalBookings: parseInt(bookings.rows[0].count),
            pendingListings: parseInt(listings.rows[0].count),
            pendingMarketplace: parseInt(marketplace.rows[0].count),
            pendingSplits: parseInt(splits.rows[0].count),
            pendingTracking: parseInt(tracking.rows[0].count),
            totalInquiries: parseInt(inquiries.rows[0].count),
        });
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

module.exports = router;
