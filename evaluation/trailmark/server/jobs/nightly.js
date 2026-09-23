const cron = require('node-cron');
const db = require('../db');
const logger = require('../lib/logger');

cron.schedule('20 3 * * *', async () => {
    const { rowCount } = await db.query("DELETE FROM login_events WHERE created_at < now() - interval '90 days'");
    logger.info({ rowCount }, 'login_events pruned');
});

cron.schedule('*/15 * * * *', async () => {
    await db.query('REFRESH MATERIALIZED VIEW CONCURRENTLY trail_leaderboard');
});

cron.schedule('0 4 * * 1', async () => {
    const { rows } = await db.query(
        `SELECT t.id, percentile_cont(0.5) WITHIN GROUP (ORDER BY a.moving_time_s) AS median_s
         FROM trails t JOIN activities a ON a.trail_id = t.id
         GROUP BY t.id`
    );
    for (const row of rows) {
        await db.query('UPDATE trails SET median_moving_time_s = $1 WHERE id = $2', [row.median_s, row.id]);
    }
    logger.info({ trails: rows.length }, 'trail medians refreshed');
});
