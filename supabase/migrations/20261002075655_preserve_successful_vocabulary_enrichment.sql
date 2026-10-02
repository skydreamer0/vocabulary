begin;

-- Late failures and empty responses must not erase a successful same-term
-- lookup. Keep the decision inside UPDATE so it uses the current locked row,
-- including after a concurrent enrichment, rename, or archive commits.
create or replace function vocab_private.vocab_enrich_word(p_id uuid,p_term text,p_dictionary jsonb,p_phonetic text,p_status text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=vocab_private.require_member(); w public.vocab_words; m jsonb; incoming_success boolean; begin
 perform vocab_private.consume_rate('enrich',80);
 if p_id is null or p_term is null or p_dictionary is null or jsonb_typeof(p_dictionary)<>'array' or jsonb_array_length(p_dictionary)>16 or octet_length(p_dictionary::text)>60000 or p_phonetic is null or length(p_phonetic)>150 or p_status is null or p_status not in ('found','not_found','unavailable') then raise sqlstate 'PT400' using message='Invalid dictionary data'; end if;
 for m in select value from jsonb_array_elements(p_dictionary) loop
  if jsonb_typeof(m)<>'object' or jsonb_typeof(m->'definition') is distinct from 'string' or jsonb_typeof(m->'partOfSpeech') is distinct from 'string' or jsonb_typeof(m->'example') is distinct from 'string' or length(m->>'definition')>1200 or length(m->>'partOfSpeech')>30 or length(m->>'example')>1000 then raise sqlstate 'PT400' using message='Invalid dictionary meaning'; end if;
 end loop;
 incoming_success := p_status='found' and jsonb_array_length(p_dictionary)>0;
 update public.vocab_words as current_word set
  dictionary=case when not incoming_success and current_word.lookup_status='found' and jsonb_array_length(current_word.dictionary)>0 then current_word.dictionary else p_dictionary end,
  phonetic=case when not incoming_success and current_word.lookup_status='found' and jsonb_array_length(current_word.dictionary)>0 then current_word.phonetic else p_phonetic end,
  lookup_status=case when not incoming_success and current_word.lookup_status='found' and jsonb_array_length(current_word.dictionary)>0 then current_word.lookup_status else p_status end
 where current_word.id=p_id and current_word.user_id=u and current_word.term=p_term and current_word.archived_at is null returning current_word.* into w;
 if not found then
  if not exists(select 1 from public.vocab_words where id=p_id and user_id=u) then raise sqlstate 'PT404' using message='Word not found'; end if;
  raise sqlstate 'PT409' using message='Word changed or was archived during lookup';
 end if;
 return to_jsonb(w);
end $$;

-- CREATE OR REPLACE retains the existing ACL; restate the intended grants
-- without changing the public SECURITY INVOKER wrapper or table permissions.
revoke all on function vocab_private.vocab_enrich_word(uuid,text,jsonb,text,text) from public,anon;
grant execute on function vocab_private.vocab_enrich_word(uuid,text,jsonb,text,text) to authenticated;

commit;
