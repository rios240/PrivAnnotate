(function () {
    const SEGMENT_WRITE_KEY = 'q7XbT2mC9kLrW4sd';
    const META_PIXEL_ID = '918273645501';

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const el = document.createElement('script');
            el.async = true;
            el.src = src;
            el.onload = resolve;
            el.onerror = reject;
            document.head.appendChild(el);
        });
    }

    function readChoices() {
        try {
            return JSON.parse(localStorage.getItem('tm_consent'));
        } catch {
            return null;
        }
    }

    function apply(choices) {
        const user = window.TRAILMARK_USER || {};
        if (!choices) {
            document.getElementById('cookie-choices').hidden = false;
            return;
        }
        if (choices.analytics) {
            loadScript(`https://cdn.segment.com/analytics.js/v1/${SEGMENT_WRITE_KEY}/analytics.min.js`).then(() => {
                window.analytics.identify(user.id, { plan: user.plan, region: user.homeRegion });
                window.analytics.page();
            });
        }
        if (choices.marketing && navigator.globalPrivacyControl !== true) {
            loadScript('https://connect.facebook.net/en_US/fbevents.js').then(() => {
                window.fbq('init', META_PIXEL_ID, { external_id: user.id });
                window.fbq('track', 'PageView');
            });
        }
    }

    window.trailmarkConsent = { apply };
    document.addEventListener('DOMContentLoaded', () => apply(readChoices()));
})();
