const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const path = require('path');
const db = require('./config/db');
require('dotenv').config();
const helmet = require('helmet');
const { verifyToken, isAdmin } = require('./middleware/auth');
const guruRoutes = require('./routes/guruRoutes');

const app = express();
const PORT = process.env.PORT || 3000;
const compression = require('compression');
app.use(compression());
app.set('trust proxy', 1);
app.use(helmet({
    contentSecurityPolicy: false
}));

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32 || jwtSecret === 'kmeanstahfizh') {
    console.error('❌ JWT_SECRET tidak aman. Gunakan secret minimal 32 karakter.');
    if (process.env.NODE_ENV === 'production') {
        process.exit(1);
    }
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const xssMiddleware = require('./middleware/xss');
app.use(xssMiddleware);
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: jwtSecret || 'development-only-insecure-secret-change-me',
    resave: false,
    saveUninitialized: false,
    name: 'sid',
    cookie: {
        maxAge: 14400000,
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production'
    }
}));

// Mitigasi CSRF sederhana berbasis Origin/Referer untuk request state-changing.
app.use((req, res, next) => {
    const protectedMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
    if (!protectedMethods.includes(req.method)) return next();

    const hasSession = Boolean(req.cookies.sid || req.cookies.token);
    if (!hasSession) return next();

    const origin = req.get('origin');
    const referer = req.get('referer');
    const host = req.get('x-forwarded-host') || req.get('host');

    const isTrusted = (value) => {
        if (!value || !host) return false;
        try {
            const parsed = new URL(value);
            return parsed.host === host;
        } catch (_) {
            return false;
        }
    };

    if (origin && isTrusted(origin)) return next();
    if (referer && isTrusted(referer)) return next();

    return res.status(403).send('Permintaan ditolak (CSRF protection).');
});

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
app.use('/guru', guruRoutes);

app.get('/', (req, res) => res.redirect('/login'));

// API dashboard summary (tetap ada)
app.get('/api/dashboard-summary', verifyToken, async (req, res) => {
    try {
        const promises = [
            db.query('SELECT COUNT(*) as total FROM santri'),
            db.query(`SELECT COUNT(*) as total FROM santri WHERE MONTH(setoran_tgl) = MONTH(CURDATE()) AND YEAR(setoran_tgl) = YEAR(CURDATE())`),
            db.query('SELECT AVG(juz_akhir) as avg FROM (SELECT MAX(juz) as juz_akhir FROM santri GROUP BY id) as a'),
            db.query(`SELECT COUNT(*) as total FROM (SELECT id, (tajwid+kelancaran+makhraj)/3 as avg_nilai FROM santri) as t WHERE avg_nilai > 80`),
            db.query(`SELECT juz, COUNT(*) as total FROM (SELECT MAX(juz) as juz FROM santri GROUP BY id) as a GROUP BY juz ORDER BY juz`),
            db.query(`SELECT 
                SUM(CASE WHEN (tajwid+kelancaran+makhraj)/3 > 80 THEN 1 ELSE 0 END) as mumtaz,
                SUM(CASE WHEN (tajwid+kelancaran+makhraj)/3 BETWEEN 60 AND 80 THEN 1 ELSE 0 END) as regular,
                SUM(CASE WHEN (tajwid+kelancaran+makhraj)/3 < 60 THEN 1 ELSE 0 END) as bimbingan
            FROM santri`)
        ];
        promises.push(db.query(`
            SELECT nama, (tajwid+kelancaran+makhraj)/3 as nilai
            FROM santri
            ORDER BY nilai DESC LIMIT 5
        `));
        if (req.user && req.user.role === 'admin') {
            promises.push(db.query(`SELECT username, action, created_at FROM logs ORDER BY created_at DESC LIMIT 5`));
        }

        const results = await Promise.all(promises);
        const totalSantri = results[0][0];
        const setoranBulan = results[1][0];
        const avgJuz = results[2][0];
        const mumtaz = results[3][0];
        const distJuz = results[4][0];
        const statusCount = results[5][0];
        const topSantri = results[6][0];
        let logs = [];
        if (req.user && req.user.role === 'admin') logs = results[7][0];

        const total = totalSantri[0].total || 1;
        const persenMumtaz = ((mumtaz[0].total / total) * 100).toFixed(1);
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
        const ids = rows.map(r => r.santri_id).filter(Boolean);
        if (ids.length > 0) {
            await db.query('DELETE FROM santri WHERE id IN (?)', [ids]);
            await db.query('UPDATE delete_requests SET status = "deleted" WHERE santri_id IN (?) AND status = "approved"', [ids]);
            ids.forEach(id => console.log(`Santri ID ${id} dihapus otomatis.`));
        }
    } catch (err) { console.error('Cron error:', err); }
});

app.listen(PORT, () => console.log(`🚀 Server: http://localhost:${PORT}`));