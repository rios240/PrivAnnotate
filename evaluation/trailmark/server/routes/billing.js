const express = require('express');
const Stripe = require('stripe');
const ledger = require('../internal/ledger');
const jobs = require('../internal/jobs');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const router = express.Router();

router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    let event;
    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            req.get('Stripe-Signature'),
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'invoice.paid') {
        const invoice = event.data.object;
        await ledger.append({
            userId: Number(invoice.metadata.userId),
            invoiceId: invoice.id,
            amount: invoice.amount_paid,
            currency: invoice.currency,
            paidAt: new Date(invoice.status_transitions.paid_at * 1000),
        });
        await jobs.enqueue('send-receipt', { invoiceId: invoice.id });
    }

    res.json({ received: true });
});

module.exports = router;
