// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker, { verifyRetell, verifyTwilio, lastSavedJob, demoText, clean, handleEndedCall, emailRuntime, alertMime, checkDailyCalls, pittsburghDate } from './index.js';
import site from '../site.config.json' with { type: 'json' };

import agentCfg from '../agent/demo-agent.json' with { type: 'json' };

// The tests set texting and ringing themselves, whatever demo-agent.json says right now.
// (Same object the Worker imports.)
agentCfg.textTheCaller = true;
agentCfg.ringOnEmergency = true;

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
// Alert emails: a stand-in for Cloudflare's send_email binding and EmailMessage class.
class FakeEmailMessage { constructor(from, to, raw) { Object.assign(this, { from, to, raw }); } }
emailRuntime.load = async () => FakeEmailMessage;
function fakeMail(to = 'ryan@example.com') {
  const sent = [];
  return { sent, env: { ALERT_EMAIL: { send: async (m) => { sent.push(m); } }, ALERT_TO: to } };
}
const bodyOf = (m) => Buffer.from(m.raw.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
const subjectOf = (m) => Buffer.from(/^Subject: =\?UTF-8\?B\?(.*)\?=\r?$/m.exec(m.raw)[1], 'base64').toString('utf8');

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

test('call_ended: answers 204 at once, then texts the caller and emails an alert', async () => {
  const sent = fakeFetch();
  const mail = fakeMail();
  const env = { RETELL_API_KEY: KEY, TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+14125550100', ...mail.env };
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
  assert.equal(mail.sent.length, 1, 'alert emailed');
  assert.equal(mail.sent[0].to, 'ryan@example.com');
  assert.equal(subjectOf(mail.sent[0]), "Demo call — Joe's Plumbing");
  assert.match(bodyOf(mail.sent[0]), /SCHEDULE REQUEST: furnace/);
  assert.ok(!sent.some((s) => s.url.endsWith('/Calls.json')), 'no ring for a non-emergency');
});

test('emergency also rings; missing Twilio still alerts', async () => {
  let sent = fakeFetch();
  const env = { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM: '+14125550100', ...fakeMail().env };
  const emergency = call({ transcript_with_tool_calls: [{ role: 'tool_call_invocation', name: 'save_job', arguments: JSON.stringify({ ...job, category: 'emergency' }) }] });
  const r = await handleEndedCall(emergency, env);
  assert.equal(r.outcome.ring, 'placed');
  const ring = sent.find((s) => s.url.endsWith('/Calls.json'));
  assert.ok(ring);
  // the voice says the name one digit at a time, never "412"
  const said = new URLSearchParams(ring.body).get('Twiml');
  assert.match(said, /Yello four one two makes to the owner/);
  assert.doesNotMatch(said, /412/);

  sent = fakeFetch();
  const mail = fakeMail();
  const r2 = await handleEndedCall(call(), mail.env);
  assert.match(r2.outcome.text, /Twilio not set up/);
  assert.equal(sent.length, 0);
  assert.match(bodyOf(mail.sent[0]), /Twilio not set up/);
});

test('no job saved: alert only, no text', async () => {
  const sent = fakeFetch();
  const mail = fakeMail();
  const r = await handleEndedCall(call({ transcript_with_tool_calls: [] }), { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM: '+1', ...mail.env });
  assert.equal(r.job, null);
  assert.equal(sent.length, 0, 'no text');
  assert.match(bodyOf(mail.sent[0]), /No job taken/);
});

test('texting off: no text to the caller, alert still emailed', async () => {
  const sent = fakeFetch();
  const mail = fakeMail();
  agentCfg.textTheCaller = false;
  try {
    const r = await handleEndedCall(call(), { TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM: '+14125550100', ...mail.env });
    assert.equal(r.outcome.text, 'off');
  } finally {
    agentCfg.textTheCaller = true;
  }
  assert.ok(!sent.some((s) => s.url.endsWith('/Messages.json')), 'no text');
  assert.match(bodyOf(mail.sent[0]), /Text to caller: off/);
});

test('KV dedupes a retried webhook', async () => {
  fakeFetch();
  const store = new Map();
  const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } };
  const env = { DEMO_KV: kv, ...fakeMail().env };
  await handleEndedCall(call(), env);
  const again = await handleEndedCall(call(), env);
  assert.equal(again.skipped, 'duplicate');
});

const memKV = () => { const store = new Map(); return { store, get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } }; };
const inbound = (from, id) => ({ event: 'call_inbound', call_inbound: { call_id: id, from_number: from, to_number: '+14122269994' } });
async function ring(env, body, signed = true) {
  const raw = JSON.stringify(body);
  const headers = signed ? { 'x-retell-signature': sign(raw) } : {};
  const res = await worker.fetch(new Request('https://x/api/retell/inbound', { method: 'POST', body: raw, headers }), env, ctx());
  assert.equal(res.status, 200);
  return (await res.json()).call_inbound;
}

test('inbound: each number gets callsPerDay calls a day, then is rejected', async () => {
  agentCfg.callsPerDay = 2;
  const env = { RETELL_API_KEY: KEY, DEMO_KV: memKV() };
  assert.equal((await ring(env, inbound('+14125550142', 'c1'))).reject, undefined);
  assert.equal((await ring(env, inbound('+14125550142', 'c2'))).reject, undefined);
  assert.equal((await ring(env, inbound('+14125550142', 'c3'))).reject, true);
  // a different caller still gets through
  assert.equal((await ring(env, inbound('+14125559999', 'c4'))).reject, undefined);
});

test('inbound: retries are counted once, the team is never capped, the next day resets', async () => {
  agentCfg.callsPerDay = 2;
  const env = { DEMO_KV: memKV() };
  const c = (id) => ({ call_id: id, from_number: '+14125550142' });
  assert.equal(await checkDailyCalls(env, c('a')), 'allowed');
  assert.equal(await checkDailyCalls(env, c('a')), 'allowed'); // Retell retry, same call
  assert.equal(await checkDailyCalls(env, c('b')), 'allowed');
  assert.equal(await checkDailyCalls(env, c('c')), 'over');
  assert.equal(await checkDailyCalls(env, c('c')), 'over');
  for (let i = 0; i < 5; i++) assert.equal(await checkDailyCalls(env, { call_id: `t${i}`, from_number: site.partnerCell }), 'team');
  const tomorrow = new Date(Date.now() + 86400000);
  assert.equal(await checkDailyCalls(env, c('d'), tomorrow), 'allowed');
});

test('inbound: fails open without KV, with a bad signature, or with no caller ID', async () => {
  agentCfg.callsPerDay = 2;
  const env = { RETELL_API_KEY: KEY };
  for (const id of ['x1', 'x2', 'x3']) assert.equal((await ring(env, inbound('+14125550142', id))).reject, undefined);
  const kvEnv = { RETELL_API_KEY: KEY, DEMO_KV: memKV() };
  for (const id of ['y1', 'y2', 'y3']) assert.equal((await ring(kvEnv, inbound('+14125550142', id), false)).reject, undefined);
  assert.equal(kvEnv.DEMO_KV.store.size, 0); // unsigned requests aren't counted
  assert.equal(await checkDailyCalls(kvEnv, { call_id: 'z', from_number: 'anonymous' }), 'uncapped');
});

test('Pittsburgh date rolls over at local midnight, not UTC', () => {
  // 03:30 UTC on Nov 10 is still Nov 9 in Pittsburgh
  assert.equal(pittsburghDate(new Date('2026-11-10T03:30:00Z')), '2026-11-09');
  assert.equal(pittsburghDate(new Date('2026-11-10T05:30:00Z')), '2026-11-10');
});

test('Twilio reply YES emails a LEAD alert and answers; STOP gets no reply', async () => {
  const mail = fakeMail();
  const url = 'https://yello412.com/api/twilio/sms';
  const env = { TWILIO_AUTH_TOKEN: 'tok', ...mail.env };
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
  assert.match(subjectOf(mail.sent.at(-1)), /^LEAD: 412-555-0142/);
  assert.doesNotMatch(await post('STOP'), /<Message>/);
  assert.equal(mail.sent.length, 1, 'no alert for STOP');
});

test('alert email: one per address, valid headers, no email setup means log only', async () => {
  const mail = fakeMail('ryan@example.com, benton@example.com');
  await handleEndedCall(call(), mail.env);
  assert.deepEqual(mail.sent.map((m) => m.to), ['ryan@example.com', 'benton@example.com']);
  assert.equal(mail.sent[0].from, 'demo@yello412.com');
  const raw = alertMime({ from: 'demo@yello412.com', to: 'r@example.com', subject: 'Demo call — Café', text: 'x'.repeat(200), date: new Date(0), id: 'abc' });
  assert.match(raw, /^From: Yello 412 demo <demo@yello412\.com>\r\nTo: r@example\.com\r\n/);
  assert.match(raw, /\r\nMessage-ID: <abc@yello412\.com>\r\n/);
  assert.match(raw, /\r\nDate: Thu, 01 Jan 1970 00:00:00 GMT\r\n/);
  assert.equal(subjectOf({ raw }), 'Demo call — Café');
  assert.equal(bodyOf({ raw }), 'x'.repeat(200));
  assert.ok(raw.split('\r\n').every((l) => l.length <= 78), 'lines stay short');

  const logged = [];
  const log = console.log;
  console.log = (m) => logged.push(m);
  try { await handleEndedCall(call(), {}); } finally { console.log = log; }
  assert.match(logged.join('\n'), /alert \(email not set up\)/);
});

test('non-API paths go to the static site', async () => {
  const env = { ASSETS: { fetch: async () => new Response('site') } };
  const res = await worker.fetch(new Request('https://x/'), env, ctx());
  assert.equal(await res.text(), 'site');
  const api = await worker.fetch(new Request('https://x/api/nope'), env, ctx());
  assert.equal(api.status, 404);
});
