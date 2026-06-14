'use strict';

const { formatRupiah, escapeHtml } = require('./format');

// Brand tokens (docs/DESIGN_SYSTEM.md). Orange is an ACCENT only — the primary
// button mirrors the app's dark-navy primary, never an orange background.
const NAVY = '#0B0F19';
const ORANGE = '#EA580C';
const INK = '#111827';
const MUTED = '#6B7280';
const BORDER = '#E5E7EB';
const CANVAS = '#F3F4F6';

// ---- Shared HTML shell -----------------------------------------------------

function button(cta) {
    if (!cta || !cta.url) return '';
    return `
            <tr>
              <td style="padding:8px 0 4px;">
                <a href="${escapeHtml(cta.url)}"
                   style="display:inline-block;background:${NAVY};color:#ffffff;text-decoration:none;
                          font-weight:600;font-size:14px;line-height:1;padding:13px 22px;border-radius:10px;">
                  ${escapeHtml(cta.label)}
                </a>
              </td>
            </tr>`;
}

function layout({ previewText, heading, paragraphsHtml, cta, footnote }) {
    const para = (paragraphsHtml || [])
        .map((html) => `<tr><td style="padding:0 0 14px;color:${INK};font-size:15px;line-height:1.6;">${html}</td></tr>`)
        .join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${CANVAS};">
  <span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeHtml(previewText || heading)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CANVAS};padding:24px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,Helvetica,Arial,sans-serif;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:92%;background:#ffffff;border:1px solid ${BORDER};border-top:3px solid ${ORANGE};border-radius:14px;overflow:hidden;">
          <tr>
            <td style="padding:26px 32px 0;">
              <span style="font-size:18px;font-weight:700;letter-spacing:-0.01em;color:${NAVY};">Fluxy<span style="color:${ORANGE};">OS</span></span>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px 8px;">
              <h1 style="margin:0;font-size:22px;line-height:1.25;font-weight:700;letter-spacing:-0.01em;color:${NAVY};">${escapeHtml(heading)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 26px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${para}
                ${button(cta)}
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px 26px;border-top:1px solid ${BORDER};">
              <p style="margin:0;color:${MUTED};font-size:12px;line-height:1.5;">${footnote || ''}</p>
            </td>
          </tr>
        </table>
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:92%;">
          <tr>
            <td style="padding:16px 8px;text-align:center;color:${MUTED};font-size:11px;line-height:1.5;">
              FluxyOS &middot; Financial operations, streamlined.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function toText({ heading, paragraphsText, cta, footnote }) {
    const lines = [heading, ''];
    (paragraphsText || []).forEach((p) => { lines.push(p, ''); });
    if (cta && cta.url) lines.push(`${cta.label}: ${cta.url}`, '');
    if (footnote) lines.push(footnote);
    lines.push('', '— FluxyOS');
    return lines.join('\n');
}

// ---- Copy ------------------------------------------------------------------
// Brand & product names stay English in both locales (docs/LOCALIZATION_PLAN.md).
// Each entry returns { subject, heading, paragraphs:[{html,text}], cta, footnote }.

function greet(locale, name) {
    if (locale === 'id') return name ? `Halo ${escapeHtml(name)},` : 'Halo,';
    return name ? `Hi ${escapeHtml(name)},` : 'Hi there,';
}

function notePara(locale, note) {
    if (!note) return null;
    const label = locale === 'id' ? 'Catatan peninjau' : 'Reviewer note';
    return {
        html: `<span style="display:block;border-left:3px solid ${ORANGE};background:#FFF7ED;padding:10px 14px;border-radius:6px;color:${INK};"><strong>${label}:</strong> ${escapeHtml(note)}</span>`,
        text: `${label}: ${note}`,
    };
}

const TRANSACTIONAL_FOOTNOTE = {
    en: 'You are receiving this because it relates to your FluxyOS account. Need help? Reply to this email.',
    id: 'Anda menerima email ini karena terkait akun FluxyOS Anda. Butuh bantuan? Balas email ini.',
};

const COPY = {
    welcome(locale, d) {
        const url = `${d.baseUrl}/dashboard`;
        if (locale === 'id') {
            return {
                subject: 'Selamat datang di FluxyOS',
                heading: 'Selamat datang di FluxyOS',
                paragraphs: [
                    { html: greet('id', d.name), text: d.name ? `Halo ${d.name},` : 'Halo,' },
                    { html: 'Akun Anda sudah siap. FluxyOS menyatukan buku besar, tagihan, pendapatan, dan AI dalam satu ruang kerja keuangan.', text: 'Akun Anda sudah siap. FluxyOS menyatukan buku besar, tagihan, pendapatan, dan AI dalam satu ruang kerja keuangan.' },
                    { html: 'Masuk dan hubungkan data pertama Anda untuk melihat angka bisnis Anda hidup.', text: 'Masuk dan hubungkan data pertama Anda untuk melihat angka bisnis Anda hidup.' },
                ],
                cta: { label: 'Buka dashboard', url },
                footnote: TRANSACTIONAL_FOOTNOTE.id,
            };
        }
        return {
            subject: 'Welcome to FluxyOS',
            heading: 'Welcome to FluxyOS',
            paragraphs: [
                { html: greet('en', d.name), text: d.name ? `Hi ${d.name},` : 'Hi there,' },
                { html: 'Your account is ready. FluxyOS brings your ledgers, bills, revenue, and AI into one finance workspace.', text: 'Your account is ready. FluxyOS brings your ledgers, bills, revenue, and AI into one finance workspace.' },
                { html: 'Jump in and connect your first data to see your numbers come to life.', text: 'Jump in and connect your first data to see your numbers come to life.' },
            ],
            cta: { label: 'Open your dashboard', url },
            footnote: TRANSACTIONAL_FOOTNOTE.en,
        };
    },

    kyc_approved(locale, d) {
        const url = `${d.baseUrl}/dashboard`;
        if (locale === 'id') {
            return {
                subject: 'Akun FluxyOS Anda terverifikasi',
                heading: 'Verifikasi disetujui',
                paragraphs: [
                    { html: greet('id', d.name), text: d.name ? `Halo ${d.name},` : 'Halo,' },
                    { html: 'Kabar baik — verifikasi identitas Anda telah disetujui. Ruang kerja FluxyOS Anda kini terbuka penuh.', text: 'Kabar baik — verifikasi identitas Anda telah disetujui. Ruang kerja FluxyOS Anda kini terbuka penuh.' },
                ],
                cta: { label: 'Buka dashboard', url },
                footnote: TRANSACTIONAL_FOOTNOTE.id,
            };
        }
        return {
            subject: 'Your FluxyOS account is verified',
            heading: "You're verified",
            paragraphs: [
                { html: greet('en', d.name), text: d.name ? `Hi ${d.name},` : 'Hi there,' },
                { html: 'Good news — your identity verification has been approved. Your FluxyOS workspace is fully unlocked.', text: 'Good news — your identity verification has been approved. Your FluxyOS workspace is fully unlocked.' },
            ],
            cta: { label: 'Open your dashboard', url },
            footnote: TRANSACTIONAL_FOOTNOTE.en,
        };
    },

    kyc_needs_revision(locale, d) {
        const url = `${d.baseUrl}/onboarding`;
        const note = notePara(locale, d.reviewerNote);
        if (locale === 'id') {
            return {
                subject: 'Tindakan diperlukan: perbarui verifikasi Anda',
                heading: 'Perlu sedikit perbaikan',
                paragraphs: [
                    { html: greet('id', d.name), text: d.name ? `Halo ${d.name},` : 'Halo,' },
                    { html: 'Verifikasi Anda butuh sedikit pembaruan sebelum dapat kami setujui.', text: 'Verifikasi Anda butuh sedikit pembaruan sebelum dapat kami setujui.' },
                    ...(note ? [note] : []),
                    { html: 'Mohon periksa dan kirim ulang detail Anda.', text: 'Mohon periksa dan kirim ulang detail Anda.' },
                ],
                cta: { label: 'Perbarui verifikasi', url },
                footnote: TRANSACTIONAL_FOOTNOTE.id,
            };
        }
        return {
            subject: 'Action needed: update your verification',
            heading: 'We need a small fix',
            paragraphs: [
                { html: greet('en', d.name), text: d.name ? `Hi ${d.name},` : 'Hi there,' },
                { html: 'Your verification needs a quick update before we can approve it.', text: 'Your verification needs a quick update before we can approve it.' },
                ...(note ? [note] : []),
                { html: 'Please review and resubmit your details.', text: 'Please review and resubmit your details.' },
            ],
            cta: { label: 'Update verification', url },
            footnote: TRANSACTIONAL_FOOTNOTE.en,
        };
    },

    kyc_rejected(locale, d) {
        const url = `${d.baseUrl}/dashboard`;
        const note = notePara(locale, d.reviewerNote);
        if (locale === 'id') {
            return {
                subject: 'Verifikasi Anda belum dapat disetujui',
                heading: 'Verifikasi belum disetujui',
                paragraphs: [
                    { html: greet('id', d.name), text: d.name ? `Halo ${d.name},` : 'Halo,' },
                    { html: 'Maaf, kami belum dapat menyetujui verifikasi identitas Anda.', text: 'Maaf, kami belum dapat menyetujui verifikasi identitas Anda.' },
                    ...(note ? [note] : []),
                    { html: 'Jika Anda merasa ini keliru, balas email ini dan tim kami akan membantu.', text: 'Jika Anda merasa ini keliru, balas email ini dan tim kami akan membantu.' },
                ],
                cta: { label: 'Buka FluxyOS', url },
                footnote: TRANSACTIONAL_FOOTNOTE.id,
            };
        }
        return {
            subject: 'Your verification could not be approved',
            heading: 'Verification not approved',
            paragraphs: [
                { html: greet('en', d.name), text: d.name ? `Hi ${d.name},` : 'Hi there,' },
                { html: "Unfortunately we couldn't approve your identity verification.", text: "Unfortunately we couldn't approve your identity verification." },
                ...(note ? [note] : []),
                { html: 'If you think this is a mistake, just reply to this email and our team will help.', text: 'If you think this is a mistake, just reply to this email and our team will help.' },
            ],
            cta: { label: 'Open FluxyOS', url },
            footnote: TRANSACTIONAL_FOOTNOTE.en,
        };
    },

    payment_verified(locale, d) {
        const url = `${d.baseUrl}/dashboard`;
        const plan = d.planName ? String(d.planName) : null;
        const amount = (d.amount != null && Number.isFinite(Number(d.amount))) ? formatRupiah(d.amount) : null;
        // Grammatical phrase for every plan/amount combination (or neither).
        const phrase = (planText) => {
            if (locale === 'id') {
                if (planText && amount) return `untuk paket ${planText} (${amount})`;
                if (planText) return `untuk paket ${planText}`;
                if (amount) return `sebesar ${amount}`;
                return '';
            }
            if (planText && amount) return `for the ${planText} plan (${amount})`;
            if (planText) return `for the ${planText} plan`;
            if (amount) return `of ${amount}`;
            return '';
        };
        const phraseHtml = phrase(plan ? escapeHtml(plan) : null);
        const phraseText = phrase(plan);
        if (locale === 'id') {
            return {
                subject: 'Pembayaran diterima — paket Anda aktif',
                heading: 'Pembayaran dikonfirmasi',
                paragraphs: [
                    { html: greet('id', d.name), text: d.name ? `Halo ${d.name},` : 'Halo,' },
                    { html: `Kami telah memverifikasi pembayaran Anda${phraseHtml ? ' ' + phraseHtml : ''}. Langganan Anda kini aktif.`, text: `Kami telah memverifikasi pembayaran Anda${phraseText ? ' ' + phraseText : ''}. Langganan Anda kini aktif.` },
                    { html: 'Terima kasih telah memilih FluxyOS.', text: 'Terima kasih telah memilih FluxyOS.' },
                ],
                cta: { label: 'Ke dashboard', url },
                footnote: TRANSACTIONAL_FOOTNOTE.id,
            };
        }
        return {
            subject: 'Payment received — your plan is active',
            heading: 'Payment confirmed',
            paragraphs: [
                { html: greet('en', d.name), text: d.name ? `Hi ${d.name},` : 'Hi there,' },
                { html: `We've verified your payment${phraseHtml ? ' ' + phraseHtml : ''}. Your subscription is now active.`, text: `We've verified your payment${phraseText ? ' ' + phraseText : ''}. Your subscription is now active.` },
                { html: 'Thanks for choosing FluxyOS.', text: 'Thanks for choosing FluxyOS.' },
            ],
            cta: { label: 'Go to dashboard', url },
            footnote: TRANSACTIONAL_FOOTNOTE.en,
        };
    },

    payment_rejected(locale, d) {
        const url = `${d.baseUrl}/payment-pending`;
        const note = notePara(locale, d.reviewerNote);
        if (locale === 'id') {
            return {
                subject: 'Kami belum dapat memverifikasi pembayaran Anda',
                heading: 'Pembayaran perlu ditinjau ulang',
                paragraphs: [
                    { html: greet('id', d.name), text: d.name ? `Halo ${d.name},` : 'Halo,' },
                    { html: 'Kami belum dapat memverifikasi pembayaran terakhir Anda.', text: 'Kami belum dapat memverifikasi pembayaran terakhir Anda.' },
                    ...(note ? [note] : []),
                    { html: 'Anda dapat memeriksa detail dan mencoba lagi.', text: 'Anda dapat memeriksa detail dan mencoba lagi.' },
                ],
                cta: { label: 'Tinjau pembayaran', url },
                footnote: TRANSACTIONAL_FOOTNOTE.id,
            };
        }
        return {
            subject: "We couldn't verify your payment",
            heading: 'Payment needs another look',
            paragraphs: [
                { html: greet('en', d.name), text: d.name ? `Hi ${d.name},` : 'Hi there,' },
                { html: "We weren't able to verify your recent payment.", text: "We weren't able to verify your recent payment." },
                ...(note ? [note] : []),
                { html: 'You can review the details and try again.', text: 'You can review the details and try again.' },
            ],
            cta: { label: 'Review payment', url },
            footnote: TRANSACTIONAL_FOOTNOTE.en,
        };
    },

    trial_ending(locale, d) {
        const url = `${d.baseUrl}/pricing`;
        const when = d.trialEndsLabel ? escapeHtml(d.trialEndsLabel) : null;
        if (locale === 'id') {
            return {
                subject: when ? `Masa uji coba FluxyOS Anda berakhir ${d.trialEndsLabel}` : 'Masa uji coba FluxyOS Anda segera berakhir',
                heading: 'Masa uji coba segera berakhir',
                paragraphs: [
                    { html: greet('id', d.name), text: d.name ? `Halo ${d.name},` : 'Halo,' },
                    { html: `Masa uji coba gratis Anda berakhir${when ? ` pada ${when}` : ' sebentar lagi'}. Pilih paket agar dashboard, AI, dan ekspor Anda tetap berjalan tanpa terganggu.`, text: `Masa uji coba gratis Anda berakhir${d.trialEndsLabel ? ` pada ${d.trialEndsLabel}` : ' sebentar lagi'}. Pilih paket agar dashboard, AI, dan ekspor Anda tetap berjalan tanpa terganggu.` },
                ],
                cta: { label: 'Pilih paket', url },
                footnote: TRANSACTIONAL_FOOTNOTE.id,
            };
        }
        return {
            subject: when ? `Your FluxyOS trial ends ${d.trialEndsLabel}` : 'Your FluxyOS trial is ending soon',
            heading: 'Your trial is ending soon',
            paragraphs: [
                { html: greet('en', d.name), text: d.name ? `Hi ${d.name},` : 'Hi there,' },
                { html: `Your free trial ends${when ? ` on ${when}` : ' soon'}. Pick a plan to keep your dashboards, AI, and exports running without interruption.`, text: `Your free trial ends${d.trialEndsLabel ? ` on ${d.trialEndsLabel}` : ' soon'}. Pick a plan to keep your dashboards, AI, and exports running without interruption.` },
            ],
            cta: { label: 'Choose a plan', url },
            footnote: TRANSACTIONAL_FOOTNOTE.en,
        };
    },
};

// Build a renderable email. locale is "en" | "id"; falls back to "en".
function buildEmail(templateKey, locale, data) {
    const fn = COPY[templateKey];
    if (!fn) throw new Error(`Unknown email template: ${templateKey}`);
    const loc = locale === 'id' ? 'id' : 'en';
    const c = fn(loc, data || {});
    const paragraphsHtml = c.paragraphs.map((p) => p.html);
    const paragraphsText = c.paragraphs.map((p) => p.text);
    const html = layout({ previewText: c.subject, heading: c.heading, paragraphsHtml, cta: c.cta, footnote: c.footnote });
    const text = toText({ heading: c.heading, paragraphsText, cta: c.cta, footnote: c.footnote });
    return { subject: c.subject, html, text };
}

module.exports = { buildEmail };
