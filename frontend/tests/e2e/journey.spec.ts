import { expect, test, type Page } from '@playwright/test';

/** `YYYY-MM-DDTHH:mm` for a datetime-local input, in the browser's (and therefore the user's) time zone. */
function localInput(daysAhead: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(hour)}:${p(minute)}`;
}

async function register(page: Page, label: string) {
  const email = `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Your name').fill('E2E Tester');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a very long passphrase');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  return email;
}

/** Reads "HH:MM:SS" shown by the timer into seconds. */
async function clockSeconds(page: Page): Promise<number> {
  const label = await page.getByLabel(/^Elapsed \d\d:\d\d:\d\d$/).first().getAttribute('aria-label');
  const [h, m, s] = label!.replace('Elapsed ', '').split(':').map(Number);
  return h! * 3600 + m! * 60 + s!;
}

test('complete user journey: plan, track, decide, review', async ({ page }) => {
  // 1 ─ register
  await register(page, 'journey');

  // 2 ─ configure preferences through onboarding
  await expect(page.getByRole('heading', { name: /Welcome, E2E/ })).toBeVisible();
  await page.getByLabel('My day starts').fill('07:00');
  await page.getByLabel('My day ends').fill('23:00');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Daily focus goal (hours)').fill('3');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Go to my dashboard' }).click();
  await expect(page).toHaveURL('/');

  // a new account gets an honest empty state, not fake numbers
  await expect(page.getByText(/Your day starts empty/)).toBeVisible();
  await expect(page.getByText('Right now')).toHaveCount(0);

  // 3 ─ create activities
  await page.goto('/activities');
  await expect(page.getByText('No activities yet')).toBeVisible();
  for (const [title, category, hour] of [
    ['Write project brief', 'Work', 9],
    ['Learn TypeScript generics', 'Learning', 14],
  ] as const) {
    await page.getByRole('button', { name: 'New activity' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New activity' });
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByLabel('Category').selectOption({ label: category });
    await dialog.getByLabel('Starts').fill(localInput(1, hour));
    await dialog.getByLabel('Ends').fill(localInput(1, hour + 1));
    await dialog.getByRole('button', { name: 'Create activity' }).click();
    await expect(page.getByRole('link', { name: title })).toBeVisible();
  }

  // validation: an activity cannot end before it starts
  await page.getByRole('button', { name: 'New activity' }).first().click();
  const bad = page.getByRole('dialog', { name: 'New activity' });
  await bad.getByLabel('Title').fill('Impossible');
  await bad.getByLabel('Category').selectOption({ label: 'Work' });
  await bad.getByLabel('Starts').fill(localInput(1, 11));
  await bad.getByLabel('Ends').fill(localInput(1, 10));
  await bad.getByRole('button', { name: 'Create activity' }).click();
  await expect(bad.getByText('The end must be after the start')).toBeVisible();
  await page.keyboard.press('Escape');

  // 4 ─ start a timer, and prove it survives a refresh
  await page.goto('/time-tracking');
  await page.getByLabel('Activity to track').selectOption({ label: 'Write project brief' });
  await page.getByRole('button', { name: 'Start', exact: true }).first().click();
  await expect(page.getByLabel(/^Elapsed /).first()).toBeVisible();
  await page.waitForTimeout(3200);
  const before = await clockSeconds(page);
  expect(before).toBeGreaterThanOrEqual(2); // the clock repaints once per second
  await page.reload();
  await expect(page.getByLabel(/^Elapsed /).first()).toBeVisible();
  const after = await clockSeconds(page);
  expect(after).toBeGreaterThanOrEqual(before); // recovered from stored timestamps, not restarted from zero
  // the topbar shows what is being tracked on every page
  await page.goto('/tasks');
  await expect(page.getByRole('status').filter({ hasText: 'Write project brief' })).toBeVisible();
  await page.goto('/time-tracking');
  await page.getByRole('button', { name: 'Stop timer options' }).first().click();
  await page.getByRole('menuitem', { name: 'Stop timer', exact: true }).click();
  await expect(page.getByText('No tracked time yet')).toHaveCount(0);
  await expect(page.getByRole('listitem').filter({ hasText: 'Write project brief' })).toBeVisible(); // appears in the history

  // 5 ─ create tasks
  await page.goto('/tasks');
  for (const [title, minutes, priority] of [
    ['Reply to client emails', '20', 'Low'],
    ['Prepare quarterly report', '45', 'High'],
  ] as const) {
    await page.getByRole('button', { name: 'New task' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New task' });
    await dialog.getByLabel('Title').fill(title);
    await dialog.getByLabel('Estimate (minutes)').fill(minutes);
    await dialog.getByLabel('Priority').selectOption({ label: priority });
    await dialog.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByRole('link', { name: title })).toBeVisible();
  }

  // 6 ─ add a recurring scheduled commitment
  await page.goto('/schedule');
  await page.getByRole('tab', { name: 'Recurring' }).click();
  await page.getByRole('button', { name: 'New recurring commitment' }).click();
  const rec = page.getByRole('dialog', { name: 'New recurring commitment' });
  await rec.getByLabel('Title').fill('Daily stand-up');
  await rec.getByLabel('Category').selectOption({ label: 'Meetings' });
  await rec.getByLabel('Starts at').fill('09:00');
  await rec.getByLabel('Duration (minutes)').fill('15');
  await rec.getByRole('button', { name: 'Add commitment' }).click();
  await expect(page.getByText('Daily stand-up')).toBeVisible();

  // 7 ─ calculate available time (tomorrow, so the result does not depend on the current hour)
  await page.goto('/availability');
  await expect(page.getByText('The whole day, classified')).toBeVisible();
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.getByText('Tomorrow')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Free windows' })).toBeVisible();
  // an empty-but-planned day still has windows; each states an explicit confidence level
  await expect(page.getByText(/confidence/).first()).toBeVisible();
  await expect(page.getByText(/free$/).first()).toBeVisible();

  // 8 ─ generate recommendations and see the reasoning
  await page.goto('/recommendations');
  await page.getByLabel('I have (minutes)').fill('90');
  await page.getByRole('button', { name: 'Recommend' }).click();
  const firstCard = page.getByText(/^Recommended because/).first();
  await expect(firstCard).toBeVisible();
  // the top recommendation is expanded: every factor behind the score is visible
  await expect(page.getByText('Deadline urgency').first()).toBeVisible();
  await expect(page.getByText('Fit to free time').first()).toBeVisible();

  // 9 ─ complete a task
  await page.goto('/tasks');
  await page.getByRole('checkbox', { name: 'Complete Reply to client emails' }).click();
  await expect(page.getByText('Task completed')).toBeVisible();
  await page.getByRole('radio', { name: 'Completed' }).click();
  await expect(page.getByRole('link', { name: 'Reply to client emails' })).toBeVisible();

  // 10 ─ review productivity analytics, computed from what was just tracked
  await page.goto('/analytics');
  await expect(page.getByRole('heading', { name: 'Productivity analytics' })).toBeVisible();
  await expect(page.getByText('Productive time', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: '7 days' }).click();
  await expect(page.getByText('Where the time went')).toBeVisible();

  // the dashboard now shows real, non-empty data
  await page.goto('/');
  await expect(page.getByText('Smart availability')).toBeVisible();
  await expect(page.getByText(/Your day starts empty/)).toHaveCount(0);
});
