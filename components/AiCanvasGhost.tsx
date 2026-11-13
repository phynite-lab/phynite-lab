'use client';
import { useEffect, useState } from 'react';
import { ViewportPortal, getBezierPath, Position } from '@xyflow/react';
import { canvasPreviewCurrent, canvasPreviewChanges, layoutNodeSize, type AiCanvasPreview } from '@/lib/workflow-auto-layout';
import type { ProjectWorkflow } from '@/lib/project-workflow';
import type { CanvasMeasurements } from '@/lib/workflow-canvas';
import { projectWorkflowApi } from '@/lib/project-workflow-api';

/** Render-only SVG in flow coordinates. It cannot select, drag, connect or mutate the graph. */
export function AiCanvasGhost({ preview, graph, revision, sizes, onCancel }: { preview: AiCanvasPreview; graph: ProjectWorkflow; revision: number; sizes: CanvasMeasurements; onCancel: () => void }) {
  const [verified, setVerified] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const [reply, saved] = await Promise.all([fetch(`/api/ai/conversations/${encodeURIComponent(preview.conversationId)}/actions/${encodeURIComponent(preview.actionId)}`, { cache: 'no-store', signal: controller.signal }), projectWorkflowApi.get(graph.projectId)]);
        const data = await reply.json() as { action?: { status: string; payloadHash: string } };
        if (controller.signal.aborted) return;
        if (!reply.ok || data.action?.status !== 'pending' || data.action.payloadHash !== preview.payloadHash || saved.revision !== preview.baseRevision || Date.now() >= preview.expiresAt * 1000) onCancel();
        else setVerified(true);
      } catch { if (!controller.signal.aborted) onCancel(); }
      finally { checking = false; }
    };
    void check();
    const timer = setInterval(() => void check(), 1000), expiry = setTimeout(onCancel, Math.max(0, Math.min(2147483647, preview.expiresAt * 1000 - Date.now())));
    return () => { controller.abort(); clearInterval(timer); clearTimeout(expiry); };
  }, [preview, graph.projectId, onCancel]);
  if (!verified || !canvasPreviewCurrent(preview, graph, revision)) return null;
  const changed = canvasPreviewChanges(graph, preview.workflow);
  const draw = (workflow: ProjectWorkflow, color: string, before: boolean) => <g stroke={color} fill={color} opacity={before ? .45 : .85}>
    {workflow.groups.filter(group => changed.groups.has(group.id)).map(group => {
      const nodes = workflow.nodes.filter(node => group.nodeIds.includes(node.id)), x = Math.min(...nodes.map(node => node.position.x)) - 20, y = Math.min(...nodes.map(node => node.position.y)) - 40;
      return <g key={group.id}><rect x={x} y={y} width={Math.max(...nodes.map(node => node.position.x + (sizes[node.id] ?? layoutNodeSize).width)) - x + 20} height={Math.max(...nodes.map(node => node.position.y + (sizes[node.id] ?? layoutNodeSize).height)) - y + 20} rx={10} fillOpacity={.04} strokeDasharray="4 5" /><text x={x + 12} y={y + 20} stroke="none" fontSize={12}>{before ? '−' : '+'} {group.name}</text></g>;
    })}
    {workflow.edges.filter(edge => changed.edges.has(edge.id)).map(edge => {
      const source = workflow.nodes.find(node => node.id === edge.source)!, target = workflow.nodes.find(node => node.id === edge.target)!, size = sizes[source.id] ?? layoutNodeSize, targetSize = sizes[target.id] ?? layoutNodeSize;
      const [path] = getBezierPath({ sourceX: source.position.x + size.width, sourceY: source.position.y + size.height / 2, sourcePosition: Position.Right, targetX: target.position.x, targetY: target.position.y + targetSize.height / 2, targetPosition: Position.Left });
      return <path key={edge.id} data-ghost-edge={edge.id} data-before={before} d={path} fill="none" strokeWidth={3} strokeDasharray="8 5" />;
    })}
    {workflow.nodes.filter(node => changed.nodes.has(node.id)).map(node => <g key={node.id} data-ghost-node={node.id} data-before={before} transform={`translate(${node.position.x},${node.position.y})`}><rect {...(sizes[node.id] ?? layoutNodeSize)} rx={8} fillOpacity={.12} strokeWidth={2} strokeDasharray="8 5" /><text x={12} y={25} stroke="none" fontSize={12}>{before ? '−' : '+'} {node.name}</text></g>)}
  </g>;
  return <ViewportPortal><svg className="workflow-ai-ghost" aria-hidden="true" data-preview-hash={preview.payloadHash} style={{ position: 'absolute', top: 0, left: 0, width: 1, height: 1, overflow: 'visible', pointerEvents: 'none', zIndex: 10 }}>{draw(graph, '#bd5050', true)}{draw(preview.workflow, '#34866a', false)}</svg></ViewportPortal>;
}
