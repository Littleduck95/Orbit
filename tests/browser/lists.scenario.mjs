// The Lists tab, end to end: making, editing, sorting, reordering, sharing
// (text, email, link, hostile links), backup, CSV, the person card, Recap,
// theming and phone widths. Ported from the suite written with the feature;
// its checks are unchanged, only the harness around them is shared now.
import fs from 'node:fs';
import path from 'node:path';

const people = [
  { id: 'p1', name: 'Dana Whitfield', circle: 'friend', tier: 'friend', cadence: 30, email: 'dana@example.com', log: [], addedOn: '2026-01-02' },
  { id: 'p2', name: 'Sam Ortiz', circle: 'friend', tier: 'bestie', cadence: 7, log: [], addedOn: '2026-01-03' },
];

export default async function lists({ newPage: harnessPage, check, url, shots }) {
  const URL = url;
  const OUT = shots;
  const newPage = async (_browser, { seed = true, width = 1200, height = 900 } = {}) => {
    const h = await harnessPage({ seed: seed ? { 'crm-people-v1': people } : {}, width, height });
    return { ctx: h.ctx, page: h.page, problems: h.problems };
  };
  const tab = (page, name) => page.getByRole('button', { name, exact: true }).first().click();
  const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('orbit:crm-collections-v1') || '[]'));
  const browser = null;

    const { ctx, page, problems } = await newPage(browser);
  await page.goto(URL);
  await page.waitForSelector('text=Lists');

  // ---- empty state ----
  await tab(page, 'Lists');
  await page.waitForSelector('text=No lists yet');
  check('empty state shows quick-start kinds', await page.getByRole('button', { name: 'Books', exact: true }).isVisible());
  await page.screenshot({ path: `${OUT}/01-empty-desktop.png`, fullPage: true });

  // ---- create a Books list from the quick start, then switch templates ----
  await page.getByRole('button', { name: 'Books', exact: true }).click();
  const nameBox = page.getByLabel('Name', { exact: true });
  const templates = page.getByRole('group', { name: 'Templates' });
  const template = (kind) => templates.getByRole('button', { name: new RegExp(`^${kind} `) });
  const change = () => page.getByRole('button', { name: 'Change', exact: true }).click();
  check('quick start prefills the name', (await nameBox.inputValue()) === 'Books to read');
  check('quick start prefills stage words', (await page.getByLabel('Name for the under way stage').inputValue()) === 'Reading');
  check('quick start folds the templates to a line', (await templates.count()) === 0
    && await page.getByText('Template: Books').isVisible());
  await change();
  check('Change opens the templates', await templates.isVisible());
  check('the chosen template is marked', (await template('Books').getAttribute('aria-pressed')) === 'true');
  check('the form has no Other template', (await template('Other').count()) === 0);
  await template('Shows').click();
  check('picking a template folds them away', (await templates.count()) === 0
    && await page.getByText('Template: Shows').isVisible());
  check('switching template swaps the name', (await nameBox.inputValue()) === 'Shows to watch');
  check('switching template swaps the stage words', (await page.getByLabel('Name for the finished stage').inputValue()) === 'Watched');
  await page.getByLabel('Name for the finished stage').fill('Seen it');
  await nameBox.fill('Shows to watchs');
  await page.getByLabel('What it is for').fill('Kept as typed');
  await change();
  await template('Books').click();
  check('switching template replaces an edited name', (await nameBox.inputValue()) === 'Books to read');
  check('switching template replaces edited stage words', (await page.getByLabel('Name for the finished stage').inputValue()) === 'Read');
  check('switching template replaces the line under each title', (await page.getByLabel('The line under each title').inputValue()) === 'Author');
  check('switching template leaves what it is for', (await page.getByLabel('What it is for').inputValue()) === 'Kept as typed');
  await page.getByRole('button', { name: 'Start blank' }).click();
  check('Start blank empties the name', (await nameBox.inputValue()) === '');
  check('Start blank empties the stage words', (await page.getByLabel('Name for the not started stage').inputValue()) === '');
  check('Start blank empties the line under each title', (await page.getByLabel('The line under each title').inputValue()) === '');
  check('Start blank says there is no template', await page.getByText('No template').isVisible());
  await page.getByRole('button', { name: 'Use one', exact: true }).click();
  check('Start blank unmarks the template', (await template('Books').getAttribute('aria-pressed')) === 'false');
  check('with no lists yet there is nothing of yours to copy', (await page.getByRole('group', { name: 'Your lists' }).count()) === 0);
  await template('Shows').click();
  await page.getByLabel('What it is for').fill('Everything people keep telling me to watch.');
  // Empty-name guard
  await nameBox.fill('');
  await page.getByRole('button', { name: 'Make this list' }).click();
  check('empty name is refused with a message', await page.getByText('Give the list a name first.').isVisible());
  await nameBox.fill('Shows to watch');
  await page.screenshot({ path: `${OUT}/02-form.png`, fullPage: true });
  await page.getByRole('button', { name: 'Make this list' }).click();
  await page.waitForSelector('text=← All lists');
  check('saving opens the new list', await page.getByRole('heading', { name: 'Shows to watch' }).isVisible());

  // ---- quick add ----
  const add = page.getByLabel('Add a show');
  for (const t of ['Severance', 'The Bear', 'Shogun', 'Andor', 'a Man on the Inside']) {
    await add.fill(t);
    await add.press('Enter');
  }
  check('quick add keeps focus in the box', await add.evaluate((el) => el === document.activeElement));
  check('quick add confirms', await page.getByText('Added a Man on the Inside.').isVisible());
  let c = (await stored(page))[0];
  check('five entries stored, newest first', c.items.map((i) => i.title).join('|') === 'a Man on the Inside|Andor|Shogun|The Bear|Severance', c.items.map((i) => i.title).join('|'));

  // ---- stepping stages ----
  await page.getByRole('button', { name: /^Severance: Want to watch\. Mark as Watching/ }).click();
  await page.getByRole('button', { name: /^Shogun: Want to watch\. Mark as Watching/ }).click();
  await page.getByRole('button', { name: /^Shogun: Watching\. Mark as Watched/ }).click();
  c = (await stored(page))[0];
  const byT = (t) => c.items.find((i) => i.title === t);
  check('stage steps forward', byT('Severance').status === 'doing' && byT('Shogun').status === 'done');
  check('finishing stamps a date', /^\d{4}-\d{2}-\d{2}$/.test(byT('Shogun').doneOn || ''));
  check('progress reads in words', await page.getByText('1 of 5 watched · 1 watching').isVisible());

  // ---- adding while filtered puts it in that stage ----
  await page.getByRole('button', { name: /^Watched 1/ }).click();
  await add.fill('Slow Horses');
  await add.press('Enter');
  c = (await stored(page))[0];
  check('adding under a stage filter uses that stage', byT && c.items.find((i) => i.title === 'Slow Horses').status === 'done');
  check('new entry is visible in the filtered view', await page.getByRole('button', { name: /^Slow Horses/ }).first().isVisible());
  await page.getByRole('button', { name: /^All 6/ }).click();

  // ---- edit an entry ----
  await page.getByRole('button', { name: /^Severance$/ }).click();
  await page.getByLabel('Where to watch').fill('Apple TV');
  await page.getByRole('radio', { name: '4 stars' }).check({ force: true });
  await page.getByLabel('Recommended by').selectOption({ label: 'Dana Whitfield' });
  await page.getByLabel('Link').fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  check('a javascript: link is refused', await page.getByText('That link does not look right.').isVisible());
  await page.getByLabel('Link').fill('tv.apple.com/show/severance');
  await page.getByLabel('Notes').fill('Dana says stick with it past episode two.');
  await page.screenshot({ path: `${OUT}/03-editor.png`, fullPage: true });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  c = (await stored(page))[0];
  const sev = c.items.find((i) => i.title === 'Severance');
  check('editor saves detail, rating, person, note', sev.detail === 'Apple TV' && sev.rating === 4 && sev.from === 'p1' && sev.note.startsWith('Dana says'));
  check('a bare domain link gets https', sev.link === 'https://tv.apple.com/show/severance', sev.link);
  check('editing leaves the stage alone', sev.status === 'doing');
  check('row shows who recommended it', await page.getByText('Apple TV · from Dana Whitfield').isVisible());
  check('row has an outbound link', await page.getByRole('link', { name: 'Open Severance on tv.apple.com' }).isVisible());

  // ---- sorting ----
  await page.getByLabel('Order').selectOption('title');
  const titles = async () => page.$$eval('.crm-entry .crm-row > span:first-child', (els) => els.map((e) => e.textContent));
  check('A to Z files "The Bear" under B and "a Man" under M',
    (await titles()).join('|') === 'Andor|The Bear|a Man on the Inside|Severance|Shogun|Slow Horses', (await titles()).join('|'));
  c = (await stored(page))[0];
  const updatedBefore = c.updatedAt;
  check('sort choice is saved on the list', c.sort === 'title');
  await page.reload();
  await tab(page, 'Lists');
  await page.getByRole('button', { name: /^Shows to watch/ }).click();
  check('sort choice survives a reload', (await page.getByLabel('Order').inputValue()) === 'title');
  await page.getByLabel('Order').selectOption('rating');
  check('Highest rated puts the rated entry first', (await titles())[0] === 'Severance');
  await page.getByLabel('Order').selectOption('status');
  check('By progress puts under-way first, finished last', (await titles())[0] === 'Severance' && ['Shogun', 'Slow Horses'].includes((await titles()).slice(-1)[0]));
  c = (await stored(page))[0];
  check('changing the order does not count as a change', c.updatedAt === updatedBefore);

  // ---- reorder mode ----
  await page.getByLabel('Order').selectOption('manual');
  await page.getByRole('button', { name: 'Reorder' }).click();
  await page.getByRole('button', { name: 'Move Andor down' }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  c = (await stored(page))[0];
  check('moving down twice with the keyboard', c.items.map((i) => i.title).slice(0, 5).join('|') === 'Slow Horses|a Man on the Inside|Shogun|The Bear|Andor', c.items.map((i) => i.title).join('|'));
  check('focus stays on the arrow after a move', await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) === 'Move Andor down');
  await page.getByRole('button', { name: 'Move Slow Horses up' }).isDisabled().then((d) => check('first row cannot move up', d));
  await page.screenshot({ path: `${OUT}/04-reorder.png`, fullPage: true });
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  // ---- share ----
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await page.screenshot({ path: `${OUT}/05-share.png`, fullPage: true });
  await page.getByRole('button', { name: 'Copy as text' }).click();
  let clip = await page.evaluate(() => navigator.clipboard.readText());
  check('text share groups by stage', /Want to watch\n- a Man on the Inside/.test(clip) && /Watching\n- Severance \(Apple TV\) ★★★★☆/.test(clip), JSON.stringify(clip.slice(0, 200)));
  check('text share leaves notes and who recommended out by default', !clip.includes('episode two') && !clip.includes('Dana Whitfield') && !clip.includes('keep telling'));
  await page.getByLabel('Include my notes').check();
  await page.getByRole('button', { name: 'Copy as text' }).click();
  clip = await page.evaluate(() => navigator.clipboard.readText());
  check('text share includes notes when asked', clip.includes('episode two') && clip.includes('keep telling me'));
  check('even with notes, who recommended stays private', !clip.includes('from Dana') && !clip.includes('Dana Whitfield'));
  await page.getByLabel('Include my notes').uncheck();
  await page.getByLabel('Show progress and ratings').uncheck();
  await page.getByRole('button', { name: 'Copy as text' }).click();
  clip = await page.evaluate(() => navigator.clipboard.readText());
  check('without progress it is a numbered list in my order', /\n1\. Slow Horses\n2\. a Man on the Inside/.test(clip) && !clip.includes('★'), JSON.stringify(clip.slice(0, 120)));
  const mailHref = await page.getByRole('link', { name: /Email it to Dana/ }).getAttribute('href');
  check('email goes to the contact with the list in the body', mailHref.startsWith('mailto:dana@example.com?subject=Shows%20to%20watch&body='));
  await page.getByRole('button', { name: 'Copy Orbit link' }).click();
  const link = await page.evaluate(() => navigator.clipboard.readText());
  check('link carries a share code', link.startsWith(`${URL}#share=`) && /#share=[A-Za-z0-9_-]+$/.test(link), `${link.length} chars`);

  // ---- open the link as someone else ----
  const other = await newPage(browser, { seed: false });
  await other.page.goto(link);
  await other.page.waitForSelector('text=A list was shared with you');
  check('link opens straight to the offer', await other.page.getByText('Shows to watch').first().isVisible());
  check('the link is cleared from the address bar', !other.page.url().includes('share='), other.page.url());
  check('nothing is added before they say so', (await stored(other.page)).length === 0);
  await other.page.screenshot({ path: `${OUT}/06-incoming.png`, fullPage: true });
  await other.page.getByRole('button', { name: 'Add to my lists' }).click();
  const theirs = (await stored(other.page))[0];
  check('their copy has every entry', theirs.items.length === 6);
  check('their copy starts fresh: no progress, ratings or dates', theirs.items.every((i) => i.status === 'want' && !i.rating && !i.doneOn));
  check('their copy keeps links but not my notes, people or description', theirs.items.find((i) => i.title === 'Severance').link === 'https://tv.apple.com/show/severance'
    && theirs.items.every((i) => !i.note && !i.from) && !theirs.note);
  check('their copy keeps my stage words and order', theirs.labels.done === 'Watched' && theirs.items[0].title === 'Slow Horses');
  check('ids are fresh', theirs.id !== c.id);
  check('opened after adding', await other.page.getByRole('heading', { name: 'Shows to watch' }).isVisible());

  // A second copy of the same list gets a distinct name rather than colliding.
  await other.page.goto(link.replace(URL, `${URL}?again=1`));
  await other.page.waitForSelector('text=A list was shared with you');
  await other.page.getByRole('button', { name: 'Add to my lists' }).click();
  const two = await stored(other.page);
  check('a clashing name says where it came from', two.length === 2 && two[1].name === 'Shows to watch (from a friend)', two.map((x) => x.name).join(' / '));

  // ---- a broken or hostile link ----
  await other.page.goto(`${URL}#share=notreallyacode`);
  await other.page.waitForSelector('text=That shared list could not be read');
  check('a broken link says so', true);
  await other.page.getByRole('button', { name: 'Close' }).click();
  const hostile = await other.page.evaluate(() => {
    const obj = { v: 1, n: '<img src=x onerror=alert(1)>', k: 'Nope', t: 1, l: ['', '', ''], dl: '', by: 'Mallory',
      i: [['Click me', '', 'javascript:alert(document.domain)'], ['Fine', '', 'https://ok.example/'], [42, '', ''], ['', 'no title']] };
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = ''; bytes.forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  });
  await other.page.getByRole('button', { name: 'Add a shared list' }).click();
  await other.page.getByLabel('Paste a shared list').fill(`Here you go: ${URL}#share=${hostile}`);
  await other.page.getByRole('button', { name: 'Add it' }).click();
  const h = (await stored(other.page)).find((x) => x.name.includes('img'));
  check('hostile list: javascript: link dropped, https kept', h && h.items.find((i) => i.title === 'Click me').link === '' && h.items.find((i) => i.title === 'Fine').link === 'https://ok.example/');
  check('hostile list: bad kind falls back, junk rows dropped, numbers coerced', h.kind === 'Other' && h.items.length === 3 && h.items.some((i) => i.title === '42'));
  check('hostile list: name renders as text, not markup', await other.page.getByRole('heading', { name: '<img src=x onerror=alert(1)>' }).isVisible());
  check('no anchor with a javascript: href anywhere', (await other.page.$$eval('a', (as) => as.filter((a) => /^javascript:/i.test(a.getAttribute('href') || '')).length)) === 0);
  await other.page.getByRole('button', { name: '← All lists' }).click();
  await other.page.getByRole('button', { name: 'Add a shared list' }).click();
  await other.page.getByLabel('Paste a shared list').fill('hello there');
  await other.page.getByRole('button', { name: 'Add it' }).click();
  check('pasting nonsense is refused', await other.page.getByText('That does not look like a shared list.').isVisible());
  check('the other browser stayed clean', other.problems.length === 0, other.problems.join(' | '));
  await other.ctx.close();

  // ---- the person card links back ----
  await tab(page, 'People');
  await page.getByText('Dana Whitfield').first().click();
  check('person card lists what they recommended', await page.getByRole('button', { name: /Severance — Shows to watch/ }).isVisible());
  await page.screenshot({ path: `${OUT}/07-person.png`, fullPage: true });
  await page.getByRole('button', { name: /Severance — Shows to watch/ }).click();
  check('and it opens that list', await page.getByRole('heading', { name: 'Shows to watch' }).isVisible());

  // ---- second list: plain, no stages ----
  await page.getByRole('button', { name: '← All lists' }).click();
  await page.getByRole('button', { name: 'New list' }).click();
  check('a new list starts blank', (await page.getByLabel('Name', { exact: true }).inputValue()) === ''
    && (await page.getByLabel('The line under each title').inputValue()) === ''
    && (await page.getByLabel('Name for the finished stage').inputValue()) === '');
  check('a new list starts with no template chosen', (await template('Shows').getAttribute('aria-pressed')) === 'false');
  check('a new list offers your own lists as templates', await page.getByRole('group', { name: 'Your lists' })
    .getByRole('button', { name: /^Shows to watch Want to watch · Watching · Watched/ }).isVisible());
  await page.getByLabel('Name', { exact: true }).fill('Gift ideas for Mom');
  check('typing a name leaves the templates open', await templates.isVisible());
  await page.getByRole('button', { name: 'No, just a list' }).click();
  check('moving on from the name folds them away', (await templates.count()) === 0
    && await page.getByText('No template').isVisible());
  await page.getByLabel('The line under each title').fill('');
  await page.getByRole('button', { name: 'Make this list' }).click();
  const add2 = page.getByLabel('Add something');
  for (const t of ['Pottery class', 'Good olive oil']) { await add2.fill(t); await add2.press('Enter'); }
  check('a plain list has no stage buttons', (await page.getByRole('button', { name: /Mark as/ }).count()) === 0);
  check('a plain list numbers its rows', (await page.$$eval('.crm-entry > span[aria-hidden]', (els) => els.map((e) => e.textContent))).join(',') === '1,2');
  check('a plain list offers no By progress order', (await page.getByLabel('Order').locator('option').allTextContents()).indexOf('By progress') === -1);

  // ---- one of your own lists as the template for the next ----
  await page.getByRole('button', { name: '← All lists' }).click();
  await page.getByRole('button', { name: 'New list' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Tabbed past');
  await page.getByLabel('Name', { exact: true }).press('Tab');
  check('tabbing on from the name folds the templates', (await templates.count()) === 0);
  await page.getByRole('button', { name: 'Use one', exact: true }).click();
  await page.getByRole('group', { name: 'Your lists' }).getByRole('button', { name: /^Gift ideas for Mom Just a list/ }).click();
  check('your own list folds to a line naming it', await page.getByText('Template: like Gift ideas for Mom').isVisible());
  check('your own list leaves the name for you', (await page.getByLabel('Name', { exact: true }).inputValue()) === '');
  check('your own list brings its no-stages setup', (await page.getByRole('button', { name: 'No, just a list' }).getAttribute('aria-pressed')) === 'true');
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await page.getByRole('group', { name: 'Your lists' }).getByRole('button', { name: /^Shows to watch / }).click();
  check('your own list brings its stage words', (await page.getByLabel('Name for the finished stage').inputValue()) === 'Watched'
    && (await page.getByRole('button', { name: 'Yes, in stages' }).getAttribute('aria-pressed')) === 'true');
  await page.screenshot({ path: `${OUT}/02b-form-yours.png`, fullPage: true });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: /^Gift ideas for Mom/ }).click();

  // ---- overview: search, kinds, cards ----
  await page.getByRole('button', { name: '← All lists' }).click();
  check('overview headline counts lists', await page.getByRole('heading', { name: 'Two lists on the go' }).isVisible());
  check('most recently changed first', (await page.$$eval('.crm-shell button span span:first-child', (e) => e.map((x) => x.textContent)))[0] === 'Gift ideas for Mom');
  await page.screenshot({ path: `${OUT}/08-overview-desktop.png`, fullPage: true });
  await page.getByPlaceholder('Search lists and everything on them').fill('olive');
  check('search finds lists by what is on them', await page.getByRole('heading', { name: 'One list matches' }).isVisible() && await page.getByText('1 matching:').isVisible());
  await page.getByPlaceholder('Search lists and everything on them').fill('');
  await page.getByRole('button', { name: 'Shows', exact: true }).click();
  check('kind filter narrows', await page.getByRole('heading', { name: 'One list matches' }).isVisible());
  await page.getByRole('button', { name: 'All', exact: true }).click();

  // ---- recap ----
  await tab(page, 'Recap');
  check('recap counts what was crossed off', await page.getByText('crossed off your lists').isVisible());

  // ---- backup contains lists; a lists-only backup restores ----
  await tab(page, 'People');
  await page.getByRole('button', { name: 'Back up' }).click();
  const backup = await page.locator('textarea[readonly]').inputValue();
  const parsed = JSON.parse(backup);
  check('backup includes lists', Array.isArray(parsed.collections) && parsed.collections.length === 2);

  const fresh = await newPage(browser, { seed: false });
  await fresh.page.goto(URL);
  await fresh.page.waitForSelector('text=Lists');
  // A lists-only user still needs to find Back up and Restore.
  await fresh.page.evaluate(() => localStorage.setItem('orbit:crm-collections-v1', JSON.stringify([{ id: 'x', name: 'Only lists', kind: 'Books', items: [{ title: 'Dune' }] }])));
  await fresh.page.reload();
  await fresh.page.waitForSelector('text=Lists');
  check('backup is reachable with lists but no people', await fresh.page.getByRole('button', { name: 'Back up' }).isVisible());
  await fresh.page.getByRole('button', { name: 'Restore' }).click();
  await fresh.page.getByPlaceholder('Paste here').fill(JSON.stringify({ people: [], events: [], reminders: [], collections: parsed.collections }));
  await fresh.page.getByRole('button', { name: 'Replace my lists' }).click();
  const restored = await stored(fresh.page);
  check('a backup with lists and no people restores', restored.length === 2 && restored[0].items.length === 6, JSON.stringify(restored.map((x) => x.name)));
  check('restore keeps progress and notes', restored[0].items.find((i) => i.title === 'Severance').note.startsWith('Dana says'));
  await fresh.page.getByRole('button', { name: 'Restore' }).click();
  await fresh.page.getByPlaceholder('Paste here').fill(JSON.stringify({ people: [], events: [], reminders: [], collections: [] }));
  await fresh.page.getByRole('button', { name: 'Replace my lists' }).click();
  check('an empty backup is still refused', await fresh.page.getByText('That backup could not be read.').isVisible() && (await stored(fresh.page)).length === 2);
  // Old bare-array backups (people only) still restore and clear lists.
  await fresh.page.getByPlaceholder('Paste here').fill(JSON.stringify(people));
  await fresh.page.getByRole('button', { name: 'Replace my lists' }).click();
  check('an old people-only backup still restores', (await stored(fresh.page)).length === 0 && await fresh.page.getByText('Dana Whitfield').first().isVisible());
  check('the restore browser stayed clean', fresh.problems.length === 0, fresh.problems.join(' | '));
  await fresh.ctx.close();

  // ---- CSV export and import ----
  await page.getByRole('button', { name: 'Hide backup' }).click();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  for (const label of [/^People/, /^Events/, /^Reminders/]) await page.getByLabel(label).uncheck();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  const csvPath = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, 'utf8');
  check('lists export as one row per entry', csv.split('\n')[0].trim() === 'List,List kind,Title,Detail,Status,Rating,Link,Notes,Added,Finished on' && csv.trim().split('\n').length === 9, dl.suggestedFilename());
  check('export uses the list\'s own stage words', csv.includes('Shows to watch,Shows,Severance,Apple TV,Watching,4,'));

  const sheet = path.join(OUT, 'reading.csv');
  fs.writeFileSync(sheet, 'List,Title,Detail,Status,Rating\nShows to watch,Pachinko,Apple TV,Watched,5\nBooks,The Overstory,Richard Powers,Reading,\nBooks,Piranesi,Susanna Clarke,finished,4\n,No list,,,\n');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByLabel('CSV file').setInputFiles(sheet);
  await page.waitForSelector('text=lists ready');
  check('import recognises a lists sheet', await page.getByText('3 lists ready').isVisible());
  await page.getByRole('button', { name: /^Add 3 lists/ }).click();
  const after = await stored(page);
  const shows = after.find((x) => x.name === 'Shows to watch');
  const books = after.find((x) => x.name === 'Books');
  check('entries for an existing list join it', shows.items.length === 7 && shows.items.some((i) => i.title === 'Pachinko' && i.status === 'done' && i.rating === 5));
  check('status words are read back', books.items.find((i) => i.title === 'The Overstory').status === 'doing' && books.items.find((i) => i.title === 'Piranesi').status === 'done');
  check('rows with no list name go to a list named after the file', after.some((x) => x.name === 'reading' && x.items[0].title === 'No list'));
  check('a sheet with no kind column takes the kind from the list name', books.kind === 'Books' && books.labels.doing === 'Reading'
    && after.find((x) => x.name === 'reading').kind === 'Books', `${books.kind}`);

  // ---- theme ----
  await tab(page, 'People');
  await page.getByRole('button', { name: 'Orbit', exact: true }).last().click();
  await tab(page, 'Lists');
  await page.screenshot({ path: `${OUT}/09-overview-orbit.png`, fullPage: true });
  const tops = await page.$$eval('.crm-shell button[style*="flex-direction: column"] > span:first-child',
    (els) => els.slice(0, 3).map((e) => Math.round(e.getBoundingClientRect().top)));
  check('cards in a row line up at the top', tops.length === 3 && new Set(tops).size === 1, tops.join(','));
  const chipColor = await page.locator('.crm-shell button span span').nth(1).evaluate((e) => getComputedStyle(e).color);
  check('kind chips follow the theme', chipColor === 'rgb(163, 176, 202)', chipColor);
  await page.getByRole('button', { name: /^Shows to watch/ }).click();
  await page.screenshot({ path: `${OUT}/10-detail-orbit.png`, fullPage: true });

  // ---- phone width ----
  const phone = await newPage(browser, { seed: false, width: 390, height: 844 });
  await phone.page.goto(URL);
  await phone.page.waitForSelector('text=Lists');
  await phone.page.evaluate((cs) => localStorage.setItem('orbit:crm-collections-v1', JSON.stringify(cs)), after);
  await phone.page.reload();
  await phone.page.waitForSelector('text=Lists');
  await tab(phone.page, 'Lists');
  await phone.page.screenshot({ path: `${OUT}/11-overview-phone.png`, fullPage: true });
  const overflow = await phone.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check('no sideways scroll at phone width (overview)', !overflow);
  await phone.page.getByRole('button', { name: /^Shows to watch/ }).click();
  await phone.page.screenshot({ path: `${OUT}/12-detail-phone.png`, fullPage: true });
  check('no sideways scroll at phone width (list)', !(await phone.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
  await phone.page.getByRole('button', { name: 'Reorder' }).click();
  await phone.page.screenshot({ path: `${OUT}/13-reorder-phone.png`, fullPage: true });
  check('no sideways scroll at phone width (reorder)', !(await phone.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));

  // A phone picks a template from a dropdown rather than a screenful of cards.
  await tab(phone.page, 'Lists');
  await phone.page.getByRole('button', { name: 'New list' }).click();
  const pick = phone.page.getByLabel('Start from a template');
  check('a phone gets a template dropdown', await pick.isVisible());
  check('and no template cards', (await phone.page.getByRole('group', { name: 'Templates' }).count()) === 0);
  check('the dropdown starts blank', (await pick.inputValue()) === '');
  check('the dropdown offers your own lists', (await pick.locator('optgroup[label="Like one of yours"] option').allTextContents()).includes('Shows to watch'));
  await pick.selectOption({ label: 'Books' });
  check('a dropdown template fills in the words', (await phone.page.getByLabel('Name', { exact: true }).inputValue()) === 'Books to read'
    && (await phone.page.getByLabel('Name for the under way stage').inputValue()) === 'Reading');
  await pick.selectOption({ label: 'Shows to watch' });
  check('a dropdown own list copies its setup', (await phone.page.getByLabel('Name', { exact: true }).inputValue()) === ''
    && (await phone.page.getByLabel('Name for the finished stage').inputValue()) === 'Watched');
  await pick.selectOption('');
  check('None clears the words again', (await phone.page.getByLabel('Name for the finished stage').inputValue()) === '');
  await phone.page.screenshot({ path: `${OUT}/14-new-list-phone.png`, fullPage: true });
  check('no sideways scroll at phone width (new list)', !(await phone.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
  await phone.page.getByRole('button', { name: 'Cancel', exact: true }).click();
  check('the phone browser stayed clean', phone.problems.length === 0, phone.problems.join(' | '));

  // ---- a browser that refuses the clipboard still lets you copy by hand ----
  await phone.page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) } });
  });
  await phone.page.reload();
  await phone.page.waitForSelector('text=Lists');
  await tab(phone.page, 'Lists');
  await phone.page.getByRole('button', { name: /^Books Books/ }).click();
  await phone.page.getByRole('button', { name: 'Share', exact: true }).click();
  await phone.page.getByRole('button', { name: 'Copy as text' }).click();
  check('refused clipboard explains itself', await phone.page.getByText('Copying was blocked here.').isVisible());
  const manual = await phone.page.getByLabel('Text to copy').inputValue();
  check('and shows the text to copy by hand', manual.startsWith('Books\n\nReading\n- The Overstory (Richard Powers)\n\nRead\n- Piranesi') && !manual.includes('Want to read'), JSON.stringify(manual.slice(0, 90)));
  check('no Share… button where the system share sheet is missing', (await phone.page.getByRole('button', { name: 'Share…' }).count()) === 0);
  await phone.ctx.close();

  // ---- fixes from the review ----
  const rv = await newPage(browser, { seed: true });
  const P = rv.page;
  await P.addInitScript(() => {
    if (localStorage.getItem('orbit:review-seeded')) return;
    localStorage.setItem('orbit:review-seeded', '1');
    const mk = (n, title) => ({ id: `e${n}`, title, status: 'want', addedOn: '2026-09-01' });
    localStorage.setItem('orbit:crm-collections-v1', JSON.stringify([
      { id: 'plain', name: 'Top albums', kind: 'Music', track: false, detail: '', labels: {}, items: [{ id: 'a1', title: 'Blue', detail: 'Joni Mitchell' }] },
      { id: 'full', name: 'Almost full', kind: 'Books', track: true, labels: { want: 'Want to read', doing: 'Reading', done: 'Read' }, detail: 'Author',
        items: Array.from({ length: 1999 }, (_, i) => mk(i, `Book ${i}`)) },
      { id: 'b', name: 'Board games', kind: 'Games', track: true, labels: { want: 'Want to play', doing: 'Playing', done: 'Finished' }, detail: 'Platform', items: [] },
    ]));
  });
  await P.goto(URL);
  await P.waitForSelector('text=Lists');
  await tab(P, 'Lists');

  // The overview remembers where you were.
  await P.getByLabel('Search lists').fill('blue');
  await P.getByLabel('Order').selectOption('name');
  await P.getByRole('button', { name: /^Top albums/ }).click();
  await P.getByRole('button', { name: '← All lists' }).click();
  check('back from a list keeps the search and order', (await P.getByLabel('Search lists').inputValue()) === 'blue'
    && (await P.getByLabel('Order').inputValue()) === 'name');
  await P.getByLabel('Search lists').fill('');

  // The detail box does not vanish mid-edit on a list with no detail line.
  await P.getByRole('button', { name: /^Top albums/ }).click();
  await P.getByRole('button', { name: /^Blue/ }).click();
  await P.getByLabel('Detail', { exact: true }).fill('');
  check('clearing the detail keeps its box on screen', await P.getByLabel('Detail', { exact: true }).isVisible());
  await P.getByRole('button', { name: 'Cancel', exact: true }).click();

  // An Enter that finishes an input-method word does not add anything.
  const before = (await stored(P)).find((x) => x.id === 'plain').items.length;
  await P.getByLabel('Add an album').fill('あお');
  await P.getByLabel('Add an album').evaluate((el) => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true }));
  });
  check('an input-method Enter does not add a half-typed entry', (await stored(P)).find((x) => x.id === 'plain').items.length === before);
  await P.getByLabel('Add an album').press('Enter');
  check('a real Enter still adds it', (await stored(P)).find((x) => x.id === 'plain').items.length === before + 1);

  // A plain ranked list shared with the default settings stays numbered.
  await P.getByRole('button', { name: 'Share', exact: true }).click();
  await P.getByRole('button', { name: 'Copy as text' }).click();
  const ranked = await P.evaluate(() => navigator.clipboard.readText());
  check('a plain list shares as a numbered ranking', ranked === 'Top albums\n\n1. あお\n2. Blue (Joni Mitchell)', JSON.stringify(ranked));
  await P.getByRole('button', { name: 'Done sharing' }).click();

  // A link pasted into the address bar mid-form does not throw the form away.
  const code = await P.evaluate(() => {
    const obj = { v: 1, n: 'From Sam', k: 'Books', t: 1, l: ['', '', ''], dl: '', by: 'Sam', i: [['Dune']] };
    return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  });
  await P.getByRole('button', { name: '← All lists' }).click();
  await P.getByRole('button', { name: 'New list' }).click();
  await P.getByLabel('Name', { exact: true }).fill('Half typed');
  await P.evaluate((c) => { window.location.hash = `share=${c}`; }, code);
  await P.waitForSelector('text=Sam shared a list with you: From Sam.');
  check('a later link waits in a notice', true);
  check('and the open form keeps what was typed', (await P.getByLabel('Name', { exact: true }).inputValue()) === 'Half typed');
  check('and the address bar is cleared', !P.url().includes('share='));
  await P.getByRole('button', { name: 'See it' }).click();
  check('See it opens the offer', await P.getByRole('button', { name: 'Add to my lists' }).isVisible());
  await P.getByRole('button', { name: 'Not now' }).click();

  // The share link says whose name goes with it.
  await P.getByRole('button', { name: 'Orbit', exact: true }).first().click();
  await P.getByPlaceholder('Your name').fill('Brock');
  await P.getByPlaceholder('Your name').press('Enter');
  await P.getByRole('button', { name: /^Top albums/ }).click();
  await P.getByRole('button', { name: 'Share', exact: true }).click();
  check('the share panel says the link carries your name', await P.getByText('It tells them it is from Brock.').isVisible());
  await P.getByRole('button', { name: '← All lists' }).click();

  // Imports: a people sheet with a job Title stays people; an import that
  // would pass the limit says so first.
  const peopleSheet = path.join(OUT, 'team.csv');
  fs.writeFileSync(peopleSheet, 'Name,List,Title,Email\nAva Chen,Professional,Director,ava@example.com\n');
  await P.getByRole('button', { name: 'More', exact: true }).click();
  await P.getByRole('button', { name: 'Import', exact: true }).click();
  await P.getByLabel('CSV file').setInputFiles(peopleSheet);
  await P.waitForSelector('text=ready');
  check('a people sheet with a Title column is still read as people', await P.getByText('1 people ready').isVisible());
  const bookSheet = path.join(OUT, 'more-books.csv');
  fs.writeFileSync(bookSheet, 'List,Title,Status\nAlmost full,Extra 1,Read\nAlmost full,Extra 2,\nAlmost full,Extra 3,\n');
  await P.getByLabel('CSV file').setInputFiles(bookSheet);
  await P.waitForSelector('text=lists ready');
  check('an import past the limit says how many will not fit', await P.getByText('Two entries will not fit. A list holds at most 2,000.').isVisible());
  await P.getByLabel('Replace everything').check();
  check('and the count follows the choice of add or replace', !(await P.getByText('will not fit').isVisible()));
  await P.getByLabel('Add to what I already have').check();
  await P.getByRole('button', { name: /^Add 1 lists/ }).click();
  const full = (await stored(P)).find((x) => x.id === 'full');
  check('a merge fills the list to the limit and no further', full.items.length === 2000 && full.items[1999].title === 'Extra 1' && full.items[1999].status === 'done');
  check('the review browser stayed clean', rv.problems.length === 0, rv.problems.join(' | '));
  await rv.ctx.close();

  check('no console errors or React warnings', problems.length === 0, problems.join(' | '));

  await ctx.close();
}
