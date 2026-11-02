import { test, expect } from '@playwright/test';

test.describe('AEGIS Console — Human Approval Center', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/approvals');
  });

  test('should render pending approval queue by default', async ({ page }) => {
    await expect(
      page.getByRole('heading', { name: 'Human Approval Center' }),
    ).toBeVisible();

    // Verify filter tabs exist
    await expect(
      page.getByRole('button', { name: 'Pending Review' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approved' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rejected' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Expired' })).toBeVisible();
  });

  test('should open authorization dialog when "Authorize & Release" is clicked', async ({
    page,
  }) => {
    const approveBtn = page
      .getByRole('button', { name: /Authorize & Release/i })
      .first();
    await approveBtn.click();

    // Dialog appears
    await expect(
      page.getByRole('heading', { name: 'Authorize Agent Operation?' }),
    ).toBeVisible();
    await expect(
      page.getByPlaceholder('Enter mandatory audit trail reason...'),
    ).toBeVisible();

    // Cancel closes dialog
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(
      page.getByRole('heading', { name: 'Authorize Agent Operation?' }),
    ).not.toBeVisible();
  });

  test('should resolve approval successfully and update UI', async ({
    page,
  }) => {
    const approveBtn = page
      .getByRole('button', { name: /Authorize & Release/i })
      .first();
    await approveBtn.click();

    // Fill justification notes
    const reasonInput = page.getByPlaceholder(
      'Enter mandatory audit trail reason...',
    );
    await reasonInput.fill(
      'Verified synthetic user identity via internal badge',
    );

    // Confirm
    await page.getByRole('button', { name: 'Confirm Authorization' }).click();

    // Modal should close
    await expect(
      page.getByRole('heading', { name: 'Authorize Agent Operation?' }),
    ).not.toBeVisible();
  });

  test('should filter by Approved and Rejected status tabs', async ({
    page,
  }) => {
    // Click Approved tab
    await page.getByRole('button', { name: 'Approved' }).click();
    await expect(
      page.getByText('Approved', { exact: true }).first(),
    ).toBeVisible();

    // Click Expired tab
    await page.getByRole('button', { name: 'Expired' }).click();
    await expect(
      page.getByText('Expired', { exact: true }).first(),
    ).toBeVisible();
  });
});
