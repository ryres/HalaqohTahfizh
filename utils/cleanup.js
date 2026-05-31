// utils/cleanup.js
const db = require('../config/db');

async function cleanupApprovedRequests() {
    try {
        // Hapus santri yang status approved dan sudah lewat 24 jam sejak approved_at
        const [requests] = await db.query(`
            SELECT dr.id, dr.santri_id 
            FROM delete_requests dr
            WHERE dr.status = 'approved' 
            AND dr.approved_at <= DATE_SUB(NOW(), INTERVAL 1 DAY)
        `);
        for (const req of requests) {
            await db.query('DELETE FROM santri WHERE id = ?', [req.santri_id]);
            await db.query('UPDATE delete_requests SET status = "deleted" WHERE id = ?', [req.id]);
        }
        if (requests.length) console.log(`Cleaned ${requests.length} approved requests`);
        return requests.length;
    } catch (err) { 
        console.error('Cleanup error:', err); 
        return 0;
    }
}

module.exports = { cleanupApprovedRequests };