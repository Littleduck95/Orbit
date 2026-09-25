// Trips still to come, the stats row, country shading, Recap's year in trips,
// and a Places list entry becoming a trip.
const stop = (name, lat, lng) => ({ name, displayAddress: '', lat, lng });
const trip = (id, title, s, startDate, extra = {}) => ({
  id, title, stops: [s], startDate, endDate: null, rating: null, excerpt: '', notes: '', companions: [], photoIds: [], tags: [],
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
});
const TRIPS = [
  trip('a', 'Chicago', stop('Chicago', 41.88, -87.63), '2026-05-10', { endDate: '2026-05-14', rating: 4.5 }),
  trip('b', 'Chicago again', stop('Chicago', 41.88, -87.62), '2025-06-10', { rating: 3 }),
  trip('c', 'Lisbon', stop('Lisbon', 38.72, -9.14), '2019-03-03', { endDate: '2019-03-10' }),
  trip('d', 'Boston', stop('Boston', 42.36, -71.06), '2021-10-03'),
  trip('e', 'Austin', stop('Austin', 30.27, -97.74), '2020-02-03'),
  trip('f', 'Tokyo', stop('Tokyo', 35.68, 139.69), '2026-11-02', { status: 'planned' }),
  trip('g', 'Iceland', stop('Reykjavik', 64.1, -21.9), null, { status: 'someday' }),
  trip('h', 'Nashville', stop('Nashville', 36.16, -86.78), '2026-09-01', { status: 'planned', endDate: '2026-09-04' }),
];
const PLACES = {
  id: 'l1', name: 'Places to go', kind: 'Places', track: true, labels: { want: 'Want to go', doing: '', done: 'Been there' }, detail: 'Where',
  sort: 'manual', addedOn: '2026-01-01', updatedAt: '2026-01-01T00:00:00.000Z',
  items: [{ id: 'i1', title: 'Kyoto', detail: 'Japan', status: 'want', rating: 0, link: '', note: '', from: null, addedOn: '2026-01-01', doneOn: null }],
};

export default async function tripplans({ newPage, check, tab }) {
  const { page, open, stored, done } = await newPage({
    seed: { 'crm-trips-v1': TRIPS, 'crm-trips-notice-v1': '1', 'crm-collections-v1': [PLACES] },
  });
  await open();
  await tab(page, 'Trips');

  // ---- the stats row ----
  const stats = page.getByRole('region', { name: 'Trip stats' });
  // The counts that need the country outlines fill in once those have loaded.
  await page.waitForFunction(() => /\d\s+countries/.test(document.querySelector('[aria-label="Trip stats"]')?.innerText || ''));
  const text = (await stats.innerText()).replace(/\s+/g, ' ');
  check('stats count countries, US states and places from the trips taken', /2 countries/.test(text) && /3 US states/.test(text) && /4 places/.test(text), text);
  check('and days away this year, and the most visited place', /5 days away in 2026/.test(text) && /Chicago Most visited · 2 trips/.test(text), text);
  await page.getByRole('button', { name: 'Hide stats' }).click();
  check('stats can be hidden', await stats.count() === 0);
  check('and stay hidden', await page.evaluate(() => localStorage.getItem('orbit:crm-trip-stats-v1')) === 'hidden');
  await page.getByRole('button', { name: 'Show stats' }).click();
  check('and come back', await stats.isVisible());

  // ---- groups, pins, filter ----
  for (const h of ['Coming up', 'Recent trips', 'Someday']) {
    check(`trips are grouped: ${h}`, await page.getByRole('heading', { name: new RegExp(`^${h}`) }).isVisible());
  }
  await page.waitForSelector('.orbit-pin-someday, .orbit-cluster');
  check('trips to come are hollow pins', await page.locator('.orbit-pin-someday').count() === 1);
  await page.getByLabel('Show', { exact: true }).selectOption('someday');
  check('the Show filter narrows to one kind', (await page.locator('section .crm-row').count()) === 1
    && await page.locator('section .crm-row').first().innerText().then((t) => t.includes('Iceland')));
  await page.getByLabel('Show', { exact: true }).selectOption('');

  // ---- shading ----
  check('nothing is shaded to start with', await page.locator('.leaflet-overlay-pane path').count() === 0);
  await page.getByRole('button', { name: 'Shade countries I have been to' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.leaflet-overlay-pane path').length > 0);
  check('shading colours in each country and US state been to', await page.locator('.leaflet-overlay-pane path').count() === 5);

  // ---- a planned trip whose dates went by ----
  await page.locator('section .crm-row', { hasText: 'Nashville' }).click();
  await page.getByRole('button', { name: 'Open trip' }).click();
  check('a planned trip that has gone by asks whether it happened', await page.getByText('Did you go?').isVisible());
  await page.getByRole('button', { name: 'Yes, I went' }).click();
  const nash = (await stored('crm-trips-v1')).find((t) => t.id === 'h');
  check('"Yes, I went" makes it a trip you took', nash && !('status' in nash) && nash.startDate === '2026-09-01');
  await page.getByRole('button', { name: '← All trips' }).click();

  // ---- adding a someday trip ----
  await page.getByRole('button', { name: 'Add a trip' }).click();
  await page.getByRole('button', { name: 'Someday', exact: true }).click();
  check('someday asks for no dates', await page.getByLabel('Started').count() === 0 && await page.getByLabel('Starts (optional)').count() === 0);
  check('and no rating', await page.getByRole('radio', { name: '4 stars' }).count() === 0);
  await page.getByLabel('Title').fill('Patagonia');
  await page.getByRole('button', { name: 'Coordinates' }).click();
  await page.getByLabel('Name', { exact: true }).fill('El Chaltén');
  await page.getByLabel('Latitude').fill('-49.33');
  await page.getByLabel('Longitude').fill('-72.89');
  await page.getByRole('button', { name: 'Add this place' }).click();
  await page.getByRole('button', { name: 'Save trip' }).click();
  await page.getByRole('heading', { name: 'Patagonia' }).waitFor();
  const pat = (await stored('crm-trips-v1')).find((t) => t.title === 'Patagonia');
  check('it saves as someday, with no dates', pat.status === 'someday' && pat.startDate === null);
  await page.getByRole('button', { name: '← All trips' }).click();

  // ---- a Places list entry onto the trip map ----
  await tab(page, 'Lists');
  await page.getByRole('button', { name: /Places to go/ }).first().click();
  await page.getByRole('button', { name: /^Kyoto\s*Japan$/ }).click();
  await page.getByRole('button', { name: 'Put it on the trip map' }).click();
  check('a Places entry opens a someday trip with its name', (await page.getByLabel('Title').inputValue()) === 'Kyoto'
    && await page.getByRole('button', { name: 'Someday', exact: true }).getAttribute('aria-pressed') === 'true');
  check('and searches for its place', (await page.getByLabel('Search for a place').inputValue()) === 'Kyoto, Japan');
  await page.getByRole('button', { name: 'Cancel' }).first().click();

  // ---- Recap ----
  await tab(page, 'Recap');
  await page.getByRole('heading', { name: '2026 in trips' }).waitFor();
  const recap = (await page.locator('#recap-trips').locator('..').innerText()).replace(/\s+/g, ' ');
  check('Recap has the year in trips', /2 trips/.test(recap) && /Top-rated trip Chicago/.test(recap), recap.slice(0, 200));
  check('with what is still to come', recap.includes('Still to come in 2026: Tokyo'), recap.slice(-80));
  check('the four latest years are buttons, older ones in a menu',
    await page.getByRole('button', { name: '2021', exact: true }).isVisible()
    && await page.getByLabel('Earlier years').locator('option').allTextContents().then((o) => o.join() === 'Earlier,2019'));
  await page.getByLabel('Earlier years').selectOption('2019');
  check('an older year opens from the menu', await page.getByRole('heading', { name: '2019 in review' }).isVisible()
    && await page.getByRole('heading', { name: '2019 in trips' }).isVisible());
  await page.getByRole('button', { name: '2026', exact: true }).click();

  // ---- New Year while Orbit is open ----
  await page.clock.setSystemTime(new Date('2027-01-01T09:00:00-06:00'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('heading', { name: '2027 in review' }).waitFor({ timeout: 5000 });
  check('Recap moves on to the new year by itself', await page.getByRole('button', { name: '2027', exact: true }).getAttribute('aria-pressed') === 'true');

  await done();
}
