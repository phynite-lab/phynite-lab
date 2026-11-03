import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NativeAiRegistry } from '../packages/phynite-lab/lib/native-ai.mjs';
import { createAgyPolicy } from '../packages/phynite-lab/lib/agy-policy.mjs';

const codexStub = `#!/usr/bin/env node
let buf=''; const send=(x)=>process.stdout.write(JSON.stringify(x)+'\\n');
process.stdin.setEncoding('utf8'); process.stdin.on('data', c=>{buf+=c; for(let i;(i=buf.indexOf('\\n'))>=0;){const line=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!line)continue;let m;try{m=JSON.parse(line)}catch{continue}; if(m.id!==undefined){
 if(m.method==='initialize') send({id:m.id,result:{}});
 else if(m.method==='config/read') send({id:m.id,result:{config:{model_provider:'openai',web_search:'disabled',features:{shell_tool:false,apps:false,hooks:false,multi_agent:false,remote_plugin:false,memories:false,shell_snapshot:false,web_search:false},mcp_servers:{},plugins:{}}}});
 else if(m.method==='account/read') send({id:m.id,result:{account:{type:'chatgpt',planType:'plus',email:null},requiresOpenaiAuth:false}});
 else if(m.method==='account/rateLimits/read') send({id:m.id,result:{rateLimits:{primary:{usedPercent:27,windowDurationMins:300,resetsAt:1793373775},secondary:{usedPercent:7,windowDurationMins:10080,resetsAt:1793941092},credits:{hasCredits:false,unlimited:false,balance:'0'}}}});
 else if(m.method==='model/list') send({id:m.id,result:{data:[{id:'gpt-6.1-sol',model:'gpt-6.1-sol',displayName:'Synthetic Codex',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'medium',description:'medium'}]}],nextCursor:null}});
 else if(m.method==='thread/start') send({id:m.id,result:{thread:{id:'thr_synthetic'},model:'gpt-6.1-sol',modelProvider:'openai',approvalPolicy:'never',sandbox:{type:'readOnly'}}});
 else if(m.method==='mcpServerStatus/list') send({id:m.id,result:{data:[],nextCursor:null}});
 else if(m.method==='turn/start') send({id:m.id,result:{turn:{id:'turn_synthetic'}}});
 else if(m.method==='account/login/start') send({id:m.id,result:{type:'chatgpt',authUrl:'https://auth.openai.com/oauth/authorize?x=1',loginId:'login_synthetic'}});
 } else if(m.method==='initialized') { /* no-op */ }
 }});
if(process.argv.includes('--version')) { console.log('codex-cli 0.162.1'); process.exit(0); }
`;

const agyStub = `#!/usr/bin/env node
if(process.argv.includes('--version')) { console.log('1.4.10'); process.exit(0); }
if(process.argv.includes('models')) { console.log('gemini-synthetic\\tSynthetic AGY'); process.exit(0); }
console.log(JSON.stringify({event:'init',conversation_id:'c',init:{model:'gemini-synthetic',agent:'phynite-bridge',tools:['run_command'],permission_mode:'request-review'}}));
for await (const line of console) { /* Should never receive a prompt when tools are unsafe. */ }
`;

async function executable(dir, name, source) { const path = join(dir, name); await writeFile(path, source, { mode: 0o700 }); await chmod(path, 0o700); return path; }

test('CLI discovery finds user npm bins and the Antigravity alias without shell PATH setup', { concurrency: false }, async () => {
  const dir = await mkdtemp('/tmp/phynite-native-path-test-');
  const home = process.env.HOME, path = process.env.PATH;
  const bin = join(dir, '.local/share/pnpm');
  await mkdir(bin, { recursive: true });
  await executable(bin, 'codex', codexStub);
  await executable(bin, 'antigravity', agyStub);
  const registry = new NativeAiRegistry({ dataDir: join(dir, 'data') });
  try {
    process.env.HOME = dir; process.env.PATH = '';
    assert.equal((await registry.detect('codex')).command, join(bin, 'codex'));
    assert.equal((await registry.detect('antigravity')).command, join(bin, 'antigravity'));
    const added = await registry.addAccount('antigravity', 'Personal');
    assert.ok(added.command.includes(join(bin, 'antigravity')));
    const status = await registry.status();
    assert.equal(status.providers.find(item => item.id === 'antigravity').accounts.find(item => item.id === added.account.id).loginCommand, added.command);
  } finally {
    if (home === undefined) delete process.env.HOME; else process.env.HOME = home;
    if (path === undefined) delete process.env.PATH; else process.env.PATH = path;
    await registry.close(); await rm(dir, { recursive: true, force: true });
  }
});

test('Antigravity login completes while restricted model checks continue in background', async () => {
  const dir = await mkdtemp('/tmp/phynite-native-login-test-');
  const registry = new NativeAiRegistry({ dataDir: dir });
  registry.version = async () => '1.4.11';
  registry.agyModels = async () => [{ id: 'antigravity/gemini-synthetic', provider: 'antigravity', name: 'Synthetic', available: false }];
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let probing = false;
  registry.probeModels = async () => { probing = true; await blocked; };
  registry.probe = async () => { throw new Error('Login must not wait for inference'); };
  try {
    const result = await registry.login('antigravity');
    assert.equal(result.connected, true);
    assert.equal(result.verified, false);
    assert.equal(probing, true);
    assert.equal((await registry.status()).providers.find(item => item.id === 'antigravity').optedIn, true);
  } finally { release(); await registry.close(); await rm(dir, { recursive: true, force: true }); }
});

test('status is detection-only and catalog is persisted atomically', async () => {
  const dir = await mkdtemp('/tmp/phynite-native-test-'), bin = await mkdtemp('/tmp/phynite-native-bin-');
  const codex = await executable(bin, 'codex', codexStub), registry = new NativeAiRegistry({ dataDir: dir, executables: { codex } });
  const before = await registry.status();
  assert.equal(before.providers.find((entry) => entry.id === 'codex').optedIn, false);
  assert.deepEqual(before.models, []);
  await registry.connect('codex');
  const persisted = JSON.parse(await readFile(join(dir, 'ai/native-catalog.json'), 'utf8'));
  assert.equal(persisted.models[0].id, 'codex/gpt-6.1-sol');
  assert.equal(persisted.models[0].available, false);
  await registry.disconnect('codex');
  await registry.close();
});

test('reviewed CLI minor lines accept compatible patch releases and reject new protocol lines', async () => {
  const dir = await mkdtemp('/tmp/phynite-native-version-test-'), bin = await mkdtemp('/tmp/phynite-native-version-bin-');
  const compatible = await executable(bin, 'codex-compatible', codexStub.replace('0.162.1', '0.162.2'));
  const registry = new NativeAiRegistry({ dataDir: dir, executables: { codex: compatible } });
  const cwd = await registry.scratch();
  assert.equal(await registry.version('codex', cwd), '0.162.2');
  await rm(cwd, { recursive: true, force: true });
  const unsupported = await executable(bin, 'codex-unsupported', codexStub.replace('0.162.1', '0.163.0'));
  const other = new NativeAiRegistry({ dataDir: `${dir}-other`, executables: { codex: unsupported } });
  const otherCwd = await other.scratch();
  await assert.rejects(other.version('codex', otherCwd), { code: 'UNVERIFIED_VERSION' });
  await rm(otherCwd, { recursive: true, force: true });
  await registry.close(); await other.close();
});

test('Codex usage refresh reports provider windows and real reset timestamps', async () => {
  const dir = await mkdtemp('/tmp/phynite-native-usage-test-'), bin = await mkdtemp('/tmp/phynite-native-usage-bin-');
  const codex = await executable(bin, 'codex', codexStub), registry = new NativeAiRegistry({ dataDir: dir, executables: { codex } });
  await registry.connect('codex');
  const status = await registry.status();
  const account = status.providers.find((entry) => entry.id === 'codex').accounts.find((entry) => entry.active);
  assert.equal(account.quota.source, 'provider');
  assert.equal(account.quota.used, 27);
  assert.equal(account.quota.remaining, 73);
  assert.equal(account.quota.limit, 100);
  assert.equal(account.quota.windows.length, 2);
  assert.equal(account.quota.windows[1].windowDurationMins, 10080);
  assert.equal(account.quota.resetAt, '2026-10-30T15:22:55.000Z');
  const refreshed = await registry.usage();
  assert.equal(refreshed.usage[0].quota.windows[0].usedPercent, 27);
  await registry.close();
});

test('usage requests are coalesced and cannot assign a previous account report after switching', async () => {
  const registry = new NativeAiRegistry({ dataDir: await mkdtemp('/tmp/phynite-native-usage-test-') });
  await registry.ready;
  registry.state.providers.codex = { optedIn: true, status: 'connected' };
  let finish, reads = 0;
  registry.refreshCodexQuota = async () => { reads++; return await new Promise(resolve => { finish = resolve; }); };
  const first = registry.usage(), second = registry.usage();
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  const added = await registry.addAccount('codex', 'Other');
  await registry.switchAccount('codex', added.account.id);
  finish({ source: 'provider', remaining: 12 });
  assert.deepEqual((await first).usage, []);
  assert.deepEqual((await second).usage, []);
  assert.equal(reads, 1);
  assert.equal(registry.activeAccount('codex').quota.source, 'not_reported_by_cli');
  await registry.close();
});

test('Codex malformed percentages cannot become fabricated zero usage', async () => {
  const registry = new NativeAiRegistry({ dataDir: await mkdtemp('/tmp/phynite-native-usage-test-') });
  const session = { request: async () => ({ rateLimits: { primary: { usedPercent: null, windowDurationMins: 300, resetsAt: 1793373775 } } }) };
  await assert.rejects(registry.codexRateLimits(session), { code: 'INVALID_PROTOCOL' });
  await registry.close();
});

test('a failed usage refresh preserves only reports belonging to the signed-in Codex account', async () => {
  const registry = new NativeAiRegistry({ dataDir: await mkdtemp('/tmp/phynite-native-usage-test-') });
  await registry.ready;
  registry.state.providers.codex = { optedIn: true, status: 'connected' };
  let email = 'first@example.test';
  await registry.rememberAccount('codex', { email });
  registry.activeAccount('codex').quota = { source: 'provider', remaining: 73, limit: 100 };
  registry.version = async () => '0.162.1';
  registry.codexSession = async () => ({ request: async method => method === 'account/read' ? { account: { type: 'chatgpt', email } } : {}, close: async () => {} });
  const sameAccount = await registry.usage();
  assert.equal(sameAccount.usage[0].error, 'INVALID_PROTOCOL');
  assert.equal(sameAccount.usage[0].quota.remaining, 73);
  email = 'second@example.test';
  const changedAccount = await registry.usage();
  assert.equal(changedAccount.usage[0].error, 'INVALID_PROTOCOL');
  assert.equal(changedAccount.usage[0].quota.source, 'not_reported_by_cli');
  assert.equal(changedAccount.providers.find(provider => provider.id === 'codex').accounts[0].email, email);
  assert.equal(changedAccount.usage[0].quota.remaining, null);
  await registry.close();
});

test('a Codex usage read cannot write account identity after switching accounts', async () => {
  const registry = new NativeAiRegistry({ dataDir: await mkdtemp('/tmp/phynite-native-usage-test-') });
  await registry.ready;
  registry.state.providers.codex = { optedIn: true, status: 'connected' };
  const added = await registry.addAccount('codex', 'Other');
  let finish;
  registry.version = async () => '0.162.1';
  registry.codexSession = async () => ({ request: async () => await new Promise(resolve => { finish = resolve; }), close: async () => {} });
  const pending = registry.refreshCodexQuota();
  const rejected = assert.rejects(pending, { code: 'CANCELLED' });
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  await registry.switchAccount('codex', added.account.id);
  finish({ account: { type: 'chatgpt', email: 'previous@example.test' } });
  await rejected;
  assert.equal(registry.activeAccount('codex').email, null);
  assert.equal(registry.activeAccount('codex').quota.source, 'not_reported_by_cli');
  await registry.close();
});

test('Antigravity usage reads official TSV without starting an agent turn', async () => {
  const dir = await mkdtemp('/tmp/phynite-agy-usage-test-');
  const agy = await executable(dir, 'agy', `#!/usr/bin/env node
if(process.argv.includes('--version')) { console.log('1.4.12'); process.exit(0); }
if(process.argv.slice(2).join(' ') !== '-p /usage --print-timeout 20s') process.exit(5);
console.log('Gemini Models\\tWeekly Limit Remaining\\t100%\\t2026-11-05T11:16:36Z');
console.log('Claude and GPT models\\tFive Hour Limit Remaining\\t85%\\t2026-10-30T19:58:30Z');
`);
  const registry = new NativeAiRegistry({ dataDir: join(dir, 'data'), executables: { antigravity: agy } });
  await registry.ready;
  registry.state.providers.antigravity = { optedIn: true, status: 'connected' };
  const result = await registry.usage(), quota = result.usage[0].quota;
  assert.equal(quota.source, 'provider');
  assert.equal(quota.windows[0].remainingPercent, 100);
  assert.equal(quota.windows[0].usedPercent, 0);
  assert.equal(quota.windows[1].group, 'Claude and GPT models');
  assert.equal(quota.windows[1].usedPercent, 15);
  assert.equal(quota.windows[1].resetAt, '2026-10-30T19:58:30.000Z');
  await writeFile(agy, (await readFile(agy, 'utf8')).replace('85%', '185%'));
  const invalid = await registry.usage();
  assert.equal(invalid.usage[0].error, 'INVALID_PROTOCOL');
  assert.equal(invalid.usage[0].quota.windows[1].usedPercent, 15);
  await registry.close();
});

test('native AI state exposes stable default account slots without quota claims', async () => {
  const registry = new NativeAiRegistry({ dataDir: await mkdtemp('/tmp/phynite-native-test-') });
  const status = await registry.status();
  for (const provider of status.providers) {
    assert.equal(provider.accounts[0].id, `${provider.id}:default`);
    assert.equal(provider.activeAccountId, `${provider.id}:default`);
    assert.deepEqual(provider.accounts[0].quota, { remaining: null, limit: null, resetAt: null, source: 'not_reported_by_cli' });
  }
  await registry.close();
});

test('provider account slots use isolated CLI homes and invalidate models on switch', async () => {
  const dir = await mkdtemp('/tmp/phynite-native-test-');
  const registry = new NativeAiRegistry({ dataDir: dir });
  await registry.ready;
  registry.state.providers.codex = { optedIn: true, status: 'connected' };
  const models = nativeModels(['synthetic']);
  registry.mergeModels('codex', models);
  registry.catalog.capabilities.models['codex/synthetic'].available = true;
  const added = await registry.addAccount('codex', 'Personal');
  assert.equal(added.account.label, 'Personal');
  assert.match(added.command, /CODEX_HOME=/);
  assert.equal(added.command.includes('token'), false);
  const switched = await registry.switchAccount('codex', added.account.id);
  assert.equal(switched.activeAccountId, added.account.id);
  assert.equal((await registry.status()).providers.find(provider => provider.id === 'codex').activeAccountId, added.account.id);
  assert.equal((await registry.status()).models[0].available, false);
  assert.equal(registry.providerEnvironment('codex').CODEX_HOME, added.account.homeDir);
  await registry.close();
});

test('Antigravity unsafe tool catalog fails before prompt', async () => {
  const dir = await mkdtemp('/tmp/phynite-native-test-'), bin = await mkdtemp('/tmp/phynite-native-bin-');
  const agy = await executable(bin, 'agy', agyStub), registry = new NativeAiRegistry({ dataDir: dir, executables: { antigravity: agy }, timeoutMs: 5000 });
  await registry.connect('antigravity');
  await assert.rejects(() => registry.probe('agy/gemini-synthetic'), (reason) => reason.code === 'UNSAFE_TOOLS');
  await registry.close();
});

function guardedAgyStub(mode, transcript) {
  return `#!/usr/bin/env node
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
if(process.argv.includes('--version')) { console.log('1.4.10'); process.exit(0); }
const mode=${JSON.stringify(mode)}, transcript=${JSON.stringify(transcript)};
const send=value=>console.log(JSON.stringify(value));
const model=process.argv[process.argv.indexOf('--model')+1];
const settings=JSON.parse(process.argv[process.argv.indexOf('--settings')+1]);
const profile=readFileSync('.agents/agents/phynite-bridge.md','utf8');
if (!['inheritMcp: false','inheritCustomizations: false','excludeDefaultComponents: true','commandExecutionPolicy: off','tools: []','plugins: []','agents: []'].every(flag=>profile.includes(flag)) || settings.toolPermission!=='strict' || settings.allowNonWorkspaceAccess!==false || settings.permissions.deny.join(',')!=='read_file(*),write_file(*),read_url(*),execute_url(*),command(*),mcp(*)' || process.argv.includes('--json-schema')) process.exit(3);
if (process.env.GH_TOKEN || process.env.NODE_OPTIONS || process.env.PHYNITE_LOCAL_SERVICE_TOKEN || process.env.GOOGLE_API_KEY) process.exit(4);
send({event:'init',conversation_id:'safe-session',init:{model:mode==='wrong-model'?'other':model,agent:mode==='wrong-agent'?'other':'phynite-bridge',tools:['read_file','run_command'],permission_mode:mode==='wrong-permission'?'request-review':'strict'}});
let turn=0;
for await (const line of createInterface({input:process.stdin})) {
 const prompt=JSON.parse(line).message.content; turn++;
 appendFileSync(transcript,JSON.stringify({turn,prompt})+'\\n');
 if(turn===1 && mode!=='missing-proof') {
  const hooks=JSON.parse(readFileSync('native-guard-hooks.json','utf8'))['phynite-native-guard'];
  execSync(hooks.SessionStart[0].command,{input:JSON.stringify({conversationId:'safe-session',modelName:model})});
  if(mode==='bad-proof') writeFileSync('native-guard-proof.json','{}');
  if(mode==='tampered-policy') appendFileSync('native-guard-hooks.json',' ');
 }
 const text=turn===1?'4':'AGY_OK';
 const json=JSON.stringify({text,toolCalls:turn===2?[{name:'host_action',argumentsJson:'{"value":1}'}]:[]});
 const body=mode==='fenced'?'\`\`\`json\\n'+json+'\\n\`\`\`':mode==='prose'?'Here is a response: '+json:json;
 const step={conversation_id:'safe-session',step_index:turn*2-1,state:'ACTIVE',step_type:'agent_response',text_delta:body};
 if(mode==='wrong-step-session') step.conversation_id='other';
 if(mode==='unknown-step') step.step_type='native_action';
 if(mode==='native-tool') step.tool_info={name:'read_file'};
 if(mode==='stale-step' && turn===2) step.step_index=1;
 send({event:'step_update',step_update:step});
 send({event:'result',result:{conversation_id:mode==='wrong-result-session'?'other':'safe-session',num_turns:mode==='duplicate-result' && turn===2?1:turn,status:'SUCCESS',response:body}});
}
`;
}

async function agyFixture(mode, run) {
  const dir = await mkdtemp('/tmp/phynite-agy-guard-test-');
  const transcript = join(dir, 'transcript.ndjson');
  const agy = await executable(dir, 'agy.mjs', guardedAgyStub(mode, transcript));
  const registry = new NativeAiRegistry({ dataDir: join(dir, 'data'), executables: { antigravity: agy }, timeoutMs: 5000 });
  await registry.ready;
  const prepared = { provider: 'antigravity', rawModel: 'gemini-synthetic', prompt: 'SYNTHETIC_PROJECT_CONTEXT', schema: { type: 'object' }, names: new Set(['host_action']) };
  const events = [];
  const execute = async () => { for await (const event of registry.execute(prepared)) events.push(event); };
  try { await run({ execute, events, transcript }); }
  finally { await registry.close(); await rm(dir, { recursive: true, force: true }); }
}

test('Antigravity verifies guard before project context and streams only the actual turn', async () => {
  await agyFixture('safe', async ({ execute, events, transcript }) => {
    await execute();
    assert.equal(events.length, 2);
    assert.equal(events[0].type, 'delta');
    assert.equal(events[0].text.includes('PHYNITE_BOOT_'), false);
    assert.deepEqual(events[1].proposal, { text: 'AGY_OK', calls: [{ name: 'host_action', input: { value: 1 } }] });
    assert.equal(events[1].streamed, true);
    const turns = (await readFile(transcript, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(turns.length, 2);
    assert.equal(turns[0].prompt.includes('SYNTHETIC_PROJECT_CONTEXT'), false);
    assert.equal(turns[1].prompt.includes('SYNTHETIC_PROJECT_CONTEXT'), true);
  });
});

test('Antigravity accepts a complete JSON fence and preserves proposal validation', async () => {
  await agyFixture('fenced', async ({ execute, events }) => {
    await execute();
    assert.deepEqual(events.at(-1).proposal, { text: 'AGY_OK', calls: [{ name: 'host_action', input: { value: 1 } }] });
  });
});

test('native structured responses do not extract JSON from arbitrary prose', async () => {
  await agyFixture('prose', async ({ execute, events }) => {
    await assert.rejects(execute, reason => reason.code === 'INVALID_RESPONSE');
    assert.deepEqual(events, []);
  });
});

for (const mode of ['missing-proof', 'bad-proof', 'tampered-policy', 'wrong-model', 'wrong-agent', 'wrong-permission', 'wrong-step-session', 'wrong-result-session', 'unknown-step', 'native-tool']) {
  test(`Antigravity rejects ${mode} before sending project context`, async () => {
    await agyFixture(mode, async ({ execute, events, transcript }) => {
      await assert.rejects(execute, reason => ['UNSAFE_CONFIGURATION', 'UNSAFE_TOOLS', 'INVALID_PROTOCOL'].includes(reason.code));
      assert.deepEqual(events, []);
      const turns = await readFile(transcript, 'utf8').catch(reason => { if (reason.code === 'ENOENT') return ''; throw reason; });
      assert.equal(turns.includes('SYNTHETIC_PROJECT_CONTEXT'), false);
    });
  });
}

for (const mode of ['duplicate-result', 'stale-step']) {
  test(`Antigravity rejects ${mode} after bootstrap`, async () => {
    await agyFixture(mode, async ({ execute, events }) => {
      await assert.rejects(execute, reason => reason.code === 'INVALID_PROTOCOL');
      assert.equal(events.some(event => event.type === 'result'), false);
    });
  });
}

test('Antigravity tool guard denies calls without running model text', async () => {
  const dir = await mkdtemp('/tmp/phynite-agy-policy-test-');
  try {
    await createAgyPolicy(dir);
    const hooks = JSON.parse(await readFile(join(dir, 'native-guard-hooks.json'), 'utf8'))['phynite-native-guard'];
    const { exec } = await import('node:child_process');
    const denial = await new Promise((resolve, reject) => {
      const child = exec(hooks.PreToolUse[0].hooks[0].command, (reason, stdout) => reason ? reject(reason) : resolve(JSON.parse(stdout)));
      child.stdin.end(JSON.stringify({ toolCall: { name: 'run_command', arguments: { command: 'UNTRUSTED_MODEL_TEXT' } } }));
    });
    assert.deepEqual(denial, { decision: 'deny', reason: 'PHYNITE_NATIVE_ACTION_DENIED' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('native CLI environment excludes inherited credentials and Node injection', { concurrency: false }, async () => {
  const keys = ['GH_TOKEN', 'NODE_OPTIONS', 'PHYNITE_LOCAL_SERVICE_TOKEN', 'GOOGLE_API_KEY'];
  const saved = keys.map(key => process.env[key]);
  try {
    for (const key of keys) process.env[key] = key === 'NODE_OPTIONS' ? '--require=/definitely-not-a-module.cjs' : 'synthetic-secret';
    await agyFixture('safe', async ({ execute }) => { await execute(); });
  } finally {
    keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; });
  }
});

test('disconnect preserves shared CLI login semantics', async () => {
  const dir = await mkdtemp('/tmp/phynite-native-test-'), bin = await mkdtemp('/tmp/phynite-native-bin-');
  const codex = await executable(bin, 'codex', codexStub), registry = new NativeAiRegistry({ dataDir: dir, executables: { codex } });
  await registry.connect('codex');
  const result = await registry.disconnect('codex');
  assert.equal(result.sharedCliLoginPreserved, true);
  assert.equal((await registry.status()).providers.find((entry) => entry.id === 'codex').optedIn, false);
  await registry.close();
});

test('Codex probe accepts only completed streamed structured proposal', async () => {
  const dir = await mkdtemp('/tmp/phynite-native-test-'), bin = await mkdtemp('/tmp/phynite-native-bin-');
  const streaming = codexStub.replace(
    "else if(m.method==='turn/start') send({id:m.id,result:{turn:{id:'turn_synthetic'}}});",
    "else if(m.method==='turn/start') { if (m.params?.input?.[0]?.text?.includes('private-thinking') || m.params?.input?.[0]?.text?.includes('private-redacted')) send({id:m.id,error:{message:'private continuation leaked'}}); else { const nonce=m.params?.input?.[0]?.text?.match(/exactly ([a-f0-9-]{36})/)?.[1] ?? 'bad'; const body=JSON.stringify({text:nonce,toolCalls:[{name:'phynite_connection_probe',argumentsJson:JSON.stringify({nonce})}]}); send({id:m.id,result:{turn:{id:'turn_synthetic'}}}); setTimeout(()=>{ send({method:'item/agentMessage/delta',params:{threadId:'thr_synthetic',turnId:'turn_synthetic',delta:body}}); send({method:'turn/completed',params:{threadId:'thr_synthetic',turn:{id:'turn_synthetic',status:'completed'}}}); }, 2); } }",
  );
  const codex = await executable(bin, 'codex', streaming), registry = new NativeAiRegistry({ dataDir: dir, executables: { codex }, timeoutMs: 5000 });
  await registry.connect('codex');
  const result = await registry.probe('codex/gpt-6.1-sol');
  assert.equal(result.verified, true);
  assert.equal((await registry.status()).capabilities.models['codex/gpt-6.1-sol'].tools, true);
  const events = [];
  for await (const event of registry.stream({ modelId: 'codex/gpt-6.1-sol', messages: [
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'private-thinking', signature: 'private-signature' }, { type: 'redacted_thinking', data: 'private-redacted' }] },
    { role: 'user', content: 'synthetic' },
  ], tools: [{ name: 'phynite_connection_probe', input_schema: { type: 'object' } }] })) events.push(event);
  assert.equal(events[0].type, 'message_start');
  assert.equal(events.at(-1).type, 'message_stop');
  assert.equal(events.some((event) => event.content_block?.type === 'tool_use'), true);
  await registry.close();
});

test('model refresh probes every detected native model, not only the first', async () => {
  const dir = await mkdtemp('/tmp/phynite-native-test-'), bin = await mkdtemp('/tmp/phynite-native-bin-');
  const multi = codexStub
    .replace("data:[{id:'gpt-6.1-sol',model:'gpt-6.1-sol',displayName:'Synthetic Codex',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'medium',description:'medium'}]}]", "data:[{id:'gpt-6.1-sol',model:'gpt-6.1-sol',displayName:'Synthetic Sol',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'medium',description:'medium'}]},{id:'gpt-6-luna',model:'gpt-6-luna',displayName:'Synthetic Luna',hidden:false,supportedReasoningEfforts:[{reasoningEffort:'low',description:'low'}]}]")
    .replace("else if(m.method==='thread/start') send({id:m.id,result:{thread:{id:'thr_synthetic'},model:'gpt-6.1-sol',modelProvider:'openai',approvalPolicy:'never',sandbox:{type:'readOnly'}}});", "else if(m.method==='thread/start') send({id:m.id,result:{thread:{id:'thr_synthetic'},model:m.params?.model,modelProvider:'openai',approvalPolicy:'never',sandbox:{type:'readOnly'}}});")
    .replace("else if(m.method==='turn/start') send({id:m.id,result:{turn:{id:'turn_synthetic'}}});", "else if(m.method==='turn/start') { const nonce=m.params?.input?.[0]?.text?.match(/exactly ([a-f0-9-]{36})/)?.[1] ?? 'bad'; const body=JSON.stringify({text:nonce,toolCalls:[{name:'phynite_connection_probe',argumentsJson:JSON.stringify({nonce})}]}); send({id:m.id,result:{turn:{id:'turn_synthetic'}}}); setTimeout(()=>{ send({method:'item/agentMessage/delta',params:{threadId:'thr_synthetic',turnId:'turn_synthetic',delta:body}}); send({method:'turn/completed',params:{threadId:'thr_synthetic',turnId:'turn_synthetic',turn:{id:'turn_synthetic',status:'completed'}}}); }, 2); }");
  const codex = await executable(bin, 'codex', multi), registry = new NativeAiRegistry({ dataDir: dir, executables: { codex }, timeoutMs: 5000 });
  await registry.connect('codex');
  await registry.models();
  const status = await registry.status();
  assert.equal(status.capabilities.models['codex/gpt-6.1-sol'].available, true);
  assert.equal(status.capabilities.models['codex/gpt-6-luna'].available, true);
  await registry.close();
});

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const nativeModels = (names) => names.map(name => ({ id: `codex/${name}`, provider: 'codex', rawModel: name, name, available: false, efforts: ['auto'] }));
function probeResult(prepared) {
  const nonce = prepared.prompt.match(/exactly ([a-f0-9-]{36})/)[1];
  return { type: 'result', streamed: true, proposal: { text: nonce, calls: [{ name: 'phynite_connection_probe', input: { nonce } }] } };
}

test('disconnect during model discovery cannot reactivate the provider', async () => {
  const registry = new NativeAiRegistry({ dataDir: await mkdtemp('/tmp/phynite-native-test-') });
  await registry.ready;
  registry.state.providers.antigravity = { optedIn: true, status: 'connected' };
  const entered = deferred(), resume = deferred();
  registry.version = async () => { entered.resolve(); await resume.promise; return '1.4.10'; };
  registry.agyModels = async () => [{ id: 'agy/synthetic', provider: 'antigravity', efforts: ['auto'] }];
  const refreshing = registry.models();
  await entered.promise;
  await registry.disconnect('antigravity');
  resume.resolve();
  await refreshing;
  const status = await registry.status();
  assert.equal(status.providers.find(provider => provider.id === 'antigravity').optedIn, false);
  assert.deepEqual(status.models, []);
  await registry.close();
});

test('a completed probe updates the current catalog after a concurrent merge', async () => {
  const registry = new NativeAiRegistry({ dataDir: await mkdtemp('/tmp/phynite-native-test-') });
  await registry.ready;
  const models = nativeModels(['synthetic']);
  registry.state.providers.codex = { optedIn: true, status: 'connected' };
  registry.mergeModels('codex', models);
  const entered = deferred(), resume = deferred();
  registry.execute = async function* (prepared) { entered.resolve(); await resume.promise; yield probeResult(prepared); };
  const probing = registry.probe(models[0].id);
  await entered.promise;
  registry.mergeModels('codex', models);
  resume.resolve();
  await probing;
  assert.equal((await registry.status()).models[0].available, true);
  await registry.close();
});

test('close cancels active checks and prevents queued model checks from starting', async () => {
  const registry = new NativeAiRegistry({ dataDir: await mkdtemp('/tmp/phynite-native-test-') });
  await registry.ready;
  const models = nativeModels(['first', 'second', 'third']);
  registry.state.providers.codex = { optedIn: true, status: 'connected' };
  registry.mergeModels('codex', models);
  const entered = deferred(); let started = 0;
  registry.execute = async function* (_prepared, signal) {
    if (++started === 2) entered.resolve();
    await new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { code: 'CANCELLED' })), { once: true }));
  };
  const probing = registry.probeModels('codex', models);
  await entered.promise;
  await registry.close();
  await probing;
  assert.equal(started, 2);
  assert.equal(registry.catalog.models.some(model => model.available), false);
  assert.equal(registry.probeJobs.size, 0);
});

test('failure of the first model still automatically checks the remaining models', async () => {
  const registry = new NativeAiRegistry({ dataDir: await mkdtemp('/tmp/phynite-native-test-') });
  await registry.ready;
  const models = nativeModels(['blocked', 'supported']);
  registry.execute = async function* (prepared) {
    if (prepared.rawModel === 'blocked') throw Object.assign(new Error('Quota unavailable'), { code: 'INFERENCE_FAILED' });
    yield probeResult(prepared);
  };
  const result = await registry.activate('codex', models, '0.162.1');
  assert.equal(result.verified, false);
  await registry.probeJobs.get('codex').promise;
  const status = await registry.status();
  assert.equal(status.models.find(model => model.id === 'codex/blocked').available, false);
  assert.equal(status.models.find(model => model.id === 'codex/supported').available, true);
  assert.equal(status.providers.find(provider => provider.id === 'codex').status, 'connected');
  await registry.close();
});

test('disconnect during an active probe cannot restore a verified capability', async () => {
  const registry = new NativeAiRegistry({ dataDir: await mkdtemp('/tmp/phynite-native-test-') });
  await registry.ready;
  const models = nativeModels(['synthetic']);
  registry.state.providers.codex = { optedIn: true, status: 'connected' };
  registry.mergeModels('codex', models);
  const entered = deferred(), resume = deferred();
  registry.execute = async function* (prepared) { entered.resolve(); await resume.promise; yield probeResult(prepared); };
  const probing = registry.probe(models[0].id);
  const rejected = assert.rejects(probing, reason => reason.code === 'CANCELLED');
  await entered.promise;
  await registry.disconnect('codex');
  resume.resolve();
  await rejected;
  const status = await registry.status();
  assert.equal(status.models[0].available, false);
  assert.equal(status.capabilities.models[models[0].id].failureCode, 'DISCONNECTED');
  await registry.close();
});

test('disconnect during Antigravity login discovery cancels activation', async () => {
  const registry = new NativeAiRegistry({ dataDir: await mkdtemp('/tmp/phynite-native-test-') });
  await registry.ready;
  const entered = deferred(), resume = deferred();
  registry.version = async () => { entered.resolve(); await resume.promise; return '1.4.10'; };
  registry.agyModels = async () => [{ id: 'agy/synthetic', provider: 'antigravity', efforts: ['auto'] }];
  const login = registry.login('antigravity');
  const rejected = assert.rejects(login, reason => reason.code === 'CANCELLED');
  await entered.promise;
  await registry.disconnect('antigravity');
  resume.resolve();
  await rejected;
  assert.equal(registry.state.providers.antigravity.optedIn, false);
  assert.deepEqual(registry.catalog.models, []);
  await registry.close();
});

test('disconnect during Codex login setup cannot leave a pending login', async () => {
  const registry = new NativeAiRegistry({ dataDir: await mkdtemp('/tmp/phynite-native-test-') });
  await registry.ready;
  const entered = deferred(), resume = deferred();
  registry.version = async () => '0.162.1';
  registry.codexSession = async () => ({
    request: async () => { entered.resolve(); await resume.promise; return { type: 'chatgpt', loginId: 'synthetic', authUrl: 'https://auth.openai.com/' }; },
    close: async () => {},
  });
  const login = registry.login('codex');
  const rejected = assert.rejects(login, reason => reason.code === 'CANCELLED');
  await entered.promise;
  await registry.disconnect('codex');
  resume.resolve();
  await rejected;
  assert.equal(registry.state.providers.codex.optedIn, false);
  assert.equal(registry.logins.size, 0);
  await registry.close();
});

test('an obsolete connection error cannot disconnect a newer activation', async () => {
  const registry = new NativeAiRegistry({ dataDir: await mkdtemp('/tmp/phynite-native-test-') });
  await registry.ready;
  const entered = deferred(), resume = deferred();
  registry.version = async () => { entered.resolve(); await resume.promise; throw Object.assign(new Error('old request failed'), { code: 'CLI_EXIT' }); };
  const connecting = registry.connect('codex');
  const rejected = assert.rejects(connecting, reason => reason.code === 'CLI_EXIT');
  await entered.promise;
  await registry.disconnect('codex');
  await registry.activate('codex', [], '0.162.1', { verify: false });
  resume.resolve();
  await rejected;
  assert.equal(registry.state.providers.codex.optedIn, true);
  await registry.close();
});

test('models added during an active probe batch are checked afterward', async () => {
  const registry = new NativeAiRegistry({ dataDir: await mkdtemp('/tmp/phynite-native-test-') });
  await registry.ready;
  const initial = nativeModels(['first']), expanded = nativeModels(['first', 'added']);
  registry.state.providers.codex = { optedIn: true, status: 'connected' };
  registry.mergeModels('codex', initial);
  const entered = deferred(), resume = deferred();
  registry.execute = async function* (prepared) { if (prepared.rawModel === 'first') { entered.resolve(); await resume.promise; } yield probeResult(prepared); };
  const probing = registry.probeModels('codex', initial);
  await entered.promise;
  registry.mergeModels('codex', expanded);
  const refreshing = registry.probeModels('codex', expanded);
  resume.resolve();
  await Promise.all([probing, refreshing]);
  assert.equal(registry.catalog.models.every(model => model.available), true);
  await registry.close();
});

test('disconnect cancels an active native chat stream', async () => {
  const registry = new NativeAiRegistry({ dataDir: await mkdtemp('/tmp/phynite-native-test-') });
  await registry.ready;
  registry.state.providers.codex = { optedIn: true, status: 'connected' };
  registry.mergeModels('codex', nativeModels(['synthetic']));
  registry.catalog.capabilities.models['codex/synthetic'] = { available: true, text: true, streaming: true };
  const entered = deferred(), resume = deferred(); let executionSignal;
  registry.execute = async function* (_prepared, signal) { executionSignal = signal; entered.resolve(); await resume.promise; yield { type: 'result', proposal: { text: 'synthetic', calls: [] } }; };
  const events = [];
  const streaming = (async () => { for await (const event of registry.stream({ modelId: 'codex/synthetic', messages: [{ role: 'user', content: 'synthetic' }] })) events.push(event); })();
  const rejected = assert.rejects(streaming, reason => reason.code === 'CANCELLED');
  await entered.promise;
  await registry.disconnect('codex');
  assert.equal(executionSignal.aborted, true);
  resume.resolve();
  await rejected;
  assert.equal(events.some(event => event.type === 'message_stop'), false);
  await registry.close();
});
