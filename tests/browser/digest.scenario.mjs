// "Coming up" on the People tab, and the Recap tab.
export default async function digest({ newPage, check }) {
  const { page, open, done } = await newPage({
    seed: {
      'crm-people-v1': [
        { id: 'a', name: 'Dana Whitfield', circle: 'friend', tier: 'friend', cadence: 30, birthday: '1990-10-02',
          addedOn: '2026-01-10', families: ['Whitfield family'],
          log: [{ date: '2026-03-01' }, { date: '2026-03-15' }, { date: '2025-11-01' }], lastContact: '2026-03-15' },
        { id: 'b', name: 'Sam Ortiz', circle: 'friend', tier: 'friend', cadence: 30, addedOn: '2025-01-01',
          dates: [{ kind: 'Wedding anniversary', label: '', date: '2016-09-30' }], log: [{ date: '2026-09-20' }], lastContact: '2026-09-20' },
      ],
      'crm-events-v1': [{ id: 'e1', title: 'Trip', date: '2026-09-25', place: 'Denver', people: [] }],
      'crm-reminders-v1': [
        { id: 'r1', title: 'Pay the card', kind: 'Money', next: '2026-09-10', every: { unit: 'month', n: 1, dom: 10 }, anchor: 'date', lead: 3, history: [{ date: '2026-08-10' }] },
        { id: 'r2', title: 'Change the filter', kind: 'Home', next: '2026-10-10', every: { unit: 'month', n: 3, dom: 10 }, anchor: 'done', lead: 7, history: [] },
      ],
    },
  });
  await open();

  const rows = await page.locator('button', { has: page.locator('span[style*="border-radius: 7px"]') }).allInnerTexts();
  const flat = rows.map((r) => r.replace(/\s+/g, ' ').trim());
  check('Coming up lists late reminders, events, anniversaries and birthdays, soonest first', JSON.stringify(flat) === JSON.stringify([
    '1 person has gone quiet Show them',
    'Pay the card, money 12 days late',
    'Trip, Denver in 3 days',
    'Sam — wedding anniversary, 10 years in 8 days',
    "Dana's birthday, turning 36 in 10 days",
  ]), flat);
  check('a reminder outside its notice period stays out', !flat.some((r) => r.includes('Change the filter')));
  check('the badge counts everything listed, in red when something is late',
    (await page.getByRole('button', { name: /^Coming up/ }).innerText()).includes('5'));

  await page.getByRole('button', { name: /^Pay the card/ }).click();
  check('a reminder there opens the Reminders tab', await page.getByRole('heading', { name: 'One thing needs you' }).isVisible());

  await page.getByRole('button', { name: 'Recap', exact: true }).click();
  const recap = (await page.locator('.crm-full').innerText()).replace(/\s+/g, ' ');
  check('Recap names the year', recap.startsWith('2026 in review'), recap.slice(0, 40));
  check('Recap counts catch-ups, people added, active months, events and reminders',
    /3 catch-ups logged/.test(recap) && /1 people added/.test(recap) && /2 of 12 months with contact/.test(recap)
      && /1 events recorded/.test(recap) && /1 reminders kept/.test(recap), recap);
  check('Recap names who you saw most', recap.includes('Most connected with Dana Whitfield'));
  check('Recap offers earlier years that have data', await page.getByRole('button', { name: '2025', exact: true }).isVisible());

  await done();
}
