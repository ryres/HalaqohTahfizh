const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const path = require('path');
const db = require('./config/db');
require('dotenv').config();
const { verifyToken, isAdmin } = require('./middleware/auth');
const halaqohRoutes = require('./routes/halaqohRoutes');
const guruRoutes = require('./routes/guruRoutes');

const app = express();
const PORT = process.env.PORT || 3000;
const compression = require('compression');
app.use(compression());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const xssMiddleware = require('./middleware/xss');
app.use(xssMiddleware);
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.JWT_SECRET || 'kmeanstahfizh',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 60000 }
}));

app.use((req, res, next) => {
    res.locals.success = req.session.success;
    res.locals.error = req.session.error;
    delete req.session.success;
    delete req.session.error;
    next();
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Breadcrumb middleware
function generateBreadcrumbs(path) {
    const pathname = path.split('?')[0];
    const parts = pathname.split('/').filter(p => p && p !== '');
    const breadcrumbs = [];
    const customNames = {
        'dashboard': 'Dashboard', 'admin': 'Admin', 'user': 'User',
        'data-santri': 'Data Santri', 'target-hafalan': 'Target Hafalan',
        'tahfizh': 'Tahfizh', 'clustering': 'Pembentukan Halaqoh',
        'logs': 'Log Aktivitas', 'users': 'Manajemen User', 'profile': 'Profil',
        'halaqoh': 'Manajemen Halaqoh', 'guru': 'Manajemen Guru',
        'add': 'Tambah', 'edit': 'Edit', 'detail': 'Detail', 'delete': 'Hapus'
    };
    let currentPath = '';
    parts.forEach((part, index) => {
        currentPath += '/' + part;
        let name = customNames[part] || part.charAt(0).toUpperCase() + part.slice(1);
        breadcrumbs.push({ name, url: currentPath, active: index === parts.length - 1 });
    });
    if (breadcrumbs.length === 0) {
        breadcrumbs.push({ name: 'Beranda', url: '/', active: true });
    } else {
        breadcrumbs.unshift({ name: 'Beranda', url: '/', active: false });
    }
    return breadcrumbs;
}

app.use((req, res, next) => {
    res.locals.breadcrumbs = generateBreadcrumbs(req.path);
    next();
});

// Routes
app.use('/', require('./routes/authRoutes'));
app.use('/santri', require('./routes/santriRoutes'));
app.use('/tahfizh', require('./routes/tahfizhRoutes'));
app.use('/', halaqohRoutes);
app.use('/guru', guruRoutes);

app.get('/', (req, res) => res.redirect('/login'));

// API dashboard summary (tetap ada)
app.get('/api/dashboard-summary', verifyToken, async (req, res) => {
    try {
        const [totalSantri] = await db.query('SELECT COUNT(*) as total FROM santri');
        const [setoranBulan] = await db.query(`
            SELECT COUNT(*) as total FROM santri 
            WHERE MONTH(setoran_tgl) = MONTH(CURDATE()) AND YEAR(setoran_tgl) = YEAR(CURDATE())
        `);
        const [avgJuz] = await db.query('SELECT AVG(juz_akhir) as avg FROM (SELECT MAX(juz) as juz_akhir FROM santri GROUP BY id) as a');
        const [mumtaz] = await db.query(`
            SELECT COUNT(*) as total FROM (
                SELECT id, (tajwid+kelancaran+makhraj)/3 as avg_nilai FROM santri
            ) as t WHERE avg_nilai > 80
        `);
        const total = totalSantri[0].total || 1;
        const persenMumtaz = ((mumtaz[0].total / total) * 100).toFixed(1);
        const [distJuz] = await db.query(`
            SELECT juz, COUNT(*) as total FROM (SELECT MAX(juz) as juz FROM santri GROUP BY id) as a GROUP BY juz ORDER BY juz
        `);
        const [statusCount] = await db.query(`
            SELECT 
                SUM(CASE WHEN (tajwid+kelancaran+makhraj)/3 > 80 THEN 1 ELSE 0 END) as mumtaz,
                SUM(CASE WHEN (tajwid+kelancaran+makhraj)/3 BETWEEN 60 AND 80 THEN 1 ELSE 0 END) as regular,
                SUM(CASE WHEN (tajwid+kelancaran+makhraj)/3 < 60 THEN 1 ELSE 0 END) as bimbingan
            FROM santri
        `);
        const [topSantri] = await db.query(`
            SELECT nama, (tajwid+kelancaran+makhraj)/3 as nilai
            FROM santri
            ORDER BY nilai DESC LIMIT 5
        `);
        let logs = [];
        if (req.user.role === 'admin') {
            const [recentLogs] = await db.query(`SELECT username, action, created_at FROM logs ORDER BY created_at DESC LIMIT 5`);
            logs = recentLogs;
        }
        res.json({
            totalSantri: totalSantri[0].total,
            setoranBulan: setoranBulan[0].total,
            rataJuz: avgJuz[0].avg ? parseFloat(avgJuz[0].avg).toFixed(1) : 0,
            persenMumtaz,
            distribusiJuz: distJuz,
            status: statusCount[0],
            topSantri,
            logs
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Gagal mengambil data dashboard' });
    }
});

// API perbandingan halaqoh
app.get('/api/halaqoh-comparison', verifyToken, isAdmin, async (req, res) => {
    try {
        const [data] = await db.query(`
            SELECT h.id, h.nama_halaqoh, COUNT(s.id) as jumlah_santri,
                   AVG(s.tajwid) as avg_tajwid, AVG(s.kelancaran) as avg_kelancaran, AVG(s.makhraj) as avg_makhraj
            FROM halaqoh h LEFT JOIN santri s ON s.halaqoh_id = h.id GROUP BY h.id ORDER BY h.nama_halaqoh
        `);
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Cron job penghapusan otomatis
const cron = require('node-cron');
cron.schedule('0 * * * *', async () => {
    console.log('Menjalankan cron: hapus santri dari request approved > 24 jam');
    try {
        const [rows] = await db.query(`
            SELECT dr.santri_id FROM delete_requests dr
            WHERE dr.status = 'approved' AND dr.approved_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)
        `);
        for (let row of rows) {
            await db.query('DELETE FROM santri WHERE id = ?', [row.santri_id]);
            await db.query('UPDATE delete_requests SET status = "deleted" WHERE santri_id = ? AND status = "approved"', [row.santri_id]);
            console.log(`Santri ID ${row.santri_id} dihapus otomatis.`);
        }
    } catch (err) { console.error('Cron error:', err); }
});

app.get('/create-tables', async (req, res) => {
    try {
        const queries = [
            // Tulis semua CREATE TABLE di sini (atau baca dari file database.sql)
            `CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    role ENUM('admin','user','guru_tahfizh') NOT NULL DEFAULT 'user',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ======================================================
-- TABEL santri
-- ======================================================
CREATE TABLE IF NOT EXISTS santri (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nama VARCHAR(100) NOT NULL,
    kelas VARCHAR(50),
    juz INT,
    surat VARCHAR(50),
    ayat INT,
    setoran_tgl DATE,
    tajwid INT,
    kelancaran INT,
    makhraj INT,
    baris INT,
    halaqoh_id INT NULL,
    guru_id INT NULL,
    target_juz INT DEFAULT 30,
    user_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (halaqoh_id) REFERENCES halaqoh(id) ON DELETE SET NULL,
    FOREIGN KEY (guru_id) REFERENCES guru(id) ON DELETE SET NULL
);

-- Index untuk performa
CREATE INDEX idx_nama ON santri (nama);
CREATE INDEX idx_juz ON santri (juz);
CREATE INDEX idx_setoran_tgl ON santri (setoran_tgl);
CREATE INDEX idx_user_id ON santri (user_id);
CREATE INDEX idx_halaqoh_id ON santri (halaqoh_id);
CREATE INDEX idx_guru_id ON santri (guru_id);
CREATE INDEX idx_created_at ON santri (created_at);

-- ======================================================
-- TABEL halaqoh
-- ======================================================
CREATE TABLE IF NOT EXISTS halaqoh (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nama_halaqoh VARCHAR(100) NOT NULL,
    guru_id INT NULL,
    ruangan VARCHAR(50),
    jadwal VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (guru_id) REFERENCES guru(id) ON DELETE SET NULL
);

-- ======================================================
-- TABEL guru
-- ======================================================
CREATE TABLE IF NOT EXISTS guru (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nama VARCHAR(100) NOT NULL,
    jabatan VARCHAR(100),
    unit VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ======================================================
-- TABEL delete_requests
-- ======================================================
CREATE TABLE IF NOT EXISTS delete_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    santri_id INT NOT NULL,
    requested_by INT NOT NULL,
    reason TEXT,
    status ENUM('pending','approved','rejected','deleted') DEFAULT 'pending',
    approved_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (santri_id) REFERENCES santri(id) ON DELETE CASCADE,
    FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE CASCADE
);

-- Index untuk delete_requests
CREATE INDEX idx_delete_status ON delete_requests (status);
CREATE INDEX idx_delete_requested_by ON delete_requests (requested_by);
CREATE INDEX idx_delete_approved_at ON delete_requests (approved_at);

-- ======================================================
-- TABEL logs
-- ======================================================
CREATE TABLE IF NOT EXISTS logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    username VARCHAR(50),
    action VARCHAR(100),
    details TEXT,
    ip_address VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Index untuk logs
CREATE INDEX idx_logs_created_at ON logs (created_at);
CREATE INDEX idx_logs_user_id ON logs (user_id);
CREATE INDEX idx_logs_action ON logs (action);

-- ======================================================
-- TABEL notifications
-- ======================================================
CREATE TABLE IF NOT EXISTS notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    type ENUM('success','info','warning','danger') DEFAULT 'info',
    link VARCHAR(255),
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_read (user_id, is_read)
);`,
        ];
        for (const query of queries) {
            await db.query(query);
        }
        res.send('Tables created');
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.listen(PORT, () => console.log(`🚀 Server: http://localhost:${PORT}`));
