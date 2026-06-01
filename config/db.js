const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
    connectTimeout: 10000,   // 10 detik
    acquireTimeout: 10000
});

const db = pool.promise();

// Test koneksi
(async () => {
    try {
        const conn = await db.getConnection();
        console.log('✅ MySQL terhubung');
        conn.release();
    } catch (err) {
        console.error('❌ Gagal koneksi MySQL pool:', err.message);
    }
})();

module.exports = db;
