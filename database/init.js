// database/init.js
// Initializes the database schema on first deployment.
// Safe to run on every startup — uses CREATE TABLE IF NOT EXISTS throughout.

const fs   = require('fs');
const path = require('path');
const db   = require('../config/db');

async function initDatabase() {
    // Quick check: if the `users` table already exists, skip initialization.
    try {
        await db.query('SELECT 1 FROM `users` LIMIT 1');
        console.log('✅ Database schema already initialized — skipping.');
        return;
    } catch (err) {
        // Table doesn't exist (ER_NO_SUCH_TABLE) — proceed with initialization.
        // Any other error is also handled below.
        if (err.code !== 'ER_NO_SUCH_TABLE') {
            console.warn('⚠️  Unexpected error during schema check:', err.message);
        }
    }

    console.log('🔧 Initializing database schema...');

    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql  = fs.readFileSync(schemaPath, 'utf8');

    // Split on semicolons, strip comments and blank lines, execute each statement.
    const statements = schemaSql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
        try {
            await db.query(statement);
        } catch (err) {
            // ER_TABLE_EXISTS_ERROR is harmless — schema is already partially applied.
            if (err.code === 'ER_TABLE_EXISTS_ERROR') {
                continue;
            }
            console.error('❌ Failed to execute schema statement:', err.message);
            console.error('   Statement:', statement.substring(0, 120));
            throw err;
        }
    }

    console.log('✅ Database schema initialized successfully.');
}

module.exports = { initDatabase };
