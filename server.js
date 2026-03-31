/* =========================================
   SERVER.JS - THE MAIN ENTRY POINT (THE WAITER MANAGER)
   =========================================
   This file starts the entire backend. It does 3 main things:
   1. Sets up the server port (usually 3000) using Express.js.
   2. Connects to `socket.io` for real-time live chat/notifications.
   3. Maps all the API routes (like a menu mapping `/api/auth` to the auth.js file).
   If a teacher asks you to "change the port" or "add a new API route base", do it here.
========================================= */
const express = require('express');
const cors = require('cors');
const { initDb } = require('./db');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"]
    }
});
const PORT = process.env.PORT || 3000;

// Share io instance with routes
app.set('io', io);

// Unique ID for this server run to force client logouts on restart
const SERVER_START_ID = Date.now().toString();

// Error handling to prevent server from exiting
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Core Middleware
app.use(cors());
app.use(express.json());

// ─── API ROUTES (must be before static serving) ─────────────────────────────

// Session endpoint — MUST be before static to prevent HTML being served
app.get('/api/sys/session', (req, res) => {
    res.json({ sessionId: SERVER_START_ID });
});

app.get('/api/test-ping', (req, res) => {
    res.json({ message: 'pong', timestamp: Date.now() });
});

// Socket.IO Connection Handling
io.on('connection', (socket) => {
    console.log('New client connected:', socket.id);

    socket.on('join', (userId) => {
        socket.join(`user_${userId}`);
        console.log(`User ${userId} joined their private room.`);
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// ─── API ROUTES (The Waiters connecting to specific Kitchens) ─────────────────
// Each line below says: "If a browser asks for /api/auth, go run the code in routes/auth.js"
app.use('/api/auth', require('./routes/auth'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/listings', require('./routes/listings'));
app.use('/api/feedback', require('./routes/feedback'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/tracking', require('./routes/tracking'));
app.use('/api/stats', require('./routes/stats'));
app.use('/api/friends', require('./routes/friends'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/splits', require('./routes/splits'));
app.use('/api/trust', require('./routes/trust'));
app.use('/api/ai', require('./routes/ai')); // Keeping this for backwards compatibility if needed
app.use('/api/chatbot', require('./routes/chatbot')); // New Guided Chatbot
app.use('/api/marketplace', require('./routes/marketplace'));
app.use('/api/payments', require('./routes/payments'));

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'unio_uploads',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp']
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }
});

app.post('/api/upload', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    res.json({ url: req.file.path }); // Cloudinary returns the full URL in req.file.path
});

// ─── STATIC FILES (must be LAST so it doesn't shadow API routes) ─────────────
app.use(express.static(path.join(__dirname, '/')));

// ─── START SERVER ─────────────────────────────────────────────────────────────
if (require.main === module) {
    initDb().then(() => {
        server.listen(PORT, () => {
            console.log(`Server is running on http://localhost:${PORT}`);
        });
    });
}

module.exports = { app, server };
