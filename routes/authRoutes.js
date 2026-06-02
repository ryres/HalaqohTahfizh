const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { verifyToken, isAdmin, isAdminOrGuru } = require('../middleware/auth');
const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const { sanitizeString, isValidUsername, isValidPassword, isValidRole, validateInteger, validateDate } = require('../utils/validation');
const { cleanupApprovedRequests } = require('../utils/cleanup');
const { logActivity } = require('../utils/logger');
const { addNotification } = require('../utils/notifications');


// ==================== HALAMAN LOGIN & REGISTER ====================
router.get('/login', (req, res) => res.render('login', { error: null }));

router.post('/login', async (req, res) => {
    let username = isValidUsername(req.body.username) ? req.body.username : null;
    let password = req.body.password;
    if (!username || !password) {
        return res.render('login', { error: 'Username atau password salah' });
    }
    try {
        const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
        if (rows.length === 0) {
            return res.render('login', { error: 'Username atau password salah' });
        }
        const user = rows[0];
        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.render('login', { error: 'Username atau password salah' });
        }
        if (!JWT_SECRET) {
            return res.render('login', { error: 'Server belum dikonfigurasi dengan benar' });
        }
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '1d' });
        res.cookie('token', token, {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production',
            maxAge: 24 * 60 * 60 * 1000
        });
        req.session.success = `Selamat datang, ${user.username}`;
        await logActivity(user.id, user.username, 'LOGIN', null, req);
        if (user.role === 'admin' || user.role === 'guru_tahfizh') {
    res.redirect('/dashboard/admin');
} else {
    res.redirect('/dashboard/user');
}
    } catch (err) {
        console.error(err);
        res.render('login', { error: 'Terjadi kesalahan, silakan coba lagi' });
    }
});

router.get('/register', (req, res) => res.render('register', { error: null }));

router.post('/register', async (req, res) => {
    let username = sanitizeString(req.body.username);
    let password = req.body.password;
    let role = sanitizeString(req.body.role);

    if (!isValidUsername(username)) return res.render('register', { error: 'Username tidak valid (min 3 alfanumerik)' });
    if (!isValidPassword(password)) return res.render('register', { error: 'Password minimal 6 karakter' });
    if (!isValidRole(role)) role = 'user';

    try {
        const hashed = await bcrypt.hash(password, 10);
        const [result] = await db.query('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hashed, role]);
        await logActivity(result.insertId, username, 'REGISTER', `Role: ${role}`, req);
        req.session.success = 'Registrasi berhasil, silakan login';
        res.redirect('/login');
    } catch (err) {
        res.render('register', { error: 'Username sudah terdaftar' });
    }
});

// ==================== DASHBOARD ====================
// Dashboard untuk semua role (admin, guru_tahfizh, user)
router.get('/dashboard', verifyToken, async (req, res) => {
    try {
        return res.render('dashboard', { user: req.user });
    } catch (err) {
        console.error(err);
        return res.status(500).send('Error loading dashboard');
    }
});
router.get('/dashboard/admin', verifyToken, (req, res) => {return res.redirect('/dashboard');});
router.get('/dashboard/user', verifyToken, (req, res) =>  {return res.redirect('/dashboard');});

// ==================== HALAMAN DATA SANTRI ====================
router.get('/data-santri', verifyToken, isAdminOrGuru, async (req, res) => {
    try {
        await cleanupApprovedRequests(); // panggil cleanup
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';
        const sortBy = req.query.sort || 'created_at';
        const order = req.query.order === 'asc' ? 'ASC' : 'DESC';
        const allowed = ['nama', 'juz', 'setoran_tgl', 'tajwid', 'kelancaran', 'makhraj', 'created_at'];
        const sortColumn = allowed.includes(sortBy) ? sortBy : 'created_at';
        let where = '';
        let params = [];
        if (search) {
            where = 'WHERE nama LIKE ? OR juz = ?';
            params = [`%${search}%`, search];
        }
        const [santri] = await db.query(
            `SELECT * FROM santri ${where} ORDER BY ${sortColumn} ${order} LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );
        const [total] = await db.query(`SELECT COUNT(*) as total FROM santri ${where}`, params);
        const totalPages = Math.ceil(total[0].total / limit);
        const [users] = await db.query('SELECT id, username, role FROM users');
        res.render('data_santri', {
            user: req.user,
            santri,
            users,
            search,
            currentPage: page,
            totalPages,
            limit,
            sortBy: sortColumn,
            order: order.toLowerCase()
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading data santri');
    }
});

// ==================== TARGET HAFALAN ====================
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
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const search = req.query.search || '';
        const sortBy = req.query.sort || 'nama';
        const order = req.query.order === 'asc' ? 'asc' : 'desc';
        let whereClause = '';
        let params = [];
        if (search) {
            whereClause = ' WHERE s.nama LIKE ? OR s.kelas LIKE ?';
            params = [`%${search}%`, `%${search}%`];
        }
        const dataQuery = `
            SELECT 
                s.id, s.nama, s.kelas, s.target_juz,
                MIN(s.setoran_tgl) as tgl_awal, MAX(s.setoran_tgl) as tgl_akhir,
                MIN(s.juz) as juz_awal, MAX(s.juz) as juz_akhir
            FROM santri s
            ${whereClause}
            GROUP BY s.id
        `;
        const [rows] = await db.query(dataQuery, params);
        let data = rows.map(row => {
            let durasiHari = null, periode = '-';
            if (row.tgl_awal && row.tgl_akhir) {
                const diffTime = Math.abs(new Date(row.tgl_akhir) - new Date(row.tgl_awal));
                durasiHari = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (durasiHari <= 7) periode = 'Pekan';
                else if (durasiHari <= 30) periode = 'Bulan';
                else if (durasiHari <= 90) periode = '3 Bulan';
                else if (durasiHari <= 180) periode = 'Semester';
                else periode = 'Tahunan';
            }
            const pencapaian = row.juz_akhir || 0;
            const target = row.target_juz || 30;
            const sisa = Math.max(0, target - pencapaian);
            return {
                nama: row.nama,
                kelas: row.kelas || '-',
                target: target,
                pencapaian: pencapaian,
                sisa: sisa,
                durasiHari: durasiHari ? durasiHari + ' hari' : '-',
                periode: periode,
                tgl_awal: row.tgl_awal ? new Date(row.tgl_awal).toLocaleDateString('id-ID') : '-',
                tgl_akhir: row.tgl_akhir ? new Date(row.tgl_akhir).toLocaleDateString('id-ID') : '-'
            };
        });
        const allowedSort = ['nama', 'kelas', 'target', 'pencapaian', 'sisa', 'durasiHari', 'periode', 'tgl_awal', 'tgl_akhir'];
        if (allowedSort.includes(sortBy)) {
            data.sort((a, b) => {
                let valA = a[sortBy];
                let valB = b[sortBy];
                if (sortBy === 'target' || sortBy === 'pencapaian' || sortBy === 'sisa') {
                    valA = parseInt(valA);
                    valB = parseInt(valB);
                } else if (sortBy === 'durasiHari') {
                    valA = parseInt(valA) || 0;
                    valB = parseInt(valB) || 0;
                } else {
                    valA = String(valA).toLowerCase();
                    valB = String(valB).toLowerCase();
                }
                if (valA < valB) return order === 'asc' ? -1 : 1;
                if (valA > valB) return order === 'asc' ? 1 : -1;
                return 0;
            });
        }
        const totalRecords = data.length;
        const totalPages = Math.ceil(totalRecords / limit);
        const offset = (page - 1) * limit;
        const paginatedData = data.slice(offset, offset + limit);
        res.render('target_hafalan', {
            user: req.user,
            data: paginatedData,
            search,
            currentPage: page,
            totalPages,
            limit,
            sortBy,
            order,
            totalRecords
        });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error target hafalan: ' + err.message);
    }
});

// ==================== MANAJEMEN USER & LOGS ====================
router.get('/logs', verifyToken, isAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';
        let whereClause = '';
        let params = [];
        if (search) {
            whereClause = ' WHERE username LIKE ? OR action LIKE ? OR details LIKE ?';
            params = [`%${search}%`, `%${search}%`, `%${search}%`];
        }
        const [logs] = await db.query(
            `SELECT * FROM logs ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );
        const [totalResult] = await db.query(
            `SELECT COUNT(*) as total FROM logs ${whereClause}`,
            params
        );
        const totalRecords = totalResult[0].total;
        const totalPages = Math.ceil(totalRecords / limit);
        res.render('logs', { user: req.user, logs, search, currentPage: page, totalPages, limit, totalRecords });
    } catch (err) {
        console.error(err);
        res.status(500).send('Gagal memuat log aktivitas');
    }
});

router.get('/users', verifyToken, isAdmin, async (req, res) => {
    try {
        const [users] = await db.query('SELECT id, username, role, created_at FROM users ORDER BY created_at DESC');
        const success = req.session.success;
        const error = req.session.error;
        // Hapus session setelah dibaca
        req.session.success = null;
        req.session.error = null;
        res.render('users', { user: req.user, users, success, error });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error load users');
    }
});

router.post('/users/add', verifyToken, isAdmin, async (req, res) => {
    let { username, password, role } = req.body;
    username = sanitizeString(username);
    if (!isValidUsername(username)) {
        req.session.error = 'Username tidak valid (min 3, huruf/angka/underscore)';
        return res.redirect('/users');
    }
    if (password && !isValidPassword(password)) {
        req.session.error = 'Password minimal 6 karakter';
        return res.redirect('/users');
    }
    const finalRole = isValidRole(role) ? role : 'user';
    const hashed = await bcrypt.hash(password || '123456', 10);
    try {
        const [result] = await db.query('INSERT INTO users (username, password, role) VALUES (?, ?, ?)', [username, hashed, finalRole]);
        await logActivity(req.user.id, req.user.username, 'TAMBAH_USER', `Username: ${username}`, req);
        req.session.success = `User ${username} berhasil ditambahkan.`;
    } catch (err) {
        req.session.error = 'Username sudah ada';
    }
    res.redirect('/users');
});

router.post('/users/delete/:id', verifyToken, isAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    if (id == req.user.id) {
        req.session.error = 'Tidak bisa menghapus diri sendiri';
        return res.redirect('/users');
    }
    // Cari username sebelum hapus
    const [rows] = await db.query('SELECT username FROM users WHERE id = ?', [id]);
    const username = rows[0]?.username || 'unknown';
    await db.query('DELETE FROM users WHERE id = ?', [id]);
    await logActivity(req.user.id, req.user.username, 'HAPUS_USER', `ID User: ${id} (${username})`, req);
    req.session.success = `User ${username} berhasil dihapus.`;
    res.redirect('/users');
});

router.post('/users/reset-password/:id', verifyToken, isAdmin, async (req, res) => {
    const id = parseInt(req.params.id);
    const newPass = '123456';
    const hashed = await bcrypt.hash(newPass, 10);
    await db.query('UPDATE users SET password = ? WHERE id = ?', [hashed, id]);
    await logActivity(req.user.id, req.user.username, 'RESET_PASSWORD_USER', `ID User: ${id}`, req);
    req.session.success = `Password user berhasil direset menjadi 123456.`;
    res.redirect('/users');
});


// ==================== PROFIL & UBAH PASSWORD ====================
router.get('/profile', verifyToken, async (req, res) => {
    const [rows] = await db.query('SELECT id, username, role, created_at FROM users WHERE id = ?', [req.user.id]);
    res.render('profile', { user: req.user, userData: rows[0], error: null, success: null });
});

router.post('/change-password', verifyToken, async (req, res) => {
    const { old_password, new_password, confirm_password } = req.body;
    if (new_password !== confirm_password || new_password.length < 6) return res.redirect('/profile');
    const [rows] = await db.query('SELECT password FROM users WHERE id = ?', [req.user.id]);
    const match = await bcrypt.compare(old_password, rows[0].password);
    if (!match) return res.redirect('/profile');
    const hashed = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE users SET password = ? WHERE id = ?', [hashed, req.user.id]);
    res.clearCookie('token');
    await logActivity(req.user.id, req.user.username, 'CHANGE_PASSWORD', null, req);
    req.session.success = 'Password berubah, silakan login ulang';
    res.redirect('/login');
});

router.get('/logout', verifyToken, async (req, res) => {
    await logActivity(req.user.id, req.user.username, 'LOGOUT', null, req);
    req.session.destroy(() => {
        res.clearCookie('sid');
        res.clearCookie('token', {
            httpOnly: true,
            sameSite: 'lax',
            secure: process.env.NODE_ENV === 'production'
        });
        res.redirect('/login');
    });
});

// ==================== MANAJEMEN HALAQOH ====================
router.get('/halaqoh', verifyToken, isAdmin, async (req, res) => {
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

router.get('/halaqoh/add', verifyToken, isAdmin, async (req, res) => {
    const [guruList] = await db.query('SELECT id, nama FROM guru ORDER BY nama');
    res.render('halaqoh/form', { user: req.user, halaqoh: null, error: null, action: '/halaqoh/add', guruList });
});

router.post('/halaqoh/add', verifyToken, isAdmin, async (req, res) => {
    const { nama_halaqoh, guru_id, ruangan, hari, jam_mulai, jam_selesai } = req.body;
    if (!nama_halaqoh || nama_halaqoh.trim().length < 3) {
        const [guruList] = await db.query('SELECT id, nama FROM guru ORDER BY nama');
        return res.render('halaqoh/form', { user: req.user, halaqoh: null, error: 'Nama halaqoh minimal 3 karakter', action: '/halaqoh/add', guruList });
    }
    const jadwal = `${hari} ${jam_mulai} - ${jam_selesai}`;
    const cleanNama = sanitizeString(nama_halaqoh);
    const cleanRuangan = sanitizeString(ruangan || '');
    const guruId = guru_id ? parseInt(guru_id) : null;
    try {
        await db.query('INSERT INTO halaqoh (nama_halaqoh, guru_id, ruangan, jadwal) VALUES (?, ?, ?, ?)', 
            [cleanNama, guruId, cleanRuangan, jadwal]);
        await logActivity(req.user.id, req.user.username, 'TAMBAH_HALAQOH', `Nama: ${cleanNama}`, req);
        req.session.success = 'Halaqoh berhasil ditambahkan';
        res.redirect('/halaqoh');
    } catch (err) {
        console.error(err);
        const [guruList] = await db.query('SELECT id, nama FROM guru ORDER BY nama');
        res.render('halaqoh/form', { user: req.user, halaqoh: null, error: 'Gagal menambahkan halaqoh', action: '/halaqoh/add', guruList });
    }
});

router.get('/halaqoh/edit/:id', verifyToken, isAdmin, async (req, res) => {
    const id = req.params.id;
    try {
        const [rows] = await db.query('SELECT * FROM halaqoh WHERE id = ?', [id]);
        if (rows.length === 0) return res.redirect('/halaqoh');
        const h = rows[0];
        let hari = '', jam_mulai = '', jam_selesai = '';
        if (h.jadwal) {
            const parts = h.jadwal.match(/(\S+)\s+(\S+)\s+-\s+(\S+)/);
            if (parts) {
                hari = parts[1];
                jam_mulai = parts[2];
                jam_selesai = parts[3];
            }
        }
        const [guruList] = await db.query('SELECT id, nama FROM guru ORDER BY nama');
        res.render('halaqoh/form', { 
            user: req.user, 
            halaqoh: { ...h, hari, jam_mulai, jam_selesai }, 
            error: null, 
            action: `/halaqoh/edit/${id}`,
            guruList
        });
    } catch (err) {
        res.redirect('/halaqoh');
    }
});

router.post('/halaqoh/edit/:id', verifyToken, isAdmin, async (req, res) => {
    const id = req.params.id;
    const { nama_halaqoh, guru_id, ruangan, hari, jam_mulai, jam_selesai } = req.body;
    if (!nama_halaqoh || nama_halaqoh.trim().length < 3) {
        const [guruList] = await db.query('SELECT id, nama FROM guru ORDER BY nama');
        return res.render('halaqoh/form', { user: req.user, halaqoh: { id, nama_halaqoh, guru_id, ruangan, hari, jam_mulai, jam_selesai }, error: 'Nama halaqoh minimal 3 karakter', action: `/halaqoh/edit/${id}`, guruList });
    }
    const jadwal = `${hari} ${jam_mulai} - ${jam_selesai}`;
    const cleanNama = sanitizeString(nama_halaqoh);
    const cleanRuangan = sanitizeString(ruangan || '');
    const guruId = guru_id ? parseInt(guru_id) : null;
    try {
        await db.query('UPDATE halaqoh SET nama_halaqoh=?, guru_id=?, ruangan=?, jadwal=? WHERE id=?', 
            [cleanNama, guruId, cleanRuangan, jadwal, id]);
        await logActivity(req.user.id, req.user.username, 'EDIT_HALAQOH', `ID: ${id}, Nama: ${cleanNama}`, req);
        req.session.success = 'Halaqoh berhasil diupdate';
        res.redirect('/halaqoh');
    } catch (err) {
        console.error(err);
        const [guruList] = await db.query('SELECT id, nama FROM guru ORDER BY nama');
        res.render('halaqoh/form', { user: req.user, halaqoh: { id, nama_halaqoh, guru_id, ruangan, hari, jam_mulai, jam_selesai }, error: 'Gagal mengupdate halaqoh', action: `/halaqoh/edit/${id}`, guruList });
    }
});

router.post('/halaqoh/delete/:id', verifyToken, isAdmin, async (req, res) => {
    const id = req.params.id;
    try {
        const [santri] = await db.query('SELECT COUNT(*) as total FROM santri WHERE halaqoh_id = ?', [id]);
        if (santri[0].total > 0) {
            req.session.error = `Tidak bisa menghapus halaqoh karena masih ada ${santri[0].total} santri terdaftar. Pindahkan atau hapus santri terlebih dahulu.`;
            return res.redirect('/halaqoh');
        }
        await db.query('DELETE FROM halaqoh WHERE id = ?', [id]);
        await logActivity(req.user.id, req.user.username, 'HAPUS_HALAQOH', `ID: ${id}`, req);
        req.session.success = 'Halaqoh berhasil dihapus';
    } catch (err) {
        req.session.error = 'Gagal menghapus halaqoh';
    }
    res.redirect('/halaqoh');
});

router.get('/halaqoh/detail/:id', verifyToken, isAdmin, async (req, res) => {
    const id = req.params.id;
    try {
        const [halaqoh] = await db.query(`
            SELECT h.*, g.nama as nama_guru 
            FROM halaqoh h 
            LEFT JOIN guru g ON h.guru_id = g.id 
            WHERE h.id = ?
        `, [id]);
        if (halaqoh.length === 0) return res.redirect('/halaqoh');
        const [santri] = await db.query('SELECT * FROM santri WHERE halaqoh_id = ? ORDER BY nama', [id]);
        res.render('halaqoh/detail', { user: req.user, halaqoh: halaqoh[0], santri });
    } catch (err) {
        res.redirect('/halaqoh');
    }
});

// ==================== CLEANUP & STATUS REQUEST ====================
// Route untuk melihat status request (guru & user)

// Route khusus guru untuk melihat request sendiri dengan detail sisa waktu
router.get('/guru/my-requests', verifyToken, async (req, res) => {
    if (req.user.role !== 'guru_tahfizh') return res.status(403).render('403', { user: req.user });
    try {
        const [requests] = await db.query(`
            SELECT dr.*, s.nama as santri_nama, s.kelas, s.juz,
                   TIMESTAMPDIFF(HOUR, dr.approved_at, NOW()) as hours_since_approve,
                   CASE 
                       WHEN dr.status = 'approved' AND dr.approved_at IS NOT NULL THEN 
                           GREATEST(0, 24 - TIMESTAMPDIFF(HOUR, dr.approved_at, NOW()))
                       ELSE NULL
                   END as hours_remaining
            FROM delete_requests dr
            JOIN santri s ON dr.santri_id = s.id
            WHERE dr.requested_by = ?
            ORDER BY dr.created_at DESC
        `, [req.user.id]);
        res.render('guru_my_requests', { user: req.user, requests });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error');
    }
});

// ADMIN: lihat semua request pending
router.get('/admin/delete-requests', verifyToken, isAdmin, async (req, res) => {
    try {
        await cleanupApprovedRequests();
        const [requests] = await db.query(`
            SELECT dr.*, s.nama as santri_nama, u.username as requester_name
            FROM delete_requests dr
            JOIN santri s ON dr.santri_id = s.id
            JOIN users u ON dr.requested_by = u.id
            WHERE dr.status = 'pending'
            ORDER BY dr.created_at DESC
        `);
        res.render('admin_delete_requests', { user: req.user, requests });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading requests');
    }
});

// ADMIN: approve/reject request (tidak langsung hapus, hanya set approved dengan waktu)
router.post('/admin/delete-requests/:id/:action', verifyToken, isAdmin, async (req, res) => {
    const { id, action } = req.params;
    try {
        if (action === 'approve') {
            // Set status approved dan catat waktu approval (approved_at)
            await db.query('UPDATE delete_requests SET status = "approved", approved_at = NOW() WHERE id = ?', [id]);
            const [reqData] = await db.query('SELECT santri_id FROM delete_requests WHERE id = ?', [id]);
            if (reqData.length) {
                await logActivity(req.user.id, req.user.username, 'APPROVE_DELETE_SANTRI', `ID Santri: ${reqData[0].santri_id}`, req);
            }
            req.session.success = 'Permintaan disetujui. Data akan dihapus otomatis dalam 24 jam.';
        } else if (action === 'reject') {
            await db.query('UPDATE delete_requests SET status = "rejected" WHERE id = ?', [id]);
            req.session.success = 'Permintaan ditolak.';
        } else {
            req.session.error = 'Aksi tidak dikenal';
        }
    } catch (err) {
        console.error(err);
        req.session.error = 'Gagal memproses permintaan';
    }
    res.redirect('/admin/delete-requests');
});

// ==================== STATUS REQUEST (untuk guru_tahfizh dan user) ====================
router.get('/delete-requests/status', verifyToken, async (req, res) => {
    // Hanya untuk guru_tahfizh
    if (req.user.role !== 'guru_tahfizh') {
        return res.status(403).render('403', { user: req.user });
    }
    try {
        await cleanupApprovedRequests();
        const [requests] = await db.query(`
            SELECT dr.*, s.nama as santri_nama 
            FROM delete_requests dr
            JOIN santri s ON dr.santri_id = s.id
            WHERE dr.requested_by = ?
            ORDER BY dr.created_at DESC
        `, [req.user.id]);
        res.render('request_status', { user: req.user, requests });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error loading status request');
    }
});

module.exports = router;