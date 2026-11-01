'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent } from 'react';
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider, applyNodeChanges, useReactFlow, type Node, type NodeProps, type Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '@/app/dft-workflow.css';
import { Copy, Scissors, ClipboardPaste, Undo2, Redo2, Plus, Play, Trash2, LayoutGrid, AlignHorizontalJustifyStart, AlignVerticalJustifyStart, Columns3, Keyboard, X, ArrowRight, Settings2 } from 'lucide-react';
import { ScfConvergenceMonitor } from './ScfConvergenceMonitor';
import type { ScfConvergence } from '@/lib/qe-live-scf';
import { UiSelect } from './UiSelect';
import type { CalculationJob, CalculationType } from './JobComposer';
import { ANALYSES, autoArrange, copyWorkflow, parseWorkflowClipboard, removeWorkflowNodes, snapWorkflowPoint, structureNodeId, workflowEdges, staleWorkflowNodes, connectWorkflow, type WorkflowDocument, type WorkflowMaterial, type WorkflowClipboard, type WorkflowPoint } from '@/lib/dft-workflow';

type NodeData = { scfConvergence?: ScfConvergence; label: string; detail: string; kind: string; status?: string; error?: string; configure: () => void; add: () => void; open?: () => void; [key: string]: unknown };
type FlowNode = Node<NodeData>;
function WorkflowNode({ data, selected }: NodeProps<FlowNode>) {
  return <section className={`dft-flow-node ${selected ? 'is-selected' : ''}`}>
    {data.kind === 'dft_neb' && <><Handle id="initial" type="target" position={Position.Left} style={{top:'25%'}} aria-label="NEB initial structure"/><Handle id="final" type="target" position={Position.Left} style={{top:'50%'}} aria-label="NEB final structure"/><Handle id="intermediate" type="target" position={Position.Left} style={{top:'75%'}} aria-label="NEB intermediate structure (optional)"/></>}
    {data.kind !== 'structure' && data.kind !== 'dft_neb' && <Handle type="target" position={Position.Left} aria-label={`${data.label} input`} />}
    <header><span className="dft-flow-kind">{data.kind}</span>{data.status && <span className="dft-flow-status" data-status={data.status}>{data.status}</span>}</header>
    <button type="button" className="nodrag dft-flow-name" onClick={data.configure}>{data.label}</button>
    <p>{data.detail}</p>
    {data.error && <p className="dft-flow-error">{data.error}</p>}
    <ScfConvergenceMonitor evidence={data.scfConvergence} compact />
    <footer className="nodrag"><button type="button" onClick={data.open ?? data.configure}>{data.kind === 'structure' ? 'Open structure' : 'Configure'}<ArrowRight size={12} /></button>{!ANALYSES.includes(data.kind as CalculationType) && <button aria-label={`Add after ${data.label}`} onClick={data.add}><Plus size={13} /></button>}</footer>
    <Handle type="source" position={Position.Right} aria-label={`${data.label} output`} />
  </section>;
}
const nodeTypes = { calculation: WorkflowNode };
const editable = (target: EventTarget | null) => target instanceof Element && !!target.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]');

export type DftWorkflowCanvasProps = {
  projectId: string; ownerId: string; theme: 'light' | 'dark'; document: WorkflowDocument; materials: WorkflowMaterial[]; jobs: CalculationJob[];
  outdatedNodeIds?: string[];
  canUndo: boolean; canRedo: boolean; busy?: boolean;
  onChange: (next: WorkflowDocument) => void; onUndo: () => void; onRedo: () => void;
  onAdd: (calculation: CalculationType, sourceId?: string) => void; onConfigure: (id: string) => void; onOpenStructure: (id: string) => void;
  onAddOperation: (kind: 'supercell' | 'surface_slab' | 'parameter_sweep' | 'dft_neb', sourceId?: string) => void;
  onImportStructure: () => void; onPaste: (data: WorkflowClipboard<WorkflowMaterial>, point: WorkflowPoint) => string[];
  onRun: (ids?: string[]) => void; onCancel: () => void;
};

function Canvas(props: DftWorkflowCanvasProps) {
  const { document, materials, jobs, projectId, ownerId, onChange, onConfigure, onOpenStructure, outdatedNodeIds } = props;
  const flow = useReactFlow<FlowNode, Edge>();
  const root = useRef<HTMLDivElement>(null), internalClipboard = useRef(''), pointer = useRef<WorkflowPoint | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [nodeEdits, setNodeEdits] = useState<{ key: string; nodes: FlowNode[] }>({ key: '', nodes: [] });
  const positionsKey = JSON.stringify(document.canvas.positions);
  const [message, setMessage] = useState(''), [help, setHelp] = useState(false), [menu, setMenu] = useState<{ x: number; y: number; source?: string } | null>(null);
  const [guides, setGuides] = useState<Array<{ x?: number; y?: number }>>([]);
  const dragBase = useRef<WorkflowDocument | null>(null), dragAnchor = useRef<WorkflowPoint | null>(null);
  const edges = useMemo(() => {
    const connections = workflowEdges(document.components, materials);
    const stale = staleWorkflowNodes(connections, props.outdatedNodeIds ?? []);
    return connections.map(edge => stale.has(edge.source) || stale.has(edge.target) ? { ...edge, className: 'dft-flow-edge-stale', style: { stroke: 'var(--status-warning, #d79021)', strokeDasharray: '7 5', strokeWidth: 2.5 }, ariaLabel: 'Outdated source data: rerun this dependency' } : edge);
  }, [document.components, materials, props.outdatedNodeIds]);
  const generatedPositions = useMemo(() => autoArrange(document.components, materials), [document.components, materials]);
  const latest = useRef(props); useEffect(() => { latest.current = props; });
  const addAtNode = useCallback((source: string) => {
    setMenu({ x: 12, y: 70, source });
  }, []);
  const projectedNodes = useMemo(() => {
    const next: FlowNode[] = [];
    for (const material of materials) {
      if (document.canvas.hiddenStructures.includes(material.id)) continue;
      const id = structureNodeId(material.id);
      next.push({ id, type: 'calculation', position: document.canvas.positions[id] ?? generatedPositions[id], data: { label: material.name, detail: 'Project structure', kind: 'structure', configure: () => onOpenStructure(material.id), open: () => onOpenStructure(material.id), add: () => addAtNode(id) } });
    }
    for (const c of document.components) {
      const job = jobs.find(j => j.componentId === c.id);
      const missing = !edges.some(e => e.target === c.id);
      let status: string = job?.status ?? 'Ready';
      if (job?.status === 'Queued' && c.scfSourceId) status = 'Waiting for SCF';
      if (job?.resultDetail?.includes('Reusing SCF')) status = job.status === 'Completed' ? 'Completed' : 'Reusing SCF';
      if (staleWorkflowNodes(edges, outdatedNodeIds ?? []).has(c.id)) status = 'Outdated';
      if (missing) status = 'Blocked';
      next.push({ id: c.id, type: 'calculation', position: document.canvas.positions[c.id] ?? generatedPositions[c.id], data: { label: c.name, detail: materials.find(m => m.id === c.materialId)?.name ?? 'Missing structure', kind: c.geometry?.kind ?? (c.sweep ? 'parameter_sweep' : c.neb ? 'dft_neb' : c.calculation === 'Total energy' ? 'SCF' : c.calculation),
        status, scfConvergence: job?.status === 'Running' ? job.scfConvergence : undefined, error: missing ? `Connect ${ANALYSES.includes(c.calculation) ? 'SCF' : 'structure'} input` : undefined, configure: () => onConfigure(c.id), add: () => addAtNode(c.id) } });
    }
    return next;
  }, [document, generatedPositions, materials, edges, jobs, addAtNode, onConfigure, onOpenStructure, outdatedNodeIds]);
  // Domain/job data is derived directly. Only temporary drag/measurement changes
  // live in view state; polling cannot reset an in-progress drag or edit history.
  const nodes = useMemo(() => {
    const edits = new Map((nodeEdits.key === positionsKey ? nodeEdits.nodes : []).map(node => [node.id, node]));
    return projectedNodes.map(node => ({ ...node, position: edits.get(node.id)?.position ?? node.position, measured: edits.get(node.id)?.measured, selected: selected.includes(node.id) }));
  }, [projectedNodes, nodeEdits, positionsKey, selected]);
  const onSelectionChange = useCallback(({ nodes }: { nodes: FlowNode[] }) => {
    const ids = nodes.map(node => node.id);
    setSelected(current => current.length === ids.length && current.every((id, i) => id === ids[i]) ? current : ids);
  }, []);
  const setNodes = (update: FlowNode[] | ((current: FlowNode[]) => FlowNode[])) => setNodeEdits({ key: positionsKey, nodes: typeof update === 'function' ? update(nodes) : update });
  const viewportKey = `phynite:dft-flow-viewport:${ownerId}:${projectId}`;
  const attempt = (action: () => void) => { try { action(); setMessage(''); } catch (error) { setMessage(error instanceof Error ? error.message : 'Workflow action failed.'); } };
  const deleteSelection = () => onChange(removeWorkflowNodes(document, selected));
  const copyText = () => copyWorkflow(document, materials, selected, projectId);
  const pasteText = (text: string) => attempt(() => {
    const bounds = root.current?.getBoundingClientRect();
    const position = flow.screenToFlowPosition(pointer.current ?? { x: (bounds?.left ?? 0) + (bounds?.width ?? 800) / 2, y: (bounds?.top ?? 0) + (bounds?.height ?? 500) / 2 });
    setSelected(props.onPaste(parseWorkflowClipboard(text), position));
  });
  const clipboard = async (kind: 'copy' | 'cut' | 'paste') => {
    if (kind === 'paste') {
      try { pasteText(await navigator.clipboard.readText()); }
      catch { if (internalClipboard.current) { pasteText(internalClipboard.current); setMessage('System clipboard unavailable; pasted the copy from this tab.'); } else setMessage('Clipboard access was denied. Focus the canvas and use Ctrl/Cmd+V.'); }
      return;
    }
    if (!selected.length) return;
    const text = copyText(); internalClipboard.current = text;
    try { await navigator.clipboard.writeText(text); if (kind === 'cut') deleteSelection(); setMessage(kind === 'cut' ? 'Selection cut.' : 'Selection copied.'); }
    catch { setMessage('System clipboard access was denied. A copy is available in this tab; the selection was kept.'); }
  };
  const nativeCopy = (event: ClipboardEvent, cut = false) => {
    if (editable(event.target) || !selected.length) return;
    event.preventDefault(); event.stopPropagation();
    const text = copyText(); event.clipboardData.setData('text/plain', text); internalClipboard.current = text;
    if (cut) deleteSelection();
  };
  const positions = () => Object.fromEntries(nodes.map(n => [n.id, n.position]));
  const commitPositions = (next: Record<string, WorkflowPoint>) => onChange({ ...document, canvas: { ...document.canvas, positions: { ...document.canvas.positions, ...positions(), ...next } } });
  const align = (axis: 'x' | 'y', distribute = false) => {
    const own = nodes.filter(n => selected.includes(n.id)).sort((a, b) => a.position[axis] - b.position[axis]);
    if (own.length < (distribute ? 3 : 2)) return;
    const min = own[0].position[axis], max = own.at(-1)!.position[axis];
    commitPositions(Object.fromEntries(own.map((n, i) => [n.id, { ...n.position, [axis]: distribute ? min + (max - min) * i / (own.length - 1) : min }])));
  };
  const configure = selected.length === 1 ? document.components.find(c => c.id === selected[0]) : undefined;
  return <div ref={root} className="dft-workflow" tabIndex={0} aria-label="DFT workflow canvas" onPointerMove={e => { pointer.current = { x: e.clientX, y: e.clientY }; }}
    onCopy={e => nativeCopy(e)} onCut={e => nativeCopy(e, true)} onPaste={e => { if (!editable(e.target)) { e.preventDefault(); e.stopPropagation(); pasteText(e.clipboardData.getData('text/plain')); } }}
    onKeyDown={e => {
      if (editable(e.target)) return;
      const key = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
      if (mod && ['z', 'y', 'd', 'a'].includes(key)) {
        e.preventDefault(); e.stopPropagation();
        if (key === 'z') { if (e.shiftKey) props.onRedo(); else props.onUndo(); }
        if (key === 'y') props.onRedo();
        if (key === 'a') { setSelected(nodes.map(n => n.id)); setNodes(nodes.map(n => ({ ...n, selected: true }))); }
        if (key === 'd' && selected.length) pasteText(copyText());
      } else if (['Delete', 'Backspace'].includes(e.key)) { e.preventDefault(); e.stopPropagation(); deleteSelection(); }
      else if (e.key.startsWith('Arrow') && selected.length) {
        e.preventDefault(); e.stopPropagation(); const amount = e.shiftKey ? 16 : 1;
        commitPositions(Object.fromEntries(nodes.filter(n => selected.includes(n.id)).map(n => [n.id, { x: n.position.x + (e.key === 'ArrowRight' ? amount : e.key === 'ArrowLeft' ? -amount : 0), y: n.position.y + (e.key === 'ArrowDown' ? amount : e.key === 'ArrowUp' ? -amount : 0) }])));
      } else if (e.key === '0') { e.preventDefault(); void flow.fitView({ padding: .2 }); }
      else if (e.key === '?') setHelp(v => !v);
      else if (e.key === 'Escape') { setMenu(null); setHelp(false); setSelected([]); setNodes(current => current.map(n => ({ ...n, selected: false }))); }
    }}>
    <div className="dft-flow-toolbar" role="toolbar" aria-label="Workflow tools">
      <button onClick={() => setMenu(menu ? null : { x: 12, y: 48 })}><Plus size={14} />Add</button>
      <span />
      <button aria-label="Undo workflow edit" disabled={!props.canUndo} onClick={props.onUndo}><Undo2 size={14} /></button><button aria-label="Redo workflow edit" disabled={!props.canRedo} onClick={props.onRedo}><Redo2 size={14} /></button>
      <button aria-label="Cut workflow selection" disabled={!selected.length} onClick={() => void clipboard('cut')}><Scissors size={14} /></button><button aria-label="Copy workflow selection" disabled={!selected.length} onClick={() => void clipboard('copy')}><Copy size={14} /></button><button aria-label="Paste workflow" onClick={() => void clipboard('paste')}><ClipboardPaste size={14} /></button>
      <button aria-label="Delete workflow selection" disabled={!selected.length} onClick={deleteSelection}><Trash2 size={14} /></button>
      <span />
      <button aria-label="Align left" disabled={selected.length < 2} onClick={() => align('x')}><AlignHorizontalJustifyStart size={14} /></button><button aria-label="Align top" disabled={selected.length < 2} onClick={() => align('y')}><AlignVerticalJustifyStart size={14} /></button><button aria-label="Distribute horizontally" disabled={selected.length < 3} onClick={() => align('x', true)}><Columns3 size={14} /></button><button aria-label="Distribute vertically" disabled={selected.length < 3} onClick={() => align('y', true)}>↕</button>
      <button onClick={() => { commitPositions(autoArrange(document.components, materials)); void flow.fitView({ padding: .2 }); }}><LayoutGrid size={14} /><span>Auto arrange</span></button>
      <label><input type="checkbox" checked={document.canvas.grid} onChange={e => onChange({ ...document, canvas: { ...document.canvas, grid: e.target.checked } })} />Grid</label><label><input type="checkbox" checked={document.canvas.guides} onChange={e => onChange({ ...document, canvas: { ...document.canvas, guides: e.target.checked } })} />Guides</label>
      <button aria-label="Workflow keyboard shortcuts" onClick={() => setHelp(v => !v)}><Keyboard size={14} /></button>
      <button className="dft-flow-run" disabled={props.busy || !document.components.length} onClick={() => props.onRun()}><Play size={13} />Run workflow</button>
      {props.busy && <button onClick={props.onCancel}>Cancel run</button>}
    </div>
    {message && <div className="dft-flow-notice" role="status">{message}<button aria-label="Dismiss workflow notice" onClick={() => setMessage('')}><X size={13} /></button></div>}
    <ReactFlow<FlowNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} colorMode={props.theme} fitView minZoom={.15} maxZoom={3} deleteKeyCode={null} disableKeyboardA11y selectionOnDrag selectionMode={'partial' as import('@xyflow/react').SelectionMode} multiSelectionKeyCode={['Meta', 'Control', 'Shift']} panOnDrag={[1]} panOnScroll zoomOnScroll={false} zoomOnDoubleClick={false} panActivationKeyCode="Space" connectOnClick
      onInit={instance => { try { const saved = JSON.parse(localStorage.getItem(viewportKey) ?? 'null'); if (saved && [saved.x, saved.y, saved.zoom].every(Number.isFinite)) void instance.setViewport(saved); } catch {} }}
      onMoveEnd={(_, viewport) => { try { localStorage.setItem(viewportKey, JSON.stringify(viewport)); } catch {} }}
      onNodesChange={changes => {
        setNodes(current => applyNodeChanges(changes, current));
        const selectionChanges = changes.filter(change => change.type === 'select');
        if (selectionChanges.length) setSelected(current => {
          const next = new Set(current);
          for (const change of selectionChanges) { if (change.selected) next.add(change.id); else next.delete(change.id); }
          return [...next];
        });
      }}
      onSelectionChange={onSelectionChange}
      onNodeDragStart={(_, node) => { dragBase.current = document; dragAnchor.current = node.position; }}
      onNodeDrag={(event, node, dragged) => {
        if (event.altKey) { setGuides([]); return; }
        const own = new Set(dragged.map(n => n.id)); own.add(node.id);
        const snapped = snapWorkflowPoint(node.position, { width: 240, height: node.measured?.height ?? 120 }, nodes.filter(n => !own.has(n.id)).map(n => ({ ...n.position, width: 240, height: n.measured?.height ?? 120 })), flow.getZoom(), document.canvas.grid, document.canvas.guides);
        const dx = snapped.point.x - node.position.x, dy = snapped.point.y - node.position.y;
        setGuides(snapped.lines); setNodes(current => current.map(n => own.has(n.id) ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } } : n));
      }}
      onNodeDragStop={() => { setGuides([]); commitPositions(positions()); dragBase.current = null; }}
      onConnect={edge => attempt(() => onChange(connectWorkflow(document, materials, edge.source, edge.target, edge.targetHandle)))}
      onEdgeDoubleClick={(_, edge) => onChange({ ...document, components: document.components.map(c => c.id !== edge.target ? c : c.neb && edge.targetHandle && edge.targetHandle !== 'initial' ? { ...c, neb: { ...c.neb, [edge.targetHandle === 'final' ? 'finalSourceId' : 'intermediateSourceId']: edge.targetHandle === 'final' ? 'unbound' : undefined } } : ANALYSES.includes(c.calculation) ? { ...c, scfSourceId: 'unbound' } : { ...c, structureSourceId: 'unbound' }) })}
      onNodeContextMenu={(event, node) => { event.preventDefault(); setSelected([node.id]); const rect = root.current!.getBoundingClientRect(); setMenu({ x: Math.min(event.clientX - rect.left, rect.width - 220), y: Math.min(event.clientY - rect.top, rect.height - 300), source: node.id }); }}
      onPaneContextMenu={event => { event.preventDefault(); const rect = root.current!.getBoundingClientRect(); setMenu({ x: Math.max(0, Math.min(event.clientX - rect.left, rect.width - 220)), y: Math.max(48, Math.min(event.clientY - rect.top, rect.height - 300)) }); }}
      onPaneClick={() => { setMenu(null); root.current?.focus(); }}>
      <Background gap={16} size={1} /><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor="var(--accent)" />
      {guides.map((line, i) => { const viewport = flow.getViewport(); return <div key={i} className="dft-flow-guide" style={line.x !== undefined ? { left: line.x * viewport.zoom + viewport.x, top: 0, bottom: 0, width: 1 } : { top: (line.y ?? 0) * viewport.zoom + viewport.y, left: 0, right: 0, height: line.y !== undefined ? 1 : 0 }} />; })}
    </ReactFlow>
    {!materials.length && <div className="dft-flow-empty"><h2>Start with a crystal structure</h2><p>Add a structure, connect an SCF, then branch into analyses.</p><button onClick={props.onImportStructure}>Import structure</button></div>}
    {configure && <div className="dft-flow-selection"><input aria-label="Workflow node name" value={configure.name} maxLength={100} onChange={e => onChange({ ...document, components: document.components.map(c => c.id === configure.id ? { ...c, name: e.target.value } : c) })} /><button onClick={() => props.onConfigure(configure.id)}><Settings2 size={14} />Configure</button><button disabled={props.busy} onClick={() => props.onRun([configure.id])}><Play size={13} />Run selection</button>
      {configure.calculation === 'Total energy' && <UiSelect label="SCF source" value={configure.scfReuse?.mode === 'selected' ? configure.scfReuse.calculationId : configure.scfReuse?.mode ?? 'auto'} options={[{ value: 'auto', label: 'Automatic reuse' }, { value: 'fresh', label: 'Run fresh' }, ...jobs.filter(j => j.calculationType === 'Total energy' && j.backendCalculationId && ['Queued', 'Running', 'Completed'].includes(j.status)).map(j => ({ value: j.backendCalculationId!, label: `${j.name} · ${j.status}` }))]} onChange={value => onChange({ ...document, components: document.components.map(c => c.id !== configure.id ? c : { ...c, scfReuse: value === 'auto' || value === 'fresh' ? { mode: value } : { mode: 'selected', calculationId: value } }) })} />}
    </div>}
    {menu && <div role="menu" aria-label="Workflow actions" className="dft-flow-menu" style={{ left: Math.max(4, menu.x), top: Math.max(48, menu.y) }}>
      <button role="menuitem" onClick={() => { props.onImportStructure(); setMenu(null); }}>Import structure</button>
      {(['supercell', 'surface_slab', 'parameter_sweep', 'dft_neb'] as const).map(kind => <button role="menuitem" key={kind} onClick={() => { props.onAddOperation(kind, menu.source); setMenu(null); }}>{kind}</button>)}
      {(['Structural relaxation', 'Total energy', ...ANALYSES] as CalculationType[]).map(kind => <button role="menuitem" key={kind} onClick={() => { props.onAdd(kind, menu.source); setMenu(null); }}>{kind === 'Total energy' ? 'SCF / Total energy' : kind}</button>)}
      {!!selected.length && <><hr /><button role="menuitem" onClick={() => { pasteText(copyText()); setMenu(null); }}>Duplicate selection</button><button role="menuitem" onClick={() => { void clipboard('copy'); setMenu(null); }}>Copy selection</button><button role="menuitem" onClick={() => { deleteSelection(); setMenu(null); }}>Delete selection</button></>}
      <button role="menuitem" onClick={() => { void clipboard('paste'); setMenu(null); }}>Paste</button>
    </div>}
    {help && <div role="dialog" aria-label="Workflow shortcuts" className="dft-flow-help"><button aria-label="Close shortcuts" onClick={() => setHelp(false)}><X size={15} /></button><h2>Workflow shortcuts</h2><dl><dt>Undo / Redo</dt><dd>Ctrl/Cmd Z / Shift Z · Ctrl Y</dd><dt>Cut / Copy / Paste</dt><dd>Ctrl/Cmd X / C / V</dd><dt>Duplicate / Select all</dt><dd>Ctrl/Cmd D / A</dd><dt>Delete</dt><dd>Delete / Backspace</dd><dt>Nudge</dt><dd>Arrow · Shift for 16 px</dd><dt>Pan / Zoom</dt><dd>Space + drag · Ctrl/Cmd + scroll</dd><dt>Fit / Close</dt><dd>0 / Escape</dd></dl><p>Alt temporarily disables snapping. Double-click a connection to disconnect it. Text fields keep native editing shortcuts. Editing never cancels submitted calculations.</p></div>}
  </div>;
}

export function DftWorkflowCanvas(props: DftWorkflowCanvasProps) { return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>; }
