// Pushes the demo agent to Retell.
//
//   npm run agent                     create or update the agent, publish it, attach the demo number
//   npm run agent -- --print          show what would be sent, without calling Retell
//   npm run agent -- --voices         list English voices to pick a voiceId from
//   npm run agent -- --url https://…  use this base URL for the tool and webhook (e.g. your workers.dev URL)
//
// Base URL: --url, else PUBLIC_URL (environment or .dev.vars), else siteUrl from site.config.json.
//
// Needs RETELL_API_KEY, from the environment or .dev.vars. Use a key with the
// webhook badge in Retell's dashboard: the backend verifies requests with it.
// IDs of what it creates are kept in agent/retell-ids.json so later runs update them.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

// .dev.vars (KEY=value lines) fills in anything not already in the environment.
const devVars = join(root, '.dev.vars');
if (existsSync(devVars)) {
  for (const line of readFileSync(devVars, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const site = JSON.parse(readFileSync(join(root, 'site.config.json'), 'utf8'));
const cfg = JSON.parse(readFileSync(join(root, 'agent', 'demo-agent.json'), 'utf8'));
const idsFile = join(root, 'agent', 'retell-ids.json');
const ids = existsSync(idsFile) ? JSON.parse(readFileSync(idsFile, 'utf8')) : {};
const baseUrl = String(option('--url') || process.env.PUBLIC_URL || site.siteUrl).replace(/\/$/, '');

function e164(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  if (ten.length !== 10) throw new Error(`Not a 10-digit US number: "${raw}"`);
  return '+1' + ten;
}
function spoken(num) {
  const d = num.slice(2);
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

// ---------- prompt ----------

// A voice reads "Yello 412" as "four hundred twelve". Everything the agent says, or
// learns the name from, gets the spelled-out name from demo-agent.json instead.
const aloud = (text) => (cfg.spokenName ? text.replaceAll(site.businessName, cfg.spokenName) : text);

const ryan = spoken(e164(site.contactCell));
const reveal = cfg.textTheCaller
  ? [
      'Tell them: when they hang up, within a minute they\'ll get a text with exactly what the owner would get for that call.',
      cfg.ringOnEmergency
        ? 'If it was an emergency, also tell them their phone will ring a few seconds after they hang up, because that\'s the call the owner gets for an emergency.'
        : '',
    ].filter(Boolean).join(' ')
  : 'Then tell them what the text to the owner would say, like you\'re reading it out loud: the category, the problem in a few words, the caller\'s name and number, the area, when they want it, and that the caller was told the owner will call back.';
const signup = cfg.textTheCaller
  ? `reply YES to the text you'll get after this call, or text Ryan at ${ryan}. Ryan will set up a time to come by.`
  : `text Ryan at ${ryan} and he'll set up a time to come by.`;

const prompt = aloud(readFileSync(join(root, 'agent', 'demo-prompt.md'), 'utf8'))
  .replaceAll('[[REVEAL]]', reveal)
  .replaceAll('[[SIGNUP]]', signup)
  .replaceAll('[[PRICE_LINE]]', String(site.priceLine))
  .replaceAll('[[PRICE_LINE_SITE]]', String(site.priceLineSite))
  .replaceAll('[[TRIAL]]', String(site.trialLength));
const leftover = prompt.match(/\[\[[A-Z_]+\]\]/);
if (leftover) throw new Error(`demo-prompt.md has an unfilled placeholder: ${leftover[0]}`);

// ---------- payloads ----------

const tools = [
  {
    type: 'custom',
    name: 'save_job',
    description: 'Save the caller\'s job so the owner gets it by text. Call it as soon as you have the problem and a callback number, and again if any detail changes.',
    url: `${baseUrl}/api/demo/save-job`,
    method: 'POST',
    speak_during_execution: false,
    speak_after_execution: true,
    timeout_ms: 3000,
    max_retry: 1,
    parameters: {
      type: 'object',
      properties: {
        business_name: { type: 'string', description: 'The business the line is answering for in this demo.' },
        category: { type: 'string', enum: ['emergency', 'schedule_request', 'quote_request', 'existing_job'], description: 'Which kind of call this is.' },
        problem: { type: 'string', description: 'What they need, in a few plain words, e.g. "furnace won\'t start, 58F inside".' },
        caller_name: { type: 'string', description: 'The caller\'s name.' },
        callback_number: { type: 'string', description: 'Best number to call them back, digits only.' },
        area: { type: 'string', description: 'Address, or neighborhood and town.' },
        wants_when: { type: 'string', description: 'When they want someone, in their words, e.g. "today after 1".' },
      },
      required: ['category', 'problem', 'callback_number'],
    },
  },
  {
    type: 'end_call',
    name: 'end_call',
    description: 'End the call once the caller is done.',
  },
];

const llmBody = {
  start_speaker: 'agent',
  begin_message: aloud(cfg.beginMessage),
  general_prompt: prompt,
  general_tools: tools,
  model_config: { type: 'cascading', primary: { model: cfg.llmModel } },
};

const agentBody = (llmId, llmVersion) => ({
  agent_name: cfg.agentName,
  response_engine: { type: 'retell-llm', llm_id: llmId, ...(llmVersion != null ? { version: llmVersion } : {}) },
  voice_id: cfg.voiceId,
  language: 'en-US',
  stt_mode: cfg.sttMode || 'fast',
  ...(cfg.boostedKeywords?.length ? { boosted_keywords: cfg.boostedKeywords } : {}),
  webhook_url: `${baseUrl}/api/retell/webhook`,
  webhook_events: ['call_ended'],
  // Pause after pickup before the opening line (Retell allows 0 to 5 seconds).
  begin_message_delay_ms: Math.min(5000, Math.max(0, Math.round((cfg.beginDelaySeconds || 0) * 1000))),
  max_call_duration_ms: Math.round(cfg.maxCallMinutes * 60_000),
  end_call_after_silence_ms: Math.max(10_000, Math.round(cfg.endAfterSilenceSeconds * 1000)),
  interruption_sensitivity: cfg.interruptionSensitivity,
  responsiveness: cfg.responsiveness,
  enable_backchannel: cfg.enableBackchannel,
  data_storage_retention_days: cfg.dataRetentionDays,
  // Retell has no off switch for post-call analysis: extract nothing, on the cheapest model.
  ...(cfg.postCallAnalysis === false ? { post_call_analysis_data: [], post_call_analysis_model: 'gpt-4.1-mini' } : {}),
});

if (flag('--print')) {
  console.log(JSON.stringify({ baseUrl, llm: llmBody, agent: agentBody(ids.llm_id || '<llm_id>', null) }, null, 2));
  process.exit(0);
}

// ---------- Retell API ----------

const key = process.env.RETELL_API_KEY;
if (!key) {
  console.error('RETELL_API_KEY is missing. Put RETELL_API_KEY=key_… in .dev.vars (see .dev.vars.example).');
  process.exit(1);
}

async function retell(method, path, body) {
  const res = await fetch(`https://api.retellai.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`Retell ${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

if (flag('--voices')) {
  const voices = await retell('GET', '/list-voices');
  for (const v of voices) {
    if (v.accent && !/american|us|english/i.test(v.accent)) continue;
    console.log(`${v.voice_id.padEnd(32)} ${String(v.voice_name || '').padEnd(18)} ${String(v.gender || '').padEnd(7)} ${v.accent || ''} (${v.provider})`);
  }
  console.log('\nPut the one you like in agent/demo-agent.json as "voiceId", then run npm run agent.');
  process.exit(0);
}

// The LLM: create once, update after.
async function saveLlm() {
  const send = (body) => ids.llm_id
    ? retell('PATCH', `/update-retell-llm/${ids.llm_id}`, body)
    : retell('POST', '/create-retell-llm', body);
  try {
    return await send(llmBody);
  } catch (err) {
    // Older accounts may only accept the plain `model` field.
    if (err.status === 400 && /model_config/i.test(err.message)) {
      const { model_config, ...rest } = llmBody;
      return send({ ...rest, model: cfg.llmModel });
    }
    throw err;
  }
}

// A published version is read-only. Start a draft from it and edit that instead;
// Retell gives the LLM a matching draft. The demo number stays on the published
// version until the end of this script.
if (ids.agent_id) {
  const latest = await retell('GET', `/get-agent/${ids.agent_id}`);
  if (latest.is_published) {
    const draft = await retell('POST', `/create-agent-version/${ids.agent_id}`, { base_version: latest.version });
    console.log(`Version ${latest.version} is published, so started draft version ${draft.version} from it.`);
  }
}

const llm = await saveLlm();
ids.llm_id = llm.llm_id;
console.log(`LLM ${ids.agent_id ? 'updated' : 'ready'}: ${llm.llm_id} (version ${llm.version})`);

const agent = ids.agent_id
  ? await retell('PATCH', `/update-agent/${ids.agent_id}`, agentBody(llm.llm_id, llm.version))
  : await retell('POST', '/create-agent', agentBody(llm.llm_id, llm.version));
ids.agent_id = agent.agent_id;
writeFileSync(idsFile, JSON.stringify(ids, null, 2) + '\n');
console.log(`Agent: ${agent.agent_id} (version ${agent.version})`);

let liveVersion = agent.version;
if (!flag('--no-publish')) {
  try {
    await retell('POST', `/publish-agent-version/${agent.agent_id}`, { version: agent.version, version_title: new Date().toISOString().slice(0, 16) });
    console.log(`Published version ${agent.version}.`);
  } catch (err) {
    console.warn(`Couldn't publish version ${agent.version}; the number will still point at it. ${err.message}`);
  }
}

const demo = e164(site.demoNumber);
if (demo) {
  await retell('PATCH', `/update-phone-number/${encodeURIComponent(demo)}`, {
    nickname: 'Yello 412 demo line',
    // The Worker turns away callers over callsPerDay before Retell answers.
    inbound_webhook_url: `${baseUrl}/api/retell/inbound`,
    inbound_agents: [{ agent_id: agent.agent_id, agent_version: liveVersion, weight: 1 }],
  });
  console.log(`Demo number ${demo} now answers with this agent.`);
} else {
  console.log('No demoNumber in site.config.json yet: buy or import a number in Retell, put it there, and run this again.');
}

console.log(`\nTool and webhook point at ${baseUrl}. Test it in Retell's dashboard (Test Audio) or call the number.`);
