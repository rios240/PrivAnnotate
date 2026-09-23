const express = require('express');
const crypto = require('crypto');
const archiver = require('archiver');
const { Queue } = require('bullmq');
const db = require('../db');
const { requireAuth, requireRole } = require('../lib/guards');
const { toCsv } = require('../lib/csv');

const router = express.Router();
const cleanupQueue = new Queue('member-cleanup', { connection: { url: process.env.REDIS_URL } });

router.use('/me', requireAuth);

router.get('/me', async (req, res) => {
    const { rows } = await db.query(
        `SELECT id, email, display_name, birth_date, home_region, phone_obf,
                marketing_opt_in, partner_sharing, profile_visibility, created_at
         FROM users WHERE id = $1`,
        [req.session.userId]
    );
    res.json(rows[0]);
});

router.patch('/me', async (req, res) => {
    const { displayName, homeRegion, phone } = req.body;
    const phoneObf = phone ? Buffer.from(phone, 'utf8').toString('base64') : null;
    await db.query(
        `UPDATE users
         SET display_name = COALESCE($1, display_name),
             home_region = COALESCE($2, home_region),
             phone_obf = COALESCE($3, phone_obf)
         WHERE id = $4`,
        [displayName, homeRegion, phoneObf, req.session.userId]
    );
    res.status(204).end();
});

router.put('/me/privacy', async (req, res) => {
    const { marketingEmails, partnerSharing, profileVisibility } = req.body;
    await db.query(
        `UPDATE users
         SET marketing_opt_in = COALESCE($1, marketing_opt_in),
             partner_sharing = COALESCE($2, partner_sharing),
             profile_visibility = COALESCE($3, profile_visibility)
         WHERE id = $4`,
        [marketingEmails, partnerSharing, profileVisibility, req.session.userId]
    );
    res.status(204).end();
});

router.get('/me/export', async (req, res) => {
    const userId = req.session.userId;
    const [profile, activities, comments] = await Promise.all([
        db.query(
            `SELECT id, email, display_name, birth_date, home_region, created_at,
                    marketing_opt_in, partner_sharing, profile_visibility
             FROM users WHERE id = $1`,
            [userId]
        ),
        db.query(
            `SELECT id, started_at, distance_m, avg_heart_rate, ST_AsGeoJSON(route) AS route
             FROM activities WHERE user_id = $1 ORDER BY started_at`,
            [userId]
        ),
        db.query('SELECT id, trail_id, body, status, created_at FROM comments WHERE author_id = $1', [userId]),
    ]);

    res.attachment('trailmark-export.zip');
    const archive = archiver('zip');
    archive.pipe(res);
    archive.append(JSON.stringify(profile.rows[0], null, 2), { name: 'profile.json' });
    archive.append(toCsv(activities.rows), { name: 'activities.csv' });
    archive.append(JSON.stringify(comments.rows, null, 2), { name: 'comments.json' });
    await archive.finalize();
});

router.post('/me/api-tokens', async (req, res) => {
    const token = crypto.randomBytes(24).toString('hex');
    await db.query('INSERT INTO api_tokens (user_id, label, token) VALUES ($1, $2, $3)', [
        req.session.userId,
        req.body.label || 'default',
        token,
    ]);
    res.status(201).json({ token });
});

router.post('/me/close', async (req, res) => {
    const userId = req.session.userId;
    await db.query(
        `UPDATE users
         SET email = NULL, password_hash = NULL, phone_obf = NULL,
             display_name = 'Former member', closed_at = now()
         WHERE id = $1`,
        [userId]
    );
    await cleanupQueue.add(
        'erase-member-content',
        { userId },
        { delay: 30 * 24 * 60 * 60 * 1000, jobId: `erase-${userId}` }
    );
    req.session.destroy(() => res.status(202).json({ status: 'closing' }));
});

router.delete('/admin/members/:id', requireRole('support'), async (req, res) => {
    await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.status(204).end();
});

module.exports = router;
