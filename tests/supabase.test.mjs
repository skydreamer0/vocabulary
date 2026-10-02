import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { after, before, beforeEach, describe, it } from 'node:test';
import { applyMigrations, createTestDatabase, rpc, USERS, validateTestDatabaseURL } from './helpers/postgres-harness.mjs';

// Default: actual PostgreSQL WASM engine, one connection, no accounts or network.
// Native CI: TEST_DATABASE_URL=postgres://... npm test. The login must be able to
// create/drop a temporary database and missing anon/authenticated test roles.
// PGlite cannot prove lock/race behavior: all such tests are explicitly skipped.
let db;
const json = JSON.stringify;
const call = (name, args = [], user = USERS.alice, role = 'authenticated', schema = 'public') =>
  db.as(user, client => rpc(client, name, args, schema), role);
const importWords = (words, user = USERS.alice) => call('vocab_import_words', [json(words)], user);
const importOne = async (term = 'bank', user = USERS.alice) => (await importWords([{ term }], user)).words[0];
const review = (word, overrides = {}, user = USERS.alice) => call('vocab_review_word', [word.id, word.revision, overrides.eventKey ?? randomUUID(), overrides.rating ?? 'good', overrides.timezone ?? 'UTC'], user);
const edit = (word, fields = {}, user = USERS.alice) => call('vocab_edit_word', [word.id, word.revision, fields.term ?? word.term, fields.context ?? word.context, fields.sense ?? word.sense, fields.definition ?? word.definition, fields.archived ?? null], user);
const enrich = (word, meanings = [{ partOfSpeech: 'noun', definition: 'A river edge.', example: 'We sat on the bank.' }], user = USERS.alice) => call('vocab_enrich_word', [word.id, word.term, json(meanings), '/bæŋk/', 'found'], user);
const rows = async (table, user = USERS.alice) => db.as(user, async client => (await client.query(`select * from public.${table} order by id`)).rows);
const wordFromDB = async id => (await db.query('select to_jsonb(w) as word from public.vocab_words w where id=$1', [id])).rows[0]?.word;
const count = async table => Number((await db.query(`select count(*) as n from ${table}`)).rows[0].n);
const rejectsCode = (promise, code, label) => assert.rejects(promise, error => {
  assert.equal(error.code, code, `${label ?? 'SQLSTATE'}: ${error.message}`);
  return true;
});

before(async () => { db = await createTestDatabase(); });
after(async () => { if (db) await db.close(); });
beforeEach(async () => { await db.reset(); });

describe('real migration, privileges and deny-by-default membership', { concurrency: false }, () => {
  it('refuses nonlocal test servers and connection-string routing overrides before connecting', () => {
    for (const host of ['localhost', '127.0.0.1', '[::1]', 'postgres']) {
      assert.equal(validateTestDatabaseURL(`postgresql://test@${host}:5432/test`).hostname, host);
    }
    for (const url of ['postgresql://db.example.com/test', 'postgresql://db.project.supabase.co/postgres',
      'postgresql://localhost/test?host=db.example.com', 'postgresql://localhost/test?database=unrelated',
      'https://localhost/test']) assert.throws(() => validateTestDatabaseURL(url), /TEST_DATABASE_URL/);
  });

  it('applies twice and keeps public wrappers invoker-only with pinned private implementations', async () => {
    await applyMigrations(db.exec);
    const { rows: functions } = await db.query(`select n.nspname as schema, p.proname as name, p.prosecdef as definer, p.proconfig as config from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','vocab_private') and p.proname like 'vocab_%'`);
    assert.equal(functions.filter(f => f.schema === 'public').length, 6);
    for (const fn of functions) {
      assert.equal(fn.definer, fn.schema === 'vocab_private', `${fn.schema}.${fn.name}`);
      assert(fn.config?.some(value => value === 'search_path=""'), `${fn.name} must pin its search_path`);
    }
    const { rows: tables } = await db.query("select relname, relrowsecurity from pg_class where oid in ('public.vocab_words'::regclass,'public.vocab_reviews'::regclass,'public.vocab_members'::regclass,'vocab_private.rate_limits'::regclass)");
    assert.equal(tables.length, 4);
    assert(tables.every(t => t.relrowsecurity));
    const { rows: grants } = await db.query("select rolname, rolsuper, rolbypassrls from pg_roles where rolname in ('anon','authenticated')");
    assert(grants.every(r => !r.rolsuper && !r.rolbypassrls));
  });

  it('future public/private functions do not silently inherit public execute permissions', async () => {
    await db.exec(`create function public.vocab_test_future() returns integer language sql as $$ select 1 $$;
      create function vocab_private.vocab_test_future() returns integer language sql as $$ select 1 $$;`);
    try {
      const { rows: privileges } = await db.query(`select role, schema,
        has_function_privilege(role, schema || '.vocab_test_future()', 'EXECUTE') as executable
        from (values ('anon'), ('authenticated')) roles(role)
        cross join (values ('public'), ('vocab_private')) schemas(schema)`);
      assert.equal(privileges.length, 4);
      assert(privileges.every(privilege => !privilege.executable), json(privileges));
    } finally {
      await db.exec('drop function public.vocab_test_future(); drop function vocab_private.vocab_test_future();');
    }
  });

  it('denies anonymous table access, public RPCs, and private RPCs', async () => {
    const word = await importOne();
    const invocations = [
      ['vocab_is_member', []], ['vocab_import_words', [json([{ term: 'stolen' }])]],
      ['vocab_edit_word', [word.id, 0, 'x', '', '', '', null]],
      ['vocab_review_word', [word.id, 0, randomUUID(), 'good', 'UTC']],
      ['vocab_enrich_word', [word.id, word.term, '[]', '', 'found']], ['vocab_lookup_budget', []],
    ];
    for (const table of ['vocab_words', 'vocab_reviews', 'vocab_members']) {
      await rejectsCode(db.as(null, client => client.query(`select * from public.${table}`), 'anon'), '42501', table);
    }
    for (const schema of ['public', 'vocab_private']) {
      for (const [name, args] of invocations) await rejectsCode(call(name, args, null, 'anon', schema), '42501', `${schema}.${name}`);
    }
    assert.equal(await count('public.vocab_words'), 1);
  });

  it('checks identity and membership inside every write RPC, including direct private calls', async () => {
    const word = await importOne();
    const invocations = [
      ['vocab_import_words', [json([{ term: 'outsider' }])]], ['vocab_edit_word', [word.id, 0, 'x', '', '', '', null]],
      ['vocab_review_word', [word.id, 0, randomUUID(), 'good', 'UTC']],
      ['vocab_enrich_word', [word.id, word.term, '[]', '', 'found']], ['vocab_lookup_budget', []],
    ];
    for (const schema of ['public', 'vocab_private']) for (const [name, args] of invocations) {
      await rejectsCode(call(name, args, USERS.outsider, 'authenticated', schema), 'PT403', name);
      await rejectsCode(call(name, args, null, 'authenticated', schema), 'PT401', name);
    }
    assert.equal(await call('vocab_is_member', [], USERS.outsider), false);
    assert.equal(await call('vocab_is_member', [], null), false);
    assert.equal(await call('vocab_is_member'), true);
    for (const table of ['vocab_words', 'vocab_reviews']) assert.deepEqual(await rows(table, USERS.outsider), []);
    assert.equal(await count('public.vocab_words'), 1);
    assert.equal(await count('vocab_private.rate_limits'), 1);
  });

  it('isolates two approved users at RLS and RPC boundaries and after membership revocation', async () => {
    const alice = await importOne();
    const bob = await importOne('bank', USERS.bob);
    await review(alice);
    await review(bob, {}, USERS.bob);
    for (const user of [USERS.alice, USERS.bob]) {
      assert.deepEqual((await rows('vocab_words', user)).map(w => w.user_id), [user]);
      assert.deepEqual((await rows('vocab_reviews', user)).map(r => r.user_id), [user]);
      const memberships = await db.as(user, async client => (await client.query('select * from public.vocab_members')).rows);
      assert.deepEqual(memberships.map(m => m.user_id), [user]);
    }
    await rejectsCode(edit({ ...alice, revision: 1 }, { term: 'stolen' }, USERS.bob), 'PT404');
    await rejectsCode(review({ ...alice, revision: 1 }, {}, USERS.bob), 'PT404');
    await rejectsCode(enrich(alice, [], USERS.bob), 'PT404');
    await db.query('delete from public.vocab_members where user_id=$1', [USERS.alice]);
    assert.deepEqual(await rows('vocab_words'), []);
    assert.deepEqual(await rows('vocab_reviews'), []);
    await rejectsCode(importWords([{ term: 'revoked' }]), 'PT403');
    assert.equal(await count('public.vocab_reviews'), 2);
  });

  it('denies direct card/history writes, membership escalation, and access to rate-limit internals', async () => {
    const word = await importOne();
    const statements = [
      ["insert into public.vocab_members(user_id) values ($1)", [USERS.outsider]],
      ["update public.vocab_members set user_id=$1 where user_id=$2", [USERS.outsider, USERS.alice]],
      ['delete from public.vocab_members where user_id=$1', [USERS.alice]],
      ["insert into public.vocab_words(user_id,term,norm_term,identity_hash) values ($1,'forged','forged','forged')", [USERS.alice]],
      ["update public.vocab_words set revision=100, user_id=$1 where id=$2", [USERS.bob, word.id]],
      ['delete from public.vocab_words where id=$1', [word.id]],
      ["insert into public.vocab_reviews default values", []],
      ["update public.vocab_reviews set rating='easy'", []],
      ['delete from public.vocab_reviews', []],
      ['truncate public.vocab_words cascade', []],
      ['select * from vocab_private.rate_limits', []],
      ["select vocab_private.consume_rate('review',999999)", []],
      ['select vocab_private.require_member()', []],
    ];
    for (const user of [USERS.alice, USERS.outsider]) for (const [sql, values] of statements) {
      await rejectsCode(db.as(user, client => client.query(sql, values)), '42501', sql);
    }
    assert.equal((await wordFromDB(word.id)).revision, 0);
    assert.equal(await count('public.vocab_members'), 2);
  });
});

describe('imports, validation and atomic capacity', { concurrency: false }, () => {
  it('deduplicates normalized case/whitespace/NFKC while preserving different context, sense, and owner', async () => {
    const result = await importWords([
      { term: ' bank ', context: ' River   edge ', sense: ' NOUN ' },
      { term: 'ＢＡＮＫ', context: 'river edge', sense: 'noun' },
      { term: 'BANK', context: 'river\tedge', sense: 'noun' },
      { term: 'bank', context: 'river edge', sense: 'money' },
      { term: 'bank', context: 'financial office', sense: 'noun' },
    ]);
    assert.equal(result.added, 3);
    assert.equal(result.duplicates, 2);
    assert.equal(new Set(result.words.map(w => w.identity_hash)).size, 3);
    assert.equal((await importWords([{ term: 'bank', context: 'river edge', sense: 'noun' }])).duplicates, 1);
    assert.equal((await importWords([{ term: 'bank', context: 'river edge', sense: 'noun' }], USERS.bob)).added, 1);
    for (const word of result.words) {
      assert.equal(word.user_id, USERS.alice);
      assert.equal(word.revision, 0);
      assert.deepEqual(word.dictionary, []);
    }
  });

  it('accepts the 100-item batch boundary and treats SQL-looking text as data', async () => {
    const result = await importWords(Array.from({ length: 100 }, (_, i) => ({ term: `word${i}` })));
    assert.equal(result.added, 100);
    const term = "word'; drop table public.vocab_words; --";
    assert.equal((await importOne(term)).term, term);
    assert.equal(await count('public.vocab_words'), 101);
  });

  it('rejects SQL/JSON NULL, malformed types, empty batches, and all import size bounds atomically', async () => {
    const invalid = [null, {}, 'word', [], Array.from({ length: 101 }, () => ({ term: 'word' })), [null], ['word'], [{}], [{ term: null }], [{ term: 12 }], [{ term: '' }], [{ term: '   ' }], [{ term: '123' }], [{ term: 'x'.repeat(101) }], [{ term: 'word', context: null }], [{ term: 'word', sense: false }], [{ term: 'word', context: 'x'.repeat(1501) }], [{ term: 'word', sense: 'x'.repeat(101) }], [{ term: 'word', extra: 'x'.repeat(220001) }], [{ term: 'valid' }, { term: null }]];
    await rejectsCode(call('vocab_import_words', [null]), 'PT400', 'SQL NULL');
    for (const payload of invalid) await rejectsCode(importWords(payload), 'PT400', json(payload).slice(0, 80));
    assert.equal(await count('public.vocab_words'), 0);
    assert.equal(await count('vocab_private.rate_limits'), 0);
  });

  it('enforces 5,000-card capacity atomically and still accepts duplicates at the limit', async () => {
    await db.query(`insert into public.vocab_words(user_id,term,norm_term,identity_hash)
      select $1, 'seed' || n, 'seed' || n, vocab_private.identity_key('seed' || n,'','') from generate_series(1,4999) n`, [USERS.alice]);
    await rejectsCode(importWords([{ term: 'last' }, { term: 'overflow' }]), 'PT409');
    assert.equal(await count('public.vocab_words'), 4999);
    assert.equal((await importWords([{ term: 'last' }])).added, 1);
    assert.equal((await importWords([{ term: 'last' }])).duplicates, 1);
    await rejectsCode(importWords([{ term: 'overflow' }]), 'PT409');
    assert.equal(await count('public.vocab_words'), 5000);
  });
});

describe('revision-safe edit, archive and dictionary enrichment', { concurrency: false }, () => {
  it('guards stale edits and duplicate identities, permits distinct senses, and clears enrichment on a changed term', async () => {
    const first = await importOne();
    const second = await importOne('river');
    await enrich(first);
    const changed = await edit(first, { definition: 'My own definition', context: 'remember this' });
    assert.equal(changed.revision, 1);
    assert.equal(changed.dictionary.length, 1);
    await rejectsCode(edit(first, { definition: 'stale' }), 'PT409');
    await rejectsCode(edit(second, { term: changed.term, context: changed.context, sense: changed.sense }), 'PT409');
    assert.equal((await wordFromDB(second.id)).revision, 0);
    const differentSense = await edit(second, { term: changed.term, context: changed.context, sense: 'finance' });
    assert.equal(differentSense.sense, 'finance');
    const renamed = await edit(changed, { term: 'shore' });
    assert.equal(renamed.lookup_status, 'pending');
    assert.equal(renamed.phonetic, '');
    assert.deepEqual(renamed.dictionary, []);
    assert.equal(renamed.definition, 'My own definition');
    await rejectsCode(enrich(first), 'PT409');
  });

  it('validates every nullable/bounded edit field without partial mutation', async () => {
    const word = await importOne();
    const valid = [word.id, 0, 'bank', '', '', '', null];
    const cases = [[0, null], [1, null], [1, -1], [2, null], [3, null], [4, null], [5, null], [2, ''], [2, 'x'.repeat(101)], [3, 'x'.repeat(1501)], [4, 'x'.repeat(101)], [5, 'x'.repeat(2001)]];
    for (const [index, value] of cases) {
      const args = [...valid]; args[index] = value;
      await rejectsCode(call('vocab_edit_word', args), 'PT400', `edit argument ${index}`);
    }
    assert.deepEqual(await wordFromDB(word.id), word);
  });

  it('preserves reviewed state on archive, refuses review/enrichment while archived, and deduplicates re-imports', async () => {
    const original = await importOne();
    const result = await review(original);
    const archived = await edit(result.word, { archived: true });
    assert(archived.archived_at > 0);
    assert.equal(archived.revision, 2);
    assert.equal(archived.due_at, result.word.due_at);
    await rejectsCode(review(archived), 'PT404');
    await rejectsCode(enrich(archived), 'PT409');
    assert.equal((await importWords([{ term: 'bank' }])).duplicates, 1);
    assert.equal((await wordFromDB(original.id)).archived_at, archived.archived_at);
    const restored = await edit(archived, { archived: false });
    assert.equal(restored.archived_at, null);
    assert.equal(restored.revision, 3);
    assert.equal(restored.due_at, result.word.due_at);
    assert.equal((await rows('vocab_reviews')).length, 1);
  });

  it('enrichment never overwrites personal definitions, revisions, or review scheduling', async () => {
    const word = await edit(await importOne(), { definition: 'Personal mnemonic' });
    const reviewed = (await review(word)).word;
    const enriched = await enrich(reviewed);
    for (const key of ['definition', 'revision', 'due_at', 'interval_days', 'streak']) assert.equal(enriched[key], reviewed[key], key);
    assert.equal(enriched.lookup_status, 'found');
    assert.equal(enriched.dictionary[0].definition, 'A river edge.');
    const unavailable = await call('vocab_enrich_word', [enriched.id, enriched.term, '[]', '', 'unavailable']);
    assert.deepEqual(unavailable, enriched);
    assert.deepEqual(await wordFromDB(word.id), enriched);
  });

  it('preserves a successful dictionary and phonetic against later failed or empty lookups', async () => {
    const enriched = await enrich(await importOne());
    const otherMeaning = [{ definition: 'An incomplete response.', partOfSpeech: 'noun', example: '' }];
    for (const [status, dictionary] of [
      ['unavailable', []], ['not_found', []], ['found', []],
      ['unavailable', otherMeaning], ['not_found', otherMeaning],
    ]) {
      const result = await call('vocab_enrich_word', [enriched.id, enriched.term, json(dictionary), '/stale/', status]);
      assert.deepEqual(result, enriched, `${status} with ${dictionary.length} meanings must return the retained result`);
      assert.deepEqual(await wordFromDB(enriched.id), enriched);
    }
    const { rows: [{ attempts }] } = await db.query("select sum(count)::integer as attempts from vocab_private.rate_limits where user_id=$1 and action='enrich'", [USERS.alice]);
    assert.equal(attempts, 6, 'retaining a successful result must not bypass the enrichment rate limit');
  });

  it('still records unsuccessful lookups before success and accepts subsequent successful refreshes', async () => {
    const word = await importOne();
    for (const status of ['unavailable', 'not_found', 'found']) {
      const result = await call('vocab_enrich_word', [word.id, word.term, '[]', '', status]);
      assert.equal(result.lookup_status, status);
      assert.deepEqual(result.dictionary, []);
      assert.equal(result.revision, word.revision);
    }
    const enriched = await enrich(word);
    const replacement = [{ definition: 'A place that holds money.', partOfSpeech: 'noun', example: 'She went to the bank.' }];
    const refreshed = await call('vocab_enrich_word', [word.id, word.term, json(replacement), '/bæŋk-new/', 'found']);
    assert.deepEqual(refreshed.dictionary, replacement);
    assert.equal(refreshed.phonetic, '/bæŋk-new/');
    assert.equal(refreshed.lookup_status, 'found');
    for (const key of Object.keys(enriched).filter(key => !['dictionary', 'phonetic', 'lookup_status'].includes(key))) {
      assert.deepEqual(refreshed[key], enriched[key], key);
    }
    assert.deepEqual(await wordFromDB(word.id), refreshed);
  });

  it('retaining successful enrichment still enforces ownership, membership, validation, rename and archive guards', async () => {
    const enriched = await enrich(await importOne());
    const failedArgs = [enriched.id, enriched.term, '[]', '', 'unavailable'];
    await rejectsCode(call('vocab_enrich_word', failedArgs, USERS.bob), 'PT404');
    await rejectsCode(call('vocab_enrich_word', failedArgs, USERS.outsider), 'PT403');
    await rejectsCode(call('vocab_enrich_word', failedArgs, null), 'PT401');
    await rejectsCode(call('vocab_enrich_word', [enriched.id, enriched.term, '[{}]', '', 'unavailable']), 'PT400');
    assert.deepEqual(await wordFromDB(enriched.id), enriched);

    const renamed = await edit(enriched, { term: 'shore' });
    await rejectsCode(call('vocab_enrich_word', failedArgs), 'PT409');
    assert.deepEqual(await wordFromDB(enriched.id), renamed);
    const reEnriched = await enrich(renamed);
    const archived = await edit(reEnriched, { archived: true });
    await rejectsCode(call('vocab_enrich_word', [archived.id, archived.term, '[]', '', 'not_found']), 'PT409');
    assert.deepEqual(await wordFromDB(enriched.id), archived);
  });

  it('rejects SQL/JSON NULL, malformed meanings, and dictionary/phonetic/packet bounds', async () => {
    const word = await importOne();
    const meaning = { definition: 'Definition', partOfSpeech: 'noun', example: '' };
    const valid = [word.id, word.term, json([meaning]), '', 'found'];
    const cases = [[0, null], [1, null], [2, null], [2, 'null'], [2, '{}'], [2, '[null]'], [2, '[{}]'], [2, json([{ ...meaning, definition: null }])], [2, json([{ ...meaning, partOfSpeech: 5 }])], [2, json([{ ...meaning, example: null }])], [2, json([{ ...meaning, definition: 'x'.repeat(1201) }])], [2, json([{ ...meaning, partOfSpeech: 'x'.repeat(31) }])], [2, json([{ ...meaning, example: 'x'.repeat(1001) }])], [2, json(Array.from({ length: 17 }, () => meaning))], [2, json([{ ...meaning, extra: 'x'.repeat(60001) }])], [3, null], [3, 'x'.repeat(151)], [4, null], [4, 'pending']];
    for (const [index, value] of cases) {
      const args = [...valid]; args[index] = value;
      await rejectsCode(call('vocab_enrich_word', args), 'PT400', `enrich argument ${index}`);
    }
    assert.deepEqual(await wordFromDB(word.id), word);
  });
});

describe('atomic review history and payload-bound retry', { concurrency: false }, () => {
  it('records one immutable history row and returns the original result on a retry after later reviews/edits', async () => {
    const word = await importOne();
    const eventKey = randomUUID();
    const first = await review(word, { eventKey });
    assert.equal(first.replayed, false);
    assert.equal(first.review.word_revision, 0);
    assert.equal(first.word.revision, 1);
    assert.equal(first.word.due_at, first.review.due_after);
    assert.equal(first.review.due_before, word.due_at);
    assert.equal(first.review.streak_after, 1);
    assert.equal(first.review.interval_after, 1);
    assert.equal(first.review.due_after - first.review.reviewed_at, 86400000);
    assert.deepEqual((await review(word, { eventKey })).review, first.review);
    const later = await review(first.word, { rating: 'easy' });
    const renamed = await edit(later.word, { term: 'shore', archived: null });
    const replay = await review(word, { eventKey });
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.review, first.review);
    assert.equal(replay.review.term, 'bank');
    assert.equal(await count('public.vocab_reviews'), 2);
    assert.deepEqual(await wordFromDB(word.id), renamed);
    assert.equal(Object.hasOwn(replay, 'word'), false, 'replay must not pretend the current card is its old review snapshot');
  });

  it('rejects reuse with a different rating, revision, word, or timezone and rejects stale distinct keys', async () => {
    const word = await importOne();
    const other = await importOne('shore');
    const eventKey = randomUUID();
    await review(word, { eventKey });
    for (const args of [[word.id, 0, eventKey, 'easy', 'UTC'], [word.id, 1, eventKey, 'good', 'UTC'], [other.id, 0, eventKey, 'good', 'UTC'], [word.id, 0, eventKey, 'good', 'Europe/London']]) {
      await rejectsCode(call('vocab_review_word', args), 'PT409');
    }
    await rejectsCode(review(word), 'PT409');
    assert.equal(await count('public.vocab_reviews'), 1);
    assert.equal((await wordFromDB(other.id)).revision, 0);
    const bob = await importOne('bank', USERS.bob);
    assert.equal((await review(bob, { eventKey }, USERS.bob)).replayed, false, 'keys are scoped to the account');
  });

  it('validates NULL, negative revisions, unknown ratings, and real bounded IANA timezones', async () => {
    const word = await importOne();
    const valid = [word.id, 0, randomUUID(), 'good', 'UTC'];
    for (const [index, value] of [[0, null], [1, null], [1, -1], [2, null], [3, null], [3, 'invalid'], [4, null], [4, ''], [4, 'not/a-zone'], [4, 'x'.repeat(101)]]) {
      const args = [...valid]; args[index] = value;
      await rejectsCode(call('vocab_review_word', args), 'PT400', `review argument ${index}`);
    }
    assert.equal(await count('public.vocab_reviews'), 0);
    assert.deepEqual(await wordFromDB(word.id), word);
    assert.equal((await review(word, { timezone: 'America/New_York' })).review.timezone, 'America/New_York');
  });

  it('computes all four ratings and caps intervals at 365 days', async () => {
    for (const [rating, interval, streak] of [['again', 10 / 1440, 0], ['hard', 1, 1], ['good', 1, 1], ['easy', 3, 1]]) {
      const result = await review(await importOne(rating), { rating });
      assert(Math.abs(result.word.interval_days - interval) < 1e-10, rating);
      assert.equal(result.word.streak, streak);
      assert.equal(result.word.due_at - result.review.reviewed_at, Math.round(interval * 86400000));
    }
    const word = await importOne('capped');
    await db.query('update public.vocab_words set interval_days=300,streak=10 where id=$1', [word.id]);
    const capped = await review(word, { rating: 'easy' });
    assert.equal(capped.word.interval_days, 365);
    assert.equal(capped.word.streak, 11);
  });

  it('rolls back history insertion and rate consumption when the subsequent card update fails', async () => {
    const word = await importOne();
    const eventKey = randomUUID();
    await db.exec(`create function public.vocab_test_fail_update() returns trigger language plpgsql as $$ begin raise exception 'Injected card update failure' using errcode='P0001'; end $$;
      create trigger vocab_test_fail_update before update on public.vocab_words for each row execute function public.vocab_test_fail_update();`);
    try {
      await rejectsCode(review(word, { eventKey }), 'P0001');
      assert.equal(await count('public.vocab_reviews'), 0);
      assert.deepEqual(await wordFromDB(word.id), word);
      assert.equal(Number((await db.query("select count(*) as n from vocab_private.rate_limits where action='review'")).rows[0].n), 0);
    } finally {
      await db.exec('drop trigger vocab_test_fail_update on public.vocab_words; drop function public.vocab_test_fail_update();');
    }
    assert.equal((await review(word, { eventKey })).replayed, false, 'failed transaction did not reserve the retry key');
    assert.equal(await count('public.vocab_reviews'), 1);
  });
});

describe('transactional per-user minute rate limits', { concurrency: false }, () => {
  it('enforces each RPC limit without consuming rejected attempts or leaking it to another user', async () => {
    const word = await importOne();
    const endpoints = [
      ['import', 15, () => importWords([{ term: 'rate-limited' }])],
      ['edit', 60, () => edit(word)], ['review', 90, () => review(word)],
      ['enrich', 80, () => enrich(word)], ['lookup', 80, () => call('vocab_lookup_budget')],
    ];
    for (const [action, maximum, attempt] of endpoints) {
      await db.query(`insert into vocab_private.rate_limits(user_id,action,bucket,count)
        select $1,$2,floor(extract(epoch from clock_timestamp())/60)::bigint + n,$3 from generate_series(0,1) n
        on conflict(user_id,action,bucket) do update set count=excluded.count`, [USERS.alice, action, maximum]);
      await rejectsCode(attempt(), 'PT429', action);
      assert((await db.query('select count from vocab_private.rate_limits where user_id=$1 and action=$2', [USERS.alice, action])).rows.every(r => r.count === maximum));
    }
    assert.equal((await importWords([{ term: 'other-user' }], USERS.bob)).added, 1);
    await call('vocab_lookup_budget', [], USERS.bob);
    assert.equal((await wordFromDB(word.id)).revision, 0);
    assert.equal(await count('public.vocab_reviews'), 0);
  });

  it('allows exactly the last budgeted call, deletes old owner buckets, and allows idempotent replay when exhausted', async () => {
    const word = await importOne();
    const eventKey = randomUUID();
    const result = await review(word, { eventKey });
    await db.query(`insert into vocab_private.rate_limits(user_id,action,bucket,count)
      select $1,'review',floor(extract(epoch from clock_timestamp())/60)::bigint + n,90 from generate_series(0,1) n
      on conflict(user_id,action,bucket) do update set count=excluded.count`, [USERS.alice]);
    assert.deepEqual((await review(word, { eventKey })).review, result.review);
    await db.query(`insert into vocab_private.rate_limits(user_id,action,bucket,count) values ($1,'lookup',-1,1),($2,'lookup',-1,1)`, [USERS.alice, USERS.bob]);
    await db.query(`insert into vocab_private.rate_limits(user_id,action,bucket,count)
      select $1,'lookup',floor(extract(epoch from clock_timestamp())/60)::bigint + n,79 from generate_series(0,1) n`, [USERS.alice]);
    await call('vocab_lookup_budget');
    const budgets = (await db.query("select count from vocab_private.rate_limits where user_id=$1 and action='lookup' and bucket>0", [USERS.alice])).rows;
    assert.deepEqual(budgets.map(row => row.count).sort(), [79, 80]);
    // Exhaust both minute buckets before asserting rejection, so crossing a
    // wall-clock minute between these two calls cannot make this test flaky.
    await db.query("update vocab_private.rate_limits set count=80 where user_id=$1 and action='lookup' and bucket>0", [USERS.alice]);
    await rejectsCode(call('vocab_lookup_budget'), 'PT429');
    const stale = (await db.query('select user_id from vocab_private.rate_limits where bucket=-1')).rows;
    assert.deepEqual(stale.map(r => r.user_id), [USERS.bob]);
  });
});

// A held, uncommitted first transaction plus pg_blocking_pids proves overlap.
// Promise.all alone (especially on PGlite) would only prove sequential retries.
async function waitForBlocked(pid, blockerPid) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const { rows: [{ blockers }] } = await db.query('select pg_blocking_pids($1) as blockers', [pid]);
    if (blockers.includes(blockerPid)) return;
    await delay(20);
  }
  assert.fail('Second independent PostgreSQL connection did not block behind the first transaction');
}

async function overlapping(firstOperation, secondOperation, verify) {
  const first = await db.session(USERS.alice);
  const second = await db.session(USERS.alice);
  let pending;
  try {
    assert.notEqual(first.pid, second.pid);
    const firstResult = await firstOperation(first.client);
    pending = secondOperation(second.client).then(value => ({ value }), error => ({ error }));
    await waitForBlocked(second.pid, first.pid);
    await first.client.query('commit');
    const secondResult = await pending;
    if (secondResult.error) await second.client.query('rollback');
    else await second.client.query('commit');
    await verify(firstResult, secondResult);
  } finally {
    await first.close();
    if (pending) await pending;
    await second.close();
  }
}

const nativeOnly = { skip: process.env.TEST_DATABASE_URL ? false : 'Requires TEST_DATABASE_URL and independent native PostgreSQL connections; PGlite cannot verify concurrency' };
describe('native PostgreSQL concurrency', { concurrency: false }, () => {
  for (const status of ['unavailable', 'not_found', 'found']) {
    it(`a blocked ${status} empty lookup cannot erase a concurrently committed successful enrichment`, nativeOnly, async () => {
      const word = await edit(await importOne(), { definition: 'Personal mnemonic' });
      const reviewed = (await review(word)).word;
      const dictionary = [{ definition: 'A river edge.', partOfSpeech: 'noun', example: 'We sat on the bank.' }];
      await overlapping(
        client => rpc(client, 'vocab_enrich_word', [word.id, word.term, json(dictionary), '/bæŋk/', 'found']),
        client => rpc(client, 'vocab_enrich_word', [word.id, word.term, '[]', '/stale/', status]),
        async (first, second) => {
          assert.ifError(second.error);
          assert.deepEqual(second.value, first);
          assert.deepEqual(await wordFromDB(word.id), first);
          for (const key of ['definition', 'revision', 'due_at', 'interval_days', 'streak']) assert.equal(first[key], reviewed[key], key);
        },
      );
      assert.equal(await count('public.vocab_reviews'), 1);
    });
  }

  it('a successful enrichment blocked behind an unsuccessful lookup still replaces the failure', nativeOnly, async () => {
    const word = await importOne();
    const dictionary = [{ definition: 'A river edge.', partOfSpeech: 'noun', example: '' }];
    await overlapping(
      client => rpc(client, 'vocab_enrich_word', [word.id, word.term, '[]', '', 'unavailable']),
      client => rpc(client, 'vocab_enrich_word', [word.id, word.term, json(dictionary), '/bæŋk/', 'found']),
      async (first, second) => {
        assert.ifError(second.error);
        assert.equal(first.lookup_status, 'unavailable');
        assert.equal(second.value.lookup_status, 'found');
        assert.deepEqual(second.value.dictionary, dictionary);
        assert.equal(second.value.phonetic, '/bæŋk/');
        assert.equal(second.value.revision, word.revision);
        assert.deepEqual(await wordFromDB(word.id), second.value);
      },
    );
  });

  it('a blocked failed enrichment still rejects a concurrent archive of an already enriched card', nativeOnly, async () => {
    const word = await enrich(await importOne());
    await overlapping(
      client => rpc(client, 'vocab_edit_word', [word.id, word.revision, word.term, word.context, word.sense, word.definition, true]),
      client => rpc(client, 'vocab_enrich_word', [word.id, word.term, '[]', '', 'unavailable']),
      async (first, second) => {
        assert.equal(second.error?.code, 'PT409');
        assert(first.archived_at);
        assert.deepEqual(first.dictionary, word.dictionary);
        assert.deepEqual(await wordFromDB(word.id), first);
      },
    );
  });

  it('same review key and payload commits once and the blocked retry returns that history', nativeOnly, async () => {
    const word = await importOne();
    const args = [word.id, 0, randomUUID(), 'good', 'UTC'];
    await overlapping(client => rpc(client, 'vocab_review_word', args), client => rpc(client, 'vocab_review_word', args), async (first, second) => {
      assert.ifError(second.error);
      assert.equal(first.replayed, false);
      assert.equal(second.value.replayed, true);
      assert.deepEqual(second.value.review, first.review);
    });
    assert.equal(await count('public.vocab_reviews'), 1);
    assert.equal((await wordFromDB(word.id)).revision, 1);
  });

  it('different keys against the same revision cannot double-apply a review', nativeOnly, async () => {
    const word = await importOne();
    await overlapping(
      client => rpc(client, 'vocab_review_word', [word.id, 0, randomUUID(), 'good', 'UTC']),
      client => rpc(client, 'vocab_review_word', [word.id, 0, randomUUID(), 'easy', 'UTC']),
      async (_first, second) => assert.equal(second.error?.code, 'PT409'),
    );
    assert.equal(await count('public.vocab_reviews'), 1);
    assert.equal((await wordFromDB(word.id)).revision, 1);
  });

  it('same key naming different words cannot commit two review events', nativeOnly, async () => {
    const first = await importOne('first');
    const second = await importOne('second');
    const key = randomUUID();
    await overlapping(
      client => rpc(client, 'vocab_review_word', [first.id, 0, key, 'good', 'UTC']),
      client => rpc(client, 'vocab_review_word', [second.id, 0, key, 'good', 'UTC']),
      async (_first, result) => assert.equal(result.error?.code, 'PT409'),
    );
    assert.equal(await count('public.vocab_reviews'), 1);
    assert.equal((await wordFromDB(second.id)).revision, 0);
  });

  it('overlapping normalized duplicate imports are deduplicated after the first transaction commits', nativeOnly, async () => {
    await overlapping(
      client => rpc(client, 'vocab_import_words', [json([{ term: 'bank', context: 'river edge' }])]),
      client => rpc(client, 'vocab_import_words', [json([{ term: 'ＢＡＮＫ', context: 'RIVER   EDGE' }])]),
      async (first, second) => {
        assert.ifError(second.error);
        assert.equal(first.added, 1);
        assert.equal(second.value.added, 0);
        assert.equal(second.value.duplicates, 1);
      },
    );
    assert.equal(await count('public.vocab_words'), 1);
  });

  it('concurrent imports cannot pass the capacity check for the same last slot', nativeOnly, async () => {
    await db.query(`insert into public.vocab_words(user_id,term,norm_term,identity_hash)
      select $1, 'seed' || n, 'seed' || n, vocab_private.identity_key('seed' || n,'','') from generate_series(1,4999) n`, [USERS.alice]);
    await overlapping(
      client => rpc(client, 'vocab_import_words', [json([{ term: 'first-last-slot' }])]),
      client => rpc(client, 'vocab_import_words', [json([{ term: 'second-last-slot' }])]),
      async (first, second) => { assert.equal(first.added, 1); assert.equal(second.error?.code, 'PT409'); },
    );
    assert.equal(await count('public.vocab_words'), 5000);
  });

  it('a concurrent archive makes the waiting review fail without adding history', nativeOnly, async () => {
    const word = await importOne();
    await overlapping(
      client => rpc(client, 'vocab_edit_word', [word.id, 0, null, null, null, null, true]),
      client => rpc(client, 'vocab_review_word', [word.id, 0, randomUUID(), 'good', 'UTC']),
      async (first, second) => { assert(first.archived_at); assert.equal(second.error?.code, 'PT404'); },
    );
    assert.equal(await count('public.vocab_reviews'), 0);
    assert.equal((await wordFromDB(word.id)).revision, 1);
  });

  it('a concurrent edit makes the waiting review stale and preserves the edited text', nativeOnly, async () => {
    const word = await importOne();
    await overlapping(
      client => rpc(client, 'vocab_edit_word', [word.id, 0, 'shore', '', '', 'edited', null]),
      client => rpc(client, 'vocab_review_word', [word.id, 0, randomUUID(), 'good', 'UTC']),
      async (_first, second) => assert.equal(second.error?.code, 'PT409'),
    );
    const current = await wordFromDB(word.id);
    assert.equal(current.term, 'shore');
    assert.equal(current.definition, 'edited');
    assert.equal(current.revision, 1);
    assert.equal(await count('public.vocab_reviews'), 0);
  });

  it('a waiting enrichment cannot attach old dictionary data after a concurrent rename', nativeOnly, async () => {
    const word = await importOne();
    await overlapping(
      client => rpc(client, 'vocab_edit_word', [word.id, 0, 'shore', '', '', '', null]),
      client => rpc(client, 'vocab_enrich_word', [word.id, 'bank', '[{"definition":"Old meaning","partOfSpeech":"noun","example":""}]', '', 'found']),
      async (_first, second) => assert.equal(second.error?.code, 'PT409'),
    );
    const current = await wordFromDB(word.id);
    assert.equal(current.term, 'shore');
    assert.deepEqual(current.dictionary, []);
    assert.equal(current.lookup_status, 'pending');
  });
});
