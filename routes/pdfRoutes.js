const express = require('express');
const db = require('../config/db');
const { verifyToken, isAdmin } = require('../middleware/auth');
const PDFDocument = require('pdfkit');
const router = express.Router();

// Helper functions
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

router.get('/target-hafalan/pdf', verifyToken, isAdmin, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || '';
        const sortBy = req.query.sort || 'nama';
        const order = req.query.order === 'asc' ? 'ASC' : 'DESC';

        let whereClause = '';
        let params = [];
        if (search) {
            whereClause = ' WHERE s.nama LIKE ? OR s.kelas LIKE ?';
            params = [`%${search}%`, `%${search}%`];
        }

        let orderBy = '';
        switch (sortBy) {
            case 'nama': orderBy = 's.nama'; break;
            case 'kelas': orderBy = 's.kelas'; break;
            case 'target_juz': orderBy = 's.target_juz'; break;
            case 'pencapaian': orderBy = 'pencapaian'; break;
            case 'sisa': orderBy = 'sisa'; break;
            case 'durasi': orderBy = 'durasi'; break;
            case 'periode': orderBy = 'periode'; break;
            case 'tgl_awal': orderBy = 'tgl_awal'; break;
            case 'tgl_akhir': orderBy = 'tgl_akhir'; break;
            default: orderBy = 's.nama';
        }

        const dataQuery = `
            SELECT 
                s.id, s.nama, s.kelas, s.target_juz,
                MIN(s.setoran_tgl) as tgl_awal, MAX(s.setoran_tgl) as tgl_akhir,
                MIN(s.juz) as juz_awal, MAX(s.juz) as juz_akhir
            FROM santri s
            ${whereClause}
            GROUP BY s.id
            ORDER BY ${orderBy} ${order}
            LIMIT ?
        `;
        const [rows] = await db.query(dataQuery, [...params, limit]);

        const data = rows.map(row => {
            let durasiHari = null, periode = '-';
            if (row.tgl_awal && row.tgl_akhir) {
                durasiHari = daysBetween(row.tgl_awal, row.tgl_akhir);
                periode = getPeriodCategory(durasiHari);
            }
            const pencapaian = row.juz_akhir || 0;
            const target = row.target_juz || 30;
            const sisa = Math.max(0, target - pencapaian);
            return {
                nama: row.nama,
                kelas: row.kelas || '-',
                target,
                pencapaian,
                sisa,
                durasiHari: durasiHari ? durasiHari + ' hari' : '-',
                periode,
                tgl_awal: row.tgl_awal ? new Date(row.tgl_awal).toLocaleDateString('id-ID') : '-',
                tgl_akhir: row.tgl_akhir ? new Date(row.tgl_akhir).toLocaleDateString('id-ID') : '-'
            };
        });

        const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="target_hafalan.pdf"');
        doc.pipe(res);

        // Header
        doc.fontSize(16).text('Laporan Target Hafalan Santri', { align: 'center' });
        doc.fontSize(10).text(`Dicetak: ${new Date().toLocaleString('id-ID')}`, { align: 'center' });
        doc.moveDown(0.5);
        if (search) doc.fontSize(10).text(`Pencarian: ${search}`, { align: 'left' });
        doc.moveDown(1);

        // Tabel
        const headers = ['Nama', 'Kelas', 'Target', 'Pencapaian', 'Sisa', 'Durasi', 'Periode', 'Tgl Awal', 'Tgl Akhir'];
        const colWidths = [70, 45, 40, 45, 40, 50, 45, 55, 55];
        const startX = doc.x;
        let currentY = doc.y;

        // Draw header baris
        doc.font('Helvetica-Bold').fontSize(9);
        let x = startX;
        headers.forEach((h, i) => {
            doc.text(h, x, currentY, { width: colWidths[i], align: 'center' });
            x += colWidths[i];
        });
        doc.moveDown(0.8);
        currentY = doc.y;

        // Draw garis horizontal
        doc.moveTo(startX, currentY - 5)
           .lineTo(startX + colWidths.reduce((a,b) => a+b, 0), currentY - 5)
           .stroke();

        // Data rows
        doc.font('Helvetica').fontSize(8);
        data.forEach((item, idx) => {
            if (currentY > 500) {
                doc.addPage();
                currentY = 50;
                // Ulang header di halaman baru
                doc.font('Helvetica-Bold').fontSize(9);
                x = startX;
                headers.forEach((h, i) => {
                    doc.text(h, x, currentY, { width: colWidths[i], align: 'center' });
                    x += colWidths[i];
                });
                doc.moveDown(0.8);
                currentY = doc.y;
                doc.font('Helvetica').fontSize(8);
            }
            x = startX;
            doc.text(item.nama, x, currentY, { width: colWidths[0] });
            doc.text(item.kelas, x + colWidths[0], currentY, { width: colWidths[1], align: 'center' });
            doc.text(item.target.toString(), x + colWidths[0] + colWidths[1], currentY, { width: colWidths[2], align: 'center' });
            doc.text(item.pencapaian.toString(), x + colWidths[0] + colWidths[1] + colWidths[2], currentY, { width: colWidths[3], align: 'center' });
            doc.text(item.sisa.toString(), x + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3], currentY, { width: colWidths[4], align: 'center' });
            doc.text(item.durasiHari, x + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4], currentY, { width: colWidths[5], align: 'center' });
            doc.text(item.periode, x + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + colWidths[5], currentY, { width: colWidths[6], align: 'center' });
            doc.text(item.tgl_awal, x + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + colWidths[5] + colWidths[6], currentY, { width: colWidths[7], align: 'center' });
            doc.text(item.tgl_akhir, x + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4] + colWidths[5] + colWidths[6] + colWidths[7], currentY, { width: colWidths[8], align: 'center' });
            doc.moveDown(0.6);
            currentY = doc.y;
        });

        // Garis penutup
        doc.moveTo(startX, currentY - 3)
           .lineTo(startX + colWidths.reduce((a,b) => a+b, 0), currentY - 3)
           .stroke();

        doc.end();
    } catch (err) {
        console.error(err);
        res.status(500).send('Gagal generate PDF');
    }
});

module.exports = router;