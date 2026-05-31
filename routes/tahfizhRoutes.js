const express = require('express');
const db = require('../config/db');
const { verifyToken, isAdmin } = require('../middleware/auth');
const ExcelJS = require('exceljs');
const silhouette = require('silhouette-coefficient');
const { logActivity } = require('../utils/logger');

const router = express.Router();

// ===================== MANHATTAN DISTANCE K-MEANS =====================
function manhattanDistance(a, b) {
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

function kMeansManhattan(data, k, maxIterations = 100) {
    // Inisialisasi centroid secara acak dari data points
    const centroids = [];
    const indices = [...Array(data.length).keys()];
    for (let i = 0; i < k; i++) {
        const rand = Math.floor(Math.random() * indices.length);
        centroids.push([...data[indices[rand]]]);
        indices.splice(rand, 1);
    }

    let assignments = new Array(data.length).fill(0);
    let iterations = 0;
    let changed = true;

    while (changed && iterations < maxIterations) {
        changed = false;
        // Assign setiap point ke centroid terdekat (Manhattan Distance)
        for (let i = 0; i < data.length; i++) {
            let minDist = Infinity;
            let bestCluster = 0;
            for (let j = 0; j < k; j++) {
                const dist = manhattanDistance(data[i], centroids[j]);
                if (dist < minDist) {
                    minDist = dist;
                    bestCluster = j;
                }
            }
            if (assignments[i] !== bestCluster) {
                assignments[i] = bestCluster;
                changed = true;
            }
        }

        // Update centroid dengan mean
        const newCentroids = Array(k).fill().map(() => [0, 0]);
        const counts = Array(k).fill(0);
        for (let i = 0; i < data.length; i++) {
            const cluster = assignments[i];
            newCentroids[cluster][0] += data[i][0];
            newCentroids[cluster][1] += data[i][1];
            counts[cluster]++;
        }
        for (let j = 0; j < k; j++) {
            if (counts[j] > 0) {
                newCentroids[j][0] /= counts[j];
                newCentroids[j][1] /= counts[j];
            } else {
                // Jika cluster kosong, pilih data random baru sebagai centroid
                const rand = Math.floor(Math.random() * data.length);
                newCentroids[j] = [...data[rand]];
            }
        }
        // Periksa apakah centroid berubah
        for (let j = 0; j < k; j++) {
            if (Math.abs(newCentroids[j][0] - centroids[j][0]) > 0.001 ||
                Math.abs(newCentroids[j][1] - centroids[j][1]) > 0.001) {
                centroids[j] = newCentroids[j];
            }
        }
        iterations++;
    }
    return { assignments, centroids, iterations };
}
// =============================================================

// Halaman clustering (form)
router.get('/clustering', verifyToken, isAdmin, (req, res) => {
    res.render('tahfizh/clustering', { user: req.user, result: null, error: null, kValue: 3 });
});

// Proses clustering
router.post('/clustering', verifyToken, isAdmin, async (req, res) => {
    const k = parseInt(req.body.k) || 3;
    try {
        const [santriRaw] = await db.query(`
            SELECT id, nama, kelas, juz,
                   (tajwid + kelancaran + makhraj) / 3 as rata_rata_nilai
            FROM santri
            WHERE tajwid IS NOT NULL AND kelancaran IS NOT NULL AND makhraj IS NOT NULL
        `);
        if (santriRaw.length < k) {
            return res.render('tahfizh/clustering', {
                user: req.user,
                result: null,
                error: `Jumlah santri (${santriRaw.length}) kurang dari jumlah kluster (${k})`,
                kValue: k
            });
        }

        const santri = santriRaw.map(s => ({
            ...s,
            juz: parseFloat(s.juz),
            rata_rata_nilai: parseFloat(s.rata_rata_nilai)
        }));

        const vectors = santri.map(s => [s.juz, s.rata_rata_nilai]);
        const { assignments, centroids, iterations } = kMeansManhattan(vectors, k);
        
        // Hitung Silhouette Coefficient (gunakan fungsi dari library dengan custom distance)
        const silhouetteScore = silhouette(vectors, assignments, manhattanDistance);
        
        const clusteringResult = santri.map((s, idx) => ({
            ...s,
            cluster: assignments[idx],
            centroid: centroids[assignments[idx]]
        }));

        const clusters = Array(k).fill().map(() => []);
        clusteringResult.forEach(s => clusters[s.cluster].push(s));

        await logActivity(req.user.id, req.user.username, 'CLUSTERING', `K=${k}, Silhouette=${silhouetteScore.toFixed(4)}`, req);

        res.render('tahfizh/clustering', {
            user: req.user,
            result: { clusters, silhouetteScore, k, iterations },
            error: null,
            kValue: k
        });
    } catch (err) {
        console.error(err);
        res.render('tahfizh/clustering', {
            user: req.user,
            result: null,
            error: 'Terjadi kesalahan saat memproses clustering: ' + err.message,
            kValue: k
        });
    }
});

// Download hasil clustering ke Excel
router.post('/download-clustering', verifyToken, isAdmin, async (req, res) => {
    const k = parseInt(req.body.k) || 3;
    try {
        const [santriRaw] = await db.query(`
            SELECT id, nama, kelas, juz,
                   (tajwid + kelancaran + makhraj) / 3 as rata_rata_nilai
            FROM santri
            WHERE tajwid IS NOT NULL AND kelancaran IS NOT NULL AND makhraj IS NOT NULL
        `);
        if (santriRaw.length < k) {
            req.session.error = 'Data santri kurang untuk clustering';
            return res.redirect('/tahfizh/clustering');
        }
        const santri = santriRaw.map(s => ({
            ...s,
            juz: parseFloat(s.juz),
            rata_rata_nilai: parseFloat(s.rata_rata_nilai)
        }));
        const vectors = santri.map(s => [s.juz, s.rata_rata_nilai]);
        const { assignments } = kMeansManhattan(vectors, k);
        
        const getLabel = (nilai) => {
            if (nilai > 80) return 'Mumtaz';
            if (nilai >= 60) return 'Regular';
            return 'Bimbingan';
        };
        
        const excelData = santri.map((s, idx) => ({
            Nama: s.nama,
            Kelas: s.kelas || '-',
            Juz: s.juz,
            'Rata-rata Nilai': s.rata_rata_nilai.toFixed(2),
            'Label Halaqoh': getLabel(s.rata_rata_nilai),
            Cluster: `Halaqoh ${assignments[idx] + 1}`
        }));
        
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Hasil Clustering');
        worksheet.columns = [
            { header: 'Nama', key: 'Nama', width: 25 },
            { header: 'Kelas', key: 'Kelas', width: 10 },
            { header: 'Juz', key: 'Juz', width: 10 },
            { header: 'Rata-rata Nilai', key: 'Rata-rata Nilai', width: 15 },
            { header: 'Label Halaqoh', key: 'Label Halaqoh', width: 15 },
            { header: 'Cluster', key: 'Cluster', width: 15 }
        ];
        excelData.forEach(row => worksheet.addRow(row));
        worksheet.getRow(1).font = { bold: true };
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="hasil_clustering.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
        await logActivity(req.user.id, req.user.username, 'DOWNLOAD_CLUSTERING', `K=${k}`, req);
    } catch (err) {
        console.error(err);
        req.session.error = 'Gagal generate file Excel';
        res.redirect('/tahfizh/clustering');
    }
});

module.exports = router;