import { test, expect } from '@playwright/test';

test.describe('AEGIS Console — Accessibility & Responsive UX', () => {
  test('should support keyboard navigation across sidebar links', async ({ page }) => {
    await page.goto('/');

    // Focus on Overview nav link
    const overviewLink = page.getByRole('link', { name: 'Overview' });
    await overviewLink.focus();
    await expect(overviewLink).toBeFocused();

    // Tab to next item (Agent Activity)
    await page.keyboard.press('Tab');
    const activityLink = page.getByRole('link', { name: 'Agent Activity' });
    await expect(activityLink).toBeFocused();
  });

  test('should toggle mobile menu drawer on compact viewports', async ({ page }) => {
    // Set viewport to mobile size
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');

    // Hamburger button should be visible
    const menuBtn = page.getByRole('button', { name: 'Toggle navigation menu' });
    await expect(menuBtn).toBeVisible();
    await menuBtn.click();

    // Drawer should appear with close button
    const closeBtn = page.getByRole('button', { name: 'Close navigation menu' });
    await expect(closeBtn).toBeVisible();

    // Close drawer
    await closeBtn.click();
    await expect(closeBtn).not.toBeVisible();
  });

  test('should provide clean 404 recovery state', async ({ page }) => {
    await page.goto('/non-existent-page-route');
    await expect(page.getByText('Page Not Found', { exact: false })).toBeVisible();
    await expect(page.getByRole('link', { name: /Return to Overview/i })).toBeVisible();
  });
});
