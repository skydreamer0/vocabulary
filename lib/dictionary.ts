import type {Meaning} from './types';

export type LookupFailure={code:'unsupported_term'|'timeout'|'network_error'|'provider_http'|'provider_redirect'|'response_too_large'|'invalid_response'|'empty_response';retryable:boolean;upstreamStatus?:number};
export type DictionaryResult={status:'found'|'not_found'|'unavailable';phonetic:string;meanings:Meaning[];failure?:LookupFailure};
type Options={fetcher?:typeof fetch;timeoutMs?:number};
const MAX_BYTES=200000;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown,max:number)=>typeof value==='string'?value.slice(0,max):'';

export async function lookupDictionary(term:string,{fetcher=fetch,timeoutMs=6000}:Options={}):Promise<DictionaryResult>{
 const empty={phonetic:'',meanings:[] as Meaning[]};
 const normalized=term.trim().replace(/[’‘]/g,"'").replace(/\s+/g,' ').toLowerCase();
 if(!/^[a-z][a-z' -]{0,79}$/.test(normalized))return {...empty,status:'not_found',failure:{code:'unsupported_term',retryable:false}};
 let failure:LookupFailure={code:'network_error',retryable:true};
 try{
  // Never accept a URL/hostname from the client or follow provider redirects.
  const response=await fetcher(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(normalized)}`,{signal:AbortSignal.timeout(timeoutMs),redirect:'manual',headers:{Accept:'application/json'}});
  if(response.status===404)return {...empty,status:'not_found'};
  if(!response.ok)return {...empty,status:'unavailable',failure:{code:response.status>=300&&response.status<400?'provider_redirect':'provider_http',retryable:true,upstreamStatus:response.status}};
  const reader=response.body?.getReader();if(!reader)return {...empty,status:'unavailable',failure:{code:'empty_response',retryable:true}};
  let size=0;const chunks:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_BYTES){await reader.cancel();return {...empty,status:'unavailable',failure:{code:'response_too_large',retryable:true}}}chunks.push(value)}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  failure={code:'invalid_response',retryable:true};
  const data:unknown=JSON.parse(new TextDecoder().decode(bytes));
  if(!Array.isArray(data)||data.length>0&&!data.some(object))return {...empty,status:'unavailable',failure};
  let phonetic='',schemaValid=data.length===0;const meanings:Meaning[]=[];
  for(const entry of data.slice(0,4)){
   if(!object(entry))continue;
   if(!phonetic)phonetic=text(entry.phonetic,150);
   if(!phonetic&&Array.isArray(entry.phonetics))for(const p of entry.phonetics.slice(0,8)){if(object(p)&&typeof p.text==='string'&&p.text){phonetic=p.text.slice(0,150);break}}
   if(!Array.isArray(entry.meanings))continue;
   if(entry.meanings.length===0)schemaValid=true;
   for(const meaning of entry.meanings.slice(0,8)){
    if(!object(meaning)||!Array.isArray(meaning.definitions))continue;
    if(meaning.definitions.length===0)schemaValid=true;
    for(const definition of meaning.definitions.slice(0,3))if(object(definition)&&typeof definition.definition==='string'){
     schemaValid=true;
     if(definition.definition.trim())meanings.push({partOfSpeech:text(meaning.partOfSpeech,30),definition:text(definition.definition,1200),example:text(definition.example,1000)});
    }
   }
  }
  if(!schemaValid)return {...empty,status:'unavailable',failure};
  return {status:meanings.length?'found':'not_found',phonetic,meanings:meanings.slice(0,16)};
 }catch(error){
  if(error instanceof Error&&(error.name==='TimeoutError'||error.name==='AbortError'))failure={code:'timeout',retryable:true};
  return {...empty,status:'unavailable',failure};
 }
}
