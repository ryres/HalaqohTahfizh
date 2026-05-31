const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 20,            // Tingkatkan sesuai kebutuhan (default 10)
    queueLimit: 0,                  // 0 = unlimited antrian
    enableKeepAlive: true,          // Kirim keep-alive packet
    keepAliveInitialDelay: 0,       // Mulai keep-alive segera
    idleTimeout: 60000,             // Tutup koneksi idle setelah 60 detik
    // (Opsional) Untuk koneksi SSL jika perlu:
    // ssl: { rejectUnauthorized: false }
});

const db = pool.promise(); // Gunakan promise wrapper

// Test koneksi (sebaiknya dilakukan sekali saat startup)
(async () => {
    try {
        const connection = await db.getConnection();
        console.log('✅ MySQL pool berhasil terkoneksi');
        connection.release(); // Kembalikan ke pool
    } catch (err) {
        console.error('❌ Gagal koneksi MySQL pool:', err.message);
    }
})();

module.exports = db;