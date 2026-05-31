// utils/validation.js
const xss = require('xss'); // perlu install npm install xss


// Sanitasi teks biasa (hapus tag HTML, trim)
function sanitizeString(str) {
    if (str === undefined || str === null) return '';
    return xss(str.trim());
}

// Validasi username (alfanumerik, underscore, min 3 max 50)
function isValidUsername(username) {
    const re = /^[a-zA-Z0-9_]{3,50}$/;
    return re.test(username);
}

// Validasi password (min 6 karakter, bebas karakter apapun)
function isValidPassword(password) {
    return password && password.length >= 6;
}

// Validasi role (hanya 'admin', 'user' dan 'guru tahfizh')
function isValidRole(role) {
    return role === 'admin' || role === 'user' || role === 'guru_tahfizh';
}

// Validasi nama santri (min 3, max 100, tidak boleh hanya angka/spesial)
function isValidNama(nama) {
    const str = sanitizeString(nama);
    return str.length >= 3 && str.length <= 100 && /[a-zA-Z]/.test(str);
}

// Validasi juz (1-30, integer)
function isValidJuz(juz) {
    const num = parseInt(juz);
    return !isNaN(num) && num >= 1 && num <= 30;
}

// Validasi surat (hanya huruf, spasi, tanda kutip, dan titik)
function isValidSurat(surat) {
    const str = sanitizeString(surat);
    return str.length >= 2 && str.length <= 100 && /^[a-zA-Z\s\.\-\']+$/.test(str);
}

// Validasi ayat (positive integer)
function isValidAyat(ayat) {
    const num = parseInt(ayat);
    return !isNaN(num) && num >= 1;
}

// Validasi nilai (0-100, integer)
function isValidNilai(val) {
    const num = parseInt(val);
    return !isNaN(num) && num >= 0 && num <= 100;
}

// Validasi baris (positive integer)
function isValidBaris(baris) {
    const num = parseInt(baris);
    return !isNaN(num) && num >= 1;
}

// Validasi tanggal (format YYYY-MM-DD)
function isValidDate(dateStr) {
    if (!dateStr) return false;
    const regex = /^\d{4}-\d{2}-\d{2}$/;
    if (!regex.test(dateStr)) return false;
    const date = new Date(dateStr);
    return date instanceof Date && !isNaN(date);
}

// Validasi kelas (opsional, alfanumerik + spasi, max 20)
function isValidKelas(kelas) {
    if (!kelas) return true;
    const str = sanitizeString(kelas);
    return str.length <= 20 && /^[a-zA-Z0-9\s\-]+$/.test(str);
}

// Validasi halaqoh & pembimbing (opsional, huruf/spasi, max 100)
function isValidTextOptional(text) {
    if (!text) return true;
    const str = sanitizeString(text);
    return str.length <= 100 && /^[a-zA-Z\s\-']+$/.test(str);
}
function isValidInteger(value, min = null) {
    if (value === undefined || value === null || value === '') return false;
    const num = parseInt(value);
    if (isNaN(num)) return false;
    if (min !== null && num < min) return false;
    return true;
}

module.exports = {
    sanitizeString,
    isValidUsername,
    isValidPassword,
    isValidRole,
    isValidNama,
    isValidJuz,
    isValidSurat,
    isValidAyat,
    isValidNilai,
    isValidBaris,
    isValidDate,
    isValidKelas,
    isValidTextOptional,
    isValidInteger
};