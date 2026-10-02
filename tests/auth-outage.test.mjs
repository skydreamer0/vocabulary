import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';

const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const base=`http://localhost:${port}`;
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p',String(port),'--hostname','localhost'],{
 windowsHide:true,stdio:'ignore',env:{...process.env,NEON_AUTH_BASE_URL:'http://127.0.0.1:1/auth',NEON_AUTH_COOKIE_SECRET:'outage-test-secret-at-least-32-characters'},
});
try{
 let ready=false;
 for(let i=0;i<100;i++){
  try{ready=(await fetch(base+'/login',{signal:AbortSignal.timeout(1000)})).ok}catch{}
  if(ready)break;
  if(server.exitCode!==null)throw new Error('Outage test server exited');
  await delay(100);
 }
 assert.ok(ready,'Outage test server must start');
 assert.equal((await fetch(base+'/',{redirect:'manual'})).status,307);
 assert.equal((await fetch(base+'/api/words')).status,401);
 console.log('PASS anonymous requests do not depend on provider availability');
 const cookie='__Secure-neon-auth.session_token=synthetic-outage-test';
 const home=await fetch(base+'/',{redirect:'manual',headers:{cookie}});
 assert.equal(home.status,503);assert.equal(home.headers.get('location'),null);
 assert.equal(home.headers.get('set-cookie'),null);assert.match(await home.text(),/登入服務暫時無法連線/);
 console.log('PASS auth outage returns 503 without login redirect or cookie clearing');
 const signout=await fetch(base+'/auth/signout',{method:'POST',redirect:'manual',headers:{cookie,origin:base}});
 assert.equal(signout.status,303);
 assert.equal(new URL(signout.headers.get('location'),base).pathname,'/auth/signout-error');
 assert.match(signout.headers.get('cache-control'),/no-store/);
 assert.equal((await fetch(base+'/auth/signout-error')).status,200);
 console.log('PASS failed sign-out leads to an honest retry page');
}finally{
 const stopped=once(server,'exit');server.kill();await stopped;
}
