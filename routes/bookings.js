/* =========================================
   BOOKINGS.JS - THE COST SPLITTING & RESERVATION LOGIC
   =========================================
   This is one of the most important files. It handles:
   1. Creating a booking (when a user books a truck).
   2. Deducting the required space from the truck's total capacity.
   3. Cost Splitting: Calculating how much one person pays based on how much space they take.
   
   If the teacher asks: "How does the system stop you from overbooking a truck?"
   Answer: "In the POST / bookings API, we parse the capacity (e.g., kg or tons) 
   and directly check if requested_qty <= available_capacity before saving to the DB."
========================================= */
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/authMiddleware');

// Helper to parse capacity string (e.g. "500kg" -> { value: 500, unit: "kg" })
function parseCapacity(capString) {
    const match = capString.trim().match(/^([\d.]+)\s*([a-zA-Z]+)?$/);
    if (!match) return { value: 0, unit: '' };
    return {
        value: parseFloat(match[1]),
        unit: (match[2] || '').toLowerCase().trim()
    };
}

// Helper to get conversion factor between units
function getConversionFactor(fromUnit, toUnit) {
    const units = {
        'kg': 1,
        'ton': 1000,
        'tons': 1000,
        'tonne': 1000,
        'tonnes': 1000,
        'slots': 1,
        'unit': 1,
        'units': 1
    };
    
    const f = units[fromUnit.toLowerCase()] || 1;
    const t = units[toUnit.toLowerCase()] || 1;
    
    return f / t;
}

// Get all joined activities (Bookings + Split Memberships)
// MOVED TO TOP to avoid route shadowing (e.g. by /:id)
router.get('/all-joined', authenticateToken, async (req, res) => {
    console.log(`[BACKEND] HIT: /api/bookings/all-joined for user ${req.user.id}`);
    try {
        const userId = req.user.id;

        // 1. Get standard bookings
        const bookingsQuery = `
            SELECT 
                'booking' as entry_type,
                b.id, b.status, b.payment_status, b.quantity, b.total_price, 
                b.cancellation_status, b.created_at, b.details,
                b.updated_at,
                b.listing_id,
                l.type, l.location, l.date, l.current_location,
                l.details as listing_details,
                dp.confirmation_id
            FROM bookings b
            JOIN listings l ON b.listing_id = l.id
            LEFT JOIN dummy_payments dp ON dp.booking_id = b.id
            WHERE b.user_id = $1
        `;

        // 2. Get marketplace split memberships
        const splitsQuery = `
            SELECT 
                'split' as entry_type,
                sm.split_id as id, s.status, 
                (CASE WHEN dp.id IS NOT NULL THEN 'paid' ELSE 'unpaid' END) as payment_status,
                1 as quantity, s.price_per_person as total_price,
                NULL as cancellation_status, sm.joined_at as created_at, NULL as details,
                NULL as updated_at,
                NULL as listing_id,
                m.type, 'Marketplace' as location, m.title as date,
                NULL as current_location,
                NULL as listing_details,
                dp.confirmation_id
            FROM split_members sm
            JOIN split_requests s ON sm.split_id = s.id
            JOIN marketplace_items m ON s.item_id = m.id
            LEFT JOIN dummy_payments dp ON dp.split_id = s.id AND dp.user_id = sm.user_id
            WHERE sm.user_id = $1
        `;

        const bookingsRes = await pool.query(bookingsQuery, [userId]);
        const splitsRes = await pool.query(splitsQuery, [userId]);

        // Merge and sort
        const combined = [...bookingsRes.rows, ...splitsRes.rows].sort((a, b) => 
            new Date(b.created_at) - new Date(a.created_at)
        );

        res.json(combined);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// Create Booking (Transactional)
router.post('/', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // Start Transaction

        const { listing_id, quantity = 1, details = {} } = req.body;
        const userId = req.user.id;

        // 1. Fetch Listing
        const listingRes = await client.query('SELECT * FROM listings WHERE id = $1 FOR UPDATE', [listing_id]);
        if (listingRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: "Listing not found" });
        }
        const listing = listingRes.rows[0];

        // 2. Check Capacity & Handle Conversion
        const listingCap = parseCapacity(listing.capacity);
        const consumerUnit = (req.body.unit || 'kg').toLowerCase();
        
        const conversionFactor = getConversionFactor(consumerUnit, listingCap.unit);
        const quantityInListingUnit = quantity * conversionFactor;

        if (listingCap.value < quantityInListingUnit) {
            await client.query('ROLLBACK');
            return res.status(400).json({ message: `Insufficient capacity. Requested ${quantity}${consumerUnit} (${quantityInListingUnit}${listingCap.unit}), but only ${listingCap.value}${listingCap.unit} available.` });
        }

        // 3. Deduct Capacity
        const newCapValue = listingCap.value - quantityInListingUnit;
        const newCapString = `${newCapValue.toFixed(2).replace(/\.00$/, '')} ${listingCap.unit}`;

        await client.query('UPDATE listings SET capacity = $1 WHERE id = $2', [newCapString, listing_id]);

        // 4. Calculate Price (Price per unit is in listing's unit, e.g. Price per Ton)
        const totalPrice = quantityInListingUnit * parseFloat(listing.price_per_unit);

        // 5. Create Booking
        const newBooking = await client.query(
            `INSERT INTO bookings (user_id, listing_id, status, payment_status, quantity, total_price, details) 
             VALUES ($1, $2, 'confirmed', 'unpaid', $3, $4, $5) RETURNING *`,
            [userId, listing_id, quantity, totalPrice, details]
        );

        // 6. Check Payment Required Flag
        const paymentRequired = listing.details?.payment_enabled !== false;

        await client.query('COMMIT'); // Commit Transaction

        res.json({
            message: "Booking successful",
            booking: newBooking.rows[0],
            payment_required: paymentRequired,
            remaining_capacity: newCapString
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send("Server Error");
    } finally {
        client.release();
    }
});

// Get User's Bookings (with Listing details)
router.get('/', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const bookings = await pool.query(`
            SELECT b.*, l.type, l.location, l.date, l.provider_id, l.details, dp.confirmation_id 
            FROM bookings b
            JOIN listings l ON b.listing_id = l.id
            LEFT JOIN dummy_payments dp ON dp.booking_id = b.id
            WHERE b.user_id = $1 
            ORDER BY b.created_at DESC
        `, [userId]);
        res.json(bookings.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// Cancel a Booking (Consumer)
router.delete('/:id', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // Start Transaction

        const { id } = req.params;
        const userId = req.user.id;

        // 1. Fetch booking to verify ownership and get quantity/listing_id
        const bookingRes = await client.query('SELECT * FROM bookings WHERE id = $1 AND user_id = $2 FOR UPDATE', [id, userId]);
        if (bookingRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: "Booking not found or not authorized" });
        }
        const booking = bookingRes.rows[0];

        // 2. Fetch the associated listing to return capacity
        const listingRes = await client.query('SELECT capacity FROM listings WHERE id = $1 FOR UPDATE', [booking.listing_id]);
        if (listingRes.rows.length > 0) {
            const currentCap = parseCapacity(listingRes.rows[0].capacity);
            const returnedQuantity = parseInt(booking.quantity, 10);
            const newCapValue = currentCap.value + returnedQuantity;
            const newCapString = `${newCapValue}${currentCap.unit}`;

            // Restore the capacity on the listing
            await client.query('UPDATE listings SET capacity = $1 WHERE id = $2', [newCapString, booking.listing_id]);
        }

        // 3. Delete the booking
        await client.query('DELETE FROM bookings WHERE id = $1', [id]);

        await client.query('COMMIT'); // Commit Transaction

        res.json({ message: "Booking successfully cancelled" });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send("Server Error");
    } finally {
        client.release();
    }
});

// Request Cancellation (Consumer)
router.post('/:id/cancel-request', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const userId = req.user.id;

        const result = await pool.query(
            "UPDATE bookings SET cancellation_status = 'requested', cancellation_reason = $1 WHERE id = $2 AND user_id = $3 RETURNING *",
            [reason, id, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Booking not found or not authorized" });
        }

        res.json({ message: "Cancellation request sent", booking: result.rows[0] });
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

// Handle Cancellation Request (Provider/Admin)
router.put('/:id/cancel-handle', authenticateToken, async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const { status } = req.body; // 'approved' or 'denied'
        const userId = req.user.id;
        const userRole = req.user.role;

        await client.query('BEGIN');

        // 1. Fetch booking and check if authorized
        const bookingRes = await client.query(`
            SELECT b.*, l.provider_id 
            FROM bookings b 
            JOIN listings l ON b.listing_id = l.id 
            WHERE b.id = $1
        `, [id]);

        if (bookingRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: "Booking not found" });
        }

        const booking = bookingRes.rows[0];
        if (userRole !== 'admin' && booking.provider_id !== userId) {
            await client.query('ROLLBACK');
            return res.status(403).json({ message: "Not authorized to handle this cancellation" });
        }

        // 2. Update status
        await client.query("UPDATE bookings SET cancellation_status = $1 WHERE id = $2", [status, id]);

        // 3. If approved, update booking status and restore capacity
        if (status === 'approved') {
            await client.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [id]);

            // Restore capacity
            const listingRes = await client.query('SELECT capacity FROM listings WHERE id = $1 FOR UPDATE', [booking.listing_id]);
            if (listingRes.rows.length > 0) {
                const currentCap = parseCapacity(listingRes.rows[0].capacity);
                // Convert booking quantity (default KG) to listing unit
                const consumerUnit = 'kg'; // Default for cancellations
                const conversionFactor = getConversionFactor(consumerUnit, currentCap.unit);
                const quantityInListingUnit = parseFloat(booking.quantity) * conversionFactor;
                
                const newVal = currentCap.value + quantityInListingUnit;
                const newCapString = `${newVal.toFixed(2).replace(/\.00$/, '')} ${currentCap.unit}`;
                await client.query('UPDATE listings SET capacity = $1 WHERE id = $2', [newCapString, booking.listing_id]);
            }
        } else {
            // If denied, maybe reset status to none or keep it as denied
            await client.query("UPDATE bookings SET cancellation_status = 'denied' WHERE id = $1", [id]);
        }

        await client.query('COMMIT');
        res.json({ message: `Cancellation request ${status}` });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err.message);
        res.status(500).send("Server Error");
    } finally {
        client.release();
    }
});

// Get Cancellation Requests for Provider's Listings
router.get('/my-listings-requests', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const result = await pool.query(`
            SELECT b.*, u.name as user_name, l.type, l.location
            FROM bookings b
            JOIN listings l ON b.listing_id = l.id
            JOIN users u ON b.user_id = u.id
            WHERE l.provider_id = $1 AND b.cancellation_status = 'requested'
            ORDER BY b.created_at DESC
        `, [userId]);
        res.json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).send("Server Error");
    }
});

module.exports = router;
