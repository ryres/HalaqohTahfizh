// utils/logger.js
const db = require('../config/db');

async function logActivity(userId, username, action, details = null, req = null) {
    let ip = null;
    if (req) {
        ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || null;
        if (ip && ip.includes(',')) ip = ip.split(',')[0].trim();
    }
    try {
        await db.query(
            'INSERT INTO logs (user_id, username, action, details, ip_address) VALUES (?, ?, ?, ?, ?)',
            [userId, username, action, details, ip]
        );
    } catch (err) {
        console.error('Gagal menyimpan log:', err.message);
    }
}

module.exports = { logActivity };