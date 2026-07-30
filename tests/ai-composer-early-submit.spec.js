// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Fluxy AI composer — submitting before the page has finished wiring the user.
 *
 * ai.html hands the signed-in user to the command center only after
 * `applyToPage()` resolves (workspace resolution + gate checks), which lands
 * ~1s after the prompt cards become clickable — longer on a slow connection.
 * A prompt submitted in that window used to fail outright with "AI chat history
 * is not ready yet" and the user had to retype it. The composer must wait for
 * the user instead of rejecting the prompt.
 */
test('a prompt clicked before auth lands is still answered', async ({ page }) => {
    // Canned backend answer so this test is about the client's readiness
    // handling, not the finance engine.
    await page.route('**/api/v1/brain/chat', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true, chat_id: null, intent: 'business_health', scope: 'project_finance',
                answer: {
                    intent: 'business_health', scope: 'project_finance', answer_type: 'analysis', confidence: 0.9,
                    period: { label: 'This month', start_date: '2026-07-01', end_date: '2026-07-31' },
                    direct_answer: 'Canned QA answer.',
                    key_numbers: [{ label: 'Revenue', value: 1000, formatted_value: 'Rp1.000', status: 'neutral' }],
                    insights: [], recommended_actions: [], limitations: [], follow_up_questions: [],
                },
                related_records: [], error: null,
            }),
        });
    });

    await page.goto('/ai.html');
    // Submit as soon as the UI offers a prompt card — deliberately BEFORE the
    // user handoff completes (that is the window this test guards).
    const card = page.locator('[data-prompt]').first();
    await card.waitFor({ state: 'visible', timeout: 30_000 });
    await card.click();

    // The prompt must be answered, not rejected.
    await expect(page.locator('#ai-chat-thread')).toContainText('Canned QA answer.', { timeout: 30_000 });
    const composerError = page.locator('#ai-composer-error');
    if (await composerError.count()) {
        await expect(composerError).toBeHidden();
    }
});
