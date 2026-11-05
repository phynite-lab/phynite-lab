import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NativeAiRegistry } from '../packages/phynite-lab/lib/native-ai.mjs';
import { CLAUDE_ISOLATION_ENV, claudeArguments, parseClaudeAuth, verifyClaudeInit } from '../packages/phynite-lab/lib/claude-bridge.mjs';

const SIGNED_IN = '{"loggedIn":true,"authMethod":"claude.ai","email":"researcher@example.test","subscriptionType":"max"}';
const RESOLVED = { fable: 'claude-fable-5-1', opus: 'claude-opus-4-7', sonnet: 'claude-sonnet-4-6', haiku: 'claude-haiku-4-5' };

// A synthetic `claude` that follows the event shapes observed from Claude Code 2.1.x print mode:
// system/init, stream_event, assistant, result, and a non-zero exit after an error result.
function claudeStub({ mode = 'ok', transcript, version = '2.1.318', auth = SIGNED_IN, authExit = 0 }) {
  return `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const argv = process.argv.slice(2), mode = ${JSON.stringify(mode)};
if (argv.includes('--version')) { console.log(${JSON.stringify(`${version} (Claude Code)`)}); process.exit(0); }
if (argv[0] === 'auth' && argv[1] === 'status') { console.log(${JSON.stringify(auth)}); process.exit(${authExit}); }
let stdin = ''; for await (const chunk of process.stdin) stdin += chunk;
appendFileSync(${JSON.stringify(transcript)}, JSON.stringify({ argv, stdin, env: Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(ANTHROPIC|CLAUDE|OPENAI|AWS|PHYNITE|GH_|NODE_OPTIONS)/.test(key))) }) + '\\n');
const emit = value => console.log(JSON.stringify(value));
const model = argv[argv.indexOf('--model') + 1];
const resolved = mode === 'wrong-model' ? 'claude-opus-4-7' : (${JSON.stringify(RESOLVED)})[model];
const init = { type: 'system', subtype: 'init', tools: [], mcp_servers: [], model: resolved, permissionMode: 'dontAsk', slash_commands: [], skills: [], plugins: [{ name: 'cc-plugin-privacy', path: 'builtin', source: 'cc-plugin-privacy@builtin' }], session_id: 's' };
if (mode === 'unsafe-tools') init.tools = ['Bash'];
if (mode === 'unsafe-mcp') init.mcp_servers = [{ name: 'files', status: 'connected' }];
if (mode === 'unsafe-plugin') init.plugins.push({ name: 'user-plugin', path: '/home/user/.claude/plugins/user-plugin', source: 'user-plugin@local' });
if (mode === 'unsafe-permission') init.permissionMode = 'bypassPermissions';
if (mode === 'unsafe-skills') init.skills = ['deploy'];
if (mode === 'memory-on') init.memory_paths = { auto: '/home/user/.claude/projects/x/memory/' };
if (mode === 'text-before-init') { emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'early' }] } }); process.exit(0); }
emit(init);
const nonce = /exactly ([a-f0-9-]{36})/.exec(stdin)?.[1];
const reply = nonce ? { text: nonce, toolCalls: [{ name: 'phynite_connection_probe', argumentsJson: JSON.stringify({ nonce }) }] } : { text: 'Hello from Claude', toolCalls: mode === 'bad-tool' ? [{ name: 'run_shell', argumentsJson: '{}' }] : [] };
const text = JSON.stringify(reply);
const delta = chunk => emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunk } }, session_id: 's' });
if (mode === 'auth-error') { emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'Not logged in · Please run /login' }] } }); emit({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login', num_turns: 1, permission_denials: [] }); process.exit(1); }
if (mode === 'limit-error') { emit({ type: 'result', subtype: 'success', is_error: true, result: 'You have reached your usage limit. It resets at 5pm.', num_turns: 1, permission_denials: [] }); process.exit(1); }
if (mode === 'tool-stream') emit({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't', name: 'Bash', input: {} } } });
if (mode === 'tool-assistant') { emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'id' } }] } }); }
if (mode === 'user-event') emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] } });
if (mode === 'no-result') { delta(text.slice(0, 5)); process.exit(0); }
emit({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } } });
emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'PRIVATE_REASONING' } } });
emit({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } });
const half = Math.ceil(text.length / 2); delta(text.slice(0, half)); delta(text.slice(half));
emit({ type: 'assistant', message: { content: [{ type: 'text', text }], stop_reason: 'end_turn' } });
emit({ type: 'result', subtype: mode === 'denied' ? 'success' : 'success', is_error: false, result: text, num_turns: mode === 'two-turns' ? 2 : 1, permission_denials: mode === 'denied' ? [{ tool_name: 'Bash' }] : [], terminal_reason: 'completed' });
`;
}

async function fixture(options, run) {
  const dir = await mkdtemp('/tmp/phynite-claude-bridge-test-');
  const transcript = join(dir, 'transcript.ndjson');
  const path = join(dir, 'claude');
  await writeFile(path, claudeStub({ ...options, transcript }), { mode: 0o700 });
  await chmod(path, 0o700);
  await writeFile(transcript, '');
  const registry = new NativeAiRegistry({ dataDir: join(dir, 'data'), executables: { claude: path }, timeoutMs: 5000 });
  await registry.ready;
  const turns = async () => (await readFile(transcript, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  try { await run({ registry, turns, dir }); } finally { await registry.close(); await rm(dir, { recursive: true, force: true }); }
}
const prepared = (overrides = {}) => ({ provider: 'claude', rawModel: 'sonnet', prompt: 'SYNTHETIC_PROJECT_CONTEXT', schema: { type: 'object' }, names: new Set(['host_action']), effort: 'auto', ...overrides });
async function run(registry, options) { const events = []; for await (const event of registry.execute(options)) events.push(event); return events; }

test('Claude Code is a third provider with its own account slot and aliased models', async () => {
  await fixture({}, async ({ registry }) => {
    const status = await registry.status();
    assert.deepEqual(status.providers.map(provider => provider.id), ['codex', 'antigravity', 'claude']);
    const claude = status.providers.find(provider => provider.id === 'claude');
    assert.equal(claude.installed, true);
    assert.equal(claude.optedIn, false);
    assert.equal(claude.accounts[0].id, 'claude:default');
    const result = await registry.connect('claude');
    assert.equal(result.connected, true);
    assert.deepEqual(result.models.map(model => model.id), ['claude/fable', 'claude/opus', 'claude/sonnet', 'claude/haiku']);
    const account = (await registry.status()).providers.find(provider => provider.id === 'claude').account;
    assert.equal(account.email, 'researcher@example.test');
    assert.equal(account.plan, 'max');
  });
});

test('Claude models stay unavailable until the restricted synthetic probe verifies each one', async () => {
  await fixture({}, async ({ registry }) => {
    await registry.connect('claude');
    await registry.models();
    const capabilities = (await registry.status()).capabilities.models;
    for (const id of ['claude/fable', 'claude/opus', 'claude/sonnet', 'claude/haiku']) {
      assert.equal(capabilities[id].available, true, id);
      assert.equal(capabilities[id].tools, true, id);
      // Native image and PDF input are not verified for this bridge, so attachments use extracted text.
      assert.equal(capabilities[id].images, false, id);
      assert.equal(capabilities[id].pdf, false, id);
    }
  });
});

test('Claude turns run with every native capability disabled and the prompt on stdin', async () => {
  await fixture({}, async ({ registry, turns }) => {
    const events = await run(registry, prepared({ effort: 'high' }));
    assert.deepEqual(events.map(event => event.type), ['delta', 'delta', 'result']);
    assert.deepEqual(events.at(-1).proposal, { text: 'Hello from Claude', calls: [] });
    assert.equal(events.at(-1).streamed, true);
    // Reasoning is never forwarded to the caller.
    assert.equal(JSON.stringify(events).includes('PRIVATE_REASONING'), false);
    const [turn] = await turns();
    const arg = name => turn.argv[turn.argv.indexOf(name) + 1];
    assert.equal(arg('--tools'), '');
    assert.equal(arg('--setting-sources'), '');
    assert.equal(arg('--permission-mode'), 'dontAsk');
    assert.equal(arg('--mcp-config'), '{"mcpServers":{}}');
    assert.equal(arg('--model'), 'sonnet');
    assert.equal(arg('--effort'), 'high');
    for (const flag of ['-p', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence', '--include-partial-messages']) assert.ok(turn.argv.includes(flag), flag);
    // The user's context is never placed in argv, where it would show in a process listing.
    assert.equal(turn.argv.some(value => value.includes('SYNTHETIC_PROJECT_CONTEXT')), false);
    assert.ok(turn.stdin.includes('SYNTHETIC_PROJECT_CONTEXT'));
    for (const [key, value] of Object.entries(CLAUDE_ISOLATION_ENV)) assert.equal(turn.env[key], value, key);
  });
});

test('Claude does not inherit API keys, provider tokens or Node injection', { concurrency: false }, async () => {
  const keys = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN', 'GH_TOKEN', 'NODE_OPTIONS'];
  const saved = keys.map(key => process.env[key]);
  try {
    for (const key of keys) process.env[key] = key === 'NODE_OPTIONS' ? '--require=/definitely-not-a-module.cjs' : 'synthetic-secret';
    await fixture({}, async ({ registry, turns }) => {
      await run(registry, prepared());
      const [turn] = await turns();
      for (const key of keys) assert.equal(key in turn.env, false, key);
    });
  } finally { keys.forEach((key, index) => { if (saved[index] === undefined) delete process.env[key]; else process.env[key] = saved[index]; }); }
});

test('an added Claude account uses an isolated config directory and a matching login command', async () => {
  await fixture({}, async ({ registry, turns }) => {
    const added = await registry.addAccount('claude', 'Lab account');
    assert.match(added.command, /^CLAUDE_CONFIG_DIR='[^']+\/accounts\/claude\/[^']+' '[^']+\/claude' auth login$/);
    await registry.switchAccount('claude', added.account.id);
    await run(registry, prepared());
    const [turn] = await turns();
    assert.equal(turn.env.CLAUDE_CONFIG_DIR, added.account.homeDir);
  });
});

for (const [mode, label] of [['unsafe-tools', 'a native tool'], ['unsafe-mcp', 'an MCP server'], ['unsafe-plugin', 'a user plugin'], ['unsafe-permission', 'a permissive mode'], ['unsafe-skills', 'a skill']]) {
  test(`Claude fails closed when init reports ${label}, before any output is used`, async () => {
    await fixture({ mode }, async ({ registry }) => {
      const events = [];
      await assert.rejects(async () => { for await (const event of registry.execute(prepared())) events.push(event); }, { code: 'UNSAFE_TOOLS' });
      assert.deepEqual(events, []);
    });
  });
}

test('Claude fails closed when init shows auto-memory is still active', async () => {
  await fixture({ mode: 'memory-on' }, async ({ registry }) => {
    await assert.rejects(run(registry, prepared()), { code: 'UNSAFE_CONFIGURATION' });
  });
});

test('Claude usage is reported as not exposed by the CLI rather than as a read failure', async () => {
  await fixture({}, async ({ registry, turns }) => {
    await registry.connect('claude');
    const report = (await registry.usage()).usage.find(item => item.provider === 'claude');
    assert.deepEqual(report, { provider: 'claude', accountId: 'claude:default', quota: null, error: 'NOT_REPORTED_BY_CLI' });
    // Reading usage never starts a model turn.
    assert.deepEqual(await turns(), []);
  });
});

test('Claude rejects a silent model substitution and any response before init', async () => {
  await fixture({ mode: 'wrong-model' }, async ({ registry }) => {
    await assert.rejects(run(registry, prepared({ rawModel: 'sonnet' })), { code: 'UNSAFE_CONFIGURATION' });
  });
  await fixture({ mode: 'text-before-init' }, async ({ registry }) => {
    await assert.rejects(run(registry, prepared()), { code: 'INVALID_PROTOCOL' });
  });
});

for (const [mode, code] of [['tool-stream', 'UNSAFE_TOOLS'], ['tool-assistant', 'UNSAFE_TOOLS'], ['user-event', 'UNSAFE_TOOLS'], ['denied', 'UNSAFE_TOOLS'], ['two-turns', 'INVALID_PROTOCOL'], ['no-result', 'INCOMPLETE_RESPONSE']]) {
  test(`Claude stops on a ${mode} protocol event`, async () => {
    await fixture({ mode }, async ({ registry }) => { await assert.rejects(run(registry, prepared()), { code }); });
  });
}

test('Claude proposals are limited to the supplied tool catalog', async () => {
  await fixture({ mode: 'bad-tool' }, async ({ registry }) => {
    await assert.rejects(run(registry, prepared()), { code: 'INVALID_TOOL' });
  });
});

test('a signed-out Claude surfaces the sign-in message even though the CLI exits with 1', async () => {
  await fixture({ mode: 'auth-error' }, async ({ registry }) => {
    await assert.rejects(run(registry, prepared()), { code: 'AUTH_REQUIRED' });
  });
});

test('Claude account limits reach the user as a short provider message', async () => {
  await fixture({ mode: 'limit-error' }, async ({ registry }) => {
    await assert.rejects(run(registry, prepared()), error => error.code === 'INFERENCE_FAILED' && /usage limit/.test(error.message));
  });
});

test('Claude version gate accepts 2.1 patch releases and rejects other lines', async () => {
  for (const [version, accepted] of [['2.1.318', true], ['2.1.0', true], ['2.0.9', false], ['2.2.0', false]]) {
    await fixture({ version }, async ({ registry }) => {
      if (accepted) assert.equal((await registry.connect('claude')).connected, true, version);
      else await assert.rejects(registry.connect('claude'), { code: 'UNVERIFIED_VERSION' }, version);
    });
  }
});

test('login asks for the official sign-in when Claude is signed out, and never reads credentials', async () => {
  await fixture({ auth: '{"loggedIn":false}' }, async ({ registry }) => {
    const result = await registry.login('claude');
    assert.equal(result.status, 'manual_login_required');
    assert.match(result.instructions, /'[^']+\/claude' auth login/);
    assert.equal((await registry.status()).providers.find(provider => provider.id === 'claude').optedIn, false);
  });
  await fixture({ auth: '{"loggedIn":false}', authExit: 1 }, async ({ registry }) => {
    assert.equal((await registry.login('claude')).status, 'manual_login_required');
  });
});

test('Claude rejects API-key sign-in because turns ignore user settings and API-key variables', async () => {
  await fixture({ auth: '{"loggedIn":true,"authMethod":"api_key","apiKeySource":"ANTHROPIC_API_KEY"}' }, async ({ registry }) => {
    await assert.rejects(registry.connect('claude'), { code: 'AUTH_REQUIRED' });
    assert.equal((await registry.status()).providers.find(provider => provider.id === 'claude').optedIn, false);
  });
});

test('disconnecting Claude leaves the official CLI sign-in in place', async () => {
  await fixture({}, async ({ registry }) => {
    await registry.connect('claude');
    const result = await registry.disconnect('claude');
    assert.equal(result.sharedCliLoginPreserved, true);
    assert.equal((await registry.status()).providers.find(provider => provider.id === 'claude').optedIn, false);
  });
});

test('stream() converts a verified Claude turn into ordered Anthropic-style events', async () => {
  await fixture({}, async ({ registry }) => {
    await registry.connect('claude');
    await registry.models();
    const events = [];
    for await (const event of registry.stream({ modelId: 'claude/sonnet', messages: [{ role: 'user', content: 'Summarize the cell.' }], tools: [] })) events.push(event);
    assert.equal(events[0].type, 'message_start');
    assert.equal(events.at(-1).type, 'message_stop');
    const text = events.filter(event => event.delta?.type === 'text_delta').map(event => event.delta.text).join('');
    assert.equal(text, 'Hello from Claude');
    assert.equal(events.find(event => event.type === 'message_delta').delta.stop_reason, 'end_turn');
  });
});

test('stream() refuses an unverified Claude model and an unsupported effort', async () => {
  await fixture({}, async ({ registry }) => {
    await registry.connect('claude');
    await assert.rejects((async () => { await registry.stream({ modelId: 'claude/sonnet', messages: [{ role: 'user', content: 'x' }] }).next(); })(), { code: 'UNVERIFIED_MODEL' });
    await registry.models();
    await assert.rejects((async () => { await registry.stream({ modelId: 'claude/sonnet', effort: 'max', messages: [{ role: 'user', content: 'x' }] }).next(); })(), { code: 'UNSUPPORTED_EFFORT' });
  });
});

test('pure helpers: arguments, init verification and sign-in parsing', () => {
  assert.equal(claudeArguments('opus').includes('--effort'), false);
  assert.deepEqual(claudeArguments('opus', 'low').slice(-4, -2), ['--effort', 'low']);
  const safe = { tools: [], mcp_servers: [], slash_commands: [], skills: [], plugins: [], permissionMode: 'dontAsk', model: 'claude-opus-4-7' };
  assert.equal(verifyClaudeInit(safe, 'opus'), 'claude-opus-4-7');
  assert.equal(verifyClaudeInit({ ...safe, memory_paths: {} }, 'opus'), 'claude-opus-4-7');
  assert.throws(() => verifyClaudeInit({ ...safe, memory_paths: { auto: '/m/' } }, 'opus'), { code: 'UNSAFE_CONFIGURATION' });
  assert.throws(() => verifyClaudeInit({ ...safe, tools: ['Read'] }, 'opus'), { code: 'UNSAFE_TOOLS' });
  assert.throws(() => verifyClaudeInit({ ...safe, plugins: undefined }, 'opus'), { code: 'UNSAFE_TOOLS' });
  assert.throws(() => verifyClaudeInit({ ...safe, model: 'gpt-6' }, 'opus'), { code: 'UNSAFE_CONFIGURATION' });
  assert.deepEqual(parseClaudeAuth('{"loggedIn":true,"email":"a@b.test","subscriptionType":"pro"}'), { email: 'a@b.test', planType: 'pro' });
  assert.deepEqual(parseClaudeAuth('{"loggedIn":true,"email":42}'), { email: undefined, planType: undefined });
  assert.throws(() => parseClaudeAuth('not json'), { code: 'INVALID_PROTOCOL' });
  assert.throws(() => parseClaudeAuth('{"loggedIn":false}'), { code: 'AUTH_REQUIRED' });
});

test('Claude image turns send image blocks over stream-json input, not inside the text prompt', async () => {
  const pixel = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABAQEANl9ngAAAAABJRU5ErkJggg==';
  await fixture({}, async ({ registry, turns }) => {
    const events = await run(registry, prepared({ images: [{ mediaType: 'image/png', data: pixel }] }));
    assert.equal(events.at(-1).type, 'result');
    const [turn] = await turns();
    assert.equal(turn.argv[turn.argv.indexOf('--input-format') + 1], 'stream-json');
    const message = JSON.parse(turn.stdin.trim());
    assert.equal(message.type, 'user');
    assert.deepEqual(message.message.content.map(block => block.type), ['text', 'image']);
    assert.deepEqual(message.message.content[1].source, { type: 'base64', media_type: 'image/png', data: pixel });
    assert.equal(message.message.content[0].text.includes(pixel), false);
    assert.ok(message.message.content[0].text.includes('SYNTHETIC_PROJECT_CONTEXT'));
  });
  // Text-only turns keep plain stdin.
  await fixture({}, async ({ registry, turns }) => {
    await run(registry, prepared());
    const [turn] = await turns();
    assert.equal(turn.argv.includes('--input-format'), false);
  });
});
