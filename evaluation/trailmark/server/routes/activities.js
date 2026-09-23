const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const { requireAuth } = require('../lib/guards');
const { parseGpx } = require('../lib/gpx');

const MAX_UPLOAD_SIZE_MB = 25;

const router = express.Router();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_SIZE_MB * 1024 * 1024 },
});

function sealNote(plaintext) {
    const key = Buffer.from(process.env.NOTES_KEY_B64, 'base64');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

async function shareRouteWithPartner(userId, activityId, track) {
    if (process.env.ROUTESHARE_ENABLED !== 'true') {
        return;
    }
    await fetch('https://ingest.routeshare.example/v2/tracks', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': process.env.ROUTESHARE_KEY },
        body: JSON.stringify({
            athleteRef: `tm-${userId}`,
            activityRef: activityId,
            startedAt: track.startedAt,
            polyline: track.lineString.coordinates,
        }),
    });
}

async function refreshReadiness(userId) {
    const { rows } = await db.query(
        `SELECT distance_m, avg_heart_rate FROM activities
         WHERE user_id = $1 AND started_at > now() - interval '28 days'`,
        [userId]
    );
    const load = rows.reduce((sum, a) => sum + (a.distance_m / 1000) * (a.avg_heart_rate / 140), 0);
    const readiness = Math.max(0, Math.min(100, Math.round(100 - load * 1.5)));
    await db.query('UPDATE users SET readiness_score = $1 WHERE id = $2', [readiness, userId]);
}

router.post('/activities', requireAuth, upload.single('gpx'), async (req, res) => {
    const track = parseGpx(req.file.buffer);
    const { rows } = await db.query(
        `INSERT INTO activities (user_id, started_at, distance_m, avg_heart_rate, route, notes_enc)
         VALUES ($1, $2, $3, $4, ST_GeomFromGeoJSON($5), $6) RETURNING id`,
        [
            req.session.userId,
            track.startedAt,
            track.distanceMeters,
            track.avgHeartRate,
            JSON.stringify(track.lineString),
            req.body.notes ? sealNote(req.body.notes) : null,
        ]
    );
    await refreshReadiness(req.session.userId);
    await shareRouteWithPartner(req.session.userId, rows[0].id, track);
    res.status(201).json({ id: rows[0].id });
});

router.delete('/activities/:id', requireAuth, async (req, res) => {
    const result = await db.query('DELETE FROM activities WHERE id = $1 AND user_id = $2', [
        req.params.id,
        req.session.userId,
    ]);
    if (result.rowCount === 0) {
        return res.status(404).end();
    }
    res.status(204).end();
});

module.exports = router;
