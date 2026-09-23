-- 0007: live location pings for group hikes

CREATE TABLE location_pings (
    id          bigserial PRIMARY KEY,
    user_id     bigint NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    hike_id     bigint NOT NULL REFERENCES group_hikes (id) ON DELETE CASCADE,
    lat         double precision NOT NULL,
    lon         double precision NOT NULL,
    accuracy_m  real,
    recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX location_pings_hike_idx ON location_pings (hike_id, recorded_at DESC);

ALTER TABLE location_pings ENABLE ROW LEVEL SECURITY;

CREATE POLICY location_pings_same_hike ON location_pings
    FOR SELECT
    USING (
        hike_id IN (
            SELECT hike_id FROM group_hike_members
            WHERE user_id = current_setting('app.current_user_id')::bigint
        )
    );

CREATE POLICY location_pings_own_insert ON location_pings
    FOR INSERT
    WITH CHECK (user_id = current_setting('app.current_user_id')::bigint);

SELECT cron.schedule(
    'location-pings-expiry',
    '*/30 * * * *',
    $$DELETE FROM location_pings WHERE recorded_at < now() - interval '72 hours'$$
);
