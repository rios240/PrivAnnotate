const express = require('express');
const OpenAI = require('openai');
const db = require('../db');
const { requireAuth } = require('../lib/guards');

const router = express.Router();
const openai = new OpenAI();

router.get('/trails/:trailId/comments', async (req, res) => {
    const { rows } = await db.query(
        `SELECT c.id, c.body, c.created_at, u.display_name
         FROM comments c JOIN users u ON u.id = c.author_id
         WHERE c.trail_id = $1 AND c.status = 'visible'
         ORDER BY c.created_at DESC LIMIT 50`,
        [req.params.trailId]
    );
    res.json(rows);
});

router.post('/trails/:trailId/comments', requireAuth, async (req, res) => {
    const text = req.body.text;
    const { rows } = await db.query(
        'INSERT INTO comments (trail_id, author_id, body, status) VALUES ($1, $2, $3, $4) RETURNING id',
        [req.params.trailId, req.session.userId, text, 'visible']
    );
    const commentId = rows[0].id;

    const moderation = await openai.moderations.create({ model: 'omni-moderation-latest', input: text });
    if (moderation.results[0].flagged) {
        await db.query("UPDATE comments SET status = 'hidden', hidden_reason = 'auto' WHERE id = $1", [
            commentId,
        ]);
    }

    res.status(201).json({ id: commentId });
});

router.get('/members/:id', async (req, res) => {
    const { rows } = await db.query(
        `SELECT id, display_name, avatar_url, home_region, readiness_score, profile_visibility
         FROM users WHERE id = $1 AND closed_at IS NULL`,
        [req.params.id]
    );
    const member = rows[0];
    if (!member) {
        return res.status(404).end();
    }
    if (member.profile_visibility === 'private' && req.session.userId !== member.id) {
        return res.json({ id: member.id, display_name: member.display_name });
    }
    res.json(member);
});

module.exports = router;
