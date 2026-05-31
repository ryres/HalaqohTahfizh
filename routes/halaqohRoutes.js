const express = require('express');
const db = require('../config/db');
const { verifyToken, isAdmin } = require('../middleware/auth');
const { logActivity } = require('../utils/logger');
const { sanitizeString } = require('../utils/validation');

const router = express.Router();

// Daftar halaqoh
router.get('/', verifyToken, isAdmin, async (req, res) => {
    try {
        const [halaqoh] = await db.query(`
            SELECT h.*, g.nama as nama_guru 
            FROM halaqoh h 
            LEFT JOIN guru g ON h.guru_id = g.id 
            ORDER BY h.nama_halaqoh
        `);
        for (let h of halaqoh) {
            const [count] = await db.query('SELECT COUNT(*) as total FROM santri WHERE halaqoh_id = ?', [h.id]);
            h.jumlah_santri = count[0].total;
        }
        res.render('halaqoh/index', { user: req.user, halaqoh, success: req.session.success, error: null });
        req.session.success = null;
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading halaqoh');
    }
});

// Form tambah
router.get('/add', verifyToken, isAdmin, async (req, res) => {
    const [guruList] = await db.query('SELECT id, nama FROM guru ORDER BY nama');
    res.render('halaqoh/form', { user: req.user, halaqoh: null, error: null, action: '/halaqoh/add', guruList });
});

// Proses tambah
router.post('/add', verifyToken, isAdmin, async (req, res) => {
    const { nama_halaqoh, guru_id, jadwal, ruangan } = req.body;
    if (!nama_halaqoh || nama_halaqoh.trim().length < 3) {
        const [guruList] = await db.query('SELECT id, nama FROM guru ORDER BY nama');
        return res.render('halaqoh/form', { user: req.user, halaqoh: null, error: 'Nama halaqoh minimal 3 karakter', action: '/halaqoh/add', guruList });
    }
    const cleanNama = sanitizeString(nama_halaqoh);
    const cleanJadwal = sanitizeString(jadwal || '');
    const cleanRuangan = sanitizeString(ruangan || '');
    try {
        await db.query('INSERT INTO halaqoh (nama_halaqoh, guru_id, jadwal, ruangan) VALUES (?, ?, ?, ?)', [cleanNama, guru_id || null, cleanJadwal, cleanRuangan]);
        await logActivity(req.user.id, req.user.username, 'TAMBAH_HALAQOH', `Nama: ${cleanNama}`, req);
        req.session.success = 'Halaqoh berhasil ditambahkan';
        res.redirect('/halaqoh');
    } catch (err) {
        console.error(err);
        const [guruList] = await db.query('SELECT id, nama FROM guru ORDER BY nama');
        res.render('halaqoh/form', { user: req.user, halaqoh: null, error: 'Gagal menambahkan halaqoh', action: '/halaqoh/add', guruList });
    }
});

// Form edit
router.get('/edit/:id', verifyToken, isAdmin, async (req, res) => {
    const [rows] = await db.query('SELECT * FROM halaqoh WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.redirect('/halaqoh');
    const [guruList] = await db.query('SELECT id, nama FROM guru ORDER BY nama');
    res.render('halaqoh/form', { user: req.user, halaqoh: rows[0], error: null, action: `/halaqoh/edit/${req.params.id}`, guruList });
});

// Proses edit
router.post('/edit/:id', verifyToken, isAdmin, async (req, res) => {
    const { nama_halaqoh, guru_id, jadwal, ruangan } = req.body;
    const cleanNama = sanitizeString(nama_halaqoh);
    const cleanJadwal = sanitizeString(jadwal || '');
    const cleanRuangan = sanitizeString(ruangan || '');
    try {
        await db.query('UPDATE halaqoh SET nama_halaqoh=?, guru_id=?, jadwal=?, ruangan=? WHERE id=?', [cleanNama, guru_id || null, cleanJadwal, cleanRuangan, req.params.id]);
        await logActivity(req.user.id, req.user.username, 'EDIT_HALAQOH', `ID: ${req.params.id}`, req);
        req.session.success = 'Halaqoh berhasil diupdate';
        res.redirect('/halaqoh');
    } catch (err) {
        console.error(err);
        const [guruList] = await db.query('SELECT id, nama FROM guru ORDER BY nama');
        const [rows] = await db.query('SELECT * FROM halaqoh WHERE id = ?', [req.params.id]);
        res.render('halaqoh/form', { user: req.user, halaqoh: rows[0], error: 'Gagal mengupdate', action: `/halaqoh/edit/${req.params.id}`, guruList });
    }
});

// Hapus
router.get('/delete/:id', verifyToken, isAdmin, async (req, res) => {
    const id = req.params.id;
    const [santri] = await db.query('SELECT COUNT(*) as total FROM santri WHERE halaqoh_id = ?', [id]);
    if (santri[0].total > 0) {
        req.session.error = `Masih ada ${santri[0].total} santri. Hapus atau pindahkan dulu.`;
        return res.redirect('/halaqoh');
    }
    await db.query('DELETE FROM halaqoh WHERE id = ?', [id]);
    req.session.success = 'Halaqoh dihapus';
    res.redirect('/halaqoh');
});

// Detail
router.get('/detail/:id', verifyToken, isAdmin, async (req, res) => {
    const [halaqoh] = await db.query(`
        SELECT h.*, g.nama as nama_guru 
        FROM halaqoh h 
        LEFT JOIN guru g ON h.guru_id = g.id 
        WHERE h.id = ?
    `, [req.params.id]);
    if (!halaqoh.length) return res.redirect('/halaqoh');
    const [santri] = await db.query('SELECT * FROM santri WHERE halaqoh_id = ? ORDER BY nama', [req.params.id]);
    res.render('halaqoh/detail', { user: req.user, halaqoh: halaqoh[0], santri });
});

module.exports = router;