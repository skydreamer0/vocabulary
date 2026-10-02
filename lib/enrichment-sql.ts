import type {DictionaryResult} from './dictionary';

// Each CASE reads the locked row's current values. A late failed request cannot
// erase a successful concurrent lookup, and renamed/archived words are untouched.
export function enrichmentUpdate(id:string,user:string,term:string,result:DictionaryResult){
 return {
  sql:`UPDATE words SET
   dictionary=CASE WHEN lookup_status='found' AND dictionary<>'[]' AND ?<>'found' THEN dictionary ELSE ? END,
   phonetic=CASE WHEN lookup_status='found' AND dictionary<>'[]' AND ?<>'found' THEN phonetic ELSE ? END,
   lookup_status=CASE WHEN lookup_status='found' AND dictionary<>'[]' AND ?<>'found' THEN lookup_status ELSE ? END
   WHERE id=? AND user_id=? AND term=? AND archived_at IS NULL RETURNING *`,
  params:[result.status,JSON.stringify(result.meanings),result.status,result.phonetic,result.status,result.status,id,user,term],
 };
}
