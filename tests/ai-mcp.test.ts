import test from 'node:test';
import assert from 'node:assert/strict';
import { aiTools, executeAiTool, type AiBackend } from '../lib/ai-tools.ts';
import { aiEffectivePermission } from '../lib/ai-workbench.ts';
import { aiMcpControlPlaneTimeout, type AiMcpTool } from '../lib/ai-mcp.ts';
const tools: AiMcpTool[] = [true, false].map((readOnly, index) => ({ name: `mcp__fixture__${index ? 'write' : 'read'}`, serverId: 'fixture', readOnly, toolHash: 'a'.repeat(64), description: 'Synthetic fixture', input_schema: { type: 'object' } }));

test('dynamic tools cannot shadow builtins, widen custom subsets or bypass task permissions', () => {
  for (const mode of ['chat', 'approval', 'full'] as const) for (const task of ['work', 'plan', 'research', 'summary'] as const) {
    const names = aiTools(aiEffectivePermission(mode, task), true, null, tools).map(tool => tool.name);
    assert.ok(names.includes(tools[0].name)); assert.equal(names.includes(tools[1].name), mode !== 'chat' && task === 'work');
  }
  assert.ok(!aiTools('full', false, null, tools).some(tool => tool.name === tools[1].name));
  assert.deepEqual(aiTools('full', true, [tools[0].name], tools).map(tool => tool.name), [tools[0].name]);
  assert.ok(!aiTools('full', true, null, [{ ...tools[0], name: 'shell_tool' }]).some(tool => tool.name === 'shell_tool'));
});

test('read-only calls use the frozen host capability and mutations wait for exact action approval', async () => {
  const calls: Array<{ op: string; data?: Record<string, unknown> }> = [];
  const action = { id: 'aia_fixture', status: 'pending', payloadHash: 'b'.repeat(64) };
  const backend: AiBackend = async <T,>(op: string, data?: Record<string, unknown>) => { calls.push({ op, data }); return (op === 'context' ? { stamp: 'fixture-stamp' } : op === 'prepare' ? { action } : { content: [{ type: 'text', text: 'Synthetic fixture' }] }) as T; };
  const signal = new AbortController().signal;
  const read = await executeAiTool(tools[0].name, { query: 'Fixture' }, 'chat', backend, signal, 'read', null, tools);
  assert.ok(read.result); assert.equal(calls[0].op, 'mcp_call'); assert.equal(calls[0].data?.toolHash, tools[0].toolHash);
  calls.length = 0;
  const proposed = await executeAiTool(tools[1].name, { name: 'Fixture' }, 'approval', backend, signal, 'write', null, tools);
  assert.equal(proposed.awaitingApproval, true); assert.deepEqual(calls.map(call => call.op), ['context', 'prepare']);
  assert.equal(calls[1].data?.kind, 'mcp_call'); assert.equal(calls[1].data?.toolName, tools[1].name);
  const frozen = calls[1].data?.payload as Record<string, unknown>; assert.equal(frozen.readOnly, false); assert.deepEqual(frozen.arguments, { name: 'Fixture' });
  await assert.rejects(executeAiTool(tools[1].name, {}, 'chat', backend, signal, 'blocked', null, tools), { code: 'AI_PERMISSION_DENIED' });
});


test('local MCP lifecycle fits within the control-plane deadline without extending hosted or ordinary reads', () => {
  for (const suffix of ['mcp_tools','mcp_call','prepare','execute','actions/aia_fixture']) {
    const path=`conversations/aic_fixture/${suffix}`;
    assert.ok(aiMcpControlPlaneTimeout(path,true) > 2 * (10_000 + 30_000) + 30_000);
    assert.equal(aiMcpControlPlaneTimeout(path,false),20_000);
  }
  assert.equal(aiMcpControlPlaneTimeout('conversations/aic_fixture/context',true),20_000);
  assert.equal(aiMcpControlPlaneTimeout('projects',true),20_000);
});
