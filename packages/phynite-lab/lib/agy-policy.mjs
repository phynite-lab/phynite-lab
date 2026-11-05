import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const digest = value => createHash('sha256').update(value).digest('hex');
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const unsafe = () => Object.assign(new Error('Antigravity could not verify its native tool restrictions. No project context was sent. Reconnect or check the installed CLI version.'), { code: 'UNSAFE_CONFIGURATION' });

/** AGY 1.4.10–1.4.11 advertises a static tool registry in init, even for an isolated
 * agent. Enforce denial with its hook and permission layers instead. The first
 * turn contains only an arithmetic warmup; its SessionStart receipt must verify
 * before the bridge sends any project context.
 */
export async function createAgyPolicy(cwd, responseSchema = { type: 'object' }) {
  const profilePath = join(cwd, '.agents', 'agents', 'phynite-bridge.md');
  const hooksPath = join(cwd, 'native-guard-hooks.json'), scriptPath = join(cwd, 'native-guard.mjs'), proofPath = join(cwd, 'native-guard-proof.json');
  const nonce = randomUUID(), bootstrapText = '4';
  const paths = [profilePath, hooksPath, scriptPath];
  // The trusted hook receives structured data on stdin. No model text is ever
  // interpolated into its command. Hook failures are also denied by this CLI.
  const script = `import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
let raw = '';
for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 65536) process.exit(2); }
const kind = process.argv[2];
if (kind === 'block') {
  process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'PHYNITE_NATIVE_ACTION_DENIED' }));
} else if (kind === 'session') {
  const event = JSON.parse(raw);
  const hashes = Object.fromEntries(${JSON.stringify(paths)}.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
  writeFileSync(${JSON.stringify(proofPath)}, JSON.stringify({ nonce: ${JSON.stringify(nonce)}, conversationId: event.conversationId, model: event.modelName, hashes }), { mode: 0o600 });
  process.stdout.write('{}');
} else process.exit(2);
`;
  const command = `${quote(process.execPath)} ${quote(scriptPath)}`;
  const hooks = JSON.stringify({ 'phynite-native-guard': {
    SessionStart: [{ type: 'command', command: `${command} session`, timeout: 5 }],
    PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: `${command} block`, timeout: 5 }] }],
  } });
  const profile = `---
name: phynite-bridge
description: Phynite text and host-validated action proposals only.
mainAgent: true
subagent: false
model: inherit
commandExecutionPolicy: off
inheritMcp: false
inheritCustomizations: false
excludeDefaultComponents: true
tools: []
mcpServers: []
skills: []
plugins: []
agents: []
hooks:
  - ${JSON.stringify(hooksPath)}
---
# System Prompt
You are the materials-science assistant in Phynite Lab. Native tools are unavailable. Reply to every request as one JSON object with exactly two fields: text (a string) and toolCalls (an array). Use an empty array when no action is needed. Each action has name and argumentsJson (a string containing JSON). These Phynite actions are processed by the host only. The host provides phynite_connection_probe, a harmless connection echo check; when asked to check the connection, propose it with the supplied public nonce in argumentsJson. Do not invoke native CLI tools, manage_task, filesystem tools, subagents, task management, or agents. After your JSON response stop immediately. Do not check, list, start, or monitor background tasks.

## Host response protocol
Every reply must be a JSON object with text (a string) and toolCalls (an array). These are application messages, not Antigravity native tool invocations. The host provides its allowed application request names in the response schema below. You may propose these requests as JSON data; Phynite validates and approves them before any action. When no application request is needed, use an empty toolCalls array. Do not add Markdown or prose outside the JSON object.
${JSON.stringify(responseSchema)}
`;
  await mkdir(join(cwd, '.agents', 'agents'), { recursive: true, mode: 0o700 });
  for (const [path, source] of [[profilePath, profile], [hooksPath, hooks], [scriptPath, script]]) await writeFile(path, source, { mode: 0o600, flag: 'wx' });
  const hashes = Object.fromEntries([[profilePath, profile], [hooksPath, hooks], [scriptPath, script]].map(([path, source]) => [path, digest(source)]));
  return {
    settings: { toolPermission: 'strict', permissions: { allow: [], ask: [], deny: ['read_file', 'write_file', 'read_url', 'execute_url', 'command', 'mcp'].map(action => `${action}(*)`) }, allowNonWorkspaceAccess: false, statusLine: { enabled: false }, title: { enabled: false } },
    bootstrapText,
    // The trusted hook receipt, not the model's answer, proves policy. Use an
    // ordinary factual warmup rather than asking the model to echo a nonce.
    bootstrap: 'What is 2 + 2? Reply with exactly this JSON object and no other text: {"text":"4","toolCalls":[]}',
    async verify(conversationId, model) {
      try {
        const raw = await readFile(proofPath, 'utf8');
        if (raw.length > 16384) throw unsafe();
        const proof = JSON.parse(raw);
        // ACP sessions do not expose the conversation ID; the per-request nonce still binds the receipt.
        if (proof.nonce !== nonce || (conversationId !== null && proof.conversationId !== conversationId) || proof.model !== model || !proof.hashes || Object.keys(proof.hashes).length !== paths.length) throw unsafe();
        for (const path of paths) if (proof.hashes[path] !== hashes[path] || digest(await readFile(path)) !== hashes[path]) throw unsafe();
      } catch { throw unsafe(); }
    },
  };
}
