// e2e/flow.spec.ts
//
// Playwright smoke for the 7-station happy path. Skipped at MVP — depends on
// real browser context with WebGPU/CLIP weights cached + the HD-2D adapter
// (goal #12). When goal #12 lands, replace the test.skip() guards with the
// real navigation steps and assertions below.

import { test, expect } from '@playwright/test';

test.skip(
	'storybook workshop happy path: kid-picker → s1..s7 → free digital download',
	async ({ page }) => {
		await page.goto('/');
		// New kid
		await page.getByRole('button', { name: '+ New Hero' }).click();
		await page.getByLabel('Name').fill('Eli');
		await page.getByLabel('Birthday').fill('2021-01-01');
		await page.getByRole('button', { name: 'Add hero' }).click();

		// Station 1
		await page.getByRole('button', { name: /Bedtime/ }).click();
		await page.getByRole('button', { name: /^birthday$/ }).click();
		await page.getByRole('button', { name: 'Next →' }).click();

		// Station 2
		await page.locator('button.pillar').first().click();
		await page.getByRole('button', { name: 'Next →' }).click();

		// Station 3
		await page.locator('textarea').fill('Stay curious, Eli.');
		await page.getByRole('button', { name: 'Next →' }).click();

		// Station 4
		await page.locator('select').first().selectOption({ index: 1 });
		await page.getByRole('button', { name: 'Next →' }).click();

		// Station 5
		await page.getByRole('button', { name: /Octopath/ }).click();
		await page.getByRole('button', { name: 'Next →' }).click();

		// Station 6 — wait for generation + consent
		await expect(page.getByText(/sealed|shortcode/i)).toBeVisible({ timeout: 60_000 });
		await page.getByLabel(/reviewed every spread/i).check();
		await page.getByLabel(/can't return it/i).check();
		await page.getByRole('button', { name: /Seal it/ }).click();

		// Station 7
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			page.getByRole('button', { name: /Get the free digital book/ }).click(),
		]);
		expect(download.suggestedFilename()).toMatch(/^storybook-/);
	},
);

test.skip('draft resume via ?draftId=...', async () => {
	// Walks Station 1 → Station 2, then reloads with ?draftId=... and asserts
	// the orchestrator restores at Station 2 with prior outputs intact.
});

test.skip('consent gate blocks Station 7 until both boxes checked', async () => {
	// Drives the flow to Station 6, confirms the "Seal it" button stays
	// disabled until BOTH checkboxes are checked.
});

test.skip('library cascade-delete removes kid and all their drafts', async () => {
	// Creates kid, two drafts, navigates to /library, clicks "Delete kid",
	// asserts the page reflects zero drafts and zero kids.
});
