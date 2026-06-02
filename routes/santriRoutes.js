const express = require('express');
const db = require('../config/db');
const { verifyToken, isAdmin, isAdminOrGuru } = require('../middleware/auth');
const ExcelJS = require('exceljs');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const surahs = require('../data/surahs.js');
const { logActivity } = require('../utils/logger');
const { cleanupApprovedRequests } = require('../utils/cleanup');
const { addNotification } = require('../utils/notifications');
// Helper untuk notifikasi ke semua admin
async function notifyAdmins(title, message, type, link = null) {
    try {
        const [admins] = await db.query('SELECT id FROM users WHERE role = "admin"');
        for (const admin of admins) {
            await addNotification(admin.id, title, message, type, link);
        }
    } catch (err) {
        console.error('Gagal mengirim notifikasi ke admin:', err);
    }
}
const {
    sanitizeString,
    isValidNama,
    isValidJuz,
    isValidSurat,
    isValidAyat,
    isValidNilai,
    isValidBaris,
    isValidDate,
    isValidKelas,
    isValidInteger
} = require('../utils/validation');
const { sendNotification } = require('../utils/email');

const router = express.Router();

// Konfigurasi multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../uploads');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage });

// Helper untuk ambil daftar halaqoh
async function getHalaqohList() {
    const [rows] = await db.query('SELECT id, nama_halaqoh FROM halaqoh ORDER BY nama_halaqoh');
    return rows;
}

// Helper untuk ambil daftar guru
async function getGuruList() {
    const [rows] = await db.query('SELECT id, nama FROM guru ORDER BY nama');
    return rows;
}

// ===================== FORM TAMBAH SANTRI =====================
router.get('/add', verifyToken, async (req, res) => {
    const guruList = await getGuruList();
    res.render('santri_form', {
        santri: null,
        error: null,
        action: '/santri/add',
        user: req.user,
        surahs: surahs,
        guruList: guruList,
        halaqohList: await getHalaqohList()
    });
});

router.post('/add', verifyToken, async (req, res) => {
    const {
                nama, kelas, juz, surat, ayat, setoran_tgl,
        tajwid, kelancaran, makhraj, baris, halaqoh_id, guru_id, target_juz
    } = req.body;

    // Validasi
    if (!isValidNama(nama)) {
        return res.render('santri_form', {
            santri: req.body,
            error: 'Nama tidak valid (min 3 huruf, maks 100, mengandung huruf)',
            action: '/santri/add',
            user: req.user,
            surahs: surahs,
            guruList: await getGuruList(),
            halaqohList: await getHalaqohList()
        });
        

    }
    if (!isValidJuz(juz)) {
        return res.render('santri_form', {
            santri: req.body,
            error: 'Juz harus antara 1-30',
            action: '/santri/add',
            user: req.user,
            surahs: surahs,
            guruList: await getGuruList(),
            halaqohList: await getHalaqohList()
        });
    }
    if (target_juz && !isValidJuz(target_juz)) {
        return res.render('santri_form', {
            santri: req.body,
            error: 'Target juz harus antara 1-30',
            action: '/santri/add',
            user: req.user,
            surahs: surahs,
            guruList: await getGuruList(),
            halaqohList: await getHalaqohList()
        });
    }
    if (!isValidSurat(surat)) {
        return res.render('santri_form', {
            santri: req.body,
            error: 'Surat tidak valid (hanya huruf, spasi, tanda petik, titik)',
            action: '/santri/add',
            user: req.user,
            surahs: surahs,
            guruList: await getGuruList(),
            halaqohList: await getHalaqohList()
        });
    }
    if (!isValidAyat(ayat)) {
        return res.render('santri_form', {
            santri: req.body,
            error: 'Ayat harus angka positif',
            action: '/santri/add',
            user: req.user,
            surahs: surahs,
            guruList: await getGuruList(),
            halaqohList: await getHalaqohList()
        });
    }
    if (!isValidDate(setoran_tgl)) {
        return res.render('santri_form', {
            santri: req.body,
            error: 'Tanggal setor tidak valid (format YYYY-MM-DD)',
            action: '/santri/add',
            user: req.user,
            surahs: surahs,
            guruList: await getGuruList(),
            halaqohList: await getHalaqohList()
        });
    }
    if (!isValidNilai(tajwid) || !isValidNilai(kelancaran) || !isValidNilai(makhraj)) {
        return res.render('santri_form', {
            santri: req.body,
            error: 'Nilai tajwid, kelancaran, makhraj harus 0-100',
            action: '/santri/add',
            user: req.user,
            surahs: surahs,
            guruList: await getGuruList(),
            halaqohList: await getHalaqohList()
        });
    }
    if (!isValidBaris(baris)) {
        return res.render('santri_form', {
            santri: req.body,
            error: 'Baris harus angka positif',
            action: '/santri/add',
            user: req.user,
            surahs: surahs,
            guruList: await getGuruList(),
            halaqohList: await getHalaqohList()
        });
    }
    if (!isValidKelas(kelas)) {
        return res.render('santri_form', {
            santri: req.body,
            error: 'Kelas tidak valid (maks 20 karakter, alfanumerik/spasi/-)',
            action: '/santri/add',
            user: req.user,
            surahs: surahs,
            guruList: await getGuruList(),
            halaqohList: await getHalaqohList()
        });
    }
    if (halaqoh_id && !isValidInteger(halaqoh_id, 1)) {
        return res.render('santri_form', {
            santri: req.body,
            error: 'Halaqoh tidak valid',
            action: '/santri/add',
            user: req.user,
            surahs: surahs,
            guruList: await getGuruList(),
            halaqohList: await getHalaqohList()
        });
    }
    if (guru_id && !isValidInteger(guru_id, 1)) {
        return res.render('santri_form', {
            santri: req.body,
            error: 'Guru pembimbing tidak valid',
            action: '/santri/add',
            user: req.user,
            surahs: surahs,
            guruList: await getGuruList(),
            halaqohList: await getHalaqohList()
        });
    }

    const cleanNama = sanitizeString(nama);
    const cleanKelas = sanitizeString(kelas || '');
    const cleanSurat = sanitizeString(surat);
    const cleanTargetJuz = target_juz ? parseInt(target_juz) : 30;
    const cleanHalaqohId = halaqoh_id ? parseInt(halaqoh_id) : null;
    const cleanGuruId = guru_id ? parseInt(guru_id) : null;

    try {
        await db.query(
            `INSERT INTO santri 
            (nama, kelas, juz, surat, ayat, setoran_tgl, tajwid, kelancaran, makhraj, baris, halaqoh_id, guru_id, user_id, target_juz)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                cleanNama, cleanKelas, parseInt(juz), cleanSurat, parseInt(ayat),
                setoran_tgl, parseInt(tajwid), parseInt(kelancaran), parseInt(makhraj),
                parseInt(baris), cleanHalaqohId, cleanGuruId, req.user.id, cleanTargetJuz
            ]
            );

        await notifyAdmins('Santri Baru Ditambahkan', `Santri ${cleanNama} (juz ${juz}) ditambahkan oleh ${req.user.username}.`, 'success', '/data-santri');
        await sendNotification('Santri Baru Ditambahkan', `Santri ${cleanNama} (juz ${juz}) ditambahkan oleh ${req.user.username}.`);
        await logActivity(req.user.id, req.user.username, 'TAMBAH_SANTRI', `Santri: ${cleanNama}, Juz: ${juz}, Target: ${cleanTargetJuz}`, req);
        req.session.success = 'Data santri berhasil ditambahkan!';
        if (req.user.role === 'admin') res.redirect('/data-santri');
        else res.redirect('/dashboard/user');
    } catch (err) {
        console.error(err);
        req.session.error = 'Gagal menambahkan data: ' + err.message;
        res.redirect('back');
    }
});

// ===================== FORM EDIT SANTRI =====================
router.get('/edit/:id', verifyToken, async (req, res) => {
    const id = req.params.id;
    try {
        const [rows] = await db.query('SELECT * FROM santri WHERE id = ?', [id]);
        if (rows.length === 0) return res.redirect('/data-santri');
        const santri = rows[0];
        if (req.user.role !== 'admin' && santri.user_id !== req.user.id) {
            return res.status(403).render('403', { user: req.user });
        }
        const guruList = await getGuruList();
        const halaqohList = await getHalaqohList();
        res.render('santri_form', {
            santri,
            error: null,
            action: `/santri/edit/${id}`,
            user: req.user,
            surahs: surahs,
            guruList: guruList,
            halaqohList: halaqohList
        });
    } catch (err) {
        res.redirect('/data-santri');
    }
});

router.post('/edit/:id', verifyToken, async (req, res) => {
    const id = req.params.id;
    const {
        nama, kelas, juz, surat, ayat, setoran_tgl,
        tajwid, kelancaran, makhraj, baris, halaqoh_id, guru_id, target_juz
    } = req.body;

    // Validasi (sama seperti tambah)
    if (!isValidNama(nama)) {
        return res.render('santri_form', {
            santri: req.body,
            error: 'Nama tidak valid',
            action: `/santri/edit/${id}`,
            user: req.user,
            surahs: surahs,
            guruList: await getGuruList(),
            halaqohList: await getHalaqohList()
        });
    }
    if (!isValidJuz(juz)) {
        return res.render('santri_form', {
            santri: req.body,
            error: 'Juz harus 1-30',
            action: `/santri/edit/${id}`,
            user: req.user,
            surahs: surahs,
            guruList: await getGuruList(),
            halaqohList: await getHalaqohList()
        });
    }
    if (target_juz && !isValidJuz(target_juz)) {
        return res.render('santri_form', {
            santri: req.body,
            error: 'Target juz harus 1-30',
            action: `/santri/edit/${id}`,
            user: req.user,
            surahs: surahs,
            guruList: await getGuruList(),
            halaqohList: await getHalaqohList()
        });
    }
    if (!isValidSurat(surat)) {
        return res.render('santri_form', {
            santri: req.body,
            error: 'Surat tidak valid',
            action: `/santri/edit/${id}`,
            user: req.user,
            surahs: surahs,
            guruList: await getGuruList(),
            halaqohList: await getHalaqohList()
        });
    }
    if (!isValidAyat(ayat)) {
        return res.render('santri_form', {
            santri: req.body,
            error: 'Ayat harus positif',
            action: `/santri/edit/${id}`,
            user: req.user,
            surahs: surahs,
            guruList: await getGuruList(),
            halaqohList: await getHalaqohList()
        });
    }
    if (!isValidDate(setoran_tgl)) {
        return res.render('santri_form', {
            santri: req.body,
            error: 'Tanggal tidak valid',
            action: `/santri/edit/${id}`,
            user: req.user,
            surahs: surahs,
            guruList: await getGuruList(),
            halaqohList: await getHalaqohList()
        });
    }
    if (!isValidNilai(tajwid) || !isValidNilai(kelancaran) || !isValidNilai(makhraj)) {
        return res.render('santri_form', {
            santri: req.body,
            error: 'Nilai harus 0-100',
            action: `/santri/edit/${id}`,
            user: req.user,
            surahs: surahs,
            guruList: await getGuruList(),
            halaqohList: await getHalaqohList()
        });
    }
    if (!isValidBaris(baris)) {
        return res.render('santri_form', {
            santri: req.body,
            error: 'Baris harus positif',
            action: `/santri/edit/${id}`,
            user: req.user,
            surahs: surahs,
            guruList: await getGuruList(),
            halaqohList: await getHalaqohList()
        });
    }
    if (!isValidKelas(kelas)) {
        return res.render('santri_form', {
            santri: req.body,
            error: 'Kelas tidak valid',
            action: `/santri/edit/${id}`,
            user: req.user,
            surahs: surahs,
            guruList: await getGuruList(),
            halaqohList: await getHalaqohList()
        });
    }
    if (halaqoh_id && !isValidInteger(halaqoh_id, 1)) {
        return res.render('santri_form', {
            santri: req.body,
            error: 'Halaqoh tidak valid',
            action: `/santri/edit/${id}`,
            user: req.user,
            surahs: surahs,
            guruList: await getGuruList(),
            halaqohList: await getHalaqohList()
        });
    }
    if (guru_id && !isValidInteger(guru_id, 1)) {
        return res.render('santri_form', {
            santri: req.body,
            error: 'Guru pembimbing tidak valid',
            action: `/santri/edit/${id}`,
            user: req.user,
            surahs: surahs,
            guruList: await getGuruList(),
            halaqohList: await getHalaqohList()
        });
    }

    const cleanNama = sanitizeString(nama);
    const cleanKelas = sanitizeString(kelas || '');
    const cleanSurat = sanitizeString(surat);
    const cleanTargetJuz = target_juz ? parseInt(target_juz) : 30;
    const cleanHalaqohId = halaqoh_id ? parseInt(halaqoh_id) : null;
    const cleanGuruId = guru_id ? parseInt(guru_id) : null;

    try {
        await db.query(
            `UPDATE santri SET 
                nama=?, kelas=?, juz=?, surat=?, ayat=?, setoran_tgl=?,
                tajwid=?, kelancaran=?, makhraj=?, baris=?, halaqoh_id=?, guru_id=?, target_juz=?
             WHERE id=?`,
            [
                cleanNama, cleanKelas, parseInt(juz), cleanSurat, parseInt(ayat),
                setoran_tgl, parseInt(tajwid), parseInt(kelancaran), parseInt(makhraj),
                parseInt(baris), cleanHalaqohId, cleanGuruId, cleanTargetJuz, id
            ]
        );
        await notifyAdmins('Data Santri Diupdate', `Santri ${cleanNama} (ID: ${id}) diupdate oleh ${req.user.username}.`, 'info', `/santri/edit/${id}`);
        await logActivity(req.user.id, req.user.username, 'EDIT_SANTRI', `ID Santri: ${id}, Nama: ${cleanNama}, Target Juz: ${cleanTargetJuz}`, req);
        req.session.success = 'Data santri berhasil diupdate!';
        if (req.user.role === 'admin') res.redirect('/data-santri');
        else res.redirect('/dashboard/user');
    } catch (err) {
        console.error(err);
        req.session.error = 'Gagal mengupdate data';
        res.redirect('back');
    }
});

// ===================== HAPUS SANTRI =====================
// Hapus route /delete yang lama, ganti dengan:
router.post('/delete/:id', verifyToken, async (req, res) => {
    const id = req.params.id;
    // Hanya admin yang bisa langsung hapus
    if (req.user.role === 'admin') {
        try {
            await db.query('DELETE FROM santri WHERE id = ?', [id]);
            await logActivity(req.user.id, req.user.username, 'HAPUS_SANTRI', `ID Santri: ${id}`, req);
            req.session.success = 'Data santri berhasil dihapus!';
        } catch (err) {
            req.session.error = 'Gagal menghapus data';
        }
        return res.redirect(req.user.role === 'admin' ? '/data-santri' : '/dashboard/user');
    } else {
        // Jika bukan admin, arahkan ke halaman request
        return res.redirect(`/santri/request-delete/${id}`);
    }
});

// Form request delete (GET)
router.get('/request-delete/:id', verifyToken, async (req, res) => {
    if (req.user.role !== 'guru_tahfizh') return res.redirect('/data-santri');
    const id = req.params.id;
    const [rows] = await db.query('SELECT * FROM santri WHERE id = ?', [id]);
    if (rows.length === 0) return res.redirect('/data-santri');
    res.render('santri_request_delete', { user: req.user, santri: rows[0], error: null });
});

// Proses request delete (POST)
router.post('/request-delete/:id', verifyToken, async (req, res) => {
    if (req.user.role !== 'guru_tahfizh') return res.redirect('/data-santri');
    const id = req.params.id;
    const { reason } = req.body;
    if (!reason || reason.trim() === '') {
        const [rows] = await db.query('SELECT * FROM santri WHERE id = ?', [id]);
        return res.render('santri_request_delete', { user: req.user, santri: rows[0], error: 'Alasan wajib diisi' });
    }
    await db.query('INSERT INTO delete_requests (santri_id, requested_by, reason) VALUES (?, ?, ?)', [id, req.user.id, reason.trim()]);
    const [santriRows] = await db.query('SELECT nama FROM santri WHERE id = ?', [id]);
    const santriNama = santriRows[0]?.nama || 'Unknown';
    await notifyAdmins('Permintaan Hapus Santri', `Guru ${req.user.username} meminta hapus santri "${santriNama}". Alasan: ${reason.trim()}`, 'warning', '/admin/delete-requests');
    req.session.success = 'Permintaan hapus telah dikirim ke koordinator.';
    return res.redirect('/data-santri');
});
// ===================== EXPORT EXCEL =====================
router.get('/export', verifyToken, async (req, res) => {
    try {
        let query = `SELECT 
            s.nama, s.kelas, s.juz, s.surat, s.ayat, s.tajwid, s.kelancaran, s.makhraj, s.baris,
            DATE_FORMAT(s.setoran_tgl, '%d/%m/%Y') as tgl, 
            h.nama_halaqoh as halaqoh, 
            g.nama as pembimbing,
            s.target_juz
            FROM santri s
            LEFT JOIN halaqoh h ON s.halaqoh_id = h.id
            LEFT JOIN guru g ON s.guru_id = g.id`;
        let params = [];
        if (req.user.role !== 'admin') {
            query += ' WHERE s.user_id = ?';
            params.push(req.user.id);
        }
        const [santri] = await db.query(query, params);
        const workbook = new ExcelJS.Workbook();
        const ws = workbook.addWorksheet('Santri');
        ws.columns = [
            { header: 'Nama', key: 'nama', width: 25 },
            { header: 'Kelas', key: 'kelas', width: 10 },
            { header: 'Juz', key: 'juz', width: 10 },
            { header: 'Surat', key: 'surat', width: 20 },
            { header: 'Ayat', key: 'ayat', width: 10 },
            { header: 'Tajwid', key: 'tajwid', width: 10 },
            { header: 'Kelancaran', key: 'kelancaran', width: 12 },
            { header: 'Makhraj', key: 'makhraj', width: 10 },
            { header: 'Baris', key: 'baris', width: 10 },
            { header: 'Tanggal Setor', key: 'tgl', width: 15 },
            { header: 'Halaqoh', key: 'halaqoh', width: 20 },
            { header: 'Pembimbing', key: 'pembimbing', width: 20 },
            { header: 'Target Juz', key: 'target_juz', width: 12 }
        ];
        santri.forEach(s => ws.addRow(s));
        ws.getRow(1).font = { bold: true };
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=santri.xlsx');
        await workbook.xlsx.write(res);
        res.end();
        await logActivity(req.user.id, req.user.username, 'EXPORT_SANTRI', null, req);
    } catch (err) {
        console.error(err);
        req.session.error = 'Gagal export data';
        res.redirect('/data-santri');
    }
});

// ===================== IMPORT EXCEL =====================
router.post('/import', verifyToken, isAdmin, upload.single('file'), async (req, res) => {
    if (!req.file) {
        req.session.error = 'Pilih file Excel terlebih dahulu';
        return res.redirect('/data-santri');
    }
    try {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(req.file.path);
        const ws = workbook.getWorksheet(1);
        let success = 0, failed = 0;
        // Ambil daftar halaqoh untuk mapping nama -> id
        const halaqohMap = new Map();
        const halaqohList = await getHalaqohList();
        halaqohList.forEach(h => halaqohMap.set(h.nama_halaqoh, h.id));
        // Ambil daftar guru untuk mapping nama -> id
        const guruList = await getGuruList();
        const guruMap = new Map();
        guruList.forEach(g => guruMap.set(g.nama, g.id));

        for (let i = 2; i <= ws.rowCount; i++) {
            const row = ws.getRow(i);
            const nama = row.getCell(1).text?.trim();
            const kelas = row.getCell(2).text?.trim();
            const juz = parseInt(row.getCell(3).text);
            const surat = row.getCell(4).text?.trim();
            const ayat = parseInt(row.getCell(5).text);
            const tajwid = parseInt(row.getCell(6).text);
            const kelancaran = parseInt(row.getCell(7).text);
            const makhraj = parseInt(row.getCell(8).text);
            const baris = parseInt(row.getCell(9).text);
            let tglStr = row.getCell(10).text?.trim();
            const halaqohNama = row.getCell(11).text?.trim();
            const pembimbingNama = row.getCell(12).text?.trim();
            const targetJuz = parseInt(row.getCell(13).text) || 30;
            const halaqohId = halaqohMap.get(halaqohNama) || null;
            const guruId = guruMap.get(pembimbingNama) || null;
            if (nama && !isNaN(juz) && juz>=1 && juz<=30 && surat && !isNaN(ayat) && ayat>=1 &&
                !isNaN(tajwid) && tajwid>=0 && tajwid<=100 &&
                !isNaN(kelancaran) && kelancaran>=0 && kelancaran<=100 &&
                !isNaN(makhraj) && makhraj>=0 && makhraj<=100 && !isNaN(baris) && baris>0 &&
                targetJuz>=1 && targetJuz<=30) {
                let setoran_tgl = null;
                if (tglStr) {
                    const parts = tglStr.split('/');
                    if (parts.length === 3) setoran_tgl = `${parts[2]}-${parts[1]}-${parts[0]}`;
                }
                await db.query(
                    `INSERT INTO santri 
                    (nama, kelas, juz, surat, ayat, setoran_tgl, tajwid, kelancaran, makhraj, baris, halaqoh_id, guru_id, user_id, target_juz)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [nama, kelas || null, juz, surat, ayat, setoran_tgl, tajwid, kelancaran, makhraj, baris, halaqohId, guruId, req.user.id, targetJuz]
                );
                success++;
            } else {
                failed++;
            }
        }
        fs.unlinkSync(req.file.path);
        await logActivity(req.user.id, req.user.username, 'IMPORT_SANTRI', `Berhasil: ${success}, Gagal: ${failed}`, req);
        req.session.success = `Import selesai: ${success} berhasil, ${failed} gagal.`;
    } catch (err) {
        console.error(err);
        req.session.error = 'Gagal membaca file Excel. Pastikan format kolom sesuai.';
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }
    res.redirect('/data-santri');
});

module.exports = router;