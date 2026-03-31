const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/authMiddleware');

// Create Listing (Provider Only)
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { type, capacity, price_per_unit, location, date, details, base_cost } = req.body;
        const providerId = req.user.id;

        // Verify user is a provider (optional, but good practice)
        // if (req.user.role !== 'provider') return res.status(403).json({ message: "Access denied" });

        const newListing = await pool.query(
            `INSERT INTO listings (provider_id, type, capacity, price_per_unit, location, date, details, base_cost) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [providerId, type, capacity, price_per_unit, location, date, JSON.stringify(details), base_cost || 0]
        );

        res.json(newListing.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// Get Provider's Own Listings
router.get('/my', authenticateToken, async (req, res) => {
    try {
        const providerId = req.user.id;
        const result = await pool.query('SELECT * FROM listings WHERE provider_id = $1 ORDER BY created_at DESC', [providerId]);
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// Get All Listings (For Consumers)
router.get('/', async (req, res) => {
    try {
        // Build query based on filters if needed, for now return all approved
        const listings = await pool.query('SELECT * FROM listings WHERE approved = TRUE ORDER BY created_at DESC');
        res.json(listings.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// Update a Listing (Provider Only)
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const providerId = req.user.id;
        const { capacity, price_per_unit, location, date, base_cost, details } = req.body;

        // Verify ownership
        const listingCheck = await pool.query('SELECT provider_id, details FROM listings WHERE id = $1', [id]);
        if (listingCheck.rows.length === 0) {
            return res.status(404).json({ message: "Listing not found" });
        }
        if (listingCheck.rows[0].provider_id !== providerId) {
            return res.status(403).json({ message: "Not authorized to edit this listing" });
        }

        let newDetails = listingCheck.rows[0].details || {};
        if (details) {
            newDetails = { ...newDetails, ...details };
        }

        const updatedListing = await pool.query(
            `UPDATE listings 
             SET capacity = COALESCE($1, capacity), 
                 price_per_unit = COALESCE($2, price_per_unit), 
                 location = COALESCE($3, location), 
                 date = COALESCE($4, date), 
                 base_cost = COALESCE($5, base_cost),
                 details = $6
             WHERE id = $7 RETURNING *`,
            [capacity, price_per_unit, location, date, base_cost, JSON.stringify(newDetails), id]
        );

        res.json(updatedListing.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// Delete a Listing (Provider Only)
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const providerId = req.user.id;

        // Verify ownership
        const listingCheck = await pool.query('SELECT provider_id FROM listings WHERE id = $1', [id]);
        if (listingCheck.rows.length === 0) {
            return res.status(404).json({ message: "Listing not found" });
        }
        if (listingCheck.rows[0].provider_id !== providerId) {
            return res.status(403).json({ message: "Not authorized to delete this listing" });
        }

        // Delete associated bookings first to prevent foreign key errors
        await pool.query('DELETE FROM bookings WHERE listing_id = $1', [id]);
        await pool.query('DELETE FROM listings WHERE id = $1', [id]);

        res.json({ message: "Listing deleted successfully" });
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// Get all users who booked a listing (Provider / Creator only)
router.get('/:id/joiners', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const providerId = req.user.id;

        // Verify ownership
        const listingCheck = await pool.query('SELECT provider_id FROM listings WHERE id = $1', [id]);
        if (listingCheck.rows.length === 0) return res.status(404).json({ message: 'Listing not found' });
        if (listingCheck.rows[0].provider_id !== providerId) return res.status(403).json({ message: 'Not authorized' });

        const result = await pool.query(
            `SELECT u.id, u.name, u.email, b.quantity, b.status, b.created_at as joined_at
             FROM bookings b
             JOIN users u ON b.user_id = u.id
             WHERE b.listing_id = $1
             ORDER BY b.created_at ASC`,
            [id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});


router.put('/:id/location', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { current_location } = req.body;
        const providerId = req.user.id;

        if (!current_location) {
            return res.status(400).json({ message: 'current_location is required' });
        }

        // Verify ownership
        const listingRes = await pool.query(
            'SELECT provider_id, type, details FROM listings WHERE id = $1',
            [id]
        );
        if (listingRes.rows.length === 0) {
            return res.status(404).json({ message: 'Listing not found' });
        }
        const listing = listingRes.rows[0];
        if (listing.provider_id !== providerId) {
            return res.status(403).json({ message: 'Not authorized' });
        }

        // Validate the location is among the defined stops
        const route = listing.details?.route_full;
        if (route) {
            const validNames = [];
            if (route.start) validNames.push(route.start.name);
            (route.stops || []).forEach(s => { if (s) validNames.push(s.name); });
            if (route.end) validNames.push(route.end.name);
            if (!validNames.includes(current_location)) {
                return res.status(400).json({ message: 'Location must be one of the defined route stops', valid: validNames });
            }
        }

        await pool.query(
            'UPDATE listings SET current_location = $1 WHERE id = $2',
            [current_location, id]
        );

        res.json({ message: 'Location updated', current_location });
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;
