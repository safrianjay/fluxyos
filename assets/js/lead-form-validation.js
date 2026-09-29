/* Shared browser/server lead validation. Never silently truncate a lead. */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.FluxyLeadValidation = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
    'use strict';
    var MESSAGE_MAX = 100;
    var LIMITS = { name: 120, email: 254, whatsapp: 40, company: 160, business_type: 60, team_size: 20, message: MESSAGE_MAX, source: 30 };
    // Small, conservative list of established disposable domains. Gmail,
    // Outlook and other permanent personal mailboxes remain acceptable.
    var DISPOSABLE = ['mailinator.com','guerrillamail.com','guerrillamail.net','guerrillamail.org','sharklasers.com','grr.la','guerrillamailblock.com','pokemail.net','spam4.me','yopmail.com','yopmail.fr','yopmail.net','10minutemail.com','10minutemail.net','tempmail.com','temp-mail.org','temp-mail.io','trashmail.com','throwawaymail.com','getnada.com','dispostable.com'];
    var MESSAGES = {
        internal_email: ['Please use your business email address to contact our sales team.','Gunakan email bisnis Anda untuk menghubungi tim sales kami.'],
        invalid_email: ['Please enter a valid email address.','Masukkan alamat email yang valid.'],
        disposable_email: ['Please use a permanent email address for your enquiry.','Gunakan alamat email tetap untuk pertanyaan Anda.'],
        message_too_long: ['Please keep your message within 100 characters.','Tulis pesan maksimal 100 karakter.'],
        invalid_input: ['Please check the form fields and try again.','Periksa isian formulir, lalu coba lagi.'],
        submission_rejected: ['We could not accept this enquiry. Please check your details or email sales@fluxyos.com.','Pertanyaan ini belum bisa diterima. Periksa data Anda atau email sales@fluxyos.com.'],
        verification_failed: ['Please retry the security check, then send your enquiry.','Coba lagi pemeriksaan keamanan, lalu kirim pertanyaan Anda.'],
        verification_unavailable: ['Secure verification is unavailable. Please reload or email sales@fluxyos.com.','Pemeriksaan keamanan belum tersedia. Muat ulang atau email sales@fluxyos.com.'],
        rate_limited: ['Too many attempts. Please wait a while before trying again, or email sales@fluxyos.com.','Terlalu banyak percobaan. Tunggu sebentar sebelum mencoba lagi, atau email sales@fluxyos.com.'],
        server_error: ['Something went wrong sending your enquiry. Please try again or email sales@fluxyos.com.','Pertanyaan Anda belum terkirim. Coba lagi atau email sales@fluxyos.com.']
    };
    function message(code, locale) { return (MESSAGES[code] || MESSAGES.server_error)[locale === 'id' ? 1 : 0]; }
    function domainOf(email) { return String(email).slice(String(email).lastIndexOf('@') + 1).toLowerCase(); }
    function internal(email) { var d=domainOf(email.trim()); return d==='fluxyos.com' || d.endsWith('.fluxyos.com'); }
    function emailError(email) {
        if (internal(email)) return 'internal_email';
        if (email.length > 254 || email.indexOf('@') !== email.lastIndexOf('@')) return 'invalid_email';
        var at=email.indexOf('@'), local=email.slice(0,at), domain=domainOf(email);
        if (at < 1 || local.length > 64 || !/^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local)) return 'invalid_email';
        var labels=domain.split('.');
        if (labels.length<2 || !/^[a-z]{2,63}$/i.test(labels[labels.length-1]) || labels.some(function (l) { return !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(l); })) return 'invalid_email';
        if (DISPOSABLE.some(function (d) { return domain===d || domain.endsWith('.'+d); })) return 'disposable_email';
        return '';
    }
    function unsafe(text) {
        return /[<>]|&(?:lt|gt|#0*(?:60|62)|#x0*(?:3c|3e));|%(?:3c|3e)|\b(?:javascript|vbscript)\s*:|\bdata\s*:\s*text\/html/i.test(text);
    }
    function validate(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return {ok:false,error:'invalid_input'};
        var lead={};
        for (var field of Object.keys(LIMITS)) {
            var value=data[field];
            if (value===undefined) value='';
            if (typeof value!=='string') return {ok:false,error:'invalid_input',field:field};
            if (value.length>LIMITS[field]) return {ok:false,error:field==='message'?'message_too_long':'invalid_input',field:field};
            if (unsafe(value) || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value) || (field!=='message' && /[\r\n\t]/.test(value))) return {ok:false,error:'submission_rejected',field:field};
            lead[field]=value.normalize('NFC').trim();
        }
        var emailIssue=emailError(lead.email);
        if (emailIssue) return {ok:false,error:emailIssue,field:'email'};
        lead.email=lead.email.toLowerCase();
        for(var required of ['name','whatsapp','company','business_type']) if(!lead[required]) return {ok:false,error:'invalid_input',field:required};
        var digits=(lead.whatsapp.match(/\d/g)||[]).length;
        if(!/^\+?[\d ()-]+$/.test(lead.whatsapp) || digits<6 || digits>15) return {ok:false,error:'invalid_input',field:'whatsapp'};
        if(lead.team_size && !['1-10','11-50','51-200','201-1000','1000+'].includes(lead.team_size)) return {ok:false,error:'invalid_input',field:'team_size'};
        if(!lead.source) lead.source='contact-sales';
        if(!['contact-sales','event-signup'].includes(lead.source)) return {ok:false,error:'invalid_input',field:'source'};
        return {ok:true,lead:lead};
    }
    return { MESSAGE_MAX:MESSAGE_MAX, LIMITS:LIMITS, emailError:emailError, internal:internal, validate:validate, message:message };
});
