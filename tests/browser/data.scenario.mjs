// Settings that persist, backup and restore, and CSV in and out.
import fs from 'node:fs';
import path from 'node:path';

const DANA = { id: 'dana', name: 'Dana Whitfield', circle: 'friend', tier: 'friend', cadence: 30, email: 'dana@example.com', log: [] };

export default async function data({ newPage, check, shots }) {
  const { page, open, stored, done } = await newPage({
    seed: {
      'crm-people-v1': [DANA],
      'crm-events-v1': [{ id: 'e1', title: 'Moved', date: '2026-06-03', people: ['dana'], lat: 39.7, lon: -104.9 }],
      'crm-reminders-v1': [{ id: 'r1', title: 'Pay the card', kind: 'Money', next: '2026-10-15', every: { unit: 'month', n: 1, dom: 15 }, anchor: 'date', lead: 3 }],
      'crm-collections-v1': [{ id: 'l1', name: 'Books', kind: 'Books', items: [{ id: 'i1', title: 'Dune' }] }],
    },
  });
  await open();

  // ---- your name and the theme persist ----
  await page.getByRole('button', { name: 'Orbit', exact: true }).first().click();
  await page.getByPlaceholder('Your name').fill('Chris');
  await page.getByPlaceholder('Your name').press('Enter');
  check('a name ending in s gets an apostrophe only', await page.getByRole('button', { name: "Chris' Orbit" }).isVisible());
  await page.getByRole('button', { name: 'Orbit', exact: true }).last().click();
  const bg = await page.locator('.crm-shell').evaluate((el) => getComputedStyle(el.parentElement).backgroundColor);
  check('the Orbit theme turns the page dark', bg === 'rgb(8, 13, 26)', bg);
  await page.reload();
  await page.waitForSelector('button:has-text("Recap")');
  check('name and theme survive a reload', await page.getByRole('button', { name: "Chris' Orbit" }).isVisible()
    && (await page.locator('.crm-shell').evaluate((el) => getComputedStyle(el.parentElement).backgroundColor)) === 'rgb(8, 13, 26)');
  check('they are stored as plain text', (await page.evaluate(() => [localStorage.getItem('orbit:crm-owner-v1'), localStorage.getItem('orbit:crm-theme-v1')])).join() === 'Chris,orbit');

  // ---- backup ----
  await page.getByRole('button', { name: 'Back up' }).click();
  const backup = JSON.parse(await page.locator('textarea[readonly]').inputValue());
  check('a backup holds people, events, reminders and lists, and not the name or theme',
    JSON.stringify(Object.keys(backup)) === '["people","events","reminders","collections"]'
      && backup.people.length === 1 && backup.events.length === 1 && backup.reminders.length === 1 && backup.collections.length === 1);
  await page.getByRole('button', { name: 'Hide backup' }).click();

  // ---- restore ----
  const restore = async (text) => {
    await page.getByRole('button', { name: 'Restore' }).click();
    await page.getByPlaceholder('Paste here').fill(text);
    await page.getByRole('button', { name: 'Replace my lists' }).click();
  };
  await restore('not a backup');
  check('an unreadable backup is refused and nothing changes', await page.getByText('That backup could not be read.').isVisible()
    && (await stored('crm-people-v1')).length === 1);
  await page.getByRole('button', { name: 'Cancel restore' }).click();

  await restore(JSON.stringify([{ name: 'Old Format' }, { name: '' }, { nope: 1 }, { name: 42 }]));
  check('an old backup (a bare list of people) restores, keeping only named people',
    JSON.stringify((await stored('crm-people-v1')).map((p) => p.name)) === '["Old Format"]');
  check('CURRENT: restoring an old backup empties events, reminders and lists',
    (await stored('crm-events-v1')).length === 0 && (await stored('crm-reminders-v1')).length === 0 && (await stored('crm-collections-v1')).length === 0);

  await restore(JSON.stringify(backup));
  check('a full backup restores everything', (await stored('crm-people-v1'))[0].id === 'dana'
    && (await stored('crm-events-v1')).length === 1 && (await stored('crm-reminders-v1')).length === 1 && (await stored('crm-collections-v1')).length === 1);

  // ---- CSV export ----
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByLabel(/^Catch-up log/).check();
  const files = {};
  page.on('download', async (d) => { files[d.suggestedFilename()] = d; });
  await page.getByRole('button', { name: 'Export CSV' }).click();
  await page.waitForTimeout(500);
  const names = Object.keys(files).sort();
  check('export writes one dated file per kind of record', JSON.stringify(names) === JSON.stringify([
    'orbit-catch-ups-2026-09-22.csv', 'orbit-events-2026-09-22.csv', 'orbit-lists-2026-09-22.csv',
    'orbit-people-2026-09-22.csv', 'orbit-reminders-2026-09-22.csv']), names);
  const read = async (name) => { const p = path.join(shots, name); await files[name].saveAs(p); return fs.readFileSync(p, 'utf8'); };
  const peopleCsv = await read('orbit-people-2026-09-22.csv');
  check('the people file starts with the basic columns', peopleCsv.startsWith('Name,Also known as,List,Closeness,Relation,Role,Company,Birthday,Age,Email'));
  check('the events file keeps coordinates as numbers', (await read('orbit-events-2026-09-22.csv')).includes(',39.7,-104.9,'));
  check('the text is also shown, in case the download was blocked', (await page.locator('textarea[readonly]').inputValue()).includes('### people'));
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  // ---- CSV import: people, events and reminders are told apart ----
  const importFile = async (name, text) => {
    const p = path.join(shots, name);
    fs.writeFileSync(p, text);
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    await page.locator('input[type=file]').setInputFiles(p);
    await page.waitForSelector('text=ready');
    return (await page.locator('.crm-full').innerText()).replace(/\s+/g, ' ');
  };
  let seen = await importFile('people.csv', 'Name,Email\nZed Park,zed@example.com\n,nobody@example.com\n');
  check('a plain sheet of names is read as people, skipping rows with no name',
    seen.includes('1 people ready') && seen.includes('1 row skipped for having no name'), seen);
  await page.getByRole('button', { name: 'Add 1 people' }).click();
  check('adding keeps who was already there', (await stored('crm-people-v1')).length === 2);

  seen = await importFile('events-date.csv', 'Title,Date,Place\nParty,2026-10-01,Home\n');
  check('CURRENT: a sheet with a Date column is taken for events, then every row is skipped for having no date',
    seen.includes('0 events ready') && seen.includes('1 row skipped for having no title or date'), seen);
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  seen = await importFile('events.csv', 'Title,Start,Place\nParty,2026-10-01,Home\n');
  check('a sheet with Title and Start is read as events', seen.includes('1 events ready'), seen);
  await page.getByLabel('Replace everything').check();
  await page.getByRole('button', { name: 'Replace 1 events' }).click();
  check('replacing swaps out the events', JSON.stringify((await stored('crm-events-v1')).map((e) => e.title)) === '["Party"]');

  seen = await importFile('reminders.csv', 'Title,Next due,Repeat every,Repeat unit\nFilter,2026-12-01,3,months\nBad,someday,1,month\n');
  check('a sheet with Next due is read as reminders, skipping unreadable dates',
    seen.includes('1 reminders ready') && seen.includes('1 row skipped'), seen);
  await page.getByRole('button', { name: 'Add 1 reminders' }).click();
  const filter = (await stored('crm-reminders-v1')).find((r) => r.title === 'Filter');
  check('an imported repeat is read back', filter.every.unit === 'month' && filter.every.n === 3 && filter.every.dom === 1, filter);

  await importFile('odd.csv', 'Name,Birthday,Check in days\nOdd Date,March 3,often\n');
  await page.getByRole('button', { name: 'Add 1 people' }).click();
  const odd = (await stored('crm-people-v1')).find((p) => p.name === 'Odd Date');
  check('CURRENT: people import keeps a birthday and cadence it cannot read', odd.birthday === 'March 3' && odd.cadence === null, odd);
  await page.getByRole('button', { name: 'Everyone', exact: false }).first().click();
  await page.locator('.crm-person .crm-row', { hasText: 'Odd Date' }).click();
  check('CURRENT: and then shows "Invalid Date" on their card', await page.getByText('Invalid Date').first().isVisible());

  await done();
}
