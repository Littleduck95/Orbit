// Events and the Map. "CURRENT:" checks record behaviour the audit flagged.
export default async function events({ newPage, check }) {
  const { page, open, stored, done } = await newPage({
    seed: { 'crm-people-v1': [{ id: 'dana', name: 'Dana Whitfield', circle: 'friend', tier: 'friend', cadence: 30, log: [] }] },
  });
  await open();
  await page.getByRole('button', { name: 'Events', exact: true }).click();
  check('an empty timeline says so', await page.getByRole('heading', { name: 'Nothing on the timeline yet' }).isVisible());

  // ---- a one-day event, with a place lookup that cannot reach its service ----
  await page.getByRole('button', { name: 'Add an event' }).click();
  await page.getByLabel('What happened').fill('Moved to Denver');
  await page.getByLabel('When', { exact: true }).fill('2026-06-03');
  await page.getByPlaceholder('Cincinnati, Ohio').fill('Denver');
  await page.getByRole('button', { name: 'Find', exact: true }).click();
  await page.waitForSelector('text=Could not reach either lookup service from here');
  check('place search reports it cannot reach its service', true);
  const dana = page.locator('button', { hasText: 'Dana Whitfield' });
  check('the "Who was there" heading is not the first chip\'s name (fixed, M6)',
    (await dana.evaluate((el) => el.labels?.length ?? 0)) === 0
      && await page.getByRole('button', { name: 'Dana Whitfield', exact: true }).isVisible());
  await page.getByText('Who was there', { exact: true }).click();
  check('and clicking the heading picks nobody',
    (await dana.evaluate((el) => getComputedStyle(el).backgroundColor)) === 'rgba(0, 0, 0, 0)');
  await dana.click();
  await page.getByLabel('The details').fill('New job.');
  await page.getByRole('button', { name: 'Add to the timeline' }).click();
  let ev = await stored('crm-events-v1');
  check('the event is saved with its person and plain-text place', ev.length === 1 && ev[0].date === '2026-06-03'
    && ev[0].endDate === null && ev[0].people[0] === 'dana' && ev[0].place === 'Denver' && ev[0].lat === null, ev);
  check('the timeline counts it', await page.getByRole('heading', { name: 'One event worth keeping' }).isVisible());

  // ---- a span typed backwards is put the right way round ----
  await page.getByRole('button', { name: 'Add an event' }).click();
  await page.getByLabel('What happened').fill('Road trip');
  await page.getByRole('button', { name: 'Over several days' }).click();
  await page.getByLabel('Started').fill('2026-07-10');
  await page.getByLabel('Ended').fill('2026-07-05');
  await page.getByLabel('Kind').selectOption('Trip');
  await page.getByRole('button', { name: 'Enter coordinates myself' }).click();
  await page.getByPlaceholder('Latitude').fill('39.7');
  await page.getByPlaceholder('Longitude').fill('-104.9');
  await page.getByRole('button', { name: 'Add to the timeline' }).click();
  ev = await stored('crm-events-v1');
  const trip = ev.find((e) => e.title === 'Road trip');
  check('a backwards span is swapped', trip.date === '2026-07-05' && trip.endDate === '2026-07-10', trip);
  check('typed coordinates are kept', trip.lat === 39.7 && trip.lon === -104.9, trip);
  check('the card shows the span', await page.getByText('Jul 5–10, 2026').isVisible());

  // ---- search, filter, order ----
  await page.getByPlaceholder('Search titles, notes, places, people').fill('dana');
  check('search looks at attached people', await page.getByRole('heading', { name: 'One event matches' }).isVisible());
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByRole('button', { name: 'Trip', exact: true }).click();
  check('a kind filter narrows', await page.getByRole('heading', { name: 'One event matches' }).isVisible());
  await page.getByRole('button', { name: 'All', exact: true }).click();
  const titles = () => page.$$eval('.crm-full p[style*="font-size: 17px"]', (els) => els.map((e) => e.textContent));
  check('newest first by default', (await titles()).join('|') === 'Road trip|Moved to Denver', await titles());
  await page.locator('.crm-full select').selectOption('oldest');
  check('oldest first on request', (await titles()).join('|') === 'Moved to Denver|Road trip', await titles());
  check('CURRENT: the order menu has no label for screen readers',
    (await page.locator('.crm-full select').evaluate((el) => el.labels.length + (el.getAttribute('aria-label') ? 1 : 0))) === 0);

  // ---- map ----
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  check('the map lists pinned events only', await page.getByRole('heading', { name: 'One place pinned' }).isVisible());
  await page.getByRole('button', { name: 'Events', exact: true }).click();

  // ---- edit, coordinates cleared, remove ----
  await page.locator('.crm-full').getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.getByLabel('What happened').fill('Long road trip');
  check('an edited event shows where it is pinned', await page.getByText('Pinned at 39.700, -104.900.').isVisible());
  await page.getByRole('button', { name: 'Enter coordinates myself' }).click();
  await page.getByPlaceholder('Latitude').fill('');
  await page.getByRole('button', { name: 'Save changes' }).click();
  ev = await stored('crm-events-v1');
  const edited = ev.find((e) => e.title === 'Long road trip');
  check('edits are saved', Boolean(edited));
  check('CURRENT: clearing the latitude stores 0, putting the pin in the ocean off Africa', edited.lat === 0 && edited.lon === -104.9, edited);

  await page.locator('.crm-full').getByRole('button', { name: 'Remove', exact: true }).first().click();
  await page.getByRole('button', { name: 'Tap again to remove' }).click();
  check('removing takes two taps', (await stored('crm-events-v1')).length === 1);

  await done();
}
