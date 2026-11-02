import { test, expect } from '@playwright/test';

test.describe('AEGIS Console — Audit Investigation & Evidence Trail', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/audit');
  });

  test('should display audit timeline and evidence status notice', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Audit Investigation & Evidence Trail' })).toBeVisible();
    await expect(page.getByText('Evidence Status:')).toBeVisible();
    await expect(page.getByText('Chronological Event Timeline')).toBeVisible();
  });

  test('should filter events by free-text search query', async ({ page }) => {
    const searchInput = page.getByPlaceholder('Search by Correlation ID, Event ID, Decision ID, or Agent...');
    await searchInput.fill('cs-support-agent');

    // Matching event rows should be visible
    await expect(page.getByText('cs-support-agent').first()).toBeVisible();
  });

  test('should inspect event evidence dossier on row click', async ({ page }) => {
    const firstRow = page.locator('tbody tr').first();
    await firstRow.click();

    await expect(page.getByText('Event Evidence Dossier')).toBeVisible();
    await expect(page.getByText('Event UUID:')).toBeVisible();
    await expect(page.getByText('Metadata Payload & Evidence:')).toBeVisible();
  });
});
