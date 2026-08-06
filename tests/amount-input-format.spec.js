const { test, expect } = require('@playwright/test');

test('amount input reformats on deletion and keeps the caret', async ({ page }) => {
    await page.goto('/bill.html');
    await page.waitForFunction(() => typeof window.FluxyAmountInput === 'object', { timeout: 30000 });

    const r = await page.evaluate(() => {
        const input = document.createElement('input');
        input.type = 'text';
        document.body.appendChild(input);
        const run = (value, caret) => {
            input.value = value;
            input.setSelectionRange(caret, caret);
            window.FluxyAmountInput.format(input);
            return { value: input.value, caret: input.selectionStart };
        };
        const out = {
            // The reported bug: deleting a digit from a pre-filled "89.500.000"
            // left the original dots stranded. Must reflow to valid grouping.
            stranded: run('8000.000', 2),
            typing: run('8500000', 7),
            short: run('80', 2),
            empty: run('', 0),
            caretMid: run('89500000', 3),
            junk: run('8a5b0c0', 7),
            raw: window.FluxyAmountInput.value({ value: '8.000.000' })
        };
        input.remove();
        return out;
    });

    expect(r.stranded.value).toBe('8.000.000');
    expect(r.typing.value).toBe('8.500.000');
    expect(r.short.value).toBe('80');
    expect(r.empty.value).toBe('');
    expect(r.junk.value).toBe('8.500');       // non-digits dropped, order kept
    expect(r.raw).toBe(8000000);
    // Caret counted in DIGITS: 3 digits ("895") sit at index 4 of "89.500.000".
    expect(r.caretMid.value).toBe('89.500.000');
    expect(r.caretMid.caret).toBe(4);
});
