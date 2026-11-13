'use client';
import { PhyniteAiIcon } from '@/app/tool-icons';
import { useState } from 'react';
import { NotebookPen as BookOpen, Atom, Box, ChartNoAxesCombined, ChevronRight, FileInput, FlaskConical, History, LayoutGrid, Plus, Search, Waves, type LucideIcon } from 'lucide-react';
import { useLocale } from '@/app/locale-provider';
import { workflowModules, type WorkflowNode } from '@/lib/project-workflow';
import { workflowAiTab, workflowStudyTab, workflowNotesTab } from '@/lib/workflow-editor-state';
import type { AiConversation } from '@/lib/ai-contract';
import type { ReactNode, MouseEvent } from 'react';
export const workflowModuleSections: {en:string;id:string;kinds:WorkflowNode['kind'][]}[] = [
  {en:'Inputs',id:'Input',kinds:['structure','trajectory']},
  {en:'DFT',id:'DFT',kinds:['relax','scf','bands','dos','phonon','btp2']},
  {en:'Molecular dynamics',id:'Dinamika molekuler',kinds:['md','md-analysis','extract-frame']},
  {en:'Figures',id:'Figure',kinds:['figure']},
];
export function WorkflowModuleIcon({kind,size=18}:{kind:WorkflowNode['kind'];size?:number}) {
  const Icon:LucideIcon=kind==='structure'?Box:kind==='trajectory'?FileInput:['md','md-analysis','extract-frame'].includes(kind)?Waves:['scf','relax','phonon'].includes(kind)?Atom:ChartNoAxesCombined;
  return <Icon size={size} aria-hidden="true"/>;
}
export function WorkflowStartTab({nodes,onOpen,onAdd,onCanvas,onRuns,onNewAiChat,conversations=[],children}:{nodes:WorkflowNode[];onOpen:(id:string)=>void;onAdd:(event:MouseEvent<HTMLButtonElement>)=>void;onCanvas:()=>void;onRuns:()=>void;onNewAiChat?:()=>void;conversations?:AiConversation[];children:ReactNode}) {
  const {t}=useLocale(),[query,setQuery]=useState('');
  const matches=(name:string)=>name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const existing=nodes.filter(node=>matches(`${node.name} ${t(workflowModules[node.kind].en,workflowModules[node.kind].id)}`));
  const sections=[...workflowModuleSections,{en:'Legacy',id:'Legacy',kinds:['legacy'] as WorkflowNode['kind'][]}].map(section=>({...section,nodes:existing.filter(node=>section.kinds.includes(node.kind))})).filter(section=>section.nodes.length);
  return <section className="workflow-start-tab" role="tabpanel" aria-label={t('New tab','Tab baru')}><div className="workflow-start-content">
    <label className="workflow-start-search"><Search size={18}/><input autoFocus type="search" aria-label={t('Find module','Cari modul')} placeholder={t('Search modules in this project…','Cari modul dalam project ini…')} value={query} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();onCanvas();}}} onChange={event=>setQuery(event.target.value)}/><kbd>Esc</kbd></label>
    {!query&&<nav className="workflow-start-shortcuts" aria-label={t('Project tools','Tool project')}><button onClick={onCanvas}><LayoutGrid size={18}/><span>{t('Canvas','Kanvas')}</span><ChevronRight size={16}/></button><button onClick={()=>onNewAiChat?onNewAiChat():onOpen(workflowAiTab)}><PhyniteAiIcon size={18}/><span>{t('New AI chat','Chat AI baru')}</span><ChevronRight size={16}/></button><button onClick={()=>onOpen(workflowStudyTab)}><FlaskConical size={18}/><span>{t('Parameter study','Studi parameter')}</span><ChevronRight size={16}/></button><button onClick={()=>onOpen(workflowNotesTab)}><BookOpen size={18}/><span>{t('Notes','Catatan')}</span><ChevronRight size={16}/></button><button onClick={onRuns}><History size={18}/><span>{t('Run history','Histori eksekusi')}</span><ChevronRight size={16}/></button></nav>}
    <section className="workflow-start-existing"><header><h2>{t('In this project','Dalam project ini')} <small>{nodes.length}</small></h2><button onClick={onAdd}><Plus size={16}/>{t('Add module','Tambah modul')}</button></header>
      {!!sections.length&&<div className="workflow-start-module-groups">{sections.map(section=><section key={section.en}><h3>{t(section.en,section.id)}</h3><div>{section.nodes.map(node=><button key={node.id} aria-label={`${node.name} ${t('Open','Buka')}`} onClick={()=>onOpen(node.id)}><WorkflowModuleIcon kind={node.kind}/><span>{node.name}<small>{t(workflowModules[node.kind].en,workflowModules[node.kind].id)}</small></span><ChevronRight size={16}/></button>)}</div></section>)}</div>}
      {!existing.length&&<p className="workflow-start-empty">{nodes.length?t('No matching modules in this project.','Tidak ada modul yang cocok dalam project ini.'):t('No modules on this canvas yet. Add a module to open it here.','Belum ada modul di kanvas ini. Tambahkan modul untuk membukanya di sini.')}</p>}
    </section>
    {!!conversations.filter(chat=>matches(chat.title)).length&&<section className="workflow-start-existing workflow-start-chats"><header><h2>{t('AI conversations','Percakapan AI')}</h2></header><div className="workflow-start-module-groups"><section><div>{conversations.filter(chat=>matches(chat.title)).map(chat=><button key={chat.id} onClick={()=>onOpen(`tool:ai:${chat.id}`)}><PhyniteAiIcon size={18}/><span>{chat.title}<small>{new Date(chat.updatedAt||chat.createdAt).toLocaleDateString()}</small></span><ChevronRight size={16}/></button>)}</div></section></div></section>}
    {children}
  </div></section>;
}
