(function () {
    const GA_MEASUREMENT_ID = 'G-TRLMK0921';
    const SENTRY_DSN = 'https://4f1c9e2ab7d34c01@o451203.ingest.sentry.io/5528812';
    const user = window.TRAILMARK_USER || {};

    function initAnalytics() {
        const dnt = navigator.doNotTrack === '1' || window.doNotTrack === '1';
        if (!dnt) {
            const tag = document.createElement('script');
            tag.async = true;
            tag.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
            document.head.appendChild(tag);
            window.dataLayer = window.dataLayer || [];
            window.gtag = function () {
                window.dataLayer.push(arguments);
            };
            window.gtag('js', new Date());
            window.gtag('config', GA_MEASUREMENT_ID, { user_id: user.id });
        }
    }

    function initErrorReporting() {
        const dnt = navigator.doNotTrack === '1';
        window.Sentry.init({ dsn: SENTRY_DSN, release: window.TRAILMARK_RELEASE, tracesSampleRate: 0.2 });
        window.Sentry.setTag('dnt', dnt ? 'on' : 'off');
        if (user.id) {
            window.Sentry.setUser({ id: user.id, email: user.email });
        }
    }

    function telemetrySession() {
        let id = sessionStorage.getItem('tm_tsid');
        if (!id) {
            id = crypto.randomUUID();
            sessionStorage.setItem('tm_tsid', id);
        }
        return id;
    }

    function trackScreen(name) {
        if (navigator.doNotTrack === '1') {
            return;
        }
        navigator.sendBeacon(
            '/api/telemetry',
            JSON.stringify({ screen: name, session: telemetrySession(), user: user.id, ts: Date.now() })
        );
    }

    function formatDuration(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
    }

    window.trailmarkAnalytics = { trackScreen, formatDuration };
    initErrorReporting();
    initAnalytics();
    window.addEventListener('popstate', () => trackScreen(location.pathname));
})();
