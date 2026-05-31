// utils/email.js
const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

async function sendNotification(subject, text) {
    try {
        await transporter.sendMail({
            from: `"Sistem Tahfizh" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_TO,
            subject: subject,
            text: text
        });
        console.log('Email notifikasi terkirim');
    } catch (err) {
        console.error('Gagal kirim email:', err.message);
    }
}

module.exports = { sendNotification };