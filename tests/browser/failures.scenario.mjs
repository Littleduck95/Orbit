import fs from 'node:fs';
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

  // ---- fixed (H2): stored people that cannot be parsed are set aside, not lost ----
  {
    const RAW = '{"this is": "cut off';
    const { page, open, done } = await newPage({ seed: { 'crm-people-v1': RAW, 'crm-events-v1': [{ id: 'e', title: 'Kept', date: '2026-01-01', people: [] }] } });
    await open();
    const banner = page.getByRole('status').filter({ hasText: 'could not be read exactly as saved' });
    check('unreadable people load as empty, with a warning naming them', await page.getByRole('heading', { name: 'No one here yet' }).isVisible()
      && (await banner.innerText()).includes('Some saved people could not be read'));
    const aside = await page.evaluate(() => localStorage.getItem('orbit:crm-people-v1-set-aside'));
    check('the original text is set aside before anything can save over it', JSON.stringify(JSON.parse(aside)) === JSON.stringify([RAW]), aside);
    check('other lists load as normal', await page.evaluate(() => JSON.parse(localStorage.getItem('orbit:crm-events-v1')).length) === 1
      && !(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('orbit:crm-events-v1-')))));
    const [dl] = await Promise.all([page.waitForEvent('download'), banner.getByRole('button', { name: 'Download the original' }).click()]);
    check('the original can be downloaded from the warning', JSON.parse(fs.readFileSync(await dl.path(), 'utf8'))['crm-people-v1'] === RAW);
    await banner.getByRole('button', { name: 'OK' }).click();
    check('the warning can be dismissed', (await banner.count()) === 0);
    await page.getByRole('button', { name: 'Add someone' }).click();
    await page.getByLabel('Name', { exact: true }).fill('New Person');
    await page.getByRole('button', { name: 'Add to list' }).click();
    const [main, kept] = await page.evaluate(() => [localStorage.getItem('orbit:crm-people-v1'), localStorage.getItem('orbit:crm-people-v1-set-aside')]);
    check('saving afterwards works, and the set-aside original survives it', main.includes('New Person') && JSON.parse(kept)[0] === RAW);
    await page.evaluate((raw) => localStorage.setItem('orbit:crm-people-v1', raw), RAW);
    await page.reload();
    await page.waitForSelector('button:has-text("Recap")');
    await page.reload();
    await page.waitForSelector('button:has-text("Recap")');
    check('the same unreadable text is kept once, however often it loads',
      JSON.parse(await page.evaluate(() => localStorage.getItem('orbit:crm-people-v1-set-aside'))).length === 1);
    await done();
  }

  // ---- fixed (H2): a stored value that is not a list ----
  {
    const { page, open, done } = await newPage({ seed: { 'crm-collections-v1': { name: 'not an array' } } });
    await open();
    check('a saved value that is not a list is set aside with a warning too',
      (await page.getByRole('status').filter({ hasText: 'Some saved lists could not be read' }).count()) === 1
        && JSON.parse(await page.evaluate(() => localStorage.getItem('orbit:crm-collections-v1-set-aside')))[0] === '{"name":"not an array"}');
    await done();
  }

  // ---- fixed (H2): with no room to keep the original, that list is not saved over ----
  {
    const RAW = '[{"name": "cut';
    const { page, open, done } = await newPage({ seed: { 'crm-people-v1': RAW } });
    await page.addInitScript(() => {
      const real = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(k, v) {
        if (String(k).endsWith('-set-aside')) throw new Error('QuotaExceededError');
        return real.call(this, k, v);
      };
    });
    await open();
    const banner = page.getByRole('status').filter({ hasText: 'could not be read' });
    check('the warning says changes to that list are not being saved', (await banner.innerText())
      .includes('There was no room to keep that copy, so to keep the original safe, changes to your people are not being saved.'));
    await page.getByRole('button', { name: 'Add someone' }).click();
    await page.getByLabel('Name', { exact: true }).fill('New Person');
    await page.getByRole('button', { name: 'Add to list' }).click();
    check('a change still shows but is not saved, and says why',
      await page.getByText('was not saved, so the unreadable copy described above is not lost').isVisible()
        && (await page.evaluate(() => localStorage.getItem('orbit:crm-people-v1'))) === RAW);
    await Promise.all([page.waitForEvent('download'), banner.getByRole('button', { name: 'Download the original' }).click()]);
    await page.getByRole('button', { name: 'Add someone' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Second Person');
    await page.getByRole('button', { name: 'Add to list' }).click();
    check('downloading the original does not by itself start saving over it (the hold lasts the visit)',
      (await page.evaluate(() => localStorage.getItem('orbit:crm-people-v1'))) === RAW);
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
    check('and since it had to be repaired, the original is set aside with a warning',
      (await page.getByRole('status').filter({ hasText: 'Some saved people could not be read' }).count()) === 1
        && JSON.parse(await page.evaluate(() => localStorage.getItem('orbit:crm-people-v1-set-aside')))[0].includes('"log":"oops"'));
    await done();
  }

  // ---- H1: any other crash shows a way out, with the data intact ----
  {
    const people = [{ id: 'a', name: 'Ann Boyer', circle: 'friend', tier: 'friend', cadence: 30, birthday: '1990-10-02', log: [] }];
    const { page, open, done } = await newPage({ seed: { 'crm-people-v1': people, 'crm-theme-v1': 'orbit' } });
    await open();
    const before = await page.evaluate(() => ({ ...localStorage }));
    // Break something the app calls while drawing, then make it redraw.
    await page.evaluate(() => { Date.prototype.getFullYear = () => { throw new Error('planted crash'); }; });
    await page.getByRole('button', { name: 'Mark Ann Boyer as a VIP' }).click();
    await page.waitForSelector('text=Orbit hit a problem showing your data');
    check('a crash shows the recovery screen instead of a blank page',
      await page.getByRole('alert').isVisible() && await page.getByText('Nothing you saved has been deleted.').isVisible());
    check('it says what went wrong, folded away', (await page.locator('details pre').textContent()).includes('planted crash')
      && !(await page.locator('details').evaluate((d) => d.open)));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download a copy' }).click()]);
    const copy = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
    const after = await page.evaluate(() => ({ ...localStorage }));
    check('the copy holds every saved value exactly as stored', Object.keys(copy).length > 0
      && Object.entries(copy).every(([k, v]) => after[`orbit:${k}`] === v) && copy['crm-theme-v1'] === 'orbit');
    check('the recovery screen changes nothing that was saved, beyond the tap that crashed',
      Object.keys(after).sort().join() === Object.keys(before).sort().join()
        && JSON.parse(after['orbit:crm-people-v1'])[0].vip === true);
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.waitForSelector('button:has-text("Recap")');
    check('Try again reloads into a working app', (await page.locator('.crm-person').count()) === 1);
    await done({ allow: /planted crash|error occurred in the|above error occurred|React will try to recreate/ });
  }
}
