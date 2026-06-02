const express = require('express');
const db = require('../config/db');
const { verifyToken, isAdmin } = require('../middleware/auth');
const { logActivity } = require('../utils/logger');
const { sanitizeString } = require('../utils/validation');

const router = express.Router();

// Daftar Guru
router.get('/', verifyToken, isAdmin, async (req, res) => {
    try {
        const [guru] = await db.query('SELECT * FROM guru ORDER BY nama');
        res.render('guru/index', { user: req.user, guru, success: req.session.success, error: null });
        req.session.success = null;
    } catch (err) {
        res.status(500).send('Error loading guru');
    }
});

// Form tambah guru
router.get('/add', verifyToken, isAdmin, (req, res) => {
    res.render('guru/form', { user: req.user, guru: null, error: null, action: '/guru/add' });
});

// Proses tambah guru
router.post('/add', verifyToken, isAdmin, async (req, res) => {
    const { nama, jabatan, unit } = req.body;
    if (!nama || nama.trim().length < 3) {
        return res.render('guru/form', { user: req.user, guru: null, error: 'Nama minimal 3 karakter', action: '/guru/add' });
    }
    const cleanNama = sanitizeString(nama);
    const cleanJabatan = sanitizeString(jabatan || '');
    const cleanUnit = sanitizeString(unit || '');
    try {
        await db.query('INSERT INTO guru (nama, jabatan, unit) VALUES (?, ?, ?)', [cleanNama, cleanJabatan, cleanUnit]);
        await logActivity(req.user.id, req.user.username, 'TAMBAH_GURU', `Nama: ${cleanNama}`, req);
        req.session.success = 'Guru berhasil ditambahkan';
        res.redirect('/guru');
    } catch (err) {
        res.render('guru/form', { user: req.user, guru: null, error: 'Gagal menambahkan guru', action: '/guru/add' });
    }
});

// Form edit guru
router.get('/edit/:id', verifyToken, isAdmin, async (req, res) => {
    const [rows] = await db.query('SELECT * FROM guru WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.redirect('/guru');
    res.render('guru/form', { user: req.user, guru: rows[0], error: null, action: `/guru/edit/${req.params.id}` });
});

// Proses edit guru
router.post('/edit/:id', verifyToken, isAdmin, async (req, res) => {
    const { nama, jabatan, unit } = req.body;
    const cleanNama = sanitizeString(nama);
    const cleanJabatan = sanitizeString(jabatan || '');
    const cleanUnit = sanitizeString(unit || '');
    await db.query('UPDATE guru SET nama=?, jabatan=?, unit=? WHERE id=?', [cleanNama, cleanJabatan, cleanUnit, req.params.id]);
    await logActivity(req.user.id, req.user.username, 'EDIT_GURU', `ID: ${req.params.id}`, req);
    req.session.success = 'Guru berhasil diupdate';
    res.redirect('/guru');
});

// Hapus guru
router.post('/delete/:id', verifyToken, isAdmin, async (req, res) => {
    const id = req.params.id;
    // Cek apakah guru dipakai di halaqoh
    const [halaqoh] = await db.query('SELECT COUNT(*) as total FROM halaqoh WHERE guru_id = ?', [id]);
    if (halaqoh[0].total > 0) {
        req.session.error = `Guru masih digunakan di ${halaqoh[0].total} halaqoh. Hapus atau ubah terlebih dahulu.`;
        return res.redirect('/guru');
    }
    await db.query('DELETE FROM guru WHERE id = ?', [id]);
    req.session.success = 'Guru dihapus';
    res.redirect('/guru');
});

module.exports = router;