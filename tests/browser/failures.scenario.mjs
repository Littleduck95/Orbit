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

  // ---- fixed (H1): a backup whose people have the wrong shape inside ----
  {
    const { page, open, problems, done } = await newPage({
      seed: { 'crm-people-v1': [{ id: 'dana', name: 'Dana Whitfield', circle: 'friend', tier: 'friend', cadence: 30, log: [] }] },
    });
    await open();
    await page.getByRole('button', { name: 'Restore' }).click();
    const good = Array.from({ length: 3 }, (_, i) => ({ id: `g${i}`, name: `Good ${i}`, addedOn: '2026-01-01', log: [] }));
    const bad = { id: 'x', name: 'Bad Shape', log: 'oops', families: 'Boyer family', note: { text: 'x' }, birthday: 19900305,
      socials: { instagram: 42, x: { handle: 'no' } }, partner: 'Sam' };
    await page.getByPlaceholder('Paste here').fill(JSON.stringify({
      people: [...good, bad],
      events: [{ id: 'e', title: 'Trip', date: '2026-05-01', people: 'x', lat: '39.7', lon: -104.9, note: ['a'] }],
      reminders: [{ id: 'r', title: 'Filter', next: '2026-12-01', history: 'often', people: {}, every: 'monthly' }],
    }));
    await page.getByRole('button', { name: 'Replace my lists' }).click();
    await page.waitForTimeout(300);
    check('a backup with wrongly shaped fields restores without breaking the app',
      await page.getByRole('button', { name: 'Recap' }).isVisible() && problems.length === 0, problems);
    const people = await page.evaluate(() => JSON.parse(localStorage.getItem('orbit:crm-people-v1')));
    const fixed = people.find((p) => p.id === 'x');
    check('every person in it is kept', people.length === 4, people.map((p) => p.name));
    check('only the bad fields are repaired, to the empty values the app already uses',
      JSON.stringify([fixed.log, fixed.families, fixed.note, fixed.birthday, fixed.socials, fixed.partner])
        === JSON.stringify([[], [], '', '19900305', { instagram: '42', x: '' }, null]), fixed);
    check('well-formed people are stored exactly as they were',
      JSON.stringify(people.filter((p) => p.id !== 'x')) === JSON.stringify(good));
    const ev = (await page.evaluate(() => JSON.parse(localStorage.getItem('orbit:crm-events-v1'))))[0];
    const rm = (await page.evaluate(() => JSON.parse(localStorage.getItem('orbit:crm-reminders-v1'))))[0];
    check('events and reminders are repaired the same way',
      JSON.stringify([ev.people, ev.lat, ev.lon, ev.note, rm.history, rm.people, rm.every])
        === JSON.stringify([[], null, -104.9, '', [], [], null]), [ev, rm]);
    for (const tabName of ['Events', 'Reminders', 'Recap', 'People']) {
      await page.getByRole('button', { name: tabName, exact: true }).click();
    }
    await page.locator('.crm-person .crm-row', { hasText: 'Bad Shape' }).click();
    check('every tab and the repaired person\'s card draw without errors', problems.length === 0, problems);
    await page.reload();
    await page.waitForSelector('button:has-text("Recap")');
    check('after a reload everyone is still there', (await page.locator('.crm-person').count()) === 4);
    await done();
  }

  // ---- fixed (H1): the same bad shape already saved, on a person the old loader did not look inside ----
  {
    const { page, problems, done, url } = await newPage({
      seed: { 'crm-people-v1': [{ id: 'x', name: 'Bad Shape', addedOn: '2026-01-01', log: 'oops' },
        { id: 'y', name: 'Fine Person', addedOn: '2026-01-01', log: [] }, null, 'junk'] },
    });
    await page.goto(url);
    await page.waitForSelector('button:has-text("Recap")');
    check('a saved person with a history that is not a list loads, with everyone else',
      (await page.locator('.crm-person').count()) === 2 && problems.length === 0, problems);
    await done();
  }
}
