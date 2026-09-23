// What happens when things go wrong: a browser that refuses to save, stored
// data that cannot be read, and a backup with the wrong shape inside it.
// Most checks here are "CURRENT:" — they record risks the audit flagged.
export default async function failures({ newPage, check }) {
  // ---- a save the browser refuses is reported, not hidden ----
  {
    const { page, open, done } = await newPage({
      seed: { 'crm-people-v1': [{ id: 'dana', name: 'Dana Whitfield', circle: 'friend', tier: 'friend', cadence: 30, log: [] }] },
    });
    await open();
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); }; });
    await page.getByRole('button', { name: 'Log a catch-up with Dana Whitfield today' }).click();
    check('a refused save says the change did not save', await page.getByText('That change is showing here but did not save. Try again.').isVisible());
    check('and the change still shows on screen', (await page.locator('.crm-person', { hasText: 'Dana Whitfield' }).innerText()).includes('today'));
    await done();
  }

  // ---- stored people that cannot be parsed ----
  {
    const { page, open, done } = await newPage({ seed: { 'crm-people-v1': '{"this is": "cut off' } });
    await open();
    check('CURRENT: unreadable stored people load as an empty list, with no warning',
      await page.getByRole('heading', { name: 'No one here yet' }).isVisible());
    await page.getByRole('button', { name: 'Add someone' }).click();
    await page.getByLabel('Name', { exact: true }).fill('New Person');
    await page.getByRole('button', { name: 'Add to list' }).click();
    const raw = await page.evaluate(() => localStorage.getItem('orbit:crm-people-v1'));
    check('CURRENT: the next save overwrites the unreadable data for good', raw.startsWith('[{') && raw.includes('New Person') && !raw.includes('cut off'));
    await done();
  }

  // ---- stored people that parse but are not a list ----
  {
    const { page, open, done } = await newPage({ seed: { 'crm-people-v1': { name: 'not an array' } } });
    await open();
    check('CURRENT: a stored value that is not a list also loads as empty', await page.getByRole('heading', { name: 'No one here yet' }).isVisible());
    await done();
  }

  // ---- a backup whose people have the wrong shape inside ----
  {
    const { page, open, problems, done } = await newPage({
      seed: { 'crm-people-v1': [{ id: 'dana', name: 'Dana Whitfield', circle: 'friend', tier: 'friend', cadence: 30, log: [] }] },
    });
    await open();
    await page.getByRole('button', { name: 'Restore' }).click();
    const good = Array.from({ length: 3 }, (_, i) => ({ id: `g${i}`, name: `Good ${i}`, addedOn: '2026-01-01', log: [] }));
    await page.getByPlaceholder('Paste here').fill(JSON.stringify({ people: [...good, { id: 'x', name: 'Bad Shape', log: 'oops' }] }));
    await page.getByRole('button', { name: 'Replace my lists' }).click();
    await page.waitForTimeout(300);
    check('CURRENT: restoring a person whose log is not a list blanks the whole app',
      (await page.locator('#root').innerHTML()) === '' && problems.some((p) => /forEach is not a function/.test(p)), problems);
    check('CURRENT: the restored data was saved before the crash', (await page.evaluate(() => localStorage.getItem('orbit:crm-people-v1'))).includes('Bad Shape'));
    await page.reload();
    await page.waitForSelector('button:has-text("Recap")');
    check('CURRENT: after a reload the loader gives up on the whole list, so every good person vanishes too',
      await page.getByRole('heading', { name: 'No one here yet' }).isVisible());
    await page.getByRole('button', { name: 'Add someone' }).click();
    await page.getByLabel('Name', { exact: true }).fill('After');
    await page.getByRole('button', { name: 'Add to list' }).click();
    check('CURRENT: and the next save erases them for good',
      !(await page.evaluate(() => localStorage.getItem('orbit:crm-people-v1'))).includes('Good 0'));
    await done({ allow: /forEach is not a function|error occurred in the|above error occurred/ });
  }

  // ---- the same bad shape, on a person the loader does not look inside ----
  {
    const { page, problems, done, url } = await newPage({
      seed: { 'crm-people-v1': [{ id: 'x', name: 'Bad Shape', addedOn: '2026-01-01', log: 'oops' }] },
    });
    // Not open(): that waits for the tabs, which never appear once it crashes.
    await page.goto(url);
    await page.waitForTimeout(800);
    check('CURRENT: a stored person with addedOn and a non-list log blanks the app on every load',
      (await page.locator('#root').innerHTML()) === '' && problems.some((p) => /forEach is not a function/.test(p)), problems);
    await done({ allow: /forEach is not a function|error occurred in the|above error occurred/ });
  }
}
