// Live smoke tests; no accounts created and no emails sent.
import assert from 'node:assert/strict';

const base = process.env.BASE_URL || 'http://localhost:3000';
const home = await fetch(base + '/', { redirect: 'manual' });
assert.equal(home.status, 307);
assert.equal(new URL(home.headers.get('location'), base).pathname, '/login');
assert.equal((await fetch(base + '/login')).status, 200);
const session = await fetch(base + '/api/auth/get-session');
assert.equal(session.status, 200);
assert.equal(await session.json(), null);
console.log('PASS anonymous page redirect and session response');

for (const path of ['/api/words', '/api/reviews']) {
  const response = await fetch(base + path, {
    headers: { 'x-test-user': 'forged-user', 'x-test-auth': 'invalid-secret' },
  });
  assert.equal(response.status, 401);
  assert.match(response.headers.get('cache-control'), /no-store/);
}
console.log('PASS forged identity rejected by protected APIs');

for (const path of ['/api/auth/sign-in/email-otp', '/auth/signout']) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    body: '{}',
    redirect: 'manual',
  });
  assert.equal(response.status, 403);
}
console.log('PASS cross-origin auth and sign-out rejected');

const invalid = await fetch(base + '/api/auth/sign-in/email-otp', {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: base },
  body: JSON.stringify({ email: 'neon-qa@example.invalid', otp: '000000' }),
});
assert.equal(invalid.status, 400);
assert.equal((await invalid.json()).code, 'INVALID_OTP');
console.log('PASS invalid OTP rejected by live Neon Auth');
