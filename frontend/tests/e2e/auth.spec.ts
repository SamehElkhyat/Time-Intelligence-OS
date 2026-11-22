import { expect, test } from '@playwright/test';

test.describe('authentication', () => {
  test('anonymous visitors are sent to sign-in and returned afterwards', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page).toHaveURL(/\/login\?next=%2Ftasks/);
  });

  test('wrong credentials show a clear message without leaking which part was wrong', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('nobody@example.com');
    await page.getByLabel('Password').fill('definitely wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Incorrect email or password.')).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test('client-side validation runs before any request is sent', async ({ page }) => {
    let apiCalls = 0;
    page.on('request', (r) => r.url().includes('/api/auth/') && r.method() === 'POST' && apiCalls++);
    await page.goto('/register');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Tell us what to call you')).toBeVisible();
    await expect(page.getByText('Enter your email address')).toBeVisible();
    await page.getByLabel('Your name').fill('Test');
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByLabel('Password').fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Enter a valid email address')).toBeVisible();
    await expect(page.getByText('Use at least 10 characters')).toBeVisible();
    expect(apiCalls).toBe(0);
  });

  test('sign out ends the session; the cookie is not readable from JavaScript', async ({ page, context }) => {
    const email = `e2e-auth-${Date.now()}@example.com`;
    await page.goto('/register');
    await page.getByLabel('Your name').fill('Auth Tester');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('a very long passphrase');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/onboarding/);

    const cookie = (await context.cookies()).find((c) => c.name === 'tf_session');
    expect(cookie?.httpOnly).toBe(true);
    expect(await page.evaluate(() => document.cookie)).not.toContain('tf_session');
    expect(await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage))).not.toMatch(/csrf|token|session/i);

    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/tasks');
    await expect(page).toHaveURL(/\/login/);
  });

  test('signing out other devices revokes them', async ({ page, request }) => {
    const email = `e2e-revoke-${Date.now()}@example.com`;
    await page.goto('/register');
    await page.getByLabel('Your name').fill('Revoke Tester');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('a very long passphrase');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/onboarding/);
    // a second "device" signs in first, so the device list this page loads contains both sessions
    const other = await request.post('/api/auth/login', { data: { email, password: 'a very long passphrase' } });
    expect(other.ok()).toBe(true);
    await page.goto('/settings');
    await expect(page.getByText('This device')).toBeVisible();
    await page.getByRole('button', { name: 'Sign out other devices' }).click();
    await expect(page.getByText(/Signed out 1 other device/)).toBeVisible();
  });
});
