// Behaviour found by the audit, reproduced in the real app. Every check here
// is "CURRENT:": it records a bug as it behaves today, so that a fix changes
// this file deliberately rather than by accident.
import fs from 'node:fs';
import path from 'node:path';

const person = (id, name, over = {}) => ({ id, name, circle: 'friend', tier: 'friend', cadence: 30, log: [], ...over });

export default async function review({ newPage, check, shots }) {
  // ---- fixed (H3): the detail panel starts fresh for each person ----
  {
    const { page, open, stored, done } = await newPage({ seed: { 'crm-people-v1': [
      person('a', 'Alice Ames', { log: [{ date: '2026-09-01', text: 'Alice note' }], lastContact: '2026-09-01' }),
      person('b', 'Bob Byrne', { log: [{ date: '2026-08-01', text: 'Bob note' }], lastContact: '2026-08-01' }),
    ] } });
    await open();
    await page.locator('.crm-person .crm-row', { hasText: 'Alice Ames' }).click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await page.locator('.crm-person .crm-row', { hasText: 'Bob Byrne' }).click();
    check('an armed Remove does not carry over to the next person opened',
      await page.getByRole('button', { name: 'Remove', exact: true }).isVisible()
        && !(await page.getByRole('button', { name: 'Tap again to remove' }).isVisible()));
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    check('so one tap on the next person only arms it', (await stored('crm-people-v1')).some((p) => p.id === 'b'));

    await page.locator('.crm-person .crm-row', { hasText: 'Alice Ames' }).click();
    await page.getByRole('button', { name: /Alice note/ }).click();
    await page.getByPlaceholder('What came up?').fill('Typed for Alice');
    await page.locator('.crm-person .crm-row', { hasText: 'Bob Byrne' }).click();
    check('an open catch-up edit does not carry over either', (await page.getByPlaceholder('What came up?').count()) === 0);
    const after = await stored('crm-people-v1');
    check('and nothing typed for one person lands in another\'s history',
      after.find((p) => p.id === 'b').log[0].text === 'Bob note' && after.find((p) => p.id === 'a').log[0].text === 'Alice note');
    await done();
  }

  // ---- fixed (H4): editing someone with no reminder keeps it that way ----
  {
    const { page, open, stored, done } = await newPage({ seed: { 'crm-people-v1': [
      person('c', 'Cleo Cruz', { cadence: 0, lastContact: '2026-09-20' }),
      person('c2', 'Cy Cole', { cadence: '0', lastContact: '2026-09-20' }),
      { id: 'c3', name: 'Cam Cho', circle: 'friend', tier: 'friend', log: [] },
    ] } });
    await open();
    const cadenceAfterSave = async (name) => {
      await page.getByRole('button', { name: /^Everyone/ }).click();
      await page.locator('.crm-person .crm-row', { hasText: name }).click();
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      const shown = await page.getByLabel('Check in').inputValue();
      await page.getByRole('button', { name: 'Save changes' }).click();
      return [shown, (await stored('crm-people-v1')).find((p) => p.name === name).cadence];
    };
    const [shown, saved] = await cadenceAfterSave('Cleo Cruz');
    check('the form shows "no reminder" for someone set to no reminder', shown === '0', shown);
    check('saving without touching it keeps no reminder', saved === 0, saved);
    check('a "0" stored as text is kept as no reminder too', JSON.stringify(await cadenceAfterSave('Cy Cole')) === '["0",0]');
    check('a missing cadence still falls back to every few months', JSON.stringify(await cadenceAfterSave('Cam Cho')) === '["90",90]');
    await done();
  }

  // ---- a log edit lands on whichever entry now sits in that position ----
  {
    const log = [{ date: '2026-09-10', text: 'Lunch' }, { date: '2026-08-01', text: 'Hike' }];
    const { page, open, stored, done } = await newPage({ seed: { 'crm-people-v1': [person('d', 'Dev Dunn', { log, lastContact: '2026-09-10' })] } });
    await open();
    await page.locator('.crm-person .crm-row', { hasText: 'Dev Dunn' }).click();
    await page.getByRole('button', { name: /Hike/ }).click();
    await page.getByPlaceholder('What came up?').fill('Hike, edited');
    await page.getByRole('button', { name: 'Log a catch-up with Dev Dunn today' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const texts = (await stored('crm-people-v1'))[0].log.map((e) => e.text);
    check('CURRENT: logging a catch-up while an entry is open makes Save overwrite a different entry',
      texts.includes('Hike') && texts.includes('Hike, edited') && !texts.includes('Lunch'), texts);
    await done();
  }

  // ---- a last-contact date typed into the form is lost when the log changes ----
  {
    const { page, open, stored, done } = await newPage({ seed: { 'crm-people-v1': [person('e', 'Ema East', { lastContact: '2026-09-01' })] } });
    await open();
    await page.getByRole('button', { name: 'Log a catch-up with Ema East today' }).click();
    await page.locator('.crm-person .crm-row', { hasText: 'Ema East' }).click();
    await page.getByRole('button', { name: /Talked\./ }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    check('CURRENT: deleting the only log entry forgets a last-contact date that came from the form',
      (await stored('crm-people-v1'))[0].lastContact === null);
    await done();
  }

  // ---- search matches the word "undefined" on people missing a field ----
  {
    const { page, open, done } = await newPage({ seed: { 'crm-people-v1': [{ id: 'f', name: 'Fern Ford', circle: 'friend', cadence: 30, log: [] }] } });
    await open();
    await page.getByPlaceholder('Search everyone by name, note, or handle').fill('def');
    check('CURRENT: "def" matches someone with no role or note, through the text "undefined"',
      await page.getByRole('heading', { name: 'One person matches' }).isVisible());
    await done();
  }

  // ---- an event with a latitude but no longitude ----
  {
    const { page, open, problems, done } = await newPage({
      seed: { 'crm-events-v1': [{ id: 'g', title: 'Half pinned', date: '2026-05-01', lat: 39.1, lon: null, people: [] }] },
    });
    await open();
    await page.getByRole('button', { name: 'Events', exact: true }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.waitForTimeout(300);
    check('CURRENT: editing an event with a latitude but no longitude crashes (the recovery screen now catches it)',
      await page.getByText('Orbit hit a problem showing your data').isVisible() && problems.some((p) => /toFixed/.test(p)), problems);
    await done({ allow: /toFixed|error occurred in the|above error occurred|React will try to recreate/ });
  }

  // ---- restored events without ids ----
  {
    const { page, open, stored, done } = await newPage({ seed: { 'crm-people-v1': [person('h', 'Hana Hill')] } });
    await open();
    await page.getByRole('button', { name: 'Restore' }).click();
    await page.getByPlaceholder('Paste here').fill(JSON.stringify({
      people: [person('h', 'Hana Hill')],
      events: [{ title: 'One', date: '2026-01-01' }, { title: 'Two', date: '2026-02-01' }],
    }));
    await page.getByRole('button', { name: 'Replace my lists' }).click();
    check('CURRENT: restored events keep no id', (await stored('crm-events-v1')).every((e) => e.id === undefined));
    await page.getByRole('button', { name: 'Events', exact: true }).click();
    await page.getByRole('button', { name: 'Remove', exact: true }).first().click();
    await page.getByRole('button', { name: 'Tap again to remove' }).click();
    check('CURRENT: so removing one of them removes all of them', (await stored('crm-events-v1')).length === 0);
    // Without ids they also share a React key, which React warns about.
    await done({ allow: /unique "key" prop|Check the render method/ });
  }

  // ---- the catch-up log export skips formula escaping ----
  {
    const { page, open, done } = await newPage({
      seed: { 'crm-people-v1': [person('i', 'Ivo Ito', { log: [{ date: '2026-09-01', text: '=HYPERLINK("http://x","y")' }], lastContact: '2026-09-01' })] },
    });
    await open();
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    for (const label of [/^People/, /^Events/, /^Reminders/, /^Lists/]) await page.getByLabel(label).uncheck();
    await page.getByLabel(/^Catch-up log/).check();
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
    const p = path.join(shots, 'log.csv');
    await dl.saveAs(p);
    const text = fs.readFileSync(p, 'utf8');
    check('CURRENT: a catch-up note starting "=" is exported as a live formula', text.includes(',"=HYPERLINK') && !text.includes("'=HYPERLINK"), text);
    await done();
  }
}
