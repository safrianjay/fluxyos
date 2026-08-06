// @ts-check
const { test, expect, request } = require('@playwright/test');

// Attachment access control.
//
// The bug this pins: getDownloadURL() mints a URL carrying a token stored in the
// object's metadata, and Firebase serves it over public HTTPS with Storage
// Security Rules BYPASSED. Verified against production before the fix — a plain
// HTTP GET, no browser, no cookies, no auth, returned 200 and the whole file.
//
// The rules were never the problem; nothing consulted them on the path users
// actually fetched through. The fix is to stop minting links and read bytes via
// getBlob(), which sends the caller's ID token so storage.rules is enforced.

test('uploading a document mints no public URL', async ({ page }) => {
    await page.goto('/bill.html');
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, { timeout: 30000 });

    const r = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app); ds.actorUid = uid;

        const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const file = new File([bytes], 'access-test.png', { type: 'image/png' });
        const up = await ds.uploadDocument(uid, file, { bypassPlanLimit: true });

        // Authorised read still works, and returns a blob: URL — origin-bound,
        // dead when the tab closes, useless if pasted anywhere else.
        const objectUrl = await ds.getDocumentObjectURL(uid, up.storagePath);
        const blob = await ds.getDocumentBlob(uid, up.storagePath);

        return {
            downloadURL: up.downloadURL,
            storagePath: up.storagePath,
            objectUrlScheme: String(objectUrl).split(':')[0],
            blobBytes: blob.size,
            uploadReceiptRemoved: await (async () => {
                try { await ds.uploadReceipt(uid, file); return false; }
                catch (e) { return /removed/i.test(e.message); }
            })()
        };
    });

    // The whole point: nothing hands back a public link any more.
    expect(r.downloadURL).toBeNull();
    expect(r.objectUrlScheme).toBe('blob');
    expect(r.blobBytes).toBeGreaterThan(0);
    expect(r.uploadReceiptRemoved).toBe(true);
    expect(r.storagePath).toMatch(/^(workspaces|users)\/[^/]+\/documents\//);
});

test('a storage path cannot be read without auth', async ({ page }) => {
    await page.goto('/bill.html');
    await page.waitForFunction(() => window.FluxyWorkspace && window.FluxyWorkspace.id, { timeout: 30000 });

    const storagePath = await page.evaluate(async () => {
        const { getApps } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js');
        const { getAuth } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
        const DataService = (await import('/assets/js/db-service.js')).default;
        const app = getApps()[0];
        const uid = getAuth(app).currentUser.uid;
        const ds = new DataService(app); ds.actorUid = uid;
        const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
        const up = await ds.uploadDocument(uid, new File([bytes], 'no-auth.png', { type: 'image/png' }), { bypassPlanLimit: true });
        return up.storagePath;
    });

    // The unauthenticated media endpoint, exactly as an attacker would try it:
    // a plain HTTP client, no browser, no cookies, no token. Without a download
    // token in the object's metadata this must be refused.
    const bucket = 'fluxyos.firebasestorage.app';
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(storagePath)}?alt=media`;
    const anon = await request.newContext();
    const res = await anon.get(url);
    await anon.dispose();

    expect(res.status(), `unauthenticated GET must be refused, got ${res.status()}`).toBeGreaterThanOrEqual(400);
});

test('no code path mints a download URL any more', async ({ page }) => {
    await page.goto('/pricing');
    const src = await page.evaluate(async () => {
        const res = await fetch('/assets/js/db-service.js');
        return res.text();
    });
    // Only comments explaining WHY it is gone may mention it.
    const live = src
        .split('\n')
        .filter((l) => l.includes('getDownloadURL') && !l.trim().startsWith('//'));
    expect(live, `getDownloadURL still called: ${live.join(' | ')}`).toEqual([]);
});
