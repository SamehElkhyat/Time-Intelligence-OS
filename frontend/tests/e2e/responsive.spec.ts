import { expect, test } from '@playwright/test';

/** Mobile layout: no horizontal page scroll, navigation reachable through the drawer. */
test('mobile layout works for the main screens', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('Your name').fill('Mobile Tester');
  await page.getByLabel('Email').fill(`e2e-mobile-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('a very long passphrase');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/onboarding/);
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page).toHaveURL('/');

  for (const path of ['/', '/tasks', '/activities', '/availability', '/analytics', '/timeline']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
  }

  // the sidebar is hidden on small screens; the drawer provides the same navigation
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Tasks', exact: true }).click();
  await expect(page).toHaveURL(/\/tasks/);
});
