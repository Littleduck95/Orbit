// Sharing a person as a copy, end to end: the sender picks fields and gets a
// link, file and QR code; a recipient previews it, adds or merges, and the
// card says where it came from.
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DANA = {
  id: 'dana', name: 'Dana Whitfield', circle: 'friend', tier: 'bestie', relation: 'Cousin', vip: true, cadence: 14,
  role: 'Designer', company: 'Hallmark', aka: ['Dee'], email: 'dana@example.com', phone: '+1 (816) 555-0142',
  address: '4512 Wornall Rd', birthday: '1990-06-14', note: 'PRIVATE-NOTE owes me lunch', groups: ['Book club'],
  families: [], kids: [], socials: {}, dates: [], log: [{ date: '2026-09-01', text: 'PRIVATE-LOG the move' }],
  lastContact: '2026-09-01', addedOn: '2020-01-01',
};

const decode = (link) => JSON.parse(zlib.inflateRawSync(Buffer.from(link.split('#share=')[1].slice(1), 'base64url')).toString());

export default async function share({ newPage, check }) {
  // ---- sending ----
  const sender = await newPage({ seed: { 'crm-people-v1': [DANA], 'crm-owner-v1': 'Brock' } });
  const s = sender.page;
  await sender.open();
  await s.locator('.crm-person .crm-row', { hasText: 'Dana Whitfield' }).click();
  await s.getByRole('button', { name: 'Share', exact: true }).click();
  check('the Share panel opens on the card', await s.getByText('Share Dana’s card').isVisible());

  const box = (name) => s.getByRole('checkbox', { name: new RegExp(`^${name}`) });
  check('role and company, and also known as, start ticked',
    await box('Role and company').isChecked() && await box('Also known as').isChecked());
  check('contact details start unticked',
    !(await box('Email').isChecked()) && !(await box('Phone').isChecked()) && !(await box('Address').isChecked()) && !(await box('Birthday').isChecked()));
  check('private fields are offered separately, unticked',
    await s.getByText('Anyone with the link can read them.').isVisible()
      && !(await box('Notes').isChecked()) && !(await box('“Knows” tags').isChecked()) && !(await box('Check-in cadence').isChecked()));
  check('closeness is never offered', (await s.getByRole('checkbox', { name: /Closeness|Bestie/ }).count()) === 0);
  check('the sender name starts as mine', (await s.getByPlaceholder('Your name, so they know who sent it').inputValue()) === 'Brock');

  await box('Phone').check();
  check('says what is going', await s.getByText('Sending: Name, Role and company, Also known as, Phone.').isVisible());
  await s.getByRole('button', { name: 'Copy link' }).click();
  await s.getByText('The link is copied.').waitFor();
  const link = await s.evaluate(() => navigator.clipboard.readText());
  const sent = decode(link);
  check('the link carries the ticked fields', sent.p[0].ph === '+1 (816) 555-0142' && sent.p[0].co === 'Hallmark' && sent.by === 'Brock', sent);
  const raw = JSON.stringify(sent);
  check('and nothing unticked or private', ['PRIVATE', 'dana@example.com', 'Wornall', '1990', 'Book club', 'bestie', 'Cousin', '"c"', 'vip', 'dana"']
    .every((x) => !raw.includes(x)), raw);

  await s.getByRole('button', { name: 'QR code' }).click();
  check('a QR code can be shown', await s.getByRole('img', { name: 'QR code for Dana Whitfield\'s card' }).isVisible({ timeout: 5000 })
    || await s.getByRole('img', { name: 'QR code for Dana Whitfield\'s card' }).waitFor({ timeout: 5000 }).then(() => true, () => false));

  const [download] = await Promise.all([s.waitForEvent('download'), s.getByRole('button', { name: 'Save as file' }).click()]);
  // Kept outside the browser's own folder, which goes when its page closes.
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-share-')), 'dana-whitfield.orbit');
  await download.saveAs(file);
  const fileText = fs.readFileSync(file, 'utf8');
  check('saves a .orbit file holding the same share', download.suggestedFilename() === 'dana-whitfield.orbit'
    && JSON.parse(fileText).orbit === 'share' && !fileText.includes('PRIVATE'));
  await sender.done();

  // ---- receiving someone new ----
  const fresh = await newPage();
  await fresh.page.goto(link);
  const f = fresh.page;
  check('opening the link shows what was sent, and who from', await f.getByRole('heading', { name: 'Dana Whitfield' }).isVisible({ timeout: 5000 })
    || await f.getByRole('heading', { name: 'Dana Whitfield' }).waitFor({ timeout: 5000 }).then(() => true, () => false));
  check('names the sender, and says the name is theirs to give', await f.getByText('Brock sent you a contact on Sep 22, 2026').isVisible()
    && await f.getByText('“Brock” is the name the sender gave; Orbit cannot check it.', { exact: false }).isVisible());
  check('lists exactly the fields in it', await f.getByText('+1 (816) 555-0142').isVisible() && !(await f.getByText('Notes').isVisible()));
  check('the link is taken out of the address bar', !(await f.evaluate(() => window.location.hash)));
  check('nothing is added before saying so', (await fresh.stored('crm-people-v1')) === null);
  await f.getByRole('button', { name: 'Professional', exact: true }).click();
  await f.getByRole('button', { name: 'Add Dana' }).click();
  await f.getByText('From Brock').waitFor();
  const added = (await fresh.stored('crm-people-v1'))[0];
  check('adds them to the circle chosen, with where they came from', added.circle === 'work' && added.phone === '+1 (816) 555-0142'
    && added.via?.by === 'Brock' && added.via?.on === '2026-09-22', added);
  check('with none of the sender\'s side of things', !added.note && added.log.length === 0 && !added.lastContact && !added.vip && added.tier === null);
  await f.getByRole('button', { name: 'Remove the note about where this came from' }).click();
  await f.waitForTimeout(200);
  check('the from-note can be taken off', !('via' in (await fresh.stored('crm-people-v1'))[0]) && !(await f.getByText('From Brock').isVisible()));
  await fresh.done();

  // ---- receiving someone already here ----
  const mine = { id: 'mine', name: 'Dee W', circle: 'friend', tier: 'friend', cadence: 30, role: 'Illustrator', company: '',
    phone: '816.555.0142', note: 'MY-NOTE', aka: [], kids: [], groups: [], families: [], socials: {}, dates: [], log: [] };
  const have = await newPage({ seed: { 'crm-people-v1': [mine] } });
  const h = have.page;
  await h.goto(link);
  await h.getByText('You may already have them.').waitFor({ timeout: 5000 });
  check('spots the match and says why', await h.getByText('Dee W (same phone)').isVisible());
  check('merge is offered first', (await h.getByRole('radio', { name: 'Merge' }).getAttribute('aria-checked')) === 'true');
  check('a difference starts on keeping mine', await h.getByRole('radio', { name: 'Keep mine: Illustrator' }).isChecked()
    && !(await h.getByRole('radio', { name: 'Use theirs: Designer' }).isChecked()));
  check('a blank starts on filling it in', await h.getByRole('checkbox', { name: 'Fill in company: Hallmark' }).isChecked());
  await h.getByRole('checkbox', { name: 'Fill in company: Hallmark' }).uncheck();
  await h.getByRole('button', { name: 'Merge' }).last().click();
  await h.getByText('From Brock').waitFor();
  const merged = await have.stored('crm-people-v1');
  check('merges into the same card, changing only what was ticked', merged.length === 1 && merged[0].id === 'mine'
    && merged[0].role === 'Illustrator' && merged[0].company === '' && merged[0].note === 'MY-NOTE' && merged[0].cadence === 30
    && JSON.stringify(merged[0].aka) === JSON.stringify(['Dee', 'Dana Whitfield']), merged[0]);
  await have.done();

  // ---- a file, added as new despite a match; skipping; a broken link ----
  const other = await newPage({ seed: { 'crm-people-v1': [mine] } });
  const o = other.page;
  await other.open();
  await o.getByRole('button', { name: 'More' }).click();
  await o.getByRole('button', { name: 'Import' }).click();
  await o.getByLabel('Shared file').setInputFiles(file);
  await o.getByText('You may already have them.').waitFor({ timeout: 5000 });
  check('a .orbit file opens from Import', await o.getByRole('heading', { name: 'Dana Whitfield' }).isVisible());
  await o.getByRole('radio', { name: 'Add as new' }).click();
  await o.getByRole('button', { name: 'Add Dana' }).click();
  await o.getByText('From Brock').waitFor();
  check('Add as new keeps both', (await other.stored('crm-people-v1')).length === 2);

  await o.getByRole('button', { name: 'More' }).click();
  await o.getByRole('button', { name: 'Import' }).click();
  await o.getByLabel('Shared link').fill(link);
  await o.getByRole('button', { name: 'Open', exact: true }).click();
  await o.getByRole('radio', { name: 'Skip' }).first().click();
  await o.getByRole('button', { name: 'Done', exact: true }).last().click();
  check('Skip changes nothing', (await other.stored('crm-people-v1')).length === 2);

  await o.getByRole('button', { name: 'More' }).click();
  await o.getByRole('button', { name: 'Import' }).click();
  await o.getByLabel('Shared link').fill('not a share');
  await o.getByRole('button', { name: 'Open', exact: true }).click();
  check('something that is not a share is turned away', await o.getByRole('alert').getByText('That is not something Orbit can open.', { exact: false }).isVisible());

  // Arriving on the page shows the Receive screen; one that arrives while
  // Orbit is already open only raises a notice.
  await o.evaluate(() => { window.location.hash = '#share=zBROKENBROKENBROKEN'; });
  check('a share arriving while Orbit is open waits in a notice',
    await o.getByRole('status').getByText('Something shared with you arrived but could not be read.').waitFor({ timeout: 5000 }).then(() => true, () => false));
  await o.goto(`${link.split('#')[0]}?fresh#share=zBROKENBROKENBROKEN`);
  check('a broken share link says so', await o.getByRole('heading', { name: 'That share could not be read' }).waitFor({ timeout: 5000 }).then(() => true, () => false));
  await other.done();
}
