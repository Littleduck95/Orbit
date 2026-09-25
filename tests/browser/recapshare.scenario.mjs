// Rated events (concerts, games, shows, festivals), Recap's year in events,
// and the year's share card.
import fs from 'node:fs';
import path from 'node:path';

const stop = (name, lat, lng) => ({ name, displayAddress: '', lat, lng });
const trip = (id, title, s, startDate, extra = {}) => ({
  id, title, stops: [s], startDate, endDate: null, rating: null, excerpt: '', notes: '', companions: ['p1'], photoIds: [], tags: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
});
const TRIPS = [
  trip('a', 'Lisbon and Porto', stop('Lisbon', 38.72, -9.14), '2026-05-10', { endDate: '2026-05-17', rating: 4.5 }),
  trip('b', 'Chicago', stop('Chicago', 41.88, -87.63), '2026-03-01', { endDate: '2026-03-03', rating: 3 }),
  trip('c', 'Tokyo', stop('Tokyo', 35.68, 139.69), '2025-11-02', { rating: 5 }),
];
const event = (id, title, kind, date, extra = {}) => ({
  id, title, kind, date, endDate: null, note: 'private note', people: ['p1'], place: '', lat: null, lon: null, addedOn: '2026-01-01', ...extra,
});
const EVENTS = [
  event('e1', 'Chiefs vs Broncos', 'Sports', '2026-09-14', { rating: 4, place: 'Arrowhead Stadium', lat: 39.05, lon: -94.48 }),
  event('e2', 'Royals opening day', 'Sports', '2026-04-02', { rating: 3 }),
  event('e3', 'Phoebe Bridgers', 'Concert', '2026-06-20', { rating: 5, place: 'Red Rocks', lat: 39.66, lon: -105.2 }),
  event('e4', 'Hamilton', 'Theater', '2026-10-30'),
  event('e5', 'Old show', 'Concert', '2025-06-20', { rating: 2 }),
  event('e6', 'Moved house', 'Milestone', '2026-02-01'),
];
const PEOPLE = [{ id: 'p1', name: 'Dana Secretname', circle: 'friend', tier: 'friend', cadence: 30, log: [{ date: '2026-08-01', text: 'Lunch' }] }];

export default async function recapshare({ newPage, check, tab, shots }) {
  const { page, open, stored, done } = await newPage({
    seed: { 'crm-trips-v1': TRIPS, 'crm-trips-notice-v1': '1', 'crm-events-v1': EVENTS, 'crm-people-v1': PEOPLE },
  });
  await open();

  // ---- rating an event ----
  await tab(page, 'Events');
  check('rated events show their stars', await page.getByRole('img', { name: '5 out of 5 stars' }).count() === 1);
  await page.getByRole('button', { name: 'Add an event' }).click();
  await page.getByLabel('What happened').fill('Wet Leg');
  await page.getByLabel('Kind').selectOption('Concert');
  check('a concert that has happened can be rated', await page.getByRole('group', { name: 'How was it?' }).isVisible());
  await page.getByLabel('When').fill('2026-12-01');
  check('but not one still to come', await page.getByRole('group', { name: 'How was it?' }).count() === 0);
  await page.getByLabel('When').fill('2026-09-01');
  await page.getByLabel('Kind').selectOption('Loss');
  check('and a loss is never rated', await page.getByRole('group', { name: 'How was it?' }).count() === 0);
  await page.getByLabel('Kind').selectOption('Concert');
  await page.getByRole('radio', { name: '4.5 stars' }).check({ force: true });
  await page.getByRole('button', { name: 'Add to the timeline' }).click();
  const saved = (await stored('crm-events-v1')).find((e) => e.title === 'Wet Leg');
  check('the rating is saved with the event', saved?.rating === 4.5 && saved?.kind === 'Concert', saved);
  check('the new kinds are filters', await page.getByRole('button', { name: 'Sports', exact: true }).isVisible());

  // ---- Recap: the year in events ----
  await tab(page, 'Recap');
  const section = page.getByRole('region', { name: '2026 in events' });
  const text = (await section.innerText()).replace(/\s+/g, ' ');
  check('Recap counts the outings that have happened, by kind', /2 concerts/.test(text) && /2 games/.test(text) && !/shows?\b/.test(text.split('Still to come')[0]), text);
  check('and names the top-rated event', /Top-rated event Phoebe Bridgers/.test(text), text);
  check('and what is still to come', /Still to come in 2026: Hamilton/.test(text), text);
  check('a year before only counts its own', !/Old show/.test(text));
  await section.getByRole('button', { name: /Phoebe Bridgers/ }).first().click();
  check('an event opens from Recap to be edited', await page.getByLabel('What happened').inputValue() === 'Phoebe Bridgers');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await tab(page, 'Recap');

  // ---- the share card ----
  const box = (name) => page.getByRole('checkbox', { name: new RegExp(`^${name}`) });
  await page.getByRole('button', { name: 'Share your year' }).click();
  const card = page.locator('canvas[role="img"]');
  await card.waitFor();
  // The label is the card in words, and fills in the countries once the
  // outlines have loaded.
  await page.waitForFunction(() => /countr/.test(document.querySelector('canvas[role="img"]')?.getAttribute('aria-label') || ''));
  const label = await card.getAttribute('aria-label');
  check('the card is the year in trips and events', label.startsWith('2026 in trips & events'), label);
  check('with the numbers', /2 trips/.test(label) && /2 countries/.test(label) && /2 concerts/.test(label) && /2 games/.test(label), label);
  check('and the best trip and event', /Top-rated trip: Lisbon and Porto/.test(label) && /Top-rated event: Phoebe Bridgers/.test(label), label);
  check('never who anyone was with, or notes', !/Dana|Secretname|private note/.test(label), label);
  check('catch-ups are off to start with', !/catch-up/.test(label), label);
  await box('Catch-ups').check();
  await page.waitForFunction(() => /catch-up/.test(document.querySelector('canvas[role="img"]')?.getAttribute('aria-label') || ''));
  check('and only a count when on', /1 catch-up/.test(await card.getAttribute('aria-label')));
  await box('Catch-ups').uncheck();

  await page.getByLabel('Your name on it').fill('Brock');
  await box('Events').uncheck();
  await page.waitForFunction(() => (document.querySelector('canvas[role="img"]')?.getAttribute('aria-label') || '').startsWith('2026 in trips\n'));
  check('unticking events takes them off', !/concert|Phoebe/.test(await card.getAttribute('aria-label')));
  await box('Events').check();

  // The picture really is drawn: the canvas is not blank.
  await page.waitForFunction(() => /Phoebe/.test(document.querySelector('canvas[role="img"]')?.getAttribute('aria-label') || ''));
  await page.getByRole('button', { name: 'Save image' }).waitFor();
  await page.waitForFunction(() => !document.querySelector('button[disabled]')?.textContent?.includes('Save image'));
  const lit = await card.evaluate((c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4 * 97) if (d[i + 1] > 180 && d[i] < 160) n += 1; // the green of visited countries and the year's accent
    return n;
  });
  check('the card is drawn, with green on it', lit > 50, lit);

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save image' }).click()]);
  check('Save image downloads a PNG named for the year', download.suggestedFilename() === 'orbit-2026.png', download.suggestedFilename());
  const file = path.join(shots, 'orbit-2026.png');
  await download.saveAs(file);
  const head = fs.readFileSync(file).subarray(0, 8).toString('hex');
  check('and it is a real PNG', head === '89504e470d0a1a0a', head);

  // ---- a year with nothing to share ----
  await page.getByRole('button', { name: '2025', exact: true }).click();
  await box('Trips').uncheck();
  await box('Events').uncheck();
  check('with nothing ticked, the card says so rather than offering a blank picture',
    await page.getByText('Nothing from 2025 to put on it with these ticked.').isVisible()
    && await page.getByRole('button', { name: 'Save image' }).count() === 0);

  await done();
}
