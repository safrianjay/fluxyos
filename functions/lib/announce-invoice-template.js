'use strict';

// ONE-TIME broadcast template: "Invoice email delivery + multi-currency".
// Rendered as a `prebuilt` email (same seam as the Weekly Digest) so the shared
// transactional layout in templates.js stays untouched. Two full locales — the
// per-user language is resolved by the caller via resolveUserLocale.
//
// Brand rules honoured (docs/DESIGN_SYSTEM.md): navy #0B0F19 primary button,
// orange #EA580C as accent only (never a background), Rp amounts with dot
// separators and no space after "Rp", tabular-nums for all figures. Mockups are
// pure inline-styled tables — no hosted images, so nothing breaks with remote
// images disabled.

const { escapeHtml } = require('./format');

const NAVY = '#0B0F19';
const ORANGE = '#EA580C';
const INK = '#111827';
const MUTED = '#6B7280';
const BORDER = '#E5E7EB';
const CANVAS = '#F3F4F6';
const HAIR = '#EEF0F3';
const GREEN = '#16A34A';

const TEMPLATE = 'announce_invoice_multicurrency';

const STR = {
    en: {
        subject: 'New in FluxyOS: send invoices by email — now in USD, SGD & IDR',
        preview: 'Send invoices straight to your client’s inbox — and bill in USD, SGD, or IDR with live conversion to Rupiah.',
        eyebrow: 'Product update · July 2026',
        heading: 'Send invoices to your clients — in USD, SGD, or IDR',
        greet: (n) => (n ? `Hi ${escapeHtml(n)},` : 'Hi there,'),
        intro: [
            'Two upgrades just landed in <strong>Invoices</strong>: your invoices can now reach your client’s inbox directly from FluxyOS, and you can bill in <strong>US Dollars or Singapore Dollars</strong> alongside Rupiah — with the conversion handled for you.',
        ],
        f1Label: 'Invoice email delivery',
        f1Title: 'Send it. Don’t download it.',
        f1Body: 'Choose <strong>Finalize and mark as sent</strong> and FluxyOS emails a PDF of the invoice straight to your client — no downloading, no attachments to juggle. Delivery status shows right on the invoice, so you always know it arrived.',
        pillSent: 'Sent ✓',
        btnSend: 'Finalize and mark as sent →',
        inboxLabel: 'Your client’s inbox',
        mailFrom: 'From:', mailFromVal: 'Your business, via FluxyOS',
        mailTo: 'To:',
        mailSubject: 'Invoice INV-2026-0042 — due 30 July 2026',
        f2Label: 'Multi-currency invoicing',
        f2Title: 'Bill international clients in their currency',
        f2Body: 'Pick the currency when you create the invoice — line items, totals, and the PDF your client receives all follow it. This release supports <strong>US Dollar (USD)</strong>, <strong>Singapore Dollar (SGD)</strong>, and <strong>Indonesian Rupiah (IDR)</strong>.',
        curLabel: 'Invoice currency',
        curIdr: 'Rupiah', curUsd: 'US Dollar', curSgd: 'Singapore Dollar',
        f3Label: 'Real-time conversion',
        f3Title: 'Your books stay in Rupiah',
        f3Body: 'Every USD or SGD invoice shows a live conversion to IDR at the latest exchange rate. When it’s paid, FluxyOS records the Rupiah amount <em>and</em> the rate used in your ledger — so reporting stays clean without a calculator in sight.',
        fxTotal: 'Invoice total', fxLedger: 'Recorded in your ledger',
        fxRate: '1 USD = Rp16.250 · live rate, captured at payment',
        closing: 'More currencies are on the way. Billing a client in something we don’t cover yet? Reply to this email and tell us which currency to add next.',
        cta: 'Create your first multi-currency invoice',
        footnote: 'You’re receiving this occasional product update because you have a FluxyOS account. Questions? Just reply to this email.',
    },
    id: {
        subject: 'Baru di FluxyOS: kirim invoice via email — kini dalam USD, SGD & IDR',
        preview: 'Kirim invoice langsung ke inbox klien Anda — dan tagih dalam USD, SGD, atau IDR dengan konversi live ke Rupiah.',
        eyebrow: 'Pembaruan produk · Juli 2026',
        heading: 'Kirim invoice ke klien Anda — dalam USD, SGD, atau IDR',
        greet: (n) => (n ? `Halo ${escapeHtml(n)},` : 'Halo,'),
        intro: [
            'Sekarang Anda bisa langsung mengirim invoice ke email klien tanpa perlu download dan kirim manual. Selain itu, invoice kini mendukung <strong>Rupiah (IDR)</strong>, <strong>Dolar AS (USD)</strong>, dan <strong>Dolar Singapura (SGD)</strong>. Jika menggunakan USD atau SGD, FluxyOS akan otomatis menampilkan konversi ke Rupiah dengan kurs terbaru secara real-time.',
            'Dan ini baru permulaan. Lebih banyak mata uang akan segera hadir.',
        ],
        f1Label: 'Pengiriman invoice via email',
        f1Title: 'Kirim langsung, tanpa unduh',
        f1Body: 'Pilih <strong>Finalisasi dan tandai terkirim</strong>, dan FluxyOS mengirimkan PDF invoice langsung ke email klien Anda — tanpa mengunduh, tanpa repot lampiran. Status pengiriman tampil langsung di invoice, jadi Anda selalu tahu invoice sudah sampai.',
        pillSent: 'Terkirim ✓',
        btnSend: 'Finalisasi dan tandai terkirim →',
        inboxLabel: 'Inbox klien Anda',
        mailFrom: 'Dari:', mailFromVal: 'Bisnis Anda, via FluxyOS',
        mailTo: 'Kepada:',
        mailSubject: 'Invoice INV-2026-0042 — jatuh tempo 30 Juli 2026',
        f2Label: 'Invoice multi-mata uang',
        f2Title: 'Tagih klien internasional dalam mata uang mereka',
        f2Body: 'Pilih mata uang saat membuat invoice — item, total, dan PDF yang diterima klien mengikuti mata uang tersebut. Rilis ini mendukung <strong>Dolar AS (USD)</strong>, <strong>Dolar Singapura (SGD)</strong>, dan <strong>Rupiah (IDR)</strong>.',
        curLabel: 'Mata uang invoice',
        curIdr: 'Rupiah', curUsd: 'Dolar AS', curSgd: 'Dolar Singapura',
        f3Label: 'Konversi kurs real-time',
        f3Title: 'Pembukuan Anda tetap dalam Rupiah',
        f3Body: 'Setiap invoice USD atau SGD menampilkan konversi live ke IDR dengan kurs terkini. Saat invoice lunas, FluxyOS mencatat jumlah Rupiah <em>dan</em> kurs yang dipakai di buku besar Anda — laporan tetap rapi tanpa kalkulator.',
        fxTotal: 'Total invoice', fxLedger: 'Tercatat di buku besar',
        fxRate: '1 USD = Rp16.250 · kurs live, dicatat saat pembayaran',
        closing: 'Mata uang lain segera menyusul. Tetap gunakan FluxyOS untuk solusi finansial bisnis &amp; perusahaan Anda.',
        cta: 'Buat invoice multi-mata uang pertama Anda',
        footnote: 'Anda menerima pembaruan produk sesekali ini karena memiliki akun FluxyOS. Ada pertanyaan? Balas saja email ini.',
    },
};

const sectionLabel = (s) => `<tr><td style="padding:0 0 8px;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${ORANGE};">${s}</td></tr>`;
const sectionTitle = (s) => `<tr><td style="padding:0 0 8px;font-size:18px;font-weight:700;letter-spacing:-0.01em;color:${NAVY};">${s}</td></tr>`;
const bodyPara = (s, pad = 16) => `<tr><td class="fx-body" style="padding:0 0 ${pad}px;color:${INK};font-size:16px;line-height:1.6;">${s}</td></tr>`;

function sendMockup(t) {
    return `<tr><td style="padding:0 0 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#F9FAFB;border:1px solid ${HAIR};border-radius:12px;">
        <tr><td style="padding:16px 18px 12px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;"><tr>
            <td style="vertical-align:top;">
              <div style="font-size:14px;font-weight:600;color:${NAVY};">INV-2026-0042</div>
              <div style="font-size:12px;color:${MUTED};padding-top:2px;">PT Samudra Kreatif</div>
            </td>
            <td align="right" style="vertical-align:top;">
              <div style="font-size:14px;font-weight:600;color:${NAVY};font-variant-numeric:tabular-nums;">Rp18.500.000</div>
              <div style="padding-top:4px;"><span style="display:inline-block;background:#ECFDF5;border:1px solid #D1FAE5;color:${GREEN};font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;border-radius:999px;padding:3px 9px;">${t.pillSent}</span></div>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:0 18px;"><div style="height:1px;background:${HAIR};font-size:0;line-height:1px;">&nbsp;</div></td></tr>
        <tr><td style="padding:12px 18px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;"><tr>
            <td class="fx-stack" style="vertical-align:middle;">
              <span style="display:inline-block;background:#ffffff;border:1px solid ${BORDER};border-radius:999px;padding:6px 12px;font-size:12px;color:#374151;">&#9993;&nbsp; finance@samudrakreatif.co.id</span>
            </td>
            <td class="fx-stack fx-stack-gap" align="right" style="vertical-align:middle;padding-left:10px;">
              <span style="display:inline-block;background:${NAVY};border-radius:8px;padding:9px 16px;font-size:12px;font-weight:600;color:#ffffff;">${t.btnSend}</span>
            </td>
          </tr></table>
        </td></tr>
      </table>
    </td></tr>`;
}

function inboxMockup(t) {
    const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:${BORDER};">&nbsp;</span>`;
    return `<tr><td style="padding:0 0 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#ffffff;border:1px solid ${BORDER};border-radius:12px;">
        <tr><td style="padding:10px 14px;background:#F9FAFB;border-bottom:1px solid ${HAIR};border-radius:12px 12px 0 0;">
          ${dot} ${dot} ${dot}
          <span style="font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#9AA1AC;padding-left:8px;">${t.inboxLabel}</span>
        </td></tr>
        <tr><td style="padding:14px 18px 6px;">
          <div style="font-size:12px;color:${MUTED};padding-bottom:3px;"><span style="color:#9AA1AC;">${t.mailFrom}</span> &nbsp;${t.mailFromVal}</div>
          <div style="font-size:12px;color:${MUTED};padding-bottom:3px;"><span style="color:#9AA1AC;">${t.mailTo}</span> &nbsp;finance@samudrakreatif.co.id</div>
          <div style="font-size:13px;font-weight:600;color:${NAVY};padding-top:4px;">${t.mailSubject}</div>
        </td></tr>
        <tr><td style="padding:10px 18px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="background:#F9FAFB;border:1px solid ${HAIR};border-radius:8px;padding:8px 12px;">
              <span style="font-size:12px;font-weight:600;color:#374151;">&#128206;&nbsp; INV-2026-0042.pdf</span>
              <span style="font-size:11px;color:#9AA1AC;">&nbsp;&middot; 84 KB</span>
            </td>
          </tr></table>
        </td></tr>
      </table>
    </td></tr>`;
}

function currencyMockup(t) {
    const card = (flag, code, sub, selected) => selected
        ? `<div style="background:#ffffff;border:2px solid ${NAVY};border-radius:10px;padding:11px 8px;text-align:center;">
             <div style="font-size:16px;line-height:1;">${flag}</div>
             <div style="font-size:13px;font-weight:700;color:${NAVY};padding-top:6px;">${code} <span style="color:${ORANGE};">&#10003;</span></div>
             <div style="font-size:10px;color:${MUTED};padding-top:2px;">${sub}</div>
           </div>`
        : `<div style="background:#ffffff;border:1px solid ${BORDER};border-radius:10px;padding:12px 8px;text-align:center;">
             <div style="font-size:16px;line-height:1;">${flag}</div>
             <div style="font-size:13px;font-weight:600;color:#374151;padding-top:6px;">${code}</div>
             <div style="font-size:10px;color:#9AA1AC;padding-top:2px;">${sub}</div>
           </div>`;
    return `<tr><td style="padding:0 0 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#F9FAFB;border:1px solid ${HAIR};border-radius:12px;">
        <tr><td style="padding:16px 18px;">
          <div style="font-size:11px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};padding-bottom:10px;">${t.curLabel}</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;"><tr>
            <td width="33%" style="padding-right:8px;">${card('&#127470;&#127465;', 'IDR', t.curIdr, false)}</td>
            <td width="33%" style="padding-right:8px;">${card('&#127482;&#127480;', 'USD', t.curUsd, true)}</td>
            <td width="33%">${card('&#127480;&#127468;', 'SGD', t.curSgd, false)}</td>
          </tr></table>
        </td></tr>
      </table>
    </td></tr>`;
}

function fxMockup(t) {
    return `<tr><td style="padding:0 0 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${NAVY}" style="width:100%;background:${NAVY};background-image:linear-gradient(135deg,#0B0F19 0%,#1A2138 100%);border-radius:14px;">
        <tr><td style="padding:18px 20px 14px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;"><tr>
            <td class="fx-stack" style="vertical-align:middle;">
              <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#9AA1AC;padding-bottom:5px;">${t.fxTotal}</div>
              <div style="font-size:26px;font-weight:700;letter-spacing:-0.02em;color:#ffffff;line-height:1;font-variant-numeric:tabular-nums;">$2,500.00</div>
            </td>
            <td class="fx-stack" align="center" style="vertical-align:middle;padding:0 10px;"><span style="font-size:18px;color:${ORANGE};">&rarr;</span></td>
            <td class="fx-stack fx-stack-gap" align="right" style="vertical-align:middle;">
              <div style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#9AA1AC;padding-bottom:5px;">${t.fxLedger}</div>
              <div style="font-size:26px;font-weight:700;letter-spacing:-0.02em;color:${ORANGE};line-height:1;font-variant-numeric:tabular-nums;">Rp40.625.000</div>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:0 20px 16px;">
          <div style="border-top:1px dashed rgba(255,255,255,0.18);padding-top:10px;font-size:11px;color:#C7CBD3;">
            <span style="display:inline-block;width:7px;height:7px;border-radius:999px;background:${GREEN};">&nbsp;</span>
            &nbsp;${t.fxRate}
          </div>
        </td></tr>
      </table>
    </td></tr>`;
}

function buildHtml(t, name, ctaUrl) {
    const hairline = `<tr><td style="padding:0 36px;"><div style="height:1px;background:${HAIR};line-height:1px;font-size:0;">&nbsp;</div></td></tr>`;
    const intro = t.intro
        .map((p, i) => bodyPara(p, i === t.intro.length - 1 ? 24 : 16))
        .join('');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light only">
  <title>${escapeHtml(t.subject)}</title>
  <style>
    @media only screen and (max-width:480px){
      .fx-body{font-size:17px !important;line-height:1.6 !important;}
      .fx-h1{font-size:25px !important;}
      .fx-pad{padding-left:20px !important;padding-right:20px !important;}
      .fx-stack{display:block !important;width:100% !important;}
      .fx-stack-gap{padding-top:10px !important;padding-left:0 !important;}
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${CANVAS};-webkit-font-smoothing:antialiased;">
  <span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all;">${escapeHtml(t.preview)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${CANVAS}" style="background:${CANVAS};padding:28px 0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:92%;background:#ffffff;border:1px solid ${BORDER};border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(16,24,40,0.04);">
        <tr><td class="fx-pad" style="padding:28px 36px 18px;">
          <span style="font-size:19px;font-weight:700;letter-spacing:-0.01em;color:${NAVY};">Fluxy<span style="color:${ORANGE};">OS</span></span>
        </td></tr>
        ${hairline}
        <tr><td class="fx-pad" style="padding:24px 36px 0;">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${ORANGE};padding:0 0 10px;">${t.eyebrow}</div>
          <h1 class="fx-h1" style="margin:0;font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-0.015em;color:${NAVY};">${t.heading}</h1>
        </td></tr>
        <tr><td class="fx-pad" style="padding:16px 36px 30px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;">
            ${bodyPara(t.greet(name))}
            ${intro}
            ${sectionLabel(t.f1Label)}
            ${sectionTitle(t.f1Title)}
            ${bodyPara(t.f1Body)}
            ${sendMockup(t)}
            ${inboxMockup(t)}
            ${sectionLabel(t.f2Label)}
            ${sectionTitle(t.f2Title)}
            ${bodyPara(t.f2Body)}
            ${currencyMockup(t)}
            ${sectionLabel(t.f3Label)}
            ${sectionTitle(t.f3Title)}
            ${bodyPara(t.f3Body)}
            ${fxMockup(t)}
            ${bodyPara(t.closing)}
            <tr><td style="padding:12px 0 6px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;"><tr>
                <td align="center" bgcolor="${NAVY}" style="background:${NAVY};border-radius:10px;">
                  <a href="${escapeHtml(ctaUrl)}" style="display:block;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;line-height:1;padding:15px 20px;letter-spacing:-0.005em;">${t.cta}</a>
                </td>
              </tr></table>
            </td></tr>
          </table>
        </td></tr>
        ${hairline}
        <tr><td class="fx-pad" style="padding:20px 36px 26px;">
          <p style="margin:0;color:${MUTED};font-size:13px;line-height:1.55;">${t.footnote}</p>
        </td></tr>
      </table>
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:92%;">
        <tr><td style="padding:18px 12px 4px;text-align:center;color:#9AA1AC;font-size:11px;line-height:1.6;">
          <strong style="color:${MUTED};font-weight:600;">FluxyOS</strong> &mdash; Financial operations, streamlined.<br>
          Jakarta, Indonesia &middot; <a href="https://fluxyos.com" style="color:#9AA1AC;text-decoration:underline;">fluxyos.com</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// Strip tags/entities from a copy string for the text/plain part.
function plain(s) {
    return String(s)
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/\u00a0/g, ' ');
}

function buildText(t, name, ctaUrl) {
    const lines = [
        plain(t.heading), '',
        plain(t.greet(name)), '',
    ];
    t.intro.forEach((p) => lines.push(plain(p), ''));
    lines.push(
        `${plain(t.f1Title)} — ${plain(t.f1Body)}`, '',
        `${plain(t.f2Title)} — ${plain(t.f2Body)}`, '',
        `${plain(t.f3Title)} — ${plain(t.f3Body)}`, '',
        plain(t.closing), '',
        `${plain(t.cta)}: ${ctaUrl}`, '',
        plain(t.footnote), '',
        '— FluxyOS',
    );
    return lines.join('\n');
}

/**
 * Build the announcement as a `prebuilt` email for sendNotificationEmail.
 * `locale` is "en" | "id" (anything else falls back to "id", the product
 * default); `name` personalizes the greeting and may be empty.
 */
function buildInvoiceAnnouncement(locale, { name = '', baseUrl = 'https://dashboard.fluxyos.com' } = {}) {
    const t = STR[locale === 'en' ? 'en' : 'id'];
    const ctaUrl = `${baseUrl}/invoices`;
    return {
        subject: t.subject,
        html: buildHtml(t, name, ctaUrl),
        text: buildText(t, name, ctaUrl),
        template: TEMPLATE,
    };
}

module.exports = { buildInvoiceAnnouncement, TEMPLATE };
