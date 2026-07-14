'use strict';

// Kick the invoice-email background function (the Chromium PDF render + send).
// Shared by the enqueue function (instant send on finalize) and the scheduled
// worker (retry sweep). Uses the INTERNAL_API_TOKEN shared-secret header, the
// same pattern as commerce-sync-worker → commerce-sync-background. Chromium-free
// on purpose so neither caller bundles the heavy browser.
async function delegateToBackground(workspaceId, jobId) {
    // Prefer the deploying site's own URL so an app-site trigger stays on the
    // app site (where INVOICE_EMAIL_ENABLED is set), not the marketing apex.
    const base = (process.env.URL || process.env.APP_BASE_URL || '').replace(/\/$/, '');
    const token = process.env.INTERNAL_API_TOKEN;
    if (!base || !token) {
        console.error('[invoice-email] cannot delegate: URL/APP_BASE_URL or INTERNAL_API_TOKEN missing');
        return false;
    }
    try {
        const res = await fetch(`${base}/.netlify/functions/invoice-email-background`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-internal-token': token },
            body: JSON.stringify({ workspace_id: workspaceId, job_id: jobId }),
        });
        return res.status === 202 || res.ok;
    } catch (e) {
        console.error('[invoice-email] delegation fetch failed', e.message);
        return false;
    }
}

module.exports = { delegateToBackground };
