// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker, { verifyRetell, verifyTwilio, lastSavedJob, demoText, clean, handleEndedCall } from './index.js';

const KEY = 'key_test_123';
const sign = (raw, ts = Date.now()) => `v=${ts},d=${createHmac('sha256', KEY).update(raw + ts).digest('hex')}`;

const job = {
  business_name: "Joe's Plumbing",
  category: 'schedule_request',
  problem: "furnace won't start, 58F inside",
  caller_name: 'Dana K',
  callback_number: '4125550142',
  area: 'Mt. Lebanon',
  wants_when: 'today after 1',
};
const call = (extra = {}) => ({
  call_id: 'call_1', call_type: 'phone_call', from_number: '+14125550142', to_number: '+14125550100',
  duration_ms: 72000, disconnection_reason: 'user_hangup',
  transcript_with_tool_calls: [
    { role: 'agent', content: 'Thanks for calling' },
    { role: 'tool_call_invocation', tool_call_id: 't1', name: 'save_job', arguments: JSON.stringify({ ...job, area: 'old' }) },
    { role: 'tool_call_invocation', tool_call_id: 't2', name: 'save_job', arguments: JSON.stringify(job) },
    { role: 'tool_call_result', tool_call_id: 't2', content: 'Saved' },
  ],
  ...extra,
});

function fakeFetch() {
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), body: init?.body }); return new Response('{}', { status: 200 }); };
  return calls;
}
const ctx = () => { const p = []; return { waitUntil: (x) => p.push(x), done: () => Promise.all(p) }; };

test('Retell signature: valid, tampered, stale, missing', async () => {
  const raw = '{"event":"call_ended"}';
  assert.equal(await verifyRetell(raw, sign(raw), KEY), true);
  assert.equal(await verifyRetell(raw + ' ', sign(raw), KEY), false);
  assert.equal(await verifyRetell(raw, sign(raw, Date.now() - 6 * 60 * 1000), KEY), false);
  assert.equal(await verifyRetell(raw, null, KEY), false);
  assert.equal(await verifyRetell(raw, sign(raw), ''), false);
});

test('Twilio signature matches the documented algorithm', async () => {
  const url = 'https://yello412.com/api/twilio/sms';
  const params = { From: '+14125550142', Body: 'Yes', To: '+14125550100' };
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const header = createHmac('sha1', 'tok').update(data).digest('base64');
  assert.equal(await verifyTwilio(url, params, header, 'tok'), true);
  assert.equal(await verifyTwilio(url, { ...params, Body: 'No' }, header, 'tok'), false);
});

test('uses the latest save_job call', () => {
  assert.equal(lastSavedJob(call()).area, 'Mt. Lebanon');
  assert.equal(lastSavedJob({ transcript_with_tool_calls: [] }), null);
});

test('demo text layout', () => {
  const t = demoText(job);
  assert.equal(t.split('\n')[0], "SCHEDULE REQUEST: furnace won't start, 58F inside");
  assert.match(t, /Dana K · 412-555-0142/);
  assert.match(t, /Wants: today after 1/);
  assert.match(t, /Reply YES/);
  assert.ok(t.length < 320, 'fits in two SMS segments');
});

test('caller text is cleaned', () => {
  assert.equal(clean('call me http://evil.example now\u0007', 80), 'call me now');
  assert.equal(clean('x'.repeat(200), 10).length, 10);
});

test('save-job rejects unsigned and accepts signed requests', async () => {
  const env = { RETELL_API_KEY: KEY };
  const raw = JSON.stringify({ name: 'save_job', args: job });
  const bad = await worker.fetch(new Request('https://x/api/demo/save-job', { method: 'POST', body: raw }), env, ctx());
  assert.equal(bad.status, 401);
  const ok = await worker.fetch(new Request('https://x/api/demo/save-job', { method: 'POST', body: raw, headers: { 'x-retell-signature': sign(raw) } }), env, ctx());
  assert.equal(ok.status, 200);
});

test('call_ended: answers 204 at once, then texts the caller and alerts Telegram', async () => {
  const sent = fakeFetch();
  const env = { RETELL_API_KEY: KEY, TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+14125550100', TELEGRAM_BOT_TOKEN: 'b', TELEGRAM_CHAT_ID: '1' };
  const raw = JSON.stringify({ event: 'call_ended', call: call() });
  const c = ctx();
  const res = await worker.fetch(new Request('https://x/api/retell/webhook', { method: 'POST', body: raw, headers: { 'x-retell-signature': sign(raw) } }), env, c);
  assert.equal(res.status, 204);
  await c.done();
  const sms = sent.find((s) => s.url.endsWith('/Messages.json'));
  assert.ok(sms, 'text sent');
  const form = new URLSearchParams(sms.body);
  assert.equal(form.get('To'), '+14125550142');
  assert.match(form.get('Body'), /^SCHEDULE REQUEST/);
  assert.ok(sent.some((s) => s.url.includes('api.telegram.org')), 'Telegram alert sent');
  assert.ok(!sent.some((s) => s.url.endsWith('/Calls.json')), 'no ring for a non-emergency');
});

test('emergency also rings; missing Twilio still alerts', async () => {
  let sent = fakeFetch();
  const env = { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+14125550100', TELEGRAM_BOT_TOKEN: 'b', TELEGRAM_CHAT_ID: '1' };
  const emergency = call({ transcript_with_tool_calls: [{ role: 'tool_call_invocation', name: 'save_job', arguments: JSON.stringify({ ...job, category: 'emergency' }) }] });
  const r = await handleEndedCall(emergency, env);
  assert.equal(r.outcome.ring, 'placed');
  assert.ok(sent.some((s) => s.url.endsWith('/Calls.json')));

  sent = fakeFetch();
  const r2 = await handleEndedCall(call(), { TELEGRAM_BOT_TOKEN: 'b', TELEGRAM_CHAT_ID: '1' });
  assert.match(r2.outcome.text, /Twilio not set up/);
  assert.equal(sent.length, 1);
  assert.match(JSON.parse(sent[0].body).text, /Twilio not set up/);
});

test('no job saved: alert only, no text', async () => {
  const sent = fakeFetch();
  const r = await handleEndedCall(call({ transcript_with_tool_calls: [] }), { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM: '+1', TELEGRAM_BOT_TOKEN: 'b', TELEGRAM_CHAT_ID: '1' });
  assert.equal(r.job, null);
  assert.equal(sent.length, 1);
  assert.match(JSON.parse(sent[0].body).text, /No job taken/);
});

test('KV dedupes a retried webhook', async () => {
  fakeFetch();
  const store = new Map();
  const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } };
  const env = { DEMO_KV: kv, TELEGRAM_BOT_TOKEN: 'b', TELEGRAM_CHAT_ID: '1' };
  await handleEndedCall(call(), env);
  const again = await handleEndedCall(call(), env);
  assert.equal(again.skipped, 'duplicate');
});

test('Twilio reply YES pings Telegram and answers; STOP gets no reply', async () => {
  const sent = fakeFetch();
  const url = 'https://yello412.com/api/twilio/sms';
  const env = { TWILIO_AUTH_TOKEN: 'tok', TELEGRAM_BOT_TOKEN: 'b', TELEGRAM_CHAT_ID: '1' };
  const post = async (Body) => {
    const params = { From: '+14125550142', Body };
    const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
    const sig = createHmac('sha1', 'tok').update(data).digest('base64');
    const c = ctx();
    const res = await worker.fetch(new Request(url, { method: 'POST', body: new URLSearchParams(params).toString(), headers: { 'x-twilio-signature': sig, 'content-type': 'application/x-www-form-urlencoded' } }), env, c);
    await c.done();
    return res.text();
  };
  assert.match(await post('yes!'), /<Message>Nice\./);
  assert.match(JSON.parse(sent.at(-1).body).text, /^LEAD/);
  assert.doesNotMatch(await post('STOP'), /<Message>/);
});

test('non-API paths go to the static site', async () => {
  const env = { ASSETS: { fetch: async () => new Response('site') } };
  const res = await worker.fetch(new Request('https://x/'), env, ctx());
  assert.equal(await res.text(), 'site');
  const api = await worker.fetch(new Request('https://x/api/nope'), env, ctx());
  assert.equal(api.status, 404);
});
