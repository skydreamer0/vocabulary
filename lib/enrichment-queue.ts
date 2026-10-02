import type {Word} from './types';
import type {LookupFailure} from './dictionary';

export type LookupAttempt = {term:string;count:number;nextAt:number};
export type LookupAttempts = Record<string,LookupAttempt>;
type Options = {
 lookup:(id:string)=>Promise<{word:Word;status:string;lookupError?:LookupFailure}>;
 onWord:(word:Word)=>void;
 onBusy:(busy:boolean)=>void;
 onFailure:(message:string)=>void;
 persist:(attempts:LookupAttempts,nextRequestAt:number)=>void;
 attempts?:unknown;
 nextRequestAt?:unknown;
 now?:()=>number;
 setTimer?:(callback:()=>Promise<void>,delay:number)=>unknown;
 clearTimer?:(timer:unknown)=>void;
};
const GAP=1500; // At most 40 requests/minute, below the server's 80/minute budget.
const BACKOFF=[60000,300000,900000,3600000,21600000];
const MAX_ATTEMPTS=5;

export function readLookupAttempts(value:unknown,now=Date.now()):LookupAttempts {
 const result:LookupAttempts={};
 if(!value||typeof value!=='object'||Array.isArray(value))return result;
 for(const [id,v] of Object.entries(value).slice(0,5000)){
  if(id==='__proto__'||id==='constructor'||id==='prototype')continue;
  if(!v||typeof v!=='object')continue;
  const a=v as LookupAttempt;
  if(typeof a.term!=='string'||a.term.length>100||!Number.isInteger(a.count)||a.count<0||a.count>MAX_ATTEMPTS||!Number.isFinite(a.nextAt))continue;
  result[id]={term:a.term,count:a.count,nextAt:Math.min(Math.max(a.nextAt,0),now+86400000)};
 }
 return result;
}

// Database lookup_status is the durable work list. Only retry timing is browser-local.
// No dictionary, sentence, token or login credential is stored by this queue.
export class EnrichmentQueue {
 private options:Options;
 private attempts:LookupAttempts;
 private words=new Map<string,Word>();
 private manual=new Set<string>();
 private online=false;
 private disposed=false;
 private running=false;
 private inFlight:{id:string;term:string}|null=null;
 private blockedAuth=false;
 private timer:unknown=null;
 private nextRequestAt=0;
 private failureNotified=false;
 constructor(options:Options){this.options=options;this.attempts=readLookupAttempts(options.attempts,this.now());if(typeof options.nextRequestAt==='number'&&Number.isFinite(options.nextRequestAt))this.nextRequestAt=Math.min(Math.max(0,options.nextRequestAt),this.now()+86400000)}
 private now(){return (this.options.now||Date.now)()}
 private persist(){this.options.persist({...this.attempts},this.nextRequestAt)}
 private cancel(){if(this.timer!==null){(this.options.clearTimer||((t)=>clearTimeout(t as ReturnType<typeof setTimeout>)))(this.timer);this.timer=null}}
 private eligible(word:Word){return word.archivedAt===null&&(this.manual.has(word.id)||word.lookupStatus==='pending'||word.lookupStatus==='unavailable')}
 sync(words:Word[]){
  this.blockedAuth=false;
  this.words=new Map(words.map(w=>[w.id,w]));
  for(const [id,a] of Object.entries(this.attempts)){
   const word=this.words.get(id);
   if(!word||word.term!==a.term||!this.eligible(word))delete this.attempts[id];
  }
  this.persist();this.schedule();
 }
 setOnline(online:boolean){this.online=online;this.schedule()}
 retry(ids:string[]){
  for(const id of ids){const word=this.words.get(id);if(!word||word.archivedAt!==null||(this.inFlight?.id===id&&this.inFlight.term===word.term))continue;this.manual.add(id);delete this.attempts[id]}
  this.blockedAuth=false;
  this.failureNotified=false;this.persist();this.schedule();
 }
 dispose(){this.disposed=true;this.cancel()}
 private schedule(){
  this.cancel();
  if(this.disposed||!this.online||this.running||this.blockedAuth)return;
  let earliest=Infinity;
  for(const word of this.words.values()){
   if(!this.eligible(word))continue;
   const attempt=this.attempts[word.id];
   if(attempt?.term===word.term&&attempt.count>=MAX_ATTEMPTS&&!this.manual.has(word.id))continue;
   earliest=Math.min(earliest,attempt?.term===word.term?attempt.nextAt:0);
  }
  if(!Number.isFinite(earliest))return;
  const delay=Math.max(0,earliest-this.now(),this.nextRequestAt-this.now());
  this.timer=(this.options.setTimer||((fn,ms)=>setTimeout(()=>void fn(),ms)))(()=>this.pump(),delay);
 }
 private async pump(){
  this.timer=null;
  if(this.disposed||!this.online||this.running||this.blockedAuth)return;
  const now=this.now();
  const word=[...this.words.values()].find(w=>{
   if(!this.eligible(w))return false;
   const a=this.attempts[w.id];
   return !a||a.term!==w.term||(a.count<MAX_ATTEMPTS&&a.nextAt<=now);
  });
  if(!word){this.schedule();return}
  this.running=true;this.inFlight={id:word.id,term:word.term};this.options.onBusy(true);this.manual.delete(word.id);
  const previous=this.attempts[word.id];
  const count=(previous?.term===word.term?previous.count:0)+1;
  // Write before issuing the request, so an interrupted tab has a bounded retry.
  this.attempts[word.id]={term:word.term,count,nextAt:now+BACKOFF[Math.min(count-1,BACKOFF.length-1)]};
  this.nextRequestAt=now+GAP;this.persist();
  try{
   const result=await this.options.lookup(word.id);
   if(this.disposed)return;
   if(!result||!result.word||result.word.id!==word.id||result.word.term!==word.term||typeof result.word.lookupStatus!=='string'||(result.word.archivedAt!==null&&typeof result.word.archivedAt!=='number')||!['found','not_found','unavailable'].includes(result.status))throw new Error('Invalid lookup response');
   const current=this.words.get(word.id);
   if(!current||current.term!==word.term||current.archivedAt!==null)return;
   this.words.set(word.id,result.word);this.options.onWord(result.word);
   if(result.status==='found'||result.status==='not_found'||result.word.lookupStatus==='found'){
    delete this.attempts[word.id];this.failureNotified=false;
   }else{
    if(result.lookupError?.upstreamStatus===429){
     this.nextRequestAt=this.now()+60000;
     this.attempts[word.id]={term:word.term,count,nextAt:Math.max(this.attempts[word.id]?.nextAt||0,this.nextRequestAt)};
    }
    this.notify('詞典暫時無法回應，已儲存的詞彙不會遺失。系統會有限次自動重試，也可稍後按查詢。');
   }
  }catch(error){
   if(this.disposed)return;
   const status=typeof error==='object'&&error&&'status' in error?Number(error.status):0;
   if(status===401||status===403)this.blockedAuth=true;
   if(status===429){
    this.nextRequestAt=this.now()+60000;
    this.attempts[word.id]={term:word.term,count:Math.min(count,MAX_ATTEMPTS),nextAt:this.nextRequestAt};
   }
   this.notify(status===401||status===403?'查詢需要有效的登入權限，請重新載入確認登入狀態。已儲存的詞彙仍會保留。':status===429?'查詢較頻繁，已暫停並稍後重試。不必重新匯入詞彙。':'自動查詢暫時中斷，詞彙已儲存，稍後會有限次重試。');
  }finally{
   this.running=false;this.inFlight=null;
   if(!this.disposed){this.persist();this.options.onBusy(false);this.schedule()}
  }
 }
 private notify(message:string){if(!this.failureNotified){this.failureNotified=true;this.options.onFailure(message)}}
}
