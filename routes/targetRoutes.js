const express = require('express');
const db = require('../config/db');
const { verifyToken, isAdmin } = require('../middleware/auth');
const router = express.Router();

// Helper hitung hari
function daysBetween(date1, date2) {
    const diffTime = Math.abs(new Date(date2) - new Date(date1));
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

function getPeriodCategory(days) {
    if (days <= 7) return 'Pekan';
    if (days <= 30) return 'Bulan';
    if (days <= 90) return '3 Bulan';
    if (days <= 180) return 'Semester';
    return 'Tahunan';
}

router.get('/data-santri/target-hafalan', verifyToken, isAdmin, async (req, res) => {
    try {
        // Pastikan kolom target_juz ada
        try {
            await db.query(`ALTER TABLE santri ADD COLUMN target_juz INT DEFAULT 30`);
        } catch (err) { /* kolom sudah ada */ }

        const [rows] = await db.query(`
            SELECT 
                s.id,
                s.nama,
                s.kelas,
                s.target_juz,
                MIN(s.setoran_tgl) as tgl_awal,
                MAX(s.setoran_tgl) as tgl_akhir,
                MIN(s.juz) as juz_awal,
                MAX(s.juz) as juz_akhir
            FROM santri s
            GROUP BY s.id
            ORDER BY s.nama
        `);

        const data = rows.map(row => {
            let durasiHari = null;
            let periode = '-';
            if (row.tgl_awal && row.tgl_akhir) {
                durasiHari = daysBetween(row.tgl_awal, row.tgl_akhir);
                periode = getPeriodCategory(durasiHari);
            }
            const pencapaian = row.juz_akhir || 0;
            const target = row.target_juz || 30;
            return {
                nama: row.nama,
                kelas: row.kelas || '-',
                target: target,
                pencapaian: pencapaian,
                sisa: Math.max(0, target - pencapaian),
                durasiHari: durasiHari ? durasiHari + ' hari' : '-',
                periode: periode,
                tgl_awal: row.tgl_awal ? new Date(row.tgl_awal).toLocaleDateString('id-ID') : '-',
                tgl_akhir: row.tgl_akhir ? new Date(row.tgl_akhir).toLocaleDateString('id-ID') : '-'
            };
        });

        res.render('target_hafalan', { user: req.user, data });
    } catch (err) {
        console.error(err);
        res.status(500).send('Gagal memuat target hafalan');
    }
});

module.exports = router;