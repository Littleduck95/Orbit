// Orbit's catalog service: adds an item from Wikidata to the shared catalog
// with the name and description Wikidata gives it, never ones an app sends.
//
// The catalog is shared: everyone's "Kansas City Chiefs" is one entry. If an
// app could name a Wikidata item itself, the first person to link it could
// give it any name for everyone. So the database only takes Wikidata items
// from here (catalog_add_wikidata, callable with the service role alone),
// and this asks Wikidata for the item every time. Picking an item that is
// already in the catalog refreshes its name and description too.
//
// Runs as a Supabase Edge Function. A signed-in person's app calls it with
// { kind, id, lang }: the kind of entry, the Wikidata item id (Q and digits)
// and the language to name it in.
//
// Secrets: none of its own. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// provided by Supabase; APP_URL (optional) goes in the User-Agent Wikidata
// asks callers to send.

import { createClient } from 'npm:@supabase/supabase-js@2';

export const KINDS = ['performer', 'team', 'show', 'festival', 'venue'];
export const QID = /^Q[1-9]\d{0,11}$/;

type Rec = Record<string, unknown>;
export type Entity = { id: string; name: string; about: string };

// Wikidata's record of an item: its label and description in the language
// asked for, else English, else any. An item merged into another answers
// under the other's id, which is the one kept.
export function readEntity(body: unknown, qid: string, lang: string): Entity | null {
  const entities = (body as Rec | null)?.entities;
  if (!entities || typeof entities !== 'object') return null;
  const all = entities as Record<string, Rec>;
  const e = all[qid] ?? Object.values(all)[0];
  if (!e || typeof e !== 'object' || 'missing' in e) return null;
  if (typeof e.id !== 'string' || !QID.test(e.id)) return null;
  const pick = (m: unknown) => {
    if (!m || typeof m !== 'object') return '';
    const byLang = m as Record<string, { value?: unknown }>;
    const v = byLang[lang]?.value ?? byLang.en?.value ?? Object.values(byLang)[0]?.value;
    return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '';
  };
  const name = pick(e.labels).slice(0, 200);
  if (!name) return null;
  return { id: e.id, name, about: pick(e.descriptions).slice(0, 300) };
}

export type Deps = {
  fetchFn: typeof fetch;
  userOf: (jwt: string) => Promise<string | null>;
  save: (entry: { kind: string; qid: string; name: string; about: string }, userId: string) => Promise<unknown>;
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

export async function handle(req: Request, env: (k: string) => string | undefined, deps?: Partial<Deps>) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });

  const client = deps?.userOf && deps?.save ? null
    : createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const userOf = deps?.userOf ?? (async (t: string) => (await client!.auth.getUser(t)).data?.user?.id ?? null);
  const save = deps?.save ?? (async (x, userId) => {
    const { data, error } = await client!.rpc('catalog_add_wikidata', { p_kind: x.kind, p_name: x.name, p_about: x.about, p_qid: x.qid, p_by: userId });
    if (error) throw new Error(error.message);
    return data;
  });
  const fetchFn = deps?.fetchFn ?? fetch;

  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const userId = jwt ? await userOf(jwt).catch(() => null) : null;
  if (!userId) return reply(401, { error: 'Sign in first.' });

  const body = await req.json().catch(() => ({}));
  const kind = String(body?.kind ?? '');
  const id = String(body?.id ?? '');
  if (!KINDS.includes(kind)) return reply(400, { error: 'Unknown kind of entry.' });
  if (!QID.test(id)) return reply(400, { error: 'That is not a Wikidata item.' });
  const lang = /^[a-z]{2,3}$/.test(String(body?.lang ?? '')) ? String(body.lang) : 'en';

  let res: Response;
  try {
    res = await fetchFn(`https://www.wikidata.org/wiki/Special:EntityData/${id}.json`, {
      headers: { accept: 'application/json', 'user-agent': `Orbit/1.0 (${env('APP_URL') || 'https://littleduck95.github.io/Orbit/'})` },
    });
  } catch {
    return reply(502, { error: 'Wikidata could not be reached. Try again, or add it yourself.' });
  }
  if (res.status === 404) return reply(404, { error: 'Wikidata does not know that item.' });
  if (!res.ok) return reply(502, { error: 'Wikidata could not be reached. Try again, or add it yourself.' });
  const entity = readEntity(await res.json().catch(() => null), id, lang);
  if (!entity) return reply(404, { error: 'Wikidata does not know that item.' });

  try {
    return reply(200, await save({ kind, qid: entity.id, name: entity.name, about: entity.about }, userId));
  } catch (err) {
    console.error(`catalog: ${err instanceof Error ? err.message : err}`);
    return reply(500, { error: 'That could not be added. Try again.' });
  }
}

if (import.meta.main) Deno.serve((req) => handle(req, (k) => Deno.env.get(k)));
