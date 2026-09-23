const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const db = require('../db');

const router = express.Router();

router.post(
    '/signup',
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 12, max: 128 }),
    body('displayName').trim().escape().isLength({ min: 1, max: 40 }),
    body('birthDate').optional().isISO8601().toDate(),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password, displayName, birthDate } = req.body;
        const passwordHash = await bcrypt.hash(password, 12);

        const { rows } = await db.query(
            `INSERT INTO users (email, password_hash, display_name, birth_date)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [email, passwordHash, displayName, birthDate ?? null]
        );
        const userId = rows[0].id;

        await db.query('INSERT INTO login_events (user_id, ip, user_agent, kind) VALUES ($1, $2, $3, $4)', [
            userId,
            req.ip,
            req.get('User-Agent'),
            'signup',
        ]);

        req.session.userId = userId;
        res.status(201).json({ id: userId });
    }
);

module.exports = router;
