// The People tab: ordering, the Quiet view, search, tags, and the everyday
// actions on one person. "CURRENT:" checks record behaviour the audit flagged.
const ago = (n) => {
  const d = new Date(2026, 8, 22 - n, 12);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const PEOPLE = [
  { id: 'ann', name: 'Ann Boyer', circle: 'friend', tier: 'friend', cadence: 30, lastContact: ago(5), vip: true,
    families: ['Boyer family'], log: [{ date: ago(5), text: '' }] },
  { id: 'bea', name: 'Bea Cho', circle: 'friend', tier: 'bestie', cadence: 0, lastContact: ago(2), log: [] },
  { id: 'cal', name: 'Cal Diaz', circle: 'friend', tier: 'bestie', cadence: 7, lastContact: ago(30), aka: ['Cally'], log: [] },
  { id: 'dee', name: 'Dee Ellis', circle: 'friend', tier: 'friend', cadence: 30, lastContact: ago(25), log: [] },
  { id: 'eve', name: 'Eve Fox', circle: 'friend', tier: 'friend', cadence: 30, lastContact: null, log: [] },
  { id: 'fay', name: 'Fay Gold', circle: 'friend', tier: 'friend', cadence: 30, lastContact: ago(400), paused: true, log: [] },
  { id: 'gus', name: 'Gus Hart', circle: 'work', cadence: 90, lastContact: ago(100), company: 'Ardent Systems', log: [] },
];

export default async function people({ newPage, check, TODAY }) {
  const { page, open, stored, done } = await newPage({ seed: { 'crm-people-v1': PEOPLE } });
  await open();
  const names = () => page.$$eval('.crm-person .crm-row > div > div > span:first-child', (els) => els.map((e) => e.textContent));

  // ---- ordering and headline ----
  check('Personal is the starting list, VIP first, no-reminder next, then most overdue, paused last',
    (await names()).join('|') === 'Ann Boyer|Bea Cho|Cal Diaz|Eve Fox|Dee Ellis|Fay Gold', await names());
  check('headline counts who has gone quiet', await page.getByRole('heading', { name: 'Two people have gone quiet' }).isVisible());
  const badge = async (label) => page.getByRole('button', { name: new RegExp(`^${label}`) }).first().innerText();
  check('switcher badges count overdue people per list',
    (await badge('Everyone')).includes('3') && (await badge('Personal')).includes('2') && (await badge('Professional')).includes('1'));
  const rowText = async (n) => page.locator('.crm-person', { hasText: n }).first().innerText();
  check('rows say how long it has been', (await rowText('Cal Diaz')).includes('4 weeks') && (await rowText('Eve Fox')).includes('no log')
    && (await rowText('Bea Cho')).includes('in touch') && (await rowText('Fay Gold')).includes('paused'));

  await page.getByRole('button', { name: /^Quiet/ }).click();
  check('Quiet shows only the overdue', (await names()).join('|') === 'Cal Diaz|Eve Fox', await names());
  await page.getByRole('button', { name: /^All \(/ }).click();

  await page.getByRole('button', { name: /^Professional/ }).click();
  check('Professional shows work contacts', (await names()).join('|') === 'Gus Hart', await names());
  await page.getByRole('button', { name: /^Personal/ }).click();

  // ---- search and tags ----
  const search = page.getByPlaceholder('Search everyone by name, note, or handle');
  await search.fill('ardent');
  check('search looks through both lists, by company', await page.getByRole('heading', { name: 'One person matches' }).isVisible()
    && (await names()).join('|') === 'Gus Hart');
  await search.fill('cally');
  check('search finds nicknames', (await names()).join('|') === 'Cal Diaz');
  await search.fill('zzzz');
  check('a search with no match says so', await page.getByText('No match for that.').isVisible());
  await page.getByRole('button', { name: 'Clear', exact: true }).click();

  await page.locator('.crm-person .crm-row', { hasText: 'Ann Boyer' }).click();
  await page.getByRole('button', { name: 'Boyer family', exact: true }).click();
  check('a family tag filters to that household', await page.getByRole('heading', { name: 'Boyer family' }).isVisible()
    && await page.getByText('One person tagged, across both lists.').isVisible());
  await page.getByRole('button', { name: 'Clear', exact: true }).click();

  // ---- adding someone ----
  await page.getByRole('button', { name: 'Add someone' }).click();
  await page.getByText('Dates to remember', { exact: true }).click();
  check('clicking the "Dates to remember" heading adds nothing (fixed, M6)',
    await page.getByRole('button', { name: 'Remove this date' }).count() === 0);
  await page.getByRole('button', { name: 'Add a date', exact: true }).click();
  check('a date row\'s menu and date box have their own names',
    await page.getByRole('combobox', { name: 'Kind of date' }).count() === 1
      && await page.getByLabel('Date', { exact: true }).count() === 1);
  await page.getByRole('button', { name: 'Remove this date' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Hal Jordan');
  await page.getByRole('button', { name: 'Add to list' }).click();
  let hal = (await stored('crm-people-v1')).find((p) => p.name === 'Hal Jordan');
  check('a new person is saved as a personal friend, added today, never contacted',
    hal && hal.circle === 'friend' && hal.tier === 'friend' && hal.addedOn === TODAY && hal.lastContact === null, hal);
  check('CURRENT: a new Friend gets a 90-day check-in, not the 30 days the Friend closeness suggests', hal.cadence === 90, hal.cadence);

  // ---- quick log, VIP, catch-ups ----
  await page.getByRole('button', { name: 'Log a catch-up with Hal Jordan today' }).click();
  hal = (await stored('crm-people-v1')).find((p) => p.id === hal.id);
  check('the tick logs a catch-up today', hal.lastContact === TODAY && hal.log.length === 1 && hal.log[0].date === TODAY);
  await page.getByRole('button', { name: 'Mark Hal Jordan as a VIP' }).click();
  hal = (await stored('crm-people-v1')).find((p) => p.id === hal.id);
  check('the star marks a VIP', hal.vip === true
    && await page.getByRole('button', { name: 'Remove Hal Jordan from VIPs' }).getAttribute('aria-pressed') === 'true');

  await page.getByRole('button', { name: 'Log a catch-up', exact: true }).click();
  await page.getByPlaceholder('What came up?').fill('Coffee');
  await page.getByRole('button', { name: 'Save catch-up' }).click();
  hal = (await stored('crm-people-v1')).find((p) => p.id === hal.id);
  check('a catch-up with a note is logged', hal.log.length === 2 && hal.log.some((e) => e.text === 'Coffee'), hal.log);
  check('CURRENT: two catch-ups on the same day do not stay newest-first (the date sort is inconsistent for ties)',
    hal.log[1].text === 'Coffee', hal.log);

  await page.getByRole('button', { name: /Coffee/ }).click();
  await page.getByPlaceholder('What came up?').fill('Coffee at Oddly');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  hal = (await stored('crm-people-v1')).find((p) => p.id === hal.id);
  check('a logged catch-up can be edited', hal.log.some((e) => e.text === 'Coffee at Oddly'), hal.log);

  await page.getByRole('button', { name: /Coffee at Oddly/ }).click();
  await page.locator('input[type=date]').first().fill('');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  hal = (await stored('crm-people-v1')).find((p) => p.id === hal.id);
  check('CURRENT: clearing a catch-up\'s date and saving deletes it without asking', hal.log.length === 1, hal.log);

  // ---- editing and removing ----
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Hal J. Jordan');
  await page.getByRole('button', { name: 'Save changes' }).click();
  check('edits are saved', (await stored('crm-people-v1')).some((p) => p.name === 'Hal J. Jordan'));

  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  check('removing asks for a second tap', await page.getByRole('button', { name: 'Tap again to remove' }).isVisible()
    && (await stored('crm-people-v1')).some((p) => p.name === 'Hal J. Jordan'));
  await page.getByRole('button', { name: 'Tap again to remove' }).click();
  check('the second tap removes them', !(await stored('crm-people-v1')).some((p) => p.name === 'Hal J. Jordan'));

  // ---- well-formed data is never set aside ----
  await page.reload();
  await page.waitForSelector('button:has-text("Recap")');
  check('well-formed saved data raises no warning and makes no set-aside copy',
    (await page.getByText('could not be read exactly as saved').count()) === 0
      && !(await page.evaluate(() => Object.keys(localStorage).some((k) => k.endsWith('-set-aside')))));

  // ---- keyboard access ----
  await page.locator('.crm-person .crm-row', { hasText: 'Dee Ellis' }).focus().catch(() => {});
  const focusable = await page.locator('.crm-person .crm-row', { hasText: 'Dee Ellis' }).evaluate((el) => el.tabIndex >= 0);
  check('CURRENT: a person\'s row cannot be reached with the keyboard (only the star and tick can)', focusable === false);

  await done();
}
