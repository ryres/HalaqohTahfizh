// utils/notifications.js
const db = require('../config/db');

async function addNotification(userId, title, message, type = 'info', link = null) {
    try {
        const [result] = await db.query(
            'INSERT INTO notifications (user_id, title, message, type, link) VALUES (?, ?, ?, ?, ?)',
            [userId, title, message, type, link]
        );
        return result.insertId;
    } catch (err) {
        console.error('Gagal menambah notifikasi:', err);
        return null;
    }
}

async function getNotifications(userId, limit = 20) {
    const [rows] = await db.query(
        'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
        [userId, limit]
    );
    return rows;
}

async function getUnreadCount(userId) {
    const [rows] = await db.query(
        'SELECT COUNT(*) as total FROM notifications WHERE user_id = ? AND is_read = FALSE',
        [userId]
    );
    return rows[0].total;
}

async function markAsRead(notificationId, userId) {
    await db.query(
        'UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?',
        [notificationId, userId]
    );
}

async function markAllAsRead(userId) {
    await db.query('UPDATE notifications SET is_read = TRUE WHERE user_id = ?', [userId]);
}

module.exports = {
    addNotification,
    getNotifications,
    getUnreadCount,
    markAsRead,
    markAllAsRead
};