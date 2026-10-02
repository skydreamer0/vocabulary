export type AuthProblem={name?:string;status?:number}|null;
export type SignInClient={
 auth:{exchangeCodeForSession:(code:string)=>Promise<{error:AuthProblem}>;getUser:()=>Promise<{data:{user:{id:string}|null};error:AuthProblem}>};
 rpc:(name:string)=>PromiseLike<{data:unknown;error:unknown}>;
};
export function temporarilyUnavailable(error:AuthProblem){return !!error&&(error.name==='AuthRetryableFetchError'||(error.status||0)>=500)}
// Return only fixed local destinations. Provider errors never become redirect URLs.
export async function signInDestination(client:SignInClient,code:string):Promise<string>{
 try{
  const exchange=await client.auth.exchangeCodeForSession(code);
  if(exchange.error)return temporarilyUnavailable(exchange.error)?'/login?reason=unavailable':'/login?reason=expired';
  const identity=await client.auth.getUser();
  if(identity.error)return temporarilyUnavailable(identity.error)?'/login?reason=unavailable':'/login?reason=expired';
  if(!identity.data.user)return '/login?reason=expired';
  const membership=await client.rpc('vocab_is_member');
  if(membership.error)return '/login?reason=unavailable';
  return membership.data===true?'/':'/login?reason=not_allowed';
 }catch{return '/login?reason=unavailable'}
}
export async function signOutCompleted(client:{auth:{signOut:(options:{scope:'local'})=>Promise<{error:AuthProblem}>}}){
 try{const {error}=await client.auth.signOut({scope:'local'});return !error}catch{return false}
}
