const db = require('./config/db');
const fs = require('fs');

async function migrate() {
    try {
        const sql = fs.readFileSync('./database.sql', 'utf8');
        // Pisahkan perintah SQL berdasarkan titik koma (sederhana, asumsi tidak ada string dengan titik koma)
        const statements = sql.split(';').filter(stmt => stmt.trim());
        for (let stmt of statements) {
            await db.query(stmt);
            console.log('✓', stmt.substring(0, 50));
        }
        console.log('✅ Migrasi selesai!');
    } catch (err) {
        console.error('❌ Error:', err);
    } finally {
        process.exit();
    }
}

migrate();