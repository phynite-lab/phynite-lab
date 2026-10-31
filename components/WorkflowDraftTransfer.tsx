'use client';
import {useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {useLocale} from '@/app/locale-provider';
import {projectWorkflowApi} from '@/lib/project-workflow-api';
import {createMdCloudStorageClient,createSameOriginMdCloudTransport} from '@/lib/md-cloud-api';
import {downloadMdCloudFile} from '@/lib/md-cloud-download';
import {listMdTrajectories} from '@/lib/md-workspace';
import {draftInput,portableWorkflow,type WorkflowDraftBundle} from '@/lib/workflow-draft-bundle';
import type {ProjectWorkflow} from '@/lib/project-workflow';
export function WorkflowDraftTransfer({graph,owner,name,onError}:{graph:ProjectWorkflow;owner:string;name:string;onError:(error:string)=>void}) {
  const {t}=useLocale(),router=useRouter(),input=useRef<HTMLInputElement>(null),[busy,setBusy]=useState(false);
  const exportDraft=async()=>{
    setBusy(true);
    try {
      const workflow=portableWorkflow(graph),bundle:WorkflowDraftBundle={format:'phynite-workflow-draft',version:1,name:name||'Imported project',workflow,inputs:[],missingInputs:[]};
      const records=await listMdTrajectories(owner),seen=new Map<string,Awaited<ReturnType<typeof draftInput>>>();
      const cloud=createMdCloudStorageClient({transport:createSameOriginMdCloudTransport()});
      let total=0;
      for(const node of workflow.nodes) {
        const original=graph.nodes.find(item=>item.id===node.id)!;
        const missing:Array<{id:string;kind:string;reason:string}>=[];
        for(const ref of node.resources) {
          try {
            const key=`${ref.kind}:${ref.id}`;
            let saved=seen.get(key);
            if(!saved) {
              let blob:Blob,filename:string;
              if(ref.kind==='structure') {
                const source=await projectWorkflowApi.input(graph.projectId,ref.id);
                blob=new Blob([source.structure?JSON.stringify(source.structure):source.text??'']);filename=source.structure?'structure.json':source.filename;
              } else if(ref.kind==='trajectory') {
                const device=records.find(record=>record.id===ref.id&&record.owner===owner&&(record.cloud?.projectId??record.projectId)===graph.projectId);
                if(device){blob=device.file;filename=device.sourceFilename??device.name;}
                else {const source=await cloud.getTrajectory(ref.id);if(source.trajectory.projectId!==graph.projectId||!source.downloadUrl)throw new Error('Input is unavailable.');blob=await downloadMdCloudFile(source.downloadUrl);filename=source.trajectory.filename;}
              } else throw new Error(t('Import this verified potential separately in the local project.','Impor potensial terverifikasi ini secara terpisah di project lokal.'));
              total+=blob.size;if(total>48*1024**2)throw new Error('Bundle exceeds 48 MiB.');
              saved=await draftInput(ref.id,ref.kind,filename,blob);seen.set(key,saved);bundle.inputs.push(saved);
            }
            ref.sha256=saved.sha256;
          } catch(error){missing.push({id:ref.id,kind:ref.kind,reason:(error as Error).message});}
        }
        for(const filename of Object.keys((original.configuration.pseudopotentials??{}) as object))missing.push({id:filename,kind:'pseudopotential',reason:t('Select a verified local pseudopotential.','Pilih pseudopotensial lokal terverifikasi.')});
        if(missing.length)node.configuration.missingInputs=[...((node.configuration.missingInputs??[]) as typeof missing),...missing];
        bundle.missingInputs.push(...missing.map(item=>({nodeId:node.id,...item})));
      }
      const blob=new Blob([JSON.stringify(bundle)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='phynite-workflow-draft.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      if(bundle.missingInputs.length)onError(t(`${bundle.missingInputs.length} inputs need attention after import.`,`${bundle.missingInputs.length} input perlu diperbaiki setelah impor.`));
    }catch(error){onError((error as Error).message);}finally{setBusy(false);}
  };
  return <div className="workflow-draft-transfer"><button disabled={busy} onClick={()=>void exportDraft()}>{t('Export draft for local environment','Ekspor draft untuk lingkungan lokal')}</button><button disabled={busy} onClick={()=>input.current?.click()}>{t('Import draft','Impor draft')}</button><input ref={input} type="file" hidden accept=".json,application/json" aria-label="Import workflow draft" onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;setBusy(true);void(async()=>{
    if(file.size>68*1024**2)throw new Error('Draft bundle exceeds 68 MiB.');
    const response=await fetch('/api/phynite/v1/local-workflow-import',{method:'POST',headers:{'Content-Type':'application/json'},body:await file.text()});
    const result=await response.json() as {project:{id:string};error?:string};if(!response.ok)throw new Error(response.status===404?t('Open 127.0.0.1:3001 to import this draft into the local environment.','Buka 127.0.0.1:3001 untuk mengimpor draft ke lingkungan lokal.'):result.error||'Import failed.');
    router.push(`/projects/${encodeURIComponent(result.project.id)}`);
  })().catch(error=>onError(error.message)).finally(()=>setBusy(false));}}/></div>;
}
