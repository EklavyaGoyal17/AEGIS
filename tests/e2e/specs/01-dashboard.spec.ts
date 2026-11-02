import { test, expect } from '@playwright/test';

test.describe('AEGIS Console — Security Operations Overview', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should render the shell layout, environment indicator, and page title', async ({
    page,
    isMobile,
  }) => {
    // The persistent sidebar (brand) is desktop-only; mobile uses the drawer covered in spec 05.
    test.skip(isMobile, 'desktop sidebar layout');
    // Brand and title
    await expect(page.getByText('AEGIS', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Security Operations Console' }),
    ).toBeVisible();

    // Environment banner
    await expect(
      page.getByText('DEMO MODE — Using simulated data'),
    ).toBeVisible();

    // Health indicator
    await expect(page.getByLabel('All systems operational')).toBeVisible();
  });

  test('should display primary security KPI metrics', async ({ page }) => {
    await expect(
      page.getByText('Pending Approvals', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Blocked Actions', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Allowed Operations', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Active Policies', { exact: true }),
    ).toBeVisible();
  });

  test('should display urgent approval queue with action items', async ({
    page,
  }) => {
    await expect(page.getByText('Requires Human Approval')).toBeVisible();
    // Verify at least one pending approval row is displayed
    const resolveButtons = page.getByRole('button', {
      name: /Resolve Decision/i,
    });
    await expect(resolveButtons.first()).toBeVisible();
  });

  test('should display recent audit stream entries', async ({ page }) => {
    await expect(page.getByText('Audit Stream')).toBeVisible();
    await expect(
      page.getByText('cs-support-agent', { exact: false }),
    ).toBeVisible();
  });
});
