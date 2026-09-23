// Reminders: starters, repeating and one-off reminders, and every action on a
// card.
export default async function reminders({ newPage, check, TODAY }) {
  const { page, open, stored, done } = await newPage({
    seed: { 'crm-people-v1': [{ id: 'dana', name: 'Dana Whitfield', circle: 'friend', tier: 'friend', cadence: 30, log: [] }] },
  });
  await open();
  await page.getByRole('button', { name: 'Reminders', exact: true }).click();
  check('an empty tab says so', await page.getByRole('heading', { name: 'Nothing to remember yet' }).isVisible());

  // ---- a starter is filled in, not saved, until confirmed ----
  await page.getByRole('button', { name: /Things worth remembering/ }).click();
  await page.getByRole('button', { name: /^Replace the HVAC filter/ }).click();
  check('a starter opens the form filled in', (await page.getByLabel('What to remember').inputValue()) === 'Replace the HVAC filter'
    && (await stored('crm-reminders-v1')) === null);
  await page.getByRole('button', { name: 'Add this reminder' }).click();
  let rs = await stored('crm-reminders-v1');
  const filter = rs[0];
  check('the starter is saved one interval out, counting from completion', filter.next === '2026-12-22' && filter.anchor === 'done'
    && filter.every.unit === 'month' && filter.every.n === 3, filter);

  // ---- a monthly bill, already late ----
  await page.getByRole('button', { name: 'Add a reminder' }).click();
  await page.getByLabel('What to remember').fill('Pay the card');
  await page.getByLabel('Kind').selectOption('Money');
  await page.getByLabel('Next one due').fill('2026-09-20');
  await page.getByRole('button', { name: 'Dana Whitfield', exact: true }).click();
  await page.getByRole('button', { name: 'Add this reminder' }).click();
  check('a late reminder leads the headline', await page.getByRole('heading', { name: 'One thing needs you' }).isVisible());
  const card = (title) => page.locator('.crm-full > div > div > div', { hasText: title }).filter({ has: page.getByRole('button', { name: 'Edit' }) }).first();
  check('the card says how late', (await card('Pay the card').innerText()).includes('2 days late'));

  await card('Pay the card').getByRole('button', { name: 'Did it today' }).click();
  rs = await stored('crm-reminders-v1');
  let card1 = rs.find((r) => r.title === 'Pay the card');
  check('ticking off a calendar reminder moves it to its next slot', card1.next === '2026-10-20' && card1.lastDone === TODAY
    && card1.history.length === 1, card1);

  await card('Replace the HVAC filter').getByRole('button', { name: 'Push it back' }).click();
  await card('Replace the HVAC filter').getByRole('button', { name: 'A week', exact: true }).click();
  rs = await stored('crm-reminders-v1');
  check('pushing back moves it a week further out', rs.find((r) => r.title === 'Replace the HVAC filter').next === '2026-12-29');

  await card('Pay the card').getByRole('button', { name: 'Pause', exact: true }).click();
  rs = await stored('crm-reminders-v1');
  card1 = rs.find((r) => r.title === 'Pay the card');
  check('pausing is saved', card1.paused === true);
  await card('Pay the card').getByRole('button', { name: 'Resume', exact: true }).click();
  check('and undone', (await stored('crm-reminders-v1')).find((r) => r.title === 'Pay the card').paused === false);

  // ---- a one-off ----
  await page.getByRole('button', { name: 'Add a reminder' }).click();
  await page.getByLabel('What to remember').fill('Renew the passport');
  await page.getByRole('button', { name: 'Just once' }).click();
  await page.getByLabel('Due', { exact: true }).fill('2026-09-30');
  await page.getByRole('button', { name: 'Add this reminder' }).click();
  await card('Renew the passport').getByRole('button', { name: 'Did it today' }).click();
  const passport = (await stored('crm-reminders-v1')).find((r) => r.title === 'Renew the passport');
  check('a one-off is finished when done', passport.done === true && passport.next === '2026-09-30', passport);
  await card('Renew the passport').getByRole('button', { name: 'Not done after all' }).click();
  check('and can be reopened', (await stored('crm-reminders-v1')).find((r) => r.title === 'Renew the passport').done === false);

  // ---- it shows on the person ----
  await page.getByRole('button', { name: 'People', exact: true }).click();
  await page.locator('.crm-person .crm-row', { hasText: 'Dana Whitfield' }).click();
  check('an attached reminder shows on the person', await page.getByText('Coming round again').isVisible()
    && await page.getByText(/Pay the card/).first().isVisible());

  // ---- remove ----
  await page.getByRole('button', { name: 'Reminders', exact: true }).click();
  await card('Renew the passport').getByRole('button', { name: 'Remove', exact: true }).click();
  await card('Renew the passport').getByRole('button', { name: 'Tap again to remove' }).click();
  check('removing takes two taps', (await stored('crm-reminders-v1')).length === 2);

  await done();
}
