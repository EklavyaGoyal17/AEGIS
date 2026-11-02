import { test, expect } from '@playwright/test';

test.describe('AEGIS Console — Policy Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/policies');
  });

  test('should display policy catalog and safety notice', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Authorization Policy Management' })).toBeVisible();
    await expect(page.getByText('Policy Enforcement Safety Guardrail')).toBeVisible();

    // Verify existing pre-configured policies
    await expect(page.getByText('Allow Customer Data Reads')).toBeVisible();
    await expect(page.getByText('Block PII Exports')).toBeVisible();
  });

  test('should inspect policy details when a card is selected', async ({ page }) => {
    await page.getByText('Block PII Exports').click();
    await expect(page.getByText('Policy Inspector & AST')).toBeVisible();
    await expect(page.getByText('Underlying Policy JSON:')).toBeVisible();
  });

  test('should validate inputs in policy creation modal', async ({ page }) => {
    await page.getByRole('button', { name: 'New Policy Rule' }).click();
    await expect(page.getByRole('heading', { name: 'Create Structured Authorization Policy' })).toBeVisible();

    // Try submitting empty
    const submitBtn = page.getByRole('button', { name: 'Create & Deploy Policy' });
    await submitBtn.click();

    // Fill valid data
    await page.getByLabel('Policy Name').fill('Restrict Financial Accounts');
    await page.getByLabel('Description & Security Intent').fill('Disallow direct writes to ledger');
    await submitBtn.click();

    // Modal closes upon successful creation
    await expect(page.getByRole('heading', { name: 'Create Structured Authorization Policy' })).not.toBeVisible();
  });
});
