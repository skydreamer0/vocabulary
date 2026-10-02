export type Meaning={partOfSpeech:string;definition:string;example:string};
export type Word={id:string;term:string;context:string;sense:string;definition:string;phonetic:string;dictionary:Meaning[];lookupStatus:string;createdAt:number;dueAt:number;intervalDays:number;streak:number;revision:number;archivedAt:number|null};
export type Review={id:string;term:string;rating:string;reviewedAt:number;dueAfter:number;timezone:string};
export type Candidate={id:string;term:string;context:string;sense:string;selected:boolean};
export const normal=(s:string)=>s.normalize('NFKC').trim().replace(/\s+/g,' ').toLowerCase();
export const keyFor=(w:{term:string;context:string;sense:string})=>JSON.stringify([normal(w.term),normal(w.context),normal(w.sense)]);
export function schedule(rating:string,interval:number,streak:number,now:number){
  const days=rating==='again'?10/1440:rating==='hard'?Math.max(1,interval*1.2):rating==='good'?(streak===0?1:Math.max(3,interval*2)):Math.max(3,interval*3);
  return {dueAt:now+Math.round(Math.min(days,365)*86400000),intervalDays:Math.min(days,365),streak:rating==='again'?0:streak+1};
}
export function mapWord(r:Record<string,unknown>):Word {let dictionary:Meaning[]=[];try{dictionary=Array.isArray(r.dictionary)?r.dictionary as Meaning[]:JSON.parse(String(r.dictionary))}catch{}return {id:String(r.id),term:String(r.term),context:String(r.context),sense:String(r.sense),definition:String(r.definition),phonetic:String(r.phonetic),dictionary,lookupStatus:String(r.lookup_status),createdAt:Number(r.created_at),dueAt:Number(r.due_at),intervalDays:Number(r.interval_days),streak:Number(r.streak),revision:Number(r.revision),archivedAt:r.archived_at===null?null:Number(r.archived_at)};}
