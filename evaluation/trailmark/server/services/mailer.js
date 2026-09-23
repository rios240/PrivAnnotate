const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const FROM_HELLO = 'Trailmark <hello@trailmark.example>';
const FROM_BILLING = 'Trailmark Billing <billing@trailmark.example>';
const DIGEST_TEMPLATE = 'd-7c1e0a4f2b9d4e1a8b3c5d6e7f809a1b';
const RECEIPT_TEMPLATE = 'd-2b8f6c1e9a3d47f0b1c2d3e4f5a6b7c8';

async function sendTrailDigest(member, trails) {
    if (!member.marketing_opt_in) {
        return;
    }
    await sgMail.send({
        to: member.email,
        from: FROM_HELLO,
        templateId: DIGEST_TEMPLATE,
        dynamicTemplateData: { name: member.display_name, region: member.home_region, trails },
    });
}

async function sendReceipt(member, invoice) {
    await sgMail.send({
        to: member.email,
        from: FROM_BILLING,
        templateId: RECEIPT_TEMPLATE,
        dynamicTemplateData: {
            name: member.display_name,
            amount: (invoice.amount_paid / 100).toFixed(2),
            currency: invoice.currency.toUpperCase(),
            periodEnd: new Date(invoice.period_end * 1000).toDateString(),
        },
    });
}

module.exports = { sendTrailDigest, sendReceipt };
