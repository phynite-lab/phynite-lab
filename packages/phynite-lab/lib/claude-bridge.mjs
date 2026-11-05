// Claude Code bridge policy. The adapter drives the user's own official `claude`
// CLI in print mode with every native capability switched off, exactly like the
// Codex and Antigravity bridges: the model may only return text plus proposed
// Phynite actions, which the host validates. Phynite never reads, copies or
// stores Claude credentials; the CLI owns sign-in.
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message) => Object.assign(new Error(message), { code });

/** Aliases are resolved by the installed CLI, so the model list follows its releases.
 * Every entry still has to pass the synthetic probe before it can be selected. */
export const CLAUDE_MODELS = [
  { rawModel: 'fable', name: 'Claude Fable' },
  { rawModel: 'opus', name: 'Claude Opus' },
  { rawModel: 'sonnet', name: 'Claude Sonnet' },
  { rawModel: 'haiku', name: 'Claude Haiku' },
];
const EFFORTS = ['auto', 'low', 'medium', 'high'];
export const claudeCatalog = () => CLAUDE_MODELS.map(model => ({ id: `claude/${model.rawModel}`, provider: 'claude', name: model.name, rawModel: model.rawModel, available: false, efforts: [...EFFORTS] }));

export const CLAUDE_SYSTEM_PROMPT = 'You are the materials-science assistant in Phynite Lab. Native tools are unavailable. Reply to every request as one JSON object with exactly two fields: text (a string) and toolCalls (an array). Use an empty array when no action is needed. Each action has name and argumentsJson (a string containing JSON). Phynite actions are processed by the host only; never claim one already happened. Do not attempt filesystem, shell, web, MCP, plugin, subagent or task actions. After your JSON response, stop.';

/** Print-mode arguments. `--tools ""` removes every built-in tool, an empty strict MCP
 * config removes servers, and an empty setting-source list stops the user's own
 * settings, plugins and hooks from loading. The prompt itself is sent on stdin. */
export function claudeArguments(rawModel, effort = 'auto') {
  return ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disable-slash-commands',
    '--setting-sources', '', '--no-session-persistence', '--permission-mode', 'dontAsk',
    '--model', rawModel, ...(effort === 'auto' ? [] : ['--effort', effort]), '--system-prompt', CLAUDE_SYSTEM_PROMPT];
}

/** Switches set by Phynite, never taken from the caller's environment. They keep the
 * user's CLAUDE.md files and auto-memory out of a scientific request. */
export const CLAUDE_ISOLATION_ENV = { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1', CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };

/** Fail closed unless the CLI confirms the restricted session. `init` is the first event of a
 * turn and precedes any model output, so nothing is forwarded until this passes. */
export function verifyClaudeInit(message, rawModel) {
  const unsafe = () => fail('UNSAFE_TOOLS', 'Claude Code did not confirm its restricted session. No response was used.');
  if (!Array.isArray(message.tools) || message.tools.length || !Array.isArray(message.mcp_servers) || message.mcp_servers.length) throw unsafe();
  if (!Array.isArray(message.slash_commands) || message.slash_commands.length || (message.skills !== undefined && (!Array.isArray(message.skills) || message.skills.length))) throw unsafe();
  if (message.permissionMode !== 'dontAsk') throw unsafe();
  // Only the CLI's built-in plugins may be present; a user plugin could run hooks.
  if (!Array.isArray(message.plugins) || message.plugins.some(plugin => !object(plugin) || plugin.path !== 'builtin')) throw unsafe();
  // The selected alias must be the model that answers; never accept a silent substitution.
  if (typeof message.model !== 'string' || !/^claude-[A-Za-z0-9._-]{1,100}$/.test(message.model) || !message.model.includes(rawModel)) throw fail('UNSAFE_CONFIGURATION', 'Claude Code did not preserve the selected model.');
  return message.model;
}

/** Ordinary `claude auth status` output. Only fields that are strings are trusted. */
export function parseClaudeAuth(output) {
  let value;
  try { value = JSON.parse(output); } catch { throw fail('INVALID_PROTOCOL', 'Claude Code returned an unreadable sign-in status. Update the official CLI.'); }
  if (!object(value) || typeof value.loggedIn !== 'boolean') throw fail('INVALID_PROTOCOL', 'Claude Code returned an unreadable sign-in status. Update the official CLI.');
  if (!value.loggedIn) throw fail('AUTH_REQUIRED', 'Sign in using the official Claude Code CLI (claude auth login), then connect.');
  // Phynite turns ignore the user's CLI settings and never pass API-key variables, so a key
  // that `auth status` finds there is not usable. Require a Claude account sign-in instead.
  if (typeof value.authMethod === 'string' && /api[_ -]?key/i.test(value.authMethod)) throw fail('AUTH_REQUIRED', 'Claude Code reports API-key authentication, which this subscription connector does not use. Sign in with your Claude account (claude auth login), then connect.');
  const text = field => typeof value[field] === 'string' && value[field] && value[field].length <= 200 ? value[field] : undefined;
  return { email: text('email'), planType: text('subscriptionType') };
}

const AUTH_FAILURE = /not logged in|\/login|please run .*login|invalid api key|authentication/i;
/** A failed result becomes a provider error without echoing more than a short excerpt. */
export function claudeResultFailure(message) {
  const text = typeof message.result === 'string' ? message.result.replace(/\s+/g, ' ').trim().slice(0, 500) : '';
  if (AUTH_FAILURE.test(text)) return fail('AUTH_REQUIRED', 'Sign in using the official Claude Code CLI (claude auth login), then reconnect.');
  return fail('INFERENCE_FAILED', text || 'Claude Code did not complete its response. Check official CLI authentication and account limits.');
}

/** Any block that could carry a native action is a protocol violation, not an event to skip. */
export const isClaudeActionBlock = block => object(block) && typeof block.type === 'string' && !['text', 'thinking', 'redacted_thinking'].includes(block.type);
