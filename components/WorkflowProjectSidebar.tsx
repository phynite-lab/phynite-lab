'use client';
import { PhyniteAiIcon } from '@/app/tool-icons';

import { ChevronRight, NotebookPen, Folder, FolderOpen, MoreHorizontal, Search, SquarePen } from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from 'react';
import { useLocale } from '@/app/locale-provider';
import { workflowAiTab, workflowNotesTab } from '@/lib/workflow-editor-state';
import { workflowModuleTree } from '@/lib/workflow-navigation';
import type { ProjectWorkflow } from '@/lib/project-workflow';
import { useResearchShell } from './ResearchShellContext';

/** The project workspace only navigates its own real graph nodes. */
export function WorkflowProjectSidebar({ graph, projectName, activeTab, selectedNodeIds, statuses, onOpen, onNewTab, onAdd, onRuns, disabled = false }: {
  graph: ProjectWorkflow; projectName: string; activeTab: string; selectedNodeIds?: string[]; statuses: Record<string,string>;
  onOpen: (id:string)=>void; onNewTab:()=>void; onAdd:(event:MouseEvent<HTMLButtonElement>)=>void; onRuns:()=>void; disabled?:boolean;
}) {
  const { t }=useLocale(),shell=useResearchShell();
  const [collapsed,setCollapsed]=useState(false);
  const query=(shell?.projectQuery??'').trim().toLowerCase();
  const currentHref=`/projects/${encodeURIComponent(graph.projectId)}`;
  const current=shell?.projects.find(project=>project.href===currentHref);
  const pinned=shell?.preferences.pinnedProjectKeys??[];
  const [closedBranches, setClosedBranches] = useState<Set<string>>(new Set());
  const entries = useMemo(() => workflowModuleTree(graph), [graph]);
  const byId = new Map(entries.map(entry => [entry.node.id, entry]));
  const highlighted = useMemo(() => new Set(selectedNodeIds ?? [activeTab]), [selectedNodeIds, activeTab]);
  useEffect(() => {
    const parents = new Map(entries.map(entry => [entry.node.id, entry.parentId]));
    const ancestors = new Set<string>();
    if (!entries.some(entry => highlighted.has(entry.node.id))) return;
    for (const id of highlighted) {
      let parent = parents.get(id);
      while (parent && !ancestors.has(parent)) { ancestors.add(parent); parent = parents.get(parent); }
    }
    queueMicrotask(() => {
      setCollapsed(false);
      setClosedBranches(current => [...ancestors].some(id => current.has(id)) ? new Set([...current].filter(id => !ancestors.has(id))) : current);
    });
  }, [highlighted, entries]);
  const visible = new Set<string>();
  for (const entry of entries) {
    if (query && !entry.node.name.toLowerCase().includes(query)) continue;
    let cursor: typeof entry | undefined = entry;
    while (cursor && !visible.has(cursor.node.id)) { visible.add(cursor.node.id); cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined; }
  }
  const rows = entries.filter(entry => {
    if (!visible.has(entry.node.id)) return false;
    if (query) return true;
    let parent = entry.parentId;
    while (parent) { if (closedBranches.has(parent)) return false; parent = byId.get(parent)?.parentId; }
    return true;
  });
  const focusId = (rows.find(entry => highlighted.has(entry.node.id)) ?? rows[0])?.node.id;
  const toggleBranch = (id: string) => setClosedBranches(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const open=(id:string)=>{onOpen(id);shell?.closeMobileNavigation();};
  const currentGroup=<section className="workflow-project-group" key={graph.projectId}>
    <div className="workflow-project-folder">
      <button aria-expanded={!!query||!collapsed} aria-controls="workflow-project-children" title={projectName} onClick={()=>setCollapsed(value=>!value)}>{collapsed&&!query?<Folder size={18}/>:<FolderOpen size={18}/>}<span>{projectName}</span></button>
      <details className="workflow-project-menu" onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))event.currentTarget.removeAttribute('open');}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();event.currentTarget.removeAttribute('open');event.currentTarget.querySelector('summary')?.focus();}}}>
        <summary aria-label={t('Project actions','Aksi project')}><MoreHorizontal size={18}/></summary>
        <div role="menu" aria-label={t('Project actions','Aksi project')} onClick={event=>(event.currentTarget.closest('details') as HTMLDetailsElement).open=false}>
          <button disabled={disabled} role="menuitem" onClick={()=>open(workflowAiTab)}><PhyniteAiIcon size={16}/>Phynite AI</button><button disabled={disabled} role="menuitem" onClick={onAdd}>{t('Add module','Tambah modul')}</button>
          <button disabled={disabled} role="menuitem" onClick={()=>{onRuns();shell?.closeMobileNavigation();}}>{t('Run history','Histori eksekusi')}</button>
          {current&&<button role="menuitem" onClick={()=>shell?.changePreferences({type:'project',key:current.key,pinned:!pinned.includes(current.key)})}>{pinned.includes(current.key)?t('Unpin project','Lepas pin project'):t('Pin project','Pin project')}</button>}
        </div>
      </details>
    </div>
    <div id="workflow-project-children" className="workflow-project-children" hidden={!query&&collapsed}>
      <button type="button" className="workflow-project-link" aria-current={activeTab === workflowNotesTab ? 'page' : undefined} disabled={disabled} onClick={()=>open(workflowNotesTab)}><NotebookPen size={16}/>{t('Notes','Catatan')}</button>
      <div role="tree" aria-label={t('Modules', 'Modul')} aria-multiselectable="true" onKeyDown={event => {
        if (disabled || (event.target as Element).closest('.workflow-branch-toggle')) return;
        const target = (event.target as Element).closest<HTMLElement>('[role="treeitem"]');
        const entry = byId.get(target?.dataset.nodeId ?? '');
        if (!target || !entry || !['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]'));
        const index = items.indexOf(target);
        if (event.key === 'Enter' || event.key === ' ') open(entry.node.id);
        else if (event.key === 'ArrowRight') { if (closedBranches.has(entry.node.id)) toggleBranch(entry.node.id); else if (entry.childIds.length) items[index + 1]?.focus(); }
        else if (event.key === 'ArrowLeft') { if (entry.childIds.length && !closedBranches.has(entry.node.id) && !query) toggleBranch(entry.node.id); else items.find(item => item.dataset.nodeId === entry.parentId)?.focus(); }
        else items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
      }}>
        {rows.map(entry => <div key={entry.node.id} className="workflow-module-tree-row" role="treeitem" data-node-id={entry.node.id} data-parent-id={entry.parentId} aria-level={entry.depth + 1} aria-expanded={entry.childIds.length ? !!query || !closedBranches.has(entry.node.id) : undefined} aria-selected={highlighted.has(entry.node.id)} tabIndex={!disabled && entry.node.id === focusId ? 0 : -1} style={{ '--module-depth': Math.min(entry.depth, 7) } as CSSProperties}>
          {entry.childIds.length ? <button type="button" className="workflow-branch-toggle" tabIndex={-1} disabled={disabled} aria-label={closedBranches.has(entry.node.id) && !query ? t(`Expand ${entry.node.name}`, `Buka ${entry.node.name}`) : t(`Collapse ${entry.node.name}`, `Lipat ${entry.node.name}`)} onClick={() => toggleBranch(entry.node.id)}><ChevronRight size={13} /></button> : <span className="workflow-branch-spacer" />}
          <button type="button" tabIndex={-1} disabled={disabled} className="workflow-module-open" aria-label={entry.node.name} aria-current={activeTab === entry.node.id ? 'page' : undefined} title={[entry.node.name, ...entry.additionalInputs.map(id => `${t('Also connected to', 'Juga terhubung ke')} ${byId.get(id)?.node.name ?? id}`)].join(' · ')} onClick={() => open(entry.node.id)}><span>{entry.node.name}</span>{!!entry.additionalInputs.length && <small aria-label={t(`${entry.additionalInputs.length} additional inputs`, `${entry.additionalInputs.length} input tambahan`)}>+{entry.additionalInputs.length}</small>}{['running','queued','failed','blocked'].includes(statuses[entry.node.id]) && <small>{statuses[entry.node.id]}</small>}</button>
        </div>)}
      </div>
      {!!query && !rows.length && <p>{t('No matching modules.','Tidak ada modul yang cocok.')}</p>}

    </div>
  </section>;
  return <div className="workflow-project-sidebar" aria-busy={disabled}>
    <div className="workflow-sidebar-primary"><button disabled={disabled} aria-label={t('Open new tab','Buka tab baru')} onClick={onNewTab}><SquarePen size={18}/><span>{t('New tab','Tab baru')}</span></button></div>
    {shell?.projectSearchOpen&&<label id="workflow-project-search" className="workflow-project-search"><Search size={18}/><input autoFocus type="search" aria-label={t('Search modules','Cari modul')} placeholder={t('Search modules','Cari modul')} value={shell.projectQuery} onChange={event=>shell.setProjectQuery(event.target.value)} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(shell.projectQuery)shell.setProjectQuery('');else shell.closeSidebarSearch();}}}/></label>}
    <nav className="workflow-project-tree" aria-label={t('Project modules','Modul project')}>
      {currentGroup}
    </nav>
  </div>;
}
