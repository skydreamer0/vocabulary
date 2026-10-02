import {test} from 'node:test';
import assert from 'node:assert/strict';
import {signInDestination,signOutCompleted} from '../lib/auth-flow.ts';
const unavailable={name:'AuthRetryableFetchError',status:503};
function client({exchangeError=null,userError=null,user={id:'owner'},membership=true,membershipError=null}={}){return {auth:{exchangeCodeForSession:async()=>({error:exchangeError}),getUser:async()=>({data:{user},error:userError})},rpc:async()=>({data:membership,error:membershipError})}}
test('successful verified member returns the app',async()=>assert.equal(await signInDestination(client(),'code'),'/'));
test('a verified nonmember is distinguished from outages',async()=>assert.equal(await signInDestination(client({membership:false}),'code'),'/login?reason=not_allowed'));
test('an exchange outage is retryable rather than expiry or denial',async()=>assert.equal(await signInDestination(client({exchangeError:unavailable}),'code'),'/login?reason=unavailable'));
test('a user verification outage is not access denial',async()=>assert.equal(await signInDestination(client({userError:unavailable}),'code'),'/login?reason=unavailable'));
test('a membership database outage is not access denial',async()=>assert.equal(await signInDestination(client({membershipError:{code:'503'}}),'code'),'/login?reason=unavailable'));
test('invalid or missing verified identity does not reach the app',async()=>{assert.equal(await signInDestination(client({exchangeError:{status:400}}),'code'),'/login?reason=expired');assert.equal(await signInDestination(client({user:null}),'code'),'/login?reason=expired')});
test('a thrown provider error remains a fixed local failure destination',async()=>assert.equal(await signInDestination({auth:{exchangeCodeForSession:async()=>{throw new Error('offline')}}},'code'),'/login?reason=unavailable'));
test('failed sign-out does not report completion or imply cookies were cleared',async()=>{let options;const done=await signOutCompleted({auth:{signOut:async o=>{options=o;return {error:unavailable}}}});assert.equal(done,false);assert.deepEqual(options,{scope:'local'})});
test('successful sign-out is the only success path',async()=>{assert.equal(await signOutCompleted({auth:{signOut:async()=>({error:null})}}),true);assert.equal(await signOutCompleted({auth:{signOut:async()=>{throw new Error('offline')}}}),false)});
