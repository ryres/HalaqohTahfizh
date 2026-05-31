const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const path = require('path');
const db = require('./config/db');
require('dotenv').config();
const { initDatabase } = require('./database/init');
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

// ── Startup ──────────────────────────────────────────────────────────────────
// Initialize the database schema before accepting any requests or running crons.
(async () => {
    try {
        await initDatabase();
    } catch (err) {
        console.error('❌ Database initialization failed. Server will not start.', err);
        process.exit(1);
    }

    app.listen(PORT, () => console.log(`🚀 Server: http://localhost:${PORT}`));
})();