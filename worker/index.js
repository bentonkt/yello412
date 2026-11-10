// Yello 412 Worker: serves the site (static assets) and the demo line's backend.
//
// Routes (everything else is the static site):
//   POST /api/demo/save-job     Retell tool call, mid-call. Acknowledges fast; the job is read back
//                               from the transcript when the call ends.
//   POST /api/retell/webhook    Retell call_ended → text the caller the owner-style text,
//                               ring them if it was an emergency, email the team an alert.
//   POST /api/twilio/sms        Replies to the demo text (YES = lead) → alert email.
//
// Secrets (wrangler secret put …, or .dev.vars locally):
//   RETELL_API_KEY                         verifies Retell requests (use the key with the webhook badge)
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN  texts and the emergency ring
//   ALERT_TO                               where alert emails go, comma-separated; each must be a
//                                          verified destination address in Cloudflare Email Routing
// Vars (wrangler.toml):
//   TWILIO_FROM                            the Twilio number texts and rings come from
//   ALERT_FROM                             optional sender, default demo@<site host>
// Bindings (wrangler.toml):
//   ALERT_EMAIL (send_email)               sends the alerts; until it's set up, alerts go to the Worker log
//   DEMO_KV (optional KV)                  dedupes Retell retries and caps texts to 3 per number per day

import site from '../site.config.json' with { type: 'json' };
import agentCfg from '../agent/demo-agent.json' with { type: 'json' };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/api/demo/save-job') return await saveJob(request, env);
      if (request.method === 'POST' && url.pathname === '/api/retell/webhook') return await retellWebhook(request, env, ctx);
      if (request.method === 'POST' && url.pathname === '/api/twilio/sms') return await twilioSms(request, env, ctx);
    } catch (err) {
      console.error(err);
      return new Response('error', { status: 500 });
    }
    if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    return env.ASSETS.fetch(request);
  },
};

// ---------- Retell ----------

async function saveJob(request, env) {
  const raw = await request.text();
  if (!(await verifyRetell(raw, request.headers.get('x-retell-signature'), env.RETELL_API_KEY))) {
    return new Response('bad signature', { status: 401 });
  }
  // Nothing to store: Retell includes every tool call in the transcript it sends at call end.
  return Response.json({ result: 'Saved. The owner will get it by text.' });
}

async function retellWebhook(request, env, ctx) {
  const raw = await request.text();
  if (!(await verifyRetell(raw, request.headers.get('x-retell-signature'), env.RETELL_API_KEY))) {
    return new Response('bad signature', { status: 401 });
  }
  const { event, call } = JSON.parse(raw);
  if (event !== 'call_ended' || !call) return new Response(null, { status: 204 });

  // Answer Retell right away (it retries after 10 seconds); do the sending in the background.
  ctx.waitUntil(handleEndedCall(call, env).catch((err) => console.error('call_ended', err)));
  return new Response(null, { status: 204 });
}

export async function handleEndedCall(call, env) {
  if (env.DEMO_KV) {
    const key = `done:${call.call_id}`;
    if (await env.DEMO_KV.get(key)) return { skipped: 'duplicate' };
    await env.DEMO_KV.put(key, '1', { expirationTtl: 86400 });
  }

  const job = lastSavedJob(call);
  const caller = call.call_type === 'phone_call' ? toE164(call.from_number) : '';
  const seconds = Math.round((call.duration_ms ?? ((call.end_timestamp || 0) - (call.start_timestamp || 0))) / 1000);
  const outcome = { text: 'off', ring: 'off' };

  if (job && caller && agentCfg.textTheCaller) {
    if (!twilioReady(env)) outcome.text = 'not sent (Twilio not set up)';
    else if (!(await underDailyCap(env, caller))) outcome.text = 'not sent (3 a day already)';
    else {
      const r = await twilio(env, 'Messages.json', { To: caller, From: env.TWILIO_FROM, Body: demoText(job) });
      outcome.text = r.ok ? 'sent' : `failed: ${r.error}`;
    }
  }

  if (job && caller && job.category === 'emergency' && agentCfg.ringOnEmergency && twilioReady(env)) {
    await sleep(4000); // give them a moment to hang up first
    const r = await twilio(env, 'Calls.json', { To: caller, From: env.TWILIO_FROM, Twiml: emergencyTwiml(job) });
    outcome.ring = r.ok ? 'placed' : `failed: ${r.error}`;
  }

  await alert(env, alertText(call, job, caller, seconds, outcome));
  return { job, outcome };
}

// The most recent save_job arguments in the call, or null.
export function lastSavedJob(call) {
  const items = call.transcript_with_tool_calls || [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.role === 'tool_call_invocation' && it.name === 'save_job') {
      try {
        const args = typeof it.arguments === 'string' ? JSON.parse(it.arguments) : it.arguments;
        if (args && typeof args === 'object') return args;
      } catch { /* malformed: keep looking */ }
    }
  }
  return null;
}

// ---------- texts ----------

const LABELS = {
  emergency: 'EMERGENCY',
  schedule_request: 'SCHEDULE REQUEST',
  quote_request: 'QUOTE REQUEST',
  existing_job: 'EXISTING JOB',
};

// Caller-supplied text: strip links and control characters, cap the length.
export function clean(value, max = 80) {
  return String(value ?? '')
    .replace(/https?:\/\/\S+|www\.\S+/gi, '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function demoText(job) {
  const label = LABELS[job.category] || 'NEW CALL';
  const number = toE164(job.callback_number);
  const lines = [
    `${label}: ${clean(job.problem, 70) || 'details in call'}`,
    [clean(job.caller_name, 40), number ? pretty(number) : clean(job.callback_number, 20)].filter(Boolean).join(' · '),
    clean(job.area, 60),
    job.wants_when ? `Wants: ${clean(job.wants_when, 40)}` : '',
    'Told them you\'d call back.',
    '',
    `This is the text ${site.businessName} sends the owner. Reply YES to set it up for your business.`,
  ];
  return lines.filter((l, i) => l !== '' || i === 5).join('\n');
}

function emergencyTwiml(job) {
  const biz = clean(job.business_name, 40) || 'your business';
  const say = `Emergency call for ${biz}. ${clean(job.problem, 70)}. ${clean(job.caller_name, 40)} in ${clean(job.area, 60)}. Check your texts. This is the call ${site.businessName} makes to the owner for an emergency.`;
  return `<Response><Pause length="1"/><Say voice="Polly.Matthew">${xml(say)}</Say><Pause length="1"/><Say voice="Polly.Matthew">${xml(say)}</Say></Response>`;
}

function alertText(call, job, caller, seconds, outcome) {
  const who = caller ? pretty(caller) : (call.call_type === 'web_call' ? 'web call' : 'hidden number');
  const head = `Demo call${job?.business_name ? ` — ${clean(job.business_name, 40)}` : ''}\nFrom ${who} · ${Math.floor(seconds / 60)}m ${seconds % 60}s · ended: ${call.disconnection_reason || '?'}`;
  if (!job) return `${head}\nNo job taken (hung up early or went off script).`;
  return `${head}\n\n${demoText(job).split('\n\n')[0]}\n\nText to caller: ${outcome.text}${outcome.ring !== 'off' ? `\nEmergency ring: ${outcome.ring}` : ''}`;
}

// ---------- Twilio replies ----------

async function twilioSms(request, env, ctx) {
  const raw = await request.text();
  const params = Object.fromEntries(new URLSearchParams(raw));
  if (!(await verifyTwilio(request.url, params, request.headers.get('x-twilio-signature'), env.TWILIO_AUTH_TOKEN))) {
    return new Response('bad signature', { status: 401 });
  }
  const from = toE164(params.From) || params.From;
  const body = clean(params.Body, 300);
  const word = body.toUpperCase().replace(/[^A-Z]/g, '');

  // Twilio handles STOP, HELP and the like itself; never answer those.
  if (['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'HELP', 'INFO', 'START', 'UNSTOP'].includes(word)) {
    return twiml('');
  }
  if (word === 'YES' || word === 'Y') {
    ctx.waitUntil(alert(env, `LEAD: ${pretty(from)} replied YES to the demo text. Call them.`));
    return twiml(`Nice. ${site.contactName} will text you shortly to set up a time to come by.`);
  }
  ctx.waitUntil(alert(env, `Text from ${pretty(from)} to the demo number:\n${body}`));
  return twiml('');
}

function twiml(message) {
  const inner = message ? `<Message>${xml(message)}</Message>` : '';
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, {
    headers: { 'Content-Type': 'text/xml' },
  });
}

// ---------- providers ----------

function twilioReady(env) {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM);
}

async function twilio(env, resource, form) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/${resource}`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form),
  });
  if (res.ok) return { ok: true };
  let msg = `${res.status}`;
  try { const j = await res.json(); msg = `${j.code || res.status} ${j.message || ''}`.trim(); } catch { /* keep status */ }
  console.error('twilio', resource, msg);
  return { ok: false, error: msg };
}

// Cloudflare's email class, loaded on first use. Tests swap `load` for a stand-in, since
// `cloudflare:email` only exists inside the Workers runtime.
export const emailRuntime = { load: async () => (await import('cloudflare:email')).EmailMessage };

// Emails an alert to each ALERT_TO address. The first line of the text is the subject.
// Not set up yet: the alert goes to the Worker log instead (npx wrangler tail).
async function alert(env, text) {
  const to = String(env.ALERT_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!env.ALERT_EMAIL || !to.length) {
    console.log(`alert (email not set up):\n${text}`);
    return;
  }
  const from = env.ALERT_FROM || `demo@${new URL(site.siteUrl).hostname}`;
  const EmailMessage = await emailRuntime.load();
  for (const addr of to) {
    try {
      await env.ALERT_EMAIL.send(new EmailMessage(from, addr, alertMime({ from, to: addr, subject: text.split('\n')[0], text })));
    } catch (err) {
      console.error('alert email', addr, err);
    }
  }
}

// A plain-text email. Subject and body are base64 so names with accents or dashes come through.
export function alertMime({ from, to, subject, text, date = new Date(), id = crypto.randomUUID() }) {
  return [
    `From: ${site.businessName} demo <${from}>`,
    `To: ${to}`,
    `Subject: =?UTF-8?B?${base64(subject)}?=`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${id}@${from.split('@')[1]}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64(text).replace(/.{76}/g, '$&\r\n'),
  ].join('\r\n');
}

function base64(s) {
  let bin = '';
  for (const b of enc.encode(s)) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function underDailyCap(env, number) {
  if (!env.DEMO_KV) return true;
  const key = `sms:${number}:${new Date().toISOString().slice(0, 10)}`;
  const n = Number(await env.DEMO_KV.get(key)) || 0;
  if (n >= 3) return false;
  await env.DEMO_KV.put(key, String(n + 1), { expirationTtl: 2 * 86400 });
  return true;
}

// ---------- signatures ----------

const enc = new TextEncoder();

async function hmac(algo, key, message) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: algo }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(message)));
}

function same(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Retell: header "v=<ms timestamp>,d=<hex HMAC-SHA256(rawBody + timestamp, apiKey)>", 5-minute window.
export async function verifyRetell(raw, header, apiKey, now = Date.now()) {
  if (!header || !apiKey) return false;
  const m = /v=(\d+),d=([0-9a-fA-F]+)/.exec(header);
  if (!m) return false;
  if (Math.abs(now - Number(m[1])) > 5 * 60 * 1000) return false;
  const mac = await hmac('SHA-256', apiKey, raw + m[1]);
  const hex = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  return same(hex, m[2].toLowerCase());
}

// Twilio: base64 HMAC-SHA1 of the full URL followed by each POST param name+value, sorted by name.
export async function verifyTwilio(url, params, header, authToken) {
  if (!header || !authToken) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const mac = await hmac('SHA-1', authToken, data);
  return same(btoa(String.fromCharCode(...mac)), header);
}

// ---------- small helpers ----------

export function toE164(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  return '';
}
function pretty(e164) {
  const d = String(e164).replace(/^\+1/, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : String(e164);
}
function xml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
