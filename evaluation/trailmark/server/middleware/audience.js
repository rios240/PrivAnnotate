const { ServerEvent, UserData, EventRequest } = require('facebook-nodejs-business-sdk');
const logger = require('../lib/logger');

const PIXEL_ID = process.env.META_PIXEL_ID;
const CONVERSION_EVENTS = {
    '/api/auth/signup': 'CompleteRegistration',
    '/api/activities': 'ActivityLogged',
};

function requestLog(req, res, next) {
    const started = Date.now();
    const dnt = req.get('DNT');
    res.on('finish', () => {
        logger.info(
            { method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started, dnt },
            'request'
        );
    });
    next();
}

function syncConversions(req, res, next) {
    const eventName = CONVERSION_EVENTS[req.path];
    const gpcOptOut = req.get('Sec-GPC') === '1';
    if (eventName && req.method === 'POST' && req.session?.userId && !gpcOptOut) {
        const userData = new UserData()
            .setExternalId(String(req.session.userId))
            .setClientIpAddress(req.ip)
            .setClientUserAgent(req.get('User-Agent'));
        const event = new ServerEvent()
            .setEventName(eventName)
            .setEventTime(Math.floor(Date.now() / 1000))
            .setUserData(userData)
            .setActionSource('website');
        new EventRequest(process.env.META_CAPI_TOKEN, PIXEL_ID)
            .setEvents([event])
            .execute()
            .catch(err => logger.warn({ err }, 'conversion sync failed'));
    }
    next();
}

module.exports = { requestLog, syncConversions };
