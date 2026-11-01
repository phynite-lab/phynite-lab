import type { ProjectWorkflow } from './project-workflow.ts';
export type DraftInput = { id:string; kind:'structure'|'trajectory'; filename:string; sha256:string; bytes:string };
export type WorkflowDraftBundle = { format:'phynite-workflow-draft'; version:1; name:string; workflow:ProjectWorkflow; inputs:DraftInput[]; missingInputs:Array<{nodeId:string;id:string;kind:string;reason:string}> };
/** A portable draft never carries execution evidence, remote credentials or live output bindings. */
export function portableWorkflow(graph:ProjectWorkflow):ProjectWorkflow {
  const next=structuredClone(graph);
  for(const node of next.nodes) {
    delete node.legacy;
    for(const key of ['legacySource','preservedHistory','savedStructureSignature','configurationError','pseudopotentials','pseudopotentialChecksums']) delete node.configuration[key];
    if(node.kind==='md-analysis' && node.configuration.execution && typeof node.configuration.execution==='object') {
      const source=node.configuration.execution as Record<string,unknown>;
      node.configuration.execution=Object.fromEntries(Object.entries(source).filter(([key])=>['pipeline','name','computeTarget'].includes(key)));
    } else delete node.configuration.execution;
    if(node.kind==='figure') node.configuration={style:node.configuration.style ?? {}};
  }
  return next;
}
export async function draftInput(id:string,kind:DraftInput['kind'],filename:string,blob:Blob):Promise<DraftInput> {
  if(blob.size>48*1024**2) throw new Error('Draft inputs support up to 48 MiB. Import larger files separately.');
  const bytes=new Uint8Array(await blob.arrayBuffer()), digest=await crypto.subtle.digest('SHA-256',bytes);
  let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return {id,kind,filename,sha256:Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join(''),bytes:btoa(binary)};
}
