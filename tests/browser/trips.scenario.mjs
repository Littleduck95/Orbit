// Trips: adding one three ways, photos in IndexedDB, the map and list,
// filters, sharing with and without photos, the backup file, and People.
import fs from 'node:fs';
import path from 'node:path';

const DANA = { id: 'dana', name: 'Dana Whitfield', circle: 'friend', tier: 'friend', cadence: 30, email: 'dana@example.com', log: [] };
const SAM = { id: 'sam', name: 'Sam Ortiz', circle: 'friend', tier: 'friend', cadence: 30, log: [] };

const PLACES = {
  lisbon: [{ name: 'Lisbon', display_name: 'Lisbon, Lisboa, Portugal', lat: '38.7077', lon: '-9.1365' }],
  porto: [{ name: 'Porto', display_name: 'Porto, Portugal', lat: '41.1496', lon: '-8.6110' }],
};

// Answers place searches from PLACES and remembers when each was asked.
const fakeNominatim = async (page) => {
  const asked = [];
  await page.route('https://nominatim.openstreetmap.org/**', (r) => {
    const q = new URL(r.request().url()).searchParams.get('q').toLowerCase();
    asked.push({ q, at: Date.now() });
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(PLACES[q.split(',')[0].trim()] || []) });
  });
  return asked;
};

// Real pictures, drawn in the page, as files to upload.
const pictures = async (page, n) => page.evaluate(async (count) => {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const c = document.createElement('canvas');
    c.width = 2400;
    c.height = 1200;
    const g = c.getContext('2d');
    g.fillStyle = `hsl(${i * 70}, 60%, 50%)`;
    g.fillRect(0, 0, c.width, c.height);
    const b = await new Promise((res) => c.toBlob(res, 'image/png'));
    const bytes = new Uint8Array(await b.arrayBuffer());
    let s = '';
    for (let j = 0; j < bytes.length; j += 1) s += String.fromCharCode(bytes[j]);
    out.push(btoa(s));
  }
  return out;
}, n).then((list) => list.map((b64, i) => ({ name: `photo-${i + 1}.png`, mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') })));

const photoCount = (page) => page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('orbit-photos');
  req.onsuccess = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains('photos')) { resolve(0); return; }
    const c = db.transaction('photos').objectStore('photos').count();
    c.onsuccess = () => { resolve(c.result); db.close(); };
  };
  req.onerror = () => resolve(-1);
}));

export default async function trips({ newPage, check, tab, shots }) {
  const { page, ctx, open, stored, done, url } = await newPage({
    seed: { 'crm-people-v1': [DANA, SAM] },
  });
  const asked = await fakeNominatim(page);
  await open();

  // ---- empty ----
  await tab(page, 'Trips');
  check('an empty Trips tab says so', await page.getByRole('heading', { name: 'No trips yet' }).isVisible());
  check('and offers to add the first one on the map', await page.getByRole('button', { name: 'Add your first trip' }).isVisible());
  await page.waitForSelector('.leaflet-container');
  const credit = await page.locator('.leaflet-control-attribution').textContent();
  check('the map carries the Stadia and OpenStreetMap credits',
    credit.includes('Stadia Maps') && credit.includes('OpenStreetMap contributors'), credit);
  check('the device-only notice shows', await page.getByText('on this device only').isVisible());
  await page.getByRole('button', { name: 'Got it' }).click();
  check('the notice is remembered', Boolean(await page.evaluate(() => localStorage.getItem('orbit:crm-trips-notice-v1'))));

  // ---- the form: checks first ----
  await page.getByRole('button', { name: 'Add a trip' }).click();
  await page.getByRole('button', { name: 'Save trip' }).click();
  const alert = await page.getByRole('alert').first().textContent();
  check('saving an empty form lists what is missing', alert.includes('Give the trip a title') && alert.includes('at least one place'), alert);

  await page.getByLabel('Title').fill('A week in Portugal');
  await page.getByLabel('Started').fill('2025-05-03');
  await page.getByLabel('Ended (optional)').fill('2025-05-01');
  check('an end before the start is flagged', await page.getByText('The trip cannot end before it starts.').first().isVisible());
  await page.getByLabel('Ended (optional)').fill('2025-05-10');

  // ---- stop 1: search ----
  const search = page.getByRole('combobox', { name: 'Search for a place' });
  await search.fill('Lisbon');
  await page.getByRole('option', { name: /Lisbon/ }).waitFor();
  await search.press('Enter');
  check('a search result becomes a stop', await page.getByLabel('Name of place 1').inputValue() === 'Lisbon');
  await search.fill('Porto');
  await page.getByRole('option', { name: /Porto/ }).click();
  check('two searches, two stops', await page.getByLabel('Name of place 2').inputValue() === 'Porto');
  check('searches keep at least a second apart', asked.length === 2 && asked[1].at - asked[0].at >= 950,
    asked.map((a) => a.at - asked[0].at));

  // ---- offline search ----
  await page.route('https://nominatim.openstreetmap.org/**', (r) => r.abort());
  await search.fill('Faro');
  await page.getByText('Could not reach the place search').waitFor();
  check('a failed search says so and offers the other ways', await page.getByRole('button', { name: 'Try again' }).isVisible());
  await search.fill('');

  // ---- stop 3: pin on the map ----
  await page.getByRole('button', { name: 'Pick on map' }).click();
  await page.waitForSelector('.orbit-map');
  await page.locator('.orbit-map').scrollIntoViewIfNeeded();
  const box = await page.locator('.orbit-map').boundingBox();
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.6);
  await page.getByLabel('Name this place').fill('Sintra');
  await page.getByRole('button', { name: 'Add this place' }).click();
  check('a dropped pin becomes a named stop', await page.getByLabel('Name of place 3').inputValue() === 'Sintra');

  // ---- stop 4: coordinates ----
  await page.getByRole('button', { name: 'Coordinates' }).click();
  await page.getByLabel('Latitude').fill('95');
  await page.getByLabel('Longitude').fill('-8');
  await page.getByRole('button', { name: 'Add this place' }).click();
  check('an impossible latitude is refused', await page.getByText('Latitude is a number from -90 to 90.').isVisible());
  await page.getByLabel('Name', { exact: true }).fill('Faro');
  await page.getByLabel('Latitude').fill('37.0194');
  await page.getByRole('button', { name: 'Add this place' }).click();
  check('typed coordinates become a stop', await page.getByLabel('Name of place 4').inputValue() === 'Faro');

  // ---- reorder and remove ----
  await page.getByRole('button', { name: 'Move Faro earlier' }).click();
  check('stops move', await page.getByLabel('Name of place 3').inputValue() === 'Faro');
  await page.getByRole('button', { name: 'Remove Sintra' }).click();
  check('stops come off', await page.getByLabel('Name of place 4').count() === 0);

  // ---- rating from the keyboard ----
  await page.getByRole('radio', { name: '2.5 stars' }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  check('arrow keys step the rating by half a star', await page.getByRole('radio', { name: '3.5 stars' }).isChecked());
  await page.keyboard.press('ArrowRight');
  check('arrow keys set the rating', await page.getByRole('radio', { name: '4 stars' }).isChecked());

  await page.getByLabel('The highlight').fill('Pastéis de nata still warm at the counter.');
  await page.getByLabel('Notes').fill('Long days walking the hills.');
  await page.getByLabel('Find someone to add').fill('dan');
  await page.getByRole('button', { name: '+ Dana Whitfield' }).click();
  check('a companion is picked', await page.getByRole('button', { name: 'Remove Dana Whitfield' }).isVisible());
  await page.getByLabel('Tags').fill('food, family');

  // ---- photos ----
  const input = page.locator('input[type=file][accept^="image"]');
  await input.setInputFiles([
    ...(await pictures(page, 3)),
    { name: 'IMG_0001.HEIC', mimeType: 'image/heic', buffer: Buffer.from('not really a heic') },
  ]);
  await page.getByText('HEIC photo').waitFor({ timeout: 20000 });
  check('an unreadable HEIC gets a friendly message', await page.getByText('Save it as JPEG or PNG').isVisible());
  check('three photos are added', await page.getByText('Photos (3 of 30)').isVisible());
  check('photos are stored in IndexedDB as they are added', await photoCount(page) === 3);
  const kept = await page.evaluate(() => new Promise((resolve) => {
    indexedDB.open('orbit-photos').onsuccess = (e) => {
      const db = e.target.result;
      db.transaction('photos').objectStore('photos').getAll().onsuccess = (ev) => {
        const p = ev.target.result[0];
        resolve({ w: p.width, h: p.height, type: p.blob.type });
      };
    };
  }));
  check('photos are shrunk to 1600px and saved as JPEG', kept.w === 1600 && kept.h === 800 && kept.type === 'image/jpeg', kept);
  check('nothing about photos goes in localStorage',
    (await page.evaluate(() => Object.values(localStorage).reduce((n, v) => n + v.length, 0))) < 20000);
  await page.screenshot({ path: path.join(shots, 'trip-form.png'), fullPage: true });

  await page.getByRole('button', { name: 'Save trip' }).click();
  await page.getByRole('heading', { name: 'A week in Portugal' }).waitFor();
  let saved = (await stored('crm-trips-v1'))[0];
  check('the trip is saved with everything', saved.stops.map((s) => s.name).join() === 'Lisbon,Porto,Faro'
    && saved.rating === 4 && saved.companions.join() === 'dana' && saved.photoIds.length === 3
    && saved.tags.join() === 'food,family' && saved.endDate === '2025-05-10', saved);
  check('the detail page shows dates and length', await page.getByText('May 3–10, 2025 · 8 days').isVisible());

  // ---- lightbox ----
  await page.getByRole('button', { name: 'Open A week in Portugal, photo 2' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('img').waitFor();
  check('the lightbox opens on the photo tapped', (await dialog.getByText('2 of 3').isVisible())
    && (await dialog.getByRole('img').getAttribute('alt')) === 'A week in Portugal, photo 2');
  await page.keyboard.press('ArrowRight');
  check('arrow keys move through photos', await dialog.getByText('3 of 3').isVisible());
  await page.keyboard.press('Escape');
  check('Escape closes it', await dialog.count() === 0);
  await page.screenshot({ path: path.join(shots, 'trip-detail.png'), fullPage: true });

  // ---- reload ----
  await page.reload();
  await page.waitForSelector('button:has-text("Recap")');
  await tab(page, 'Trips');
  await page.getByRole('button', { name: 'List', exact: true }).click();
  const thumb = page.getByRole('img', { name: 'A week in Portugal, photo 1' });
  await thumb.waitFor();
  check('photos survive a reload', (await thumb.getAttribute('src')).startsWith('blob:'));

  // ---- a second trip, then the map and filters ----
  await page.getByRole('button', { name: 'Add a trip' }).click();
  await page.getByLabel('Title').fill('Weekend upstate');
  await page.getByLabel('Started').fill('2026-02-14');
  await page.getByRole('button', { name: 'Coordinates' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Hudson');
  await page.getByLabel('Latitude').fill('42.2529');
  await page.getByLabel('Longitude').fill('-73.7910');
  await page.getByRole('button', { name: 'Add this place' }).click();
  await page.getByRole('radio', { name: '2.5 stars' }).check({ force: true });
  await page.getByLabel('Find someone to add').fill('sam');
  await page.getByLabel('Find someone to add').press('Enter');
  await page.getByRole('button', { name: 'Save trip' }).click();
  await page.getByRole('button', { name: '← All trips' }).click();

  // A card with no photo shows its rating in the thumbnail's place; that number is not the title.
  const cards = async () => (await page.locator('.crm-full .crm-row').allTextContents()).map((t) => t.replace(/^[\d.]+/, ''));
  check('a half-star rating is saved as it was picked', (await stored('crm-trips-v1')).find((t) => t.title === 'Weekend upstate')?.rating === 2.5);
  check('the list shows newest first', (await cards()).map((t) => t.slice(0, 8)).join('|') === 'Weekend |A week i', await cards());
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await page.waitForSelector('.orbit-pin, .orbit-cluster');
  const pins = await page.locator('.orbit-pin').count();
  const clusters = await page.locator('.orbit-cluster').count();
  check('the map shows every stop, clustered where they crowd', pins + clusters >= 2 && pins + clusters <= 4, { pins, clusters });
  check('the trips show as cards under the map, newest first',
    await page.getByRole('heading', { name: 'Recent trips' }).isVisible()
    && (await cards()).map((t) => t.slice(0, 8)).join('|') === 'Weekend |A week i', await cards());
  const shared = page.getByRole('button', { name: 'Add a shared trip' });
  check('"Add a shared trip" sits beside "Add a trip"',
    (await shared.boundingBox()).y === (await page.getByRole('button', { name: 'Add a trip' }).boundingBox()).y);
  await shared.click();
  check('and opens the box to paste a link into', await page.getByLabel('Shared file').count() === 1
    && await shared.getAttribute('aria-expanded') === 'true');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.locator('.orbit-pin[title="Weekend upstate"]').click();
  const popup = page.locator('.leaflet-popup');
  await popup.waitFor();
  check('a pin opens its trip in a popup', (await popup.textContent()).includes('Weekend upstate')
    && (await popup.getByRole('img', { name: '2.5 out of 5 stars' }).isVisible()));
  const upstatePin = page.locator('.orbit-pin[title="Weekend upstate"] span');
  check('pins are coloured by rating, a half star with its whole star',
    (await upstatePin.evaluate((el) => getComputedStyle(el).backgroundColor)) === 'rgb(176, 74, 12)'
    && (await upstatePin.textContent()) === '2.5');
  await page.screenshot({ path: path.join(shots, 'trips-map.png') });
  await popup.getByRole('button', { name: 'Open trip' }).click();
  check('Open trip goes to the trip', await page.getByRole('heading', { name: 'Weekend upstate' }).isVisible());
  await page.getByRole('button', { name: '← All trips' }).click();

  // ---- a card under the map finds its trip on the map ----
  await page.locator('section .crm-row', { hasText: 'A week in Portugal' }).click();
  const found = page.locator('.leaflet-popup', { hasText: 'A week in Portugal' });
  await found.waitFor({ timeout: 5000 });
  check('tapping a card under the map opens that trip on the map', (await found.textContent()).includes('Place 1 of'));
  check('and the keyboard lands on its Open trip button',
    await page.evaluate(() => document.activeElement?.textContent) === 'Open trip');
  check('the page scrolls up to the map', await page.evaluate(() => document.querySelector('.leaflet-container')?.getBoundingClientRect().top < window.innerHeight));
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'List', exact: true }).click();
  const titles = cards;
  await page.getByLabel('Year').selectOption('2025');
  check('the year filter works', (await titles()).length === 1 && (await titles())[0].startsWith('A week'));
  await page.getByLabel('Year').selectOption('');
  await page.getByLabel('Rating').selectOption('3');
  check('the rating filter works', (await titles()).length === 1 && (await titles())[0].startsWith('A week'));
  await page.getByLabel('Rating').selectOption('0');
  await page.getByLabel('Went with').selectOption('sam');
  check('the companion filter works', (await titles()).length === 1 && (await titles())[0].startsWith('Weekend'));
  await page.getByRole('button', { name: 'Clear filters' }).first().click();
  await page.getByLabel('Tag').selectOption('food');
  check('the tag filter works', (await titles()).length === 1 && (await titles())[0].startsWith('A week'));
  await page.getByRole('button', { name: 'Clear filters' }).first().click();

  // ---- People ----
  await tab(page, 'People');
  await page.locator('.crm-person .crm-row', { hasText: 'Dana Whitfield' }).click();
  check('Trips together shows on the person', await page.getByText('Trips together').isVisible());
  await page.getByRole('button', { name: /A week in Portugal/ }).click();
  check('and links to the trip', await page.getByRole('heading', { name: 'A week in Portugal' }).isVisible());

  // ---- share without photos: a link, like a person's card ----
  await page.getByRole('button', { name: 'Send a copy' }).click();
  await page.getByLabel('From').fill('Chris');
  await page.getByRole('button', { name: 'QR code' }).click();
  const qrCode = page.getByRole('img', { name: 'QR code for the trip A week in Portugal' });
  await qrCode.waitFor({ timeout: 5000 }).catch(() => {});
  check('a trip can go as a QR code', await qrCode.isVisible(), await page.locator('.crm-open').last().textContent());
  await page.getByRole('button', { name: 'Copy link' }).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  check('the link is the same kind a person share uses', /#share=z[A-Za-z0-9_-]+$/.test(link), link);

  // ---- share with photos: an .orbit file ----
  await page.getByLabel(/^Include photos/).check();
  check('with photos, there is no link to copy', await page.getByRole('button', { name: 'Copy link' }).count() === 0);
  await page.getByText(/about [\d.]+ (KB|MB) with these/).waitFor();
  const [sharedDl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save as file' }).click(),
  ]);
  const sharedFile = path.join(shots, sharedDl.suggestedFilename());
  await sharedDl.saveAs(sharedFile);
  check('the shared file is an .orbit file named after the trip', sharedDl.suggestedFilename() === 'a-week-in-portugal.orbit');
  const sharedJson = JSON.parse(fs.readFileSync(sharedFile, 'utf8'));
  check('the file holds the trip and its photos, never who went',
    sharedJson.orbit === 'share' && sharedJson.t === 'trip' && sharedJson.ph.length === 3 && !JSON.stringify(sharedJson).includes('dana'));

  // ---- backup file ----
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('button', { name: 'Backup file' }).click();
  await page.getByRole('button', { name: 'Make a backup file' }).click();
  const warning = await page.getByText(/The file will be about/).textContent();
  check('the size is given before the backup is made', /about [\d.]+ (KB|MB)/.test(warning) && warning.includes('three photos'), warning);
  const [backupDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download it' }).click()]);
  const backupFile = path.join(shots, backupDl.suggestedFilename());
  await backupDl.saveAs(backupFile);
  check('the backup file downloads', fs.statSync(backupFile).size > 10000);
  check('the backup date is remembered', await page.getByText(/last backup file from here was made/).isVisible());

  // ---- delete ----
  await tab(page, 'Trips');
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await page.locator('.crm-row', { hasText: 'A week in Portugal' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  check('deleting asks first, counting the photos', await page.getByText('Delete this trip and its three photos?').isVisible());
  await page.getByRole('button', { name: 'Delete trip' }).click();
  await page.waitForTimeout(300);
  check('deleting a trip deletes its photos', await photoCount(page) === 0 && (await stored('crm-trips-v1')).length === 1);
  await done();

  // ---- a fresh browser: the link ----
  const b = await newPage();
  await b.page.goto(link);
  await b.page.getByText('Chris shared a trip with you').waitFor();
  check('a trip link offers the trip, saying who sent it', await b.page.getByText('A week in Portugal').first().isVisible());
  check('the link is taken out of the address bar', !(await b.page.evaluate(() => window.location.hash)));
  await b.page.getByRole('button', { name: 'Add it to my trips' }).click();
  await b.page.getByRole('heading', { name: 'A week in Portugal' }).waitFor();
  saved = (await b.stored('crm-trips-v1'))[0];
  check('a linked trip arrives without photos or people', saved.photoIds.length === 0 && saved.companions.length === 0 && saved.stops.length === 3);

  // ---- the same browser: the file, with photos ----
  await b.page.getByRole('button', { name: '← All trips' }).click();
  await b.page.getByRole('button', { name: 'Add a shared trip' }).click();
  await b.page.getByLabel('Shared file').setInputFiles(sharedFile);
  await b.page.getByText('three photos').first().waitFor();
  await b.page.getByRole('button', { name: 'Add it to my trips' }).click();
  await b.page.getByRole('heading', { name: /A week in Portugal \(from/ }).waitFor();
  check('taking the same trip twice keeps both, told apart', (await b.stored('crm-trips-v1')).length === 2);
  check('a trip file brings its photos', await photoCount(b.page) === 3);
  await b.done();

  // ---- a fresh browser: restore the backup, twice ----
  const c = await newPage();
  await c.open();
  await c.page.getByRole('button', { name: 'More' }).click();
  await c.page.getByRole('button', { name: 'Backup file' }).click();
  await c.page.locator('input[type=file][accept^=".zip"]').setInputFiles(backupFile);
  await c.page.getByText(/^Restored/).waitFor();
  const restoredText = await c.page.getByText(/^Restored/).textContent();
  check('restoring brings back trips, photos and people', restoredText.includes('2 trips') && restoredText.includes('3 photos') && restoredText.includes('2 people'), restoredText);
  check('photos are back in IndexedDB', await photoCount(c.page) === 3);
  await c.page.locator('input[type=file][accept^=".zip"]').setInputFiles(backupFile);
  await c.page.getByText('Everything in that backup is already here.').waitFor();
  check('restoring twice adds nothing', (await c.stored('crm-trips-v1')).length === 2 && (await c.stored('crm-people-v1')).length === 2);
  await tab(c.page, 'Trips');
  await c.page.getByRole('button', { name: 'List', exact: true }).click();
  const back = c.page.getByRole('img', { name: 'A week in Portugal, photo 1' });
  await back.waitFor();
  check('a restored trip shows its photos', (await back.getAttribute('src')).startsWith('blob:'));

  // ---- phone width ----
  await c.page.setViewportSize({ width: 390, height: 844 });
  await c.page.getByRole('button', { name: 'Add a trip' }).click();
  const wide = await c.page.evaluate(() => document.documentElement.scrollWidth);
  check('the form fits a phone without sideways scrolling', wide <= 390, wide);
  await c.page.screenshot({ path: path.join(shots, 'trip-form-phone.png'), fullPage: true });
  await c.done();
  void ctx;
  void url;
}
