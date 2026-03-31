/* =========================================
   STATS.JS - THE ANALYTICS ENGINE (MATH & MONEY)
   =========================================
   This file calculates all the money earned, money saved, and active splits.
   It uses complex SQL queries (like SUM, GROUP BY) to grab numbers directly from the DB.
   If the teacher asks: "Change how the Amount Earned is calculated"
   You would edit the SQL queries in this file!
========================================= */
const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { authenticateToken } = require('../middleware/authMiddleware');

// GET /api/stats/global
// Calculates aggregate platform-wide earnings, savings, and splits
router.get('/global', async (req, res) => {
    try {
        // 1. Total Earned (Total transaction volume of confirmed bookings)
        const earnedRes = await pool.query(`
            SELECT COALESCE(SUM(total_price), 0) as total_earned
            FROM bookings b
            WHERE b.status = 'confirmed'
        `);
        const totalEarned = parseFloat(earnedRes.rows[0].total_earned || 0);

        // 2. Total Saved (Sum of all sharing revenue + consumer discounts)
        // Part A: Sharing Revenue (What providers collected back)
        // We now include ALL listing types.
        const sharingRevenueRes = await pool.query(`
            SELECT COALESCE(SUM(b.total_price), 0) as sharing_revenue
            FROM listings l
            JOIN bookings b ON l.id = b.listing_id 
            WHERE b.status = 'confirmed'
        `);
        const sharingRevenue = parseFloat(sharingRevenueRes.rows[0].sharing_revenue || 0);

        // Part B: Consumer Discounts (Total Value - Paid Amount)
        // We assume 'totalValue' is approx capacity * price_per_unit for shared items.
        const discountsRes = await pool.query(`
            SELECT 
                l.capacity, 
                l.price_per_unit, 
                b.total_price as paid_amount,
                b.quantity
            FROM bookings b
            JOIN listings l ON b.listing_id = l.id
            WHERE b.status = 'confirmed'
        `);
        
        let totalDiscounts = 0;
        discountsRes.rows.forEach(row => {
            const capacity = parseInt(row.capacity) || 1;
            const price = parseFloat(row.price_per_unit);
            const paid = parseFloat(row.paid_amount);
            const qty = parseInt(row.quantity) || 1;

            // Simple heuristic for saving: 
            // If it's a shared resource, the 'full' value is what they'd pay solo.
            // For now, let's keep it simple: Total Split Value (est) - Paid
            const totalEstimatedValue = capacity * price;
            totalDiscounts += Math.max(0, totalEstimatedValue - paid);
        });

        const totalSaved = sharingRevenue + totalDiscounts;

        // 3. Active Splits
        const activeSplitsRes = await pool.query("SELECT COUNT(*) FROM listings WHERE approved = TRUE");
        const activeSplits = parseInt(activeSplitsRes.rows[0].count);

        res.json({
            amount_earned: totalEarned,
            amount_saved: totalSaved,
            active_splits: activeSplits
        });

    } catch (err) {
        console.error("Error fetching global stats:", err);
        res.status(500).json({ message: "Server error" });
    }
});

router.get('/', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. Savings from Splits Created by the User (Revenue collected from others)
        // This is essentially 'earnings' that offset the cost.
        const providedSavingsQuery = `
            SELECT COALESCE(SUM(b.total_price), 0) as provided_savings
            FROM listings l
            JOIN bookings b ON l.id = b.listing_id 
            WHERE l.provider_id = $1 
              AND b.status = 'confirmed'
        `;
        const providedRes = await pool.query(providedSavingsQuery, [userId]);
        const providedSavings = parseFloat(providedRes.rows[0].provided_savings || 0);

        // 2. Savings from Splits Joined by the User
        // Saving = (Full Price) - (What the user paid)
        const joinedSavingsQuery = `
            SELECT 
                l.details->>'total_cost' as total_cost,
                l.capacity, 
                l.price_per_unit, 
                b.total_price as paid_amount
            FROM bookings b
            JOIN listings l ON b.listing_id = l.id
            WHERE b.user_id = $1 
              AND b.status = 'confirmed'
              AND (b.payment_status = 'paid' OR CAST(b.total_price AS NUMERIC) = 0 OR l.details->>'payment_enabled' != 'true')
              AND l.type IN ('digital_subscriptions', 'sports', 'travel', 'other')
              AND l.details->>'payment_enabled' = 'true'
        `;
        const joinedRes = await pool.query(joinedSavingsQuery, [userId]);
        
        let joinedSavings = 0;
        joinedRes.rows.forEach(row => {
            const paid = parseFloat(row.paid_amount) || 0;
            const fallbackValue = (parseInt(row.capacity) || 1) * (parseFloat(row.price_per_unit) || 0);
            const totalValue = row.total_cost ? parseFloat(row.total_cost) : fallbackValue;
            const saving = Math.max(0, totalValue - paid);
            joinedSavings += saving;
        });

        // 3. Provider Earnings (Total revenue from all confirmed bookings)
        const amountEarnedQuery = `
            SELECT COALESCE(SUM(b.total_price), 0) as total_earned
            FROM listings l
            JOIN bookings b ON l.id = b.listing_id 
            WHERE l.provider_id = $1 
              AND b.status = 'confirmed'
              AND l.type IN ('cargo_split', 'cold_storage', 'warehouse')
        `;
        const earnedRes = await pool.query(amountEarnedQuery, [userId]);
        const amountEarned = parseFloat(earnedRes.rows[0].total_earned || 0);

        // 4. Active Splits
        const activeSplitsRes = await pool.query('SELECT COUNT(*) FROM listings WHERE provider_id = $1 AND approved = TRUE', [userId]);

        const totalAmountSaved = joinedSavings; // Exclude providedfSavings as requested

        res.json({
            amount_saved: totalAmountSaved,
            amount_earned: amountEarned,
            provided_savings: providedSavings,
            joined_savings: joinedSavings,
            active_splits: parseInt(activeSplitsRes.rows[0].count)
        });

    } catch (err) {
        console.error("Error fetching stats:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// GET /api/stats/savings-history
// Detailed saving events for the analytics modal
router.get('/savings-history', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. Savings from Splits Created (Revenue collected)
        // EXCLUDED based on user request (only calculate amount saved from joined splits)
        const createdHistory = [];

        // 2. Savings from Splits Joined (Discount)
        const joinedQuery = `
            SELECT 
                l.details->>'app' as item_name,
                l.details->>'activity' as activity_name,
                l.details->>'total_cost' as total_cost,
                l.type,
                l.capacity, 
                l.price_per_unit, 
                b.total_price as paid_amount,
                b.created_at as date
            FROM bookings b
            JOIN listings l ON b.listing_id = l.id
            WHERE b.user_id = $1 
              AND b.status = 'confirmed'
              AND (b.payment_status = 'paid' OR CAST(b.total_price AS NUMERIC) = 0 OR l.details->>'payment_enabled' != 'true')
              AND l.type IN ('digital_subscriptions', 'sports', 'travel', 'other')
              AND l.details->>'payment_enabled' = 'true'
            ORDER BY b.created_at DESC
        `;
        const joinedRes = await pool.query(joinedQuery, [userId]);
        const joinedHistory = joinedRes.rows.map(row => {
            const paid = parseFloat(row.paid_amount) || 0;
            const fallbackValue = (parseInt(row.capacity) || 1) * (parseFloat(row.price_per_unit) || 0);
            const totalValue = row.total_cost ? parseFloat(row.total_cost) : fallbackValue;
            const saving = Math.max(0, totalValue - paid);
            return {
                item: row.item_name || row.activity_name || row.type.replace(/_/g, ' '),
                type: 'Split Joined',
                amount: saving,
                date: row.date
            };
        });

        // 3. Merge and Sort
        const allHistory = [...joinedHistory].sort((a, b) => new Date(b.date) - new Date(a.date));

        // 4. Group by Month for Graph
        const monthlyData = {};
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        
        // Initialize last 6 months
        const today = new Date();
        for (let i = 5; i >= 0; i--) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            const mLabel = monthNames[d.getMonth()];
            monthlyData[mLabel] = 0;
        }

        allHistory.forEach(h => {
            const mIdx = new Date(h.date).getMonth();
            const mLabel = monthNames[mIdx];
            if (monthlyData.hasOwnProperty(mLabel)) {
                monthlyData[mLabel] += h.amount;
            }
        });

        const graphData = Object.keys(monthlyData).map(m => ({
            month: m,
            amount: monthlyData[m]
        }));

        res.json({
            history: allHistory,
            graphData: graphData
        });

    } catch (err) {
        console.error("Error fetching savings history:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// GET /api/stats/history
// Fetches the provider's chronological earnings history
router.get('/history', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // We want all bookings made against any of the user's listings
        const historyQuery = `
            SELECT 
                b.id as booking_id,
                b.created_at as date,
                b.quantity,
                b.total_price as amount,
                l.type as listing_type,
                l.location as listing_location,
                u.name as consumer_name,
                u.email as consumer_email
            FROM bookings b
            JOIN listings l ON b.listing_id = l.id
            JOIN users u ON b.user_id = u.id
            WHERE l.provider_id = $1 
              AND b.status = 'confirmed'
              AND l.type IN ('cargo_split', 'cold_storage', 'warehouse')
            ORDER BY b.created_at DESC
            LIMIT 50
        `;

        const { rows } = await pool.query(historyQuery, [userId]);

        res.json(rows);

    } catch (err) {
        console.error("Error fetching history:", err);
        res.status(500).json({ message: "Server error" });
    }
});

// GET /api/stats/earnings-history
// Detailed earning events for the provider analytics graph
router.get('/earnings-history', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // All bookings that were ever confirmed — includes still-confirmed AND cancelled ones
        const historyQuery = `
            SELECT 
                b.id as booking_id,
                b.created_at as date,
                b.total_price as amount,
                l.type as listing_type,
                l.location as listing_location,
                'earned' as entry_kind
            FROM bookings b
            JOIN listings l ON b.listing_id = l.id
            WHERE l.provider_id = $1 
              AND (b.status = 'confirmed' OR (b.status = 'cancelled' AND b.cancellation_status = 'approved'))
              AND l.type IN ('cargo_split', 'cold_storage', 'warehouse')
            ORDER BY b.created_at DESC
        `;

        // Cancelled (deducted) entries — only approved cancellations, shown at cancellation time
        const cancelledQuery = `
            SELECT 
                b.id as booking_id,
                b.updated_at as date,
                b.total_price as amount,
                l.type as listing_type,
                l.location as listing_location,
                'cancelled' as entry_kind
            FROM bookings b
            JOIN listings l ON b.listing_id = l.id
            WHERE l.provider_id = $1 
              AND b.status = 'cancelled'
              AND b.cancellation_status = 'approved'
              AND l.type IN ('cargo_split', 'cold_storage', 'warehouse')
            ORDER BY b.updated_at DESC
        `;

        const [confirmedRes, cancelledRes] = await Promise.all([
            pool.query(historyQuery, [userId]),
            pool.query(cancelledQuery, [userId])
        ]);

        const history = [
            ...confirmedRes.rows.map(r => ({
                item: r.listing_type.replace(/_/g, ' '),
                amount: parseFloat(r.amount),
                date: r.date,
                kind: 'earned'
            })),
            ...cancelledRes.rows.map(r => ({
                item: r.listing_type.replace(/_/g, ' ') + ' (Cancelled)',
                amount: -parseFloat(r.amount),
                date: r.date,
                kind: 'cancelled'
            }))
        ].sort((a, b) => new Date(b.date) - new Date(a.date));

        // Group by Month for Graph
        const monthlyData = {};
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        
        const today = new Date();
        for (let i = 5; i >= 0; i--) {
            const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
            monthlyData[monthNames[d.getMonth()]] = 0;
        }

        history.forEach(h => {
            const mLabel = monthNames[new Date(h.date).getMonth()];
            if (monthlyData.hasOwnProperty(mLabel)) {
                monthlyData[mLabel] += h.amount;
            }
        });

        const graphData = Object.keys(monthlyData).map(m => ({
            month: m,
            amount: monthlyData[m]
        }));

        res.json({ history, graphData });

    } catch (err) {
        console.error("Error fetching earnings history:", err);
        res.status(500).json({ message: "Server error" });
    }
});

module.exports = router;
