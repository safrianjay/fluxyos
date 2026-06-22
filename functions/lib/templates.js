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
    // Full-width, bulletproof (Outlook-safe) button — matches the content width.
    return `
            <tr>
              <td style="padding:12px 0 6px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;">
                  <tr>
                    <td align="center" bgcolor="${NAVY}" style="background:${NAVY};border-radius:10px;">
                      <a href="${escapeHtml(cta.url)}"
                         style="display:block;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;
                                line-height:1;padding:15px 20px;letter-spacing:-0.005em;">
                        ${escapeHtml(cta.label)}
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
}

function layout({ previewText, heading, paragraphsHtml, cta, footnote, logoUrl }) {
    const para = (paragraphsHtml || [])
        .map((html) => `<tr><td class="fx-body" style="padding:0 0 16px;color:${INK};font-size:16px;line-height:1.6;">${html}</td></tr>`)
        .join('');
    const logo = logoUrl
        ? `<img src="${escapeHtml(logoUrl)}" width="32" height="32" alt="" style="display:block;border:0;outline:none;text-decoration:none;">`
        : '';
    const hairline = `<tr><td style="padding:0 36px;"><div style="height:1px;background:#EEF0F3;line-height:1px;font-size:0;">&nbsp;</div></td></tr>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light only">
  <title>${escapeHtml(heading)}</title>
  <style>
    @media only screen and (max-width:480px){
      .fx-body{font-size:17px !important;line-height:1.6 !important;}
      .fx-h1{font-size:25px !important;}
      .fx-pad{padding-left:20px !important;padding-right:20px !important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${CANVAS};-webkit-font-smoothing:antialiased;">
  <span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${escapeHtml(previewText || heading)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${CANVAS}" style="background:${CANVAS};padding:28px 0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:92%;background:#ffffff;border:1px solid ${BORDER};border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(16,24,40,0.04);">
          <tr>
            <td class="fx-pad" style="padding:28px 36px 18px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:10px;vertical-align:middle;">${logo}</td>
                  <td style="vertical-align:middle;font-size:19px;font-weight:700;letter-spacing:-0.01em;color:${NAVY};">Fluxy<span style="color:${ORANGE};">OS</span></td>
                </tr>
              </table>
            </td>
          </tr>
          ${hairline}
          <tr>
            <td class="fx-pad" style="padding:24px 36px 6px;">
              <h1 class="fx-h1" style="margin:0;font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.015em;color:${NAVY};">${escapeHtml(heading)}</h1>
            </td>
          </tr>
          <tr>
            <td class="fx-pad" style="padding:8px 36px 30px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;">
                ${para}
                ${button(cta)}
              </table>
            </td>
          </tr>
          ${hairline}
          <tr>
            <td class="fx-pad" style="padding:20px 36px 26px;">
              <p style="margin:0;color:${MUTED};font-size:13px;line-height:1.55;">${footnote || ''}</p>
            </td>
          </tr>
        </table>
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:92%;">
          <tr>
            <td style="padding:18px 12px 4px;text-align:center;color:#9AA1AC;font-size:11px;line-height:1.6;">
              <strong style="color:${MUTED};font-weight:600;">FluxyOS</strong> — Financial operations, streamlined.<br>
              Jakarta, Indonesia &middot; <a href="https://fluxyos.com" style="color:#9AA1AC;text-decoration:underline;">fluxyos.com</a>
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

// Gender → greeting honorific. Female → Ibu / Mrs; anything else defaults to
// the male form Bapak / Mr (the lead form only offers male|female).
function honorific(gender) {
    return String(gender || '').toLowerCase() === 'female'
        ? { id: 'Ibu', en: 'Mrs' }
        : { id: 'Bapak', en: 'Mr' };
}

function notePara(locale, note) {
    if (!note) return null;
    const label = locale === 'id' ? 'Catatan peninjau' : 'Reviewer note';
    return {
        html: `<span style="display:block;background:#F9FAFB;border:1px solid #EEF0F3;padding:12px 14px;border-radius:8px;color:${INK};"><strong>${label}:</strong> ${escapeHtml(note)}</span>`,
        text: `${label}: ${note}`,
    };
}

// Neutral "finish your KYC + onboarding" callout for the welcome email.
function setupBox(locale) {
    const t = locale === 'id'
        ? { title: 'Selesaikan pengaturan akun Anda', body: 'Lengkapi verifikasi bisnis (KYC) dan proses onboarding untuk membuka seluruh fitur workspace Anda.' }
        : { title: 'Finish setting up your account', body: 'Complete your business verification (KYC) and onboarding to unlock your full workspace.' };
    return {
        html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#F9FAFB;border:1px solid #EEF0F3;border-radius:12px;"><tr><td style="padding:16px 18px;"><div style="font-size:15px;font-weight:600;color:${NAVY};margin:0 0 4px;">${t.title}</div><div style="font-size:15px;color:#374151;line-height:1.55;">${t.body}</div></td></tr></table>`,
        text: `${t.title} — ${t.body}`,
    };
}

// Voucher-ticket promo (config-driven, see WELCOME_OFFER_*). Gradient navy ticket
// with punch-hole notches on the dashed perforation and a validity strip.
function offerBox(locale, offer, baseUrl) {
    const pct = Number(offer.percent) || 0;
    const code = escapeHtml(offer.code);
    const validDays = Number(offer.validDays) || 14;
    const terms = offer.terms ? escapeHtml(offer.terms) : (locale === 'id' ? 'paket tahunan' : 'annual plans');
    const t = locale === 'id'
        ? { eyebrow: 'Penawaran terbatas', off: 'DISKON', useCode: 'Pakai kode', cta: 'Klaim diskon Anda', valid: `Berlaku ${validDays} hari setelah daftar` }
        : { eyebrow: 'Limited offer', off: 'OFF', useCode: 'Use code', cta: 'Claim your discount', valid: `Valid for ${validDays} days after signup` };
    const big = `<span style="font-size:32px;font-weight:800;letter-spacing:-0.02em;color:${ORANGE};">${pct}%</span>`;
    const discount = locale === 'id'
        ? `<span style="font-size:15px;font-weight:700;color:#ffffff;">${t.off}</span> ${big}`
        : `${big} <span style="font-size:16px;font-weight:700;color:#ffffff;">${t.off}</span>`;
    const html =
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${NAVY}" style="width:100%;background:${NAVY};background-image:linear-gradient(135deg,#0B0F19 0%,#1A2138 100%);border-radius:14px;"><tr>`
        + `<td style="padding:18px 6px 12px 20px;width:46%;vertical-align:middle;">`
            + `<div style="font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${ORANGE};margin:0 0 5px;">🎟️ ${escapeHtml(t.eyebrow)}</div>`
            + `<div style="line-height:1;">${discount}</div>`
            + `<div style="font-size:10px;color:#C7CBD3;margin-top:5px;">${terms}</div>`
        + `</td>`
        + `<td style="width:1px;padding:0;"><div style="border-left:2px dashed rgba(255,255,255,0.35);height:84px;font-size:0;line-height:0;">&nbsp;</div></td>`
        + `<td style="padding:18px 20px 12px 8px;width:54%;vertical-align:middle;text-align:center;">`
            + `<div style="font-size:11px;color:#C7CBD3;margin:0 0 6px;">${t.useCode}</div>`
            + `<span style="display:inline-block;background:#ffffff;border-radius:8px;padding:8px 14px;font-size:14px;font-weight:800;letter-spacing:0.06em;color:${NAVY};">${code}</span>`
            + `<div style="margin-top:10px;"><a href="${escapeHtml(baseUrl)}/pricing" style="font-size:10px;font-weight:700;color:${ORANGE};text-decoration:none;">${t.cta} &rarr;</a></div>`
        + `</td></tr>`
        + `<tr><td colspan="3" style="padding:0 20px 14px;"><div style="border-top:1px dashed rgba(255,255,255,0.18);padding-top:10px;text-align:center;font-size:11px;color:#9AA1AC;">⏳ ${escapeHtml(t.valid)}</div></td></tr>`
        + `</table>`;
    return { html, text: `${t.eyebrow}: ${pct}% off ${terms} — code ${offer.code} (${t.valid}) — ${baseUrl}/pricing` };
}

// "Ask Fluxy AI" prompt card (welcome email).
function askAiCard(locale) {
    const t = locale === 'id'
        ? { title: 'Tanya Fluxy AI', qs: ['Berapa pengeluaran software saya bulan ini?', 'Tagihan mana yang sudah jatuh tempo?', 'Bisakah saya menutupi pengeluaran bulan depan?'] }
        : { title: 'Ask Fluxy AI', qs: ['How much did I spend on software this month?', 'Which bills are overdue?', "Can I cover next month's expenses?"] };
    const lines = t.qs.map((q) => `<div style="font-size:15px;color:#374151;line-height:1.5;margin:0 0 8px;">&ldquo;${escapeHtml(q)}&rdquo;</div>`).join('');
    return {
        html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#F9FAFB;border:1px solid #EEF0F3;border-radius:12px;"><tr><td style="padding:16px 18px;"><div style="font-size:16px;font-weight:700;color:${NAVY};margin:0 0 10px;">🤖 ${escapeHtml(t.title)}</div>${lines}</td></tr></table>`,
        text: `${t.title}: ${t.qs.map((q) => `"${q}"`).join(' ')}`,
    };
}

const TRANSACTIONAL_FOOTNOTE = {
    en: 'You are receiving this because it relates to your FluxyOS account. Need help? Reply to this email.',
    id: 'Anda menerima email ini karena terkait akun FluxyOS Anda. Butuh bantuan? Balas email ini.',
};

const COPY = {
    welcome(locale, d) {
        // Show the "finish setup" block until both KYC and onboarding are done.
        const setupComplete = d.kycComplete === true && d.onboardingComplete === true;
        const cta = setupComplete
            ? { label: locale === 'id' ? 'Buka dashboard' : 'Open your dashboard', url: `${d.baseUrl}/dashboard` }
            : { label: locale === 'id' ? 'Selesaikan verifikasi & pengaturan' : 'Complete verification & setup', url: `${d.baseUrl}/onboarding` };

        const line = (s) => ({ html: s, text: s });
        const paragraphs = [];
        if (locale === 'id') {
            paragraphs.push({ html: greet('id', d.name), text: d.name ? `Halo ${d.name},` : 'Halo,' });
            paragraphs.push({ html: 'Ruang kerja keuangan Anda <strong>hampir siap</strong>.', text: 'Ruang kerja keuangan Anda hampir siap.' });
            paragraphs.push({ html: 'Sebagian besar bisnis bukan kesulitan karena <strong>kekurangan data</strong>. Mereka kesulitan karena informasi keuangannya <strong>tersebar di spreadsheet, invoice, rekening koran, dan berbagai alat yang tidak terhubung</strong>.', text: 'Sebagian besar bisnis bukan kesulitan karena kekurangan data. Mereka kesulitan karena informasi keuangannya tersebar di spreadsheet, invoice, rekening koran, dan berbagai alat yang tidak terhubung.' });
            paragraphs.push({ html: 'FluxyOS <strong>menyatukan semuanya di satu tempat</strong>, sehingga Anda bisa melihat <strong>dari mana uang masuk</strong>, <strong>ke mana perginya</strong>, dan <strong>apa yang perlu diperhatikan</strong>.', text: 'FluxyOS menyatukan semuanya di satu tempat, sehingga Anda bisa melihat dari mana uang masuk, ke mana perginya, dan apa yang perlu diperhatikan.' });
            if (!setupComplete) paragraphs.push(setupBox('id'));
            paragraphs.push(askAiCard('id'));
            if (d.offer && d.offer.code) paragraphs.push(offerBox('id', d.offer, d.baseUrl));
            return { subject: 'Selamat datang di FluxyOS', heading: 'Selamat datang di FluxyOS 👋', paragraphs, cta, footnote: TRANSACTIONAL_FOOTNOTE.id };
        }
        paragraphs.push({ html: greet('en', d.name), text: d.name ? `Hi ${d.name},` : 'Hi there,' });
        paragraphs.push({ html: 'Your finance workspace is <strong>almost ready</strong>.', text: 'Your finance workspace is almost ready.' });
        paragraphs.push({ html: "Most businesses don't struggle because they <strong>lack data</strong>. They struggle because their financial information is <strong>scattered across spreadsheets, invoices, bank statements, and disconnected tools</strong>.", text: "Most businesses don't struggle because they lack data. They struggle because their financial information is scattered across spreadsheets, invoices, bank statements, and disconnected tools." });
        paragraphs.push({ html: "FluxyOS <strong>brings everything together in one place</strong>, so you can see <strong>where money is coming from</strong>, <strong>where it's going</strong>, and <strong>what needs attention</strong>.", text: "FluxyOS brings everything together in one place, so you can see where money is coming from, where it's going, and what needs attention." });
        if (!setupComplete) paragraphs.push(setupBox('en'));
        paragraphs.push(askAiCard('en'));
        if (d.offer && d.offer.code) paragraphs.push(offerBox('en', d.offer, d.baseUrl));
        return { subject: 'Welcome to FluxyOS', heading: 'Welcome to FluxyOS 👋', paragraphs, cta, footnote: TRANSACTIONAL_FOOTNOTE.en };
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
                    ...(d.offer && d.offer.code ? [
                        { html: 'Tapi tenang — kami siapkan sesuatu yang spesial agar Anda bisa lanjut tanpa beban:', text: 'Tapi tenang — kami siapkan sesuatu yang spesial agar Anda bisa lanjut tanpa beban:' },
                        offerBox('id', d.offer, d.baseUrl),
                    ] : []),
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
                ...(d.offer && d.offer.code ? [
                    { html: "But don't worry — we've got something special to keep you going:", text: "But don't worry — we've got something special to keep you going:" },
                    offerBox('en', d.offer, d.baseUrl),
                ] : []),
            ],
            cta: { label: 'Choose a plan', url },
            footnote: TRANSACTIONAL_FOOTNOTE.en,
        };
    },

    // Manual "we've extended your trial" notice — sent by hand when support
    // grants a special trial extension. `trialEndsLabel` is the new, already
    // formatted end date; `dashboardUrl` defaults to /dashboard.
    trial_extended(locale, d) {
        const url = d.dashboardUrl || `${d.baseUrl}/dashboard`;
        const when = d.trialEndsLabel ? escapeHtml(d.trialEndsLabel) : null;
        if (locale === 'id') {
            return {
                subject: 'Masa uji coba FluxyOS Anda telah diperpanjang',
                heading: 'Masa uji coba Anda diperpanjang',
                paragraphs: [
                    { html: greet('id', d.name), text: d.name ? `Halo ${d.name},` : 'Halo,' },
                    { html: 'Terima kasih atas waktu Anda hari ini.', text: 'Terima kasih atas waktu Anda hari ini.' },
                    { html: `Kami telah memperpanjang masa uji coba FluxyOS Anda selama satu bulan mulai hari ini${when ? `, sehingga berakhir pada <strong>${when}</strong>` : ''}. Anda dapat terus mengeksplorasi platform dan mengundang tim untuk berkolaborasi di ruang kerja Anda.`, text: `Kami telah memperpanjang masa uji coba FluxyOS Anda selama satu bulan mulai hari ini${when ? `, sehingga berakhir pada ${when}` : ''}. Anda dapat terus mengeksplorasi platform dan mengundang tim untuk berkolaborasi di ruang kerja Anda.` },
                    { html: 'Jika ada pertanyaan atau butuh bantuan, silakan balas email ini.', text: 'Jika ada pertanyaan atau butuh bantuan, silakan balas email ini.' },
                ],
                cta: { label: 'Buka dashboard', url },
                footnote: TRANSACTIONAL_FOOTNOTE.id,
            };
        }
        return {
            subject: 'Your FluxyOS trial has been extended',
            heading: 'Your trial has been extended',
            paragraphs: [
                { html: greet('en', d.name), text: d.name ? `Hi ${d.name},` : 'Hi there,' },
                { html: 'Thank you for your time today.', text: 'Thank you for your time today.' },
                { html: `We've extended your FluxyOS trial by one month starting today${when ? `, so it now runs through <strong>${when}</strong>` : ''}. You can keep exploring the platform and invite your team to collaborate in your workspace.`, text: `We've extended your FluxyOS trial by one month starting today${when ? `, so it now runs through ${when}` : ''}. You can keep exploring the platform and invite your team to collaborate in your workspace.` },
                { html: 'If you have any questions or need a hand, just reply to this email.', text: 'If you have any questions or need a hand, just reply to this email.' },
            ],
            cta: { label: 'Open your dashboard', url },
            footnote: TRANSACTIONAL_FOOTNOTE.en,
        };
    },

    // Billing / repayment reminder. `phase`: 'upcoming' (7d before), 'due_soon'
    // (1d before), 'overdue' (3d after the period ended without payment).
    billing_reminder(locale, d) {
        const plan = d.planName ? escapeHtml(String(d.planName)) : null;
        const amount = (d.amount != null && Number.isFinite(Number(d.amount))) ? formatRupiah(d.amount) : null;
        const when = d.dueLabel ? escapeHtml(d.dueLabel) : null;
        const phase = d.phase || 'upcoming';
        const checkout = `${d.baseUrl}/checkout`;
        const billing = `${d.baseUrl}/settings-billing`;
        if (locale === 'id') {
            const detail = (plan ? `paket ${plan} Anda` : 'langganan Anda') + (amount ? ` (${amount})` : '');
            const P = {
                upcoming: { subject: 'Langganan FluxyOS Anda diperpanjang dalam 7 hari', heading: 'Perpanjangan dalam 7 hari', body: `${detail} akan diperpanjang${when ? ` pada ${when}` : ' minggu depan'}. Siapkan pembayaran agar dashboard, AI, dan ekspor Anda tetap berjalan tanpa terganggu.`, cta: 'Tinjau tagihan', url: billing },
                due_soon: { subject: 'Langganan FluxyOS Anda diperpanjang besok', heading: 'Perpanjangan besok', body: `${detail} diperpanjang${when ? ` pada ${when}` : ' besok'}. Selesaikan pembayaran sekarang agar tidak ada gangguan akses.`, cta: 'Bayar sekarang', url: checkout },
                overdue: { subject: 'Tindakan diperlukan: pembayaran FluxyOS Anda terlambat', heading: 'Pembayaran Anda terlambat', body: `Pembayaran untuk ${detail} jatuh tempo${when ? ` pada ${when}` : ''} dan kini <strong>terlambat</strong>. Bayar sekarang untuk mencegah akun Anda terkunci.`, cta: 'Bayar sekarang', url: checkout },
            };
            const p = P[phase] || P.upcoming;
            return { subject: p.subject, heading: p.heading, paragraphs: [{ html: greet('id', d.name), text: d.name ? `Halo ${d.name},` : 'Halo,' }, { html: p.body, text: p.body.replace(/<[^>]+>/g, '') }], cta: { label: p.cta, url: p.url }, footnote: TRANSACTIONAL_FOOTNOTE.id };
        }
        const detail = (plan ? `your ${plan} plan` : 'your subscription') + (amount ? ` (${amount})` : '');
        const Cap = detail.charAt(0).toUpperCase() + detail.slice(1);
        const P = {
            upcoming: { subject: 'Your FluxyOS plan renews in 7 days', heading: 'Your plan renews in 7 days', body: `${Cap} renews${when ? ` on ${when}` : ' next week'}. Make sure your payment is ready so your dashboards, AI, and exports keep running.`, cta: 'Review billing', url: billing },
            due_soon: { subject: 'Your FluxyOS plan renews tomorrow', heading: 'Your plan renews tomorrow', body: `${Cap} renews${when ? ` on ${when}` : ' tomorrow'}. Complete your payment now to avoid any interruption.`, cta: 'Pay now', url: checkout },
            overdue: { subject: 'Action needed: your FluxyOS payment is overdue', heading: 'Your payment is overdue', body: `Payment for ${detail} was due${when ? ` on ${when}` : ''} and is now <strong>overdue</strong>. Pay now to avoid your account being locked.`, cta: 'Pay now', url: checkout },
        };
        const p = P[phase] || P.upcoming;
        return { subject: p.subject, heading: p.heading, paragraphs: [{ html: greet('en', d.name), text: d.name ? `Hi ${d.name},` : 'Hi there,' }, { html: p.body, text: p.body.replace(/<[^>]+>/g, '') }], cta: { label: p.cta, url: p.url }, footnote: TRANSACTIONAL_FOOTNOTE.en };
    },

    account_locked(locale, d) {
        const url = `${d.baseUrl}/checkout`;
        if (locale === 'id') {
            return {
                subject: 'Akun FluxyOS Anda terkunci',
                heading: 'Akun Anda terkunci',
                paragraphs: [
                    { html: greet('id', d.name), text: d.name ? `Halo ${d.name},` : 'Halo,' },
                    { html: 'Karena pembayaran belum kami terima, akun FluxyOS Anda kini <strong>terkunci</strong> dan akses dijeda sementara.', text: 'Karena pembayaran belum kami terima, akun FluxyOS Anda kini terkunci dan akses dijeda sementara.' },
                    { html: 'Data Anda tetap aman. Aktifkan kembali kapan saja dengan menyelesaikan pembayaran.', text: 'Data Anda tetap aman. Aktifkan kembali kapan saja dengan menyelesaikan pembayaran.' },
                ],
                cta: { label: 'Aktifkan kembali', url },
                footnote: TRANSACTIONAL_FOOTNOTE.id,
            };
        }
        return {
            subject: 'Your FluxyOS account is locked',
            heading: 'Your account is locked',
            paragraphs: [
                { html: greet('en', d.name), text: d.name ? `Hi ${d.name},` : 'Hi there,' },
                { html: "We haven't received your payment, so your FluxyOS account is now <strong>locked</strong> and access is paused.", text: "We haven't received your payment, so your FluxyOS account is now locked and access is paused." },
                { html: 'Your data is safe — reactivate any time by completing your payment.', text: 'Your data is safe — reactivate any time by completing your payment.' },
            ],
            cta: { label: 'Reactivate account', url },
            footnote: TRANSACTIONAL_FOOTNOTE.en,
        };
    },

    // "Finish your QRIS payment" reminder — fired when a payment request (new
    // plan, repayment, or upgrade) is still awaiting_payment. CTA goes straight
    // back to the QR screen via /payment-pending?requestId=.
    payment_pending_reminder(locale, d) {
        const plan = d.planName ? escapeHtml(String(d.planName)) : null;
        const amount = (d.amount != null && Number.isFinite(Number(d.amount))) ? formatRupiah(d.amount) : null;
        const url = d.requestId ? `${d.baseUrl}/payment-pending?requestId=${encodeURIComponent(d.requestId)}` : `${d.baseUrl}/payment-pending`;
        if (locale === 'id') {
            const detail = (plan ? `paket ${plan}` : 'paket Anda') + (amount ? ` (${amount})` : '');
            return {
                subject: 'Selesaikan pembayaran FluxyOS Anda',
                heading: 'Tinggal satu langkah lagi',
                paragraphs: [
                    { html: greet('id', d.name), text: d.name ? `Halo ${d.name},` : 'Halo,' },
                    { html: `Anda sudah memilih ${detail} dan QRIS pembayaran sudah siap. Scan kode QR untuk menyelesaikan pembayaran.`, text: `Anda sudah memilih ${plan ? `paket ${d.planName}` : 'paket Anda'}${amount ? ` (${amount})` : ''} dan QRIS pembayaran sudah siap. Scan kode QR untuk menyelesaikan pembayaran.` },
                    { html: 'Selesaikan <strong>sebelum kode QR Anda kedaluwarsa</strong> agar paket Anda langsung aktif. Sudah membayar? Abaikan email ini — kami akan segera memverifikasi.', text: 'Selesaikan sebelum kode QR Anda kedaluwarsa agar paket Anda langsung aktif. Sudah membayar? Abaikan email ini — kami akan segera memverifikasi.' },
                ],
                cta: { label: 'Buka pembayaran QRIS', url },
                footnote: TRANSACTIONAL_FOOTNOTE.id,
            };
        }
        const detail = (plan ? `the ${plan} plan` : 'your plan') + (amount ? ` (${amount})` : '');
        return {
            subject: 'Complete your FluxyOS payment',
            heading: "You're one step away",
            paragraphs: [
                { html: greet('en', d.name), text: d.name ? `Hi ${d.name},` : 'Hi there,' },
                { html: `You selected ${detail} and your QRIS payment is ready. Scan the QR code to finish.`, text: `You selected ${plan ? `the ${d.planName} plan` : 'your plan'}${amount ? ` (${amount})` : ''} and your QRIS payment is ready. Scan the QR code to finish.` },
                { html: 'Complete it <strong>before your QR code expires</strong> to activate your plan. Already paid? You can ignore this — we’ll confirm shortly.', text: 'Complete it before your QR code expires to activate your plan. Already paid? You can ignore this — we’ll confirm shortly.' },
            ],
            cta: { label: 'Open QRIS payment', url },
            footnote: TRANSACTIONAL_FOOTNOTE.en,
        };
    },

    // Immediate acknowledgement when a payment is submitted (pending_verification).
    payment_under_review(locale, d) {
        const plan = d.planName ? escapeHtml(String(d.planName)) : null;
        const amount = (d.amount != null && Number.isFinite(Number(d.amount))) ? formatRupiah(d.amount) : null;
        const url = d.requestId ? `${d.baseUrl}/payment-pending?requestId=${encodeURIComponent(d.requestId)}` : `${d.baseUrl}/settings-billing`;
        if (locale === 'id') {
            const detail = (plan ? ` untuk paket ${plan}` : '') + (amount ? ` (${amount})` : '');
            return {
                subject: 'Pembayaran diterima — sedang kami verifikasi',
                heading: 'Pembayaran diterima',
                paragraphs: [
                    { html: greet('id', d.name), text: d.name ? `Halo ${d.name},` : 'Halo,' },
                    { html: `Terima kasih! Kami telah menerima pembayaran Anda${detail} dan tim kami sedang memverifikasinya. Anda akan menerima konfirmasi begitu pembayaran disetujui — biasanya dalam beberapa jam.`, text: `Terima kasih! Kami telah menerima pembayaran Anda${plan ? ` untuk paket ${d.planName}` : ''}${amount ? ` (${amount})` : ''} dan tim kami sedang memverifikasinya. Anda akan menerima konfirmasi begitu pembayaran disetujui — biasanya dalam beberapa jam.` },
                    { html: 'Tidak ada tindakan yang diperlukan dari Anda.', text: 'Tidak ada tindakan yang diperlukan dari Anda.' },
                ],
                cta: { label: 'Lihat status pembayaran', url },
                footnote: TRANSACTIONAL_FOOTNOTE.id,
            };
        }
        const detail = (plan ? ` for the ${plan} plan` : '') + (amount ? ` (${amount})` : '');
        return {
            subject: "Payment received — we're verifying it",
            heading: 'Payment received',
            paragraphs: [
                { html: greet('en', d.name), text: d.name ? `Hi ${d.name},` : 'Hi there,' },
                { html: `Thanks! We've received your payment${detail} and our team is verifying it now. You'll get a confirmation as soon as it's approved — usually within a few hours.`, text: `Thanks! We've received your payment${plan ? ` for the ${d.planName} plan` : ''}${amount ? ` (${amount})` : ''} and our team is verifying it now. You'll get a confirmation as soon as it's approved — usually within a few hours.` },
                { html: 'No action is needed from you.', text: 'No action is needed from you.' },
            ],
            cta: { label: 'View payment status', url },
            footnote: TRANSACTIONAL_FOOTNOTE.en,
        };
    },

    // One-time product-update announcement: Bahasa Indonesia is now available.
    // Bilingual BY DESIGN (English first, Bahasa Indonesia below) — it announces
    // the language itself, so every recipient sees both regardless of locale.
    announce_id_language(_locale, d) {
        const baseUrl = d.baseUrl || 'https://fluxyos.com';
        const settingsUrl = `${baseUrl}/settings-language`;
        const eyebrow = (t) => ({
            html: `<div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${ORANGE};margin:0 0 2px;">${escapeHtml(t)}</div>`,
            text: t.toUpperCase(),
        });
        const divider = (label) => ({
            html: `<div style="border-top:1px solid #EEF0F3;margin:6px 0 0;"></div><div style="text-align:center;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${NAVY};padding-top:16px;">${escapeHtml(label)}</div>`,
            text: `— ${label} —`,
        });
        const line = (html, text) => ({ html, text: text != null ? text : html.replace(/<[^>]+>/g, '') });
        return {
            subject: 'FluxyOS now speaks Bahasa Indonesia 🇮🇩 · Kini hadir dalam Bahasa Indonesia',
            heading: 'FluxyOS now speaks Bahasa Indonesia',
            paragraphs: [
                eyebrow('New enhancement release'),
                // ---- English ----
                line('Hi there,'),
                line('Good news — FluxyOS is now available in <strong>Bahasa Indonesia</strong>. Your whole workspace, including the dashboard, reports, and Fluxy AI, can now speak Bahasa.'),
                line('To switch, open <strong>Settings &rarr; Language &amp; Region</strong> and choose <strong>Bahasa Indonesia</strong>. The interface changes instantly, and your amounts always stay in Rupiah (Rp).', 'To switch, open Settings → Language & Region and choose Bahasa Indonesia. The interface changes instantly, and your amounts always stay in Rupiah (Rp).'),
                // ---- divider ----
                divider('🇮🇩 Bahasa Indonesia'),
                // ---- Indonesian ----
                line('Halo,'),
                line('Kabar baik — FluxyOS kini tersedia dalam <strong>Bahasa Indonesia</strong>. Seluruh workspace Anda, termasuk dashboard, laporan, dan Fluxy AI, kini bisa berbahasa Indonesia.'),
                line('Untuk mengganti, buka <strong>Pengaturan &rarr; Bahasa &amp; Wilayah</strong> lalu pilih <strong>Bahasa Indonesia</strong>. Tampilan langsung berubah, dan nominal tetap dalam Rupiah (Rp).', 'Untuk mengganti, buka Pengaturan → Bahasa & Wilayah lalu pilih Bahasa Indonesia. Tampilan langsung berubah, dan nominal tetap dalam Rupiah (Rp).'),
            ],
            cta: { label: 'Change language · Ganti bahasa', url: settingsUrl },
            footnote: "You're receiving this FluxyOS product update because you have an account. · Anda menerima pembaruan produk FluxyOS ini karena memiliki akun.",
        };
    },

    // Sales-lead meeting-reminder outreach, sent from the dashboard Sales Leads
    // page. Bilingual BY DESIGN (Indonesian primary, English below) regardless of
    // `locale`, mirroring outreach/meeting-reminder-bilingual.html. The greeting
    // honorific is driven by `d.gender`; the meeting date/time come from
    // `d.meetingISO` and are formatted in Asia/Jakarta (WIB).
    lead_outreach(_locale, d) {
        const baseUrl = d.baseUrl || 'https://fluxyos.com';
        const name = d.name ? escapeHtml(String(d.name)) : '';
        const hon = honorific(d.gender);
        const sender = d.senderName ? escapeHtml(String(d.senderName)) : 'Tim FluxyOS';

        const dt = d.meetingISO ? new Date(d.meetingISO) : null;
        const valid = dt && !isNaN(dt.getTime());
        const TZ = 'Asia/Jakarta';
        const fmt = (locale, opts) => (valid ? new Intl.DateTimeFormat(locale, { ...opts, timeZone: TZ }).format(dt) : '');
        const idWeekday = fmt('id-ID', { weekday: 'long' }) || 'meeting kita';
        const enWeekday = fmt('en-GB', { weekday: 'long' }) || 'our meeting day';
        const idDate = fmt('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const enDate = fmt('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        const idTime = valid ? `${fmt('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false })} WIB (GMT+7)` : '';
        const enTime = valid ? `${fmt('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} WIB (GMT+7)` : '';

        const line = (html, text) => ({ html, text: text != null ? text : html.replace(/<[^>]+>/g, '') });
        const card = (date, time, helper) => line(
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#F9FAFB;border:1px solid ${BORDER};border-radius:12px;"><tr><td style="padding:16px 20px;">`
            + `<div style="font-size:18px;font-weight:700;color:${NAVY};letter-spacing:-0.01em;">📅 ${escapeHtml(date)}</div>`
            + `<div style="padding-top:4px;font-size:15px;color:${INK};">🕒 ${escapeHtml(time)}</div>`
            + `<div style="padding-top:8px;font-size:13px;color:${MUTED};line-height:1.5;">${helper}</div>`
            + `</td></tr></table>`,
            `${date} — ${time}. ${helper}`,
        );

        return {
            subject: 'We are excited to meet you soon',
            heading: 'Kami tidak sabar untuk bertemu',
            paragraphs: [
                line(`<div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${ORANGE};">Pengingat meeting</div>`, 'PENGINGAT MEETING'),
                // ---- Bahasa Indonesia (primary) ----
                line(`Halo ${hon.id} ${name},`),
                line(`Sekadar mengingatkan bahwa kita sudah terjadwal untuk bertemu pada hari ${escapeHtml(idWeekday)}. Saya sangat menantikan kesempatan untuk mengenal bisnis Anda lebih jauh dan berdiskusi mengenai tantangan yang saat ini sedang dihadapi.`),
                line('Dalam sesi ini, saya akan menunjukkan bagaimana FluxyOS membantu bisnis mengelola operasional, keuangan, dan proses administrasi dengan lebih efisien melalui otomatisasi dan AI yang terintegrasi.'),
                card(idDate, idTime, 'Undangan kalender sudah tersedia di inbox Anda, jadi tidak ada yang perlu dilakukan sebelum meeting.'),
                line('Jika ada waktu luang, Anda juga bisa melihat sekilas FluxyOS di fluxyos.com agar mendapatkan gambaran mengenai platform kami. Dengan begitu, saat sesi berlangsung kita bisa langsung fokus membahas kebutuhan bisnis Anda dan mengeksplorasi solusi yang paling relevan.'),
                line(`Sampai jumpa di hari ${escapeHtml(idWeekday)}. Saya menantikan diskusi kita.`),
                // ---- divider ----
                line(`<div style="border-top:1px solid #EEF0F3;margin:6px 0 0;"></div><div style="text-align:center;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${NAVY};padding-top:16px;">🇬🇧 English</div>`, '— English —'),
                // ---- English (secondary) ----
                line(`Hi ${hon.en} ${name},`),
                line(`Just confirming our meeting on ${escapeHtml(enWeekday)}, and I'm looking forward to it. You'll get a proper walkthrough of how FluxyOS and our AI can help solve the problems you're dealing with right now.`),
                card(enDate, enTime, 'The calendar invite is already in your inbox — no action needed.'),
                line("If you have a few minutes before then, take a look around fluxyos.com. It'll give you a feel for things ahead of our call."),
                line('Stop losing your evenings to financial reports and spreadsheets. Let FluxyOS handle it, so you can get back to running your business.'),
                line(`Salam, &middot; Best regards,<br><strong style="color:${NAVY};">${sender}</strong><br><span style="color:${MUTED};">FluxyOS</span>`, `Salam / Best regards, ${d.senderName || 'Tim FluxyOS'} — FluxyOS`),
            ],
            cta: { label: 'Jelajahi FluxyOS · Explore FluxyOS', url: baseUrl },
            footnote: 'Anda menerima email ini karena telah menjadwalkan meeting dengan tim FluxyOS. · You’re receiving this because you booked a meeting with the FluxyOS team.',
        };
    },

    // Workspace team invitation. Bilingual by design (Indonesian primary, English
    // below) since the invitee's locale is unknown. Brand/role names stay English
    // per docs/LOCALIZATION_PLAN.md. data: { inviterName, workspaceName, role,
    // roleLabel, acceptUrl, baseUrl }.
    team_invite(_locale, d) {
        const baseUrl = d.baseUrl || 'https://fluxyos.com';
        const acceptUrl = d.acceptUrl || baseUrl;
        const inviter = d.inviterName ? escapeHtml(String(d.inviterName)) : 'A FluxyOS workspace owner';
        const workspace = d.workspaceName ? escapeHtml(String(d.workspaceName)) : 'a FluxyOS workspace';
        const roleLabel = escapeHtml(String(d.roleLabel || d.role || 'team member'));
        const wsRaw = d.workspaceName ? String(d.workspaceName) : 'a FluxyOS workspace';
        const line = (html, text) => ({ html, text: text != null ? text : html.replace(/<[^>]+>/g, '') });
        return {
            // Bilingual subject (Indonesian · English), same meaning both sides.
            subject: `Anda diundang ke ${wsRaw} · You've been invited to join ${wsRaw}`,
            heading: 'Anda diundang ke FluxyOS',
            paragraphs: [
                line(`<div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${ORANGE};">Undangan tim</div>`, 'UNDANGAN TIM'),
                // ---- Bahasa Indonesia (primary) — same meaning as the English below ----
                line(`Halo,`),
                line(`<strong>${inviter}</strong> mengundang Anda untuk bergabung ke <strong>${workspace}</strong> di FluxyOS sebagai <strong>${roleLabel}</strong>.`),
                line('Terima undangan dan masuk menggunakan alamat email ini untuk mendapatkan akses. Jika Anda belum memiliki akun FluxyOS, buat akun dengan email ini dan Anda akan otomatis ditambahkan.'),
                // ---- divider ----
                line(`<div style="border-top:1px solid #EEF0F3;margin:6px 0 0;"></div><div style="text-align:center;font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${NAVY};padding-top:16px;">🇬🇧 English</div>`, '— English —'),
                // ---- English (same meaning) ----
                line(`Hi,`),
                line(`<strong>${inviter}</strong> has invited you to join <strong>${workspace}</strong> on FluxyOS as a <strong>${roleLabel}</strong>.`),
                line('Accept the invitation and sign in with this email address to get access. If you don’t have a FluxyOS account yet, create one with this email and you’ll be added automatically.'),
            ],
            cta: { label: 'Terima undangan · Accept invitation', url: acceptUrl },
            footnote: 'Jika Anda tidak mengenali undangan ini, abaikan email ini. · If you didn’t expect this invitation, you can safely ignore this email.',
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
    const baseUrl = (data && data.baseUrl) || 'https://fluxyos.com';
    const logoUrl = `${baseUrl}/assets/images/email-logo.png`;
    const html = layout({ previewText: c.subject, heading: c.heading, paragraphsHtml, cta: c.cta, footnote: c.footnote, logoUrl });
    const text = toText({ heading: c.heading, paragraphsText, cta: c.cta, footnote: c.footnote });
    return { subject: c.subject, html, text };
}

// `layout` + brand tokens are exported so the Weekly Digest builder
// (functions/lib/digest-template.js) renders on the same shell/header/footer.
module.exports = { buildEmail, layout, BRAND: { NAVY, ORANGE, INK, MUTED, BORDER, CANVAS } };
