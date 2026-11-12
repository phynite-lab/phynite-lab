import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { LocalMcpRegistry, mcpToolName } from '../packages/phynite-lab/lib/local-mcp.mjs';
import { createLocalAiServer } from '../packages/phynite-lab/lib/ai-server.mjs';

const tools = [
  { name: 'read_sample', description: 'Synthetic fixture evidence', inputSchema: { type: 'object', properties: { count: { type: 'integer', minimum: 1, maximum: 3 } }, required: ['count'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'save_sample', inputSchema: { type: 'object', properties: { name: { type: 'string', minLength: 1 } }, required: ['name'], additionalProperties: false } },
];
async function fixture(t, overrides = {}, advertisedTools = tools) {
  const root = await mkdtemp(join(tmpdir(), 'phynite-mcp-'));
  t.after(async () => { const { rm } = await import('node:fs/promises'); await rm(root, { recursive: true, force: true }); });
  await mkdir(join(root, 'mcp'), { mode: 0o700 });
  const script = join(root, 'fixture.mjs');
  await writeFile(script, `import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';
const tools=${JSON.stringify(advertisedTools)};
for await (const line of createInterface({input:process.stdin})) {
 const m=JSON.parse(line); if (!('id' in m)) continue;
 if (process.env.FIXTURE_HANG==='yes') continue;
 let result=m.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{tools:{}}}:m.method==='tools/list'?{tools}:null;
 if (m.method==='tools/call') {
  appendFileSync(${JSON.stringify(join(root,'calls.jsonl'))}, JSON.stringify(m.params)+'\\n');
  result={content:[{type:'text',text:'Fixture Δ café — '+(process.env.MCP_FIXTURE_KEY??'')},{type:'image',data:'omit-binary'}],structuredContent:{fixture:true,apiKey:process.env.MCP_FIXTURE_KEY, inherited:!!(process.env.PHYNITE_LOCAL_AI_TOKEN||process.env.AWS_SECRET_ACCESS_KEY||process.env.NODE_OPTIONS)}};
 }
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');
}`);
  const row = { id: 'fixture', label: 'Fixture server', transport: 'stdio', command: process.execPath, args: [script], env: { MCP_FIXTURE_KEY: 'synthetic-private-credential' }, ...overrides };
  const config = join(root, 'mcp', 'servers.json');
  await writeFile(config, JSON.stringify({ version: 1, servers: [row] }), { mode: 0o600 });
  const registry = new LocalMcpRegistry({ dataDir: root, timeoutMs: 3000 }); t.after(() => registry.close());
  return { root, registry, row, config };
}
const payload = tool => ({ name: tool.name, arguments: tool.readOnly ? { count: 2 } : { name: 'Fixture' }, readOnly: tool.readOnly, toolHash: tool.toolHash });

test('private disk registration, explicit opt-in, discovery and credential-free results', async t => {
  const previous = process.env.PHYNITE_LOCAL_AI_TOKEN; process.env.PHYNITE_LOCAL_AI_TOKEN = 'synthetic-inherited-credential';
  t.after(() => { if (previous === undefined) delete process.env.PHYNITE_LOCAL_AI_TOKEN; else process.env.PHYNITE_LOCAL_AI_TOKEN = previous; });
  const { registry, root } = await fixture(t);
  let catalog = await registry.list(); assert.equal(catalog.tools.length, 0); assert.equal(catalog.servers[0].enabled, false);
  await assert.rejects(registry.setEnabled({ serverId: 'fixture', enabled: true, command: '/bin/sh' }));
  catalog = await registry.setEnabled({ serverId: 'fixture', enabled: true });
  assert.equal(catalog.tools.length, 2); assert.equal(catalog.tools[0].readOnly, true); assert.equal(catalog.tools[1].readOnly, false);
  assert.doesNotMatch(JSON.stringify(catalog), /synthetic-private-credential|fixture\.mjs|command|headers|MCP_FIXTURE_KEY/);
  assert.deepEqual(await registry.invoke(payload(catalog.tools[0])), { valid: true });
  const result = await registry.invoke(payload(catalog.tools[0]), { execute: true });
  assert.match(result.content[0].text, /Δ café/); assert.doesNotMatch(JSON.stringify(result), /synthetic-private-credential|apiKey/);
  assert.equal(result.structuredContent.inherited, false); assert.equal(result.omittedContent, 1);
  assert.equal((await readFile(join(root, 'calls.jsonl'), 'utf8')).trim().split('\n').length, 1);
});

test('schema arguments, stale capabilities, disablement and private configuration fail closed', async t => {
  const { registry, config, row } = await fixture(t);
  const { tools: discovered } = await registry.setEnabled({ serverId: 'fixture', enabled: true });
  const input = payload(discovered[0]);
  for (const args of [{ count: 2, password: 'do-not-send' }, { count: 2, query: 'Bearer synthetic-credential' }, { count: 4 }, { count: 1, injected: true }, { count: '2' }, {}]) await assert.rejects(registry.invoke({ ...input, arguments: args }), { code: 'MCP_ARGUMENTS_INVALID' });
  await assert.rejects(registry.invoke({ ...input, readOnly: false }), { code: 'MCP_TOOL_CHANGED' });
  await writeFile(config, JSON.stringify({ version: 1, servers: [{ ...row, label: 'Changed server' }] }));
  await assert.rejects(registry.invoke(input), { code: 'MCP_TOOL_CHANGED' });
  await registry.setEnabled({ serverId: 'fixture', enabled: false });
  await assert.rejects(registry.invoke(input), { code: 'MCP_NOT_FOUND' });
  await chmod(config, 0o644); await assert.rejects(registry.list(), { code: 'MCP_CONFIG_INVALID' });
});

test('only absolute executables, clean environment and fixed loopback HTTP can be configured', async t => {
  const { registry, config, row } = await fixture(t);
  for (const bad of [{ ...row, command: 'node' }, { ...row, env: { PHYNITE_LOCAL_AI_TOKEN: 'blocked' } }, { ...row, env: { AWS_SECRET_ACCESS_KEY: 'blocked' } }, { ...row, env: { NODE_OPTIONS: '--require=bad' } }, ...['https://example.com/mcp','http://localhost:1234/mcp','http://127.0.0.1:1234/mcp?token=bad','http://127.0.0.1:1234@evil.test'].map(url => ({ id:'fixture',label:'Fixture',transport:'http',url }))]) {
    await writeFile(config, JSON.stringify({ version: 1, servers: [bad] })); await assert.rejects(registry.list(), { code: 'MCP_CONFIG_INVALID' });
  }
});

test('HTTP MCP negotiates a session, respects byte/redirect limits and never follows remote destinations', async t => {
  let redirect = false, huge = false, deleted = 0;
  const server = createServer(async (req, res) => {
    if (req.method === 'DELETE') { deleted++; res.writeHead(204).end(); return; }
    const chunks=[]; for await (const part of req) chunks.push(part);
    const request=JSON.parse(Buffer.concat(chunks));
    if (redirect) { res.writeHead(302,{Location:'https://example.invalid/mcp'}).end(); return; }
    if (request.method==='notifications/initialized') { assert.equal(req.headers['mcp-session-id'],'fixture-session'); res.writeHead(202).end(); return; }
    let result=request.method==='initialize'?{protocolVersion:'2025-03-26',capabilities:{tools:{}}}:request.method==='tools/list'?{tools}: {content:[{type:'text',text:huge?'x'.repeat(1024*1024+1):'Fixture result'}]};
    res.writeHead(200,{'Content-Type':'application/json','Mcp-Session-Id':'fixture-session'}).end(JSON.stringify({jsonrpc:'2.0',id:request.id,result}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); t.after(()=>new Promise(resolve=>server.close(resolve)));
  const {registry}=await fixture(t,{transport:'http',command:undefined,args:undefined,env:undefined,url:`http://127.0.0.1:${server.address().port}/mcp`});
  const catalog=await registry.setEnabled({serverId:'fixture',enabled:true}); assert.equal(catalog.tools.length,2);
  assert.equal((await registry.invoke(payload(catalog.tools[0]),{execute:true})).content[0].text,'Fixture result'); assert.ok(deleted>=2);
  huge=true; await assert.rejects(registry.invoke(payload(catalog.tools[0]),{execute:true}), {code:'MCP_RESPONSE_LIMIT'});
  huge=false; redirect=true; assert.equal((await registry.list()).servers[0].status,'unavailable');
});

test('cancellation terminates a hung stdio session and long names remain unique and bounded', async t => {
  const {registry,config,row}=await fixture(t); const catalog=await registry.setEnabled({serverId:'fixture',enabled:true});
  await writeFile(config,JSON.stringify({version:1,servers:[{...row,env:{FIXTURE_HANG:'yes'}}]}));
  const controller=new AbortController(); const pending=registry.invoke(payload(catalog.tools[0]),{signal:controller.signal,execute:true});
  setTimeout(()=>controller.abort(),100); await assert.rejects(pending); assert.equal(registry.active.size,0);
  const first=mcpToolName('longserver','tool'.repeat(40)), second=mcpToolName('longserver','tool'.repeat(40)+'x');
  assert.match(first,/^[A-Za-z0-9_-]{1,64}$/); assert.notEqual(first,second); assert.notEqual(mcpToolName('fixture','read.v1'),mcpToolName('fixture','read_v1'));
});

test('launcher MCP transport rejects browsers and unauthenticated internal calls', async t => {
  const {root}=await fixture(t);
  const server=await createLocalAiServer({dataDir:root,registry:{close(){}}}); t.after(()=>server.close());
  const endpoint=server.origin+'/mcp/servers';
  assert.equal((await fetch(endpoint)).status,403);
  assert.equal((await fetch(endpoint,{headers:{Authorization:`Bearer ${server.token}`,Origin:'http://127.0.0.1:3000'}})).status,403);
  const reply=await fetch(endpoint,{headers:{Authorization:`Bearer ${server.token}`}}); assert.equal(reply.status,200); assert.equal((await reply.json()).tier,'local');
});


test('unsupported schema constraints are rejected rather than bypassed', async t => {
  const {registry}=await fixture(t,{},[{...tools[0],inputSchema:{type:'object',properties:{count:{type:'string',pattern:'^(a+)+$'}}}}]);
  const catalog=await registry.setEnabled({serverId:'fixture',enabled:true});
  assert.deepEqual(catalog.tools,[]); assert.equal(catalog.servers[0].status,'unavailable'); assert.equal(catalog.servers[0].code,'MCP_SCHEMA_UNSUPPORTED');
});
