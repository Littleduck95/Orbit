// The catalog service (supabase/functions/catalog/index.ts), run under Deno as
// Supabase runs it. Run with `npm run test:notify`.
import { assertEquals } from 'jsr:@std/assert@1';
import { handle, readEntity } from '../../supabase/functions/catalog/index.ts';

const ENTITY = (id: string, labels: Record<string, string>, descriptions: Record<string, string> = {}) => ({
  entities: { [id]: {
    id,
    labels: Object.fromEntries(Object.entries(labels).map(([l, value]) => [l, { language: l, value }])),
    descriptions: Object.fromEntries(Object.entries(descriptions).map(([l, value]) => [l, { language: l, value }])),
  } },
});

Deno.test('Wikidata\'s name and description, in the language asked for, else English, else any', () => {
  const body = ENTITY('Q223455', { en: 'Kansas City Chiefs', fr: 'Chiefs de Kansas City' }, { en: 'NFL team' });
  assertEquals(readEntity(body, 'Q223455', 'fr'), { id: 'Q223455', name: 'Chiefs de Kansas City', about: 'NFL team' });
  assertEquals(readEntity(body, 'Q223455', 'de')?.name, 'Kansas City Chiefs');
  assertEquals(readEntity(ENTITY('Q9', { ja: '東京' }), 'Q9', 'en')?.name, '東京');
  assertEquals(readEntity({ entities: { Q5: { id: 'Q5', missing: '' } } }, 'Q5', 'en'), null, 'an item that is not there');
  assertEquals(readEntity(ENTITY('Q5', {}), 'Q5', 'en'), null, 'an item with no name');
  assertEquals(readEntity(null, 'Q5', 'en'), null);
});

Deno.test('an item merged into another is kept under the one it became', () => {
  assertEquals(readEntity(ENTITY('Q2', { en: 'Earth' }), 'Q99', 'en')?.id, 'Q2');
});

type Saved = { kind: string; qid: string; name: string; about: string };
const call = async (body: unknown, opts: { jwt?: string; wikidata?: (url: string) => Response | Promise<Response> } = {}) => {
  const saved: { entry: Saved; by: string }[] = [];
  const asked: string[] = [];
  const res = await handle(new Request('https://x.supabase.co/functions/v1/catalog', {
    method: 'POST',
    headers: { authorization: opts.jwt === undefined ? 'Bearer good' : opts.jwt, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), () => undefined, {
    userOf: async (t) => (t === 'good' ? 'user-1' : null),
    save: async (entry, by) => { saved.push({ entry, by }); return { id: 'cat-1', ...entry, source: 'wikidata', source_id: entry.qid }; },
    fetchFn: (async (url: string) => { asked.push(String(url)); return opts.wikidata ? opts.wikidata(String(url)) : new Response(JSON.stringify(ENTITY('Q223455', { en: 'Kansas City Chiefs' }, { en: 'NFL team' }))); }) as typeof fetch,
  });
  return { status: res.status, body: await res.json().catch(() => null), saved, asked };
};

Deno.test('it names the item as Wikidata does, whatever the app sends', async () => {
  const r = await call({ kind: 'team', id: 'Q223455', lang: 'en', name: 'Scam Tickets', about: 'buy here' });
  assertEquals(r.status, 200);
  assertEquals(r.saved, [{ entry: { kind: 'team', qid: 'Q223455', name: 'Kansas City Chiefs', about: 'NFL team' }, by: 'user-1' }]);
  assertEquals(r.asked, ['https://www.wikidata.org/wiki/Special:EntityData/Q223455.json']);
});

Deno.test('only for someone signed in', async () => {
  assertEquals((await call({ kind: 'team', id: 'Q223455' }, { jwt: '' })).status, 401);
  assertEquals((await call({ kind: 'team', id: 'Q223455' }, { jwt: 'Bearer forged' })).status, 401);
});

Deno.test('only a real item id and a known kind, and nothing else reaches Wikidata', async () => {
  const bad = await call({ kind: 'team', id: 'Q1/../../evil' });
  assertEquals([bad.status, bad.asked.length], [400, 0]);
  assertEquals((await call({ kind: 'car', id: 'Q223455' })).status, 400);
});

Deno.test('an item Wikidata does not have, or cannot give, adds nothing', async () => {
  const gone = await call({ kind: 'team', id: 'Q5' }, { wikidata: () => new Response('{}', { status: 404 }) });
  assertEquals([gone.status, gone.saved.length], [404, 0]);
  const down = await call({ kind: 'team', id: 'Q5' }, { wikidata: () => new Response('oops', { status: 503 }) });
  assertEquals([down.status, down.saved.length], [502, 0]);
  const odd = await call({ kind: 'team', id: 'Q5' }, { wikidata: () => new Response('not json') });
  assertEquals([odd.status, odd.saved.length], [404, 0]);
});

Deno.test('a language that is not a language code is English', async () => {
  const r = await call({ kind: 'team', id: 'Q223455', lang: '<script>' });
  assertEquals(r.saved[0].entry.name, 'Kansas City Chiefs');
});
