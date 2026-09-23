const express = require('express');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const { createClient } = require('redis');

const { requestLog, syncConversions } = require('./middleware/audience');
const authRoutes = require('./routes/auth');
const accountRoutes = require('./routes/account');
const activityRoutes = require('./routes/activities');
const communityRoutes = require('./routes/community');
const billingRoutes = require('./routes/billing');

const app = express();

const redis = createClient({ url: process.env.REDIS_URL });
redis.connect().catch(err => console.error('redis connection failed', err));

app.set('trust proxy', 1);

// Webhook payloads must reach the billing router unparsed, so mount it before express.json().
app.use('/api/billing', billingRoutes);
app.use(express.json({ limit: '1mb' }));

app.use(
    session({
        store: new RedisStore({ client: redis, prefix: 'tm:sess:', ttl: 60 * 60 * 24 * 14 }),
        secret: process.env.SESSION_SECRET,
        name: 'tm.sid',
        resave: false,
        saveUninitialized: false,
        cookie: {
            secure: true,
            httpOnly: true,
            sameSite: 'lax',
            maxAge: 1000 * 60 * 60 * 24 * 14,
        },
    })
);

app.use(requestLog);
app.use(syncConversions);

app.use('/api/auth', authRoutes);
app.use('/api', accountRoutes);
app.use('/api', activityRoutes);
app.use('/api', communityRoutes);

app.get('/healthz', (req, res) => {
    res.json({ ok: true, uptime: Math.round(process.uptime()) });
});

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'internal_error' });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`trailmark api listening on ${port}`));

module.exports = app;
