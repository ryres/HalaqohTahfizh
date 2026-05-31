const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'kmeanstahfizh';

function verifyToken(req, res, next) {
    const token = req.cookies.token;
    if (!token) return res.redirect('/login');
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.clearCookie('token');
        res.redirect('/login');
    }
}

function isAdmin(req, res, next) {
    if (req.user && req.user.role === 'admin') {
        next();
    } else {
      return res.status(403).render('403', { user: req.user });
    }
}

function isAdminOrGuru(req, res, next) {
    if (req.user && (req.user.role === 'admin' || req.user.role === 'guru_tahfizh')) {
        next();
    } else {
        res.status(403).render('403', { user: req.user });
    }
}

module.exports = { verifyToken, isAdmin, isAdminOrGuru };