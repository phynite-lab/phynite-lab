'use client';
import { WorkspaceLoading } from '@/components/WorkspaceLoading';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArchiveRestore, ArrowRight, Clock3, Copy, FolderOpen, FolderTree, MoreHorizontal, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { useCalculationWorkspace } from '../use-calculation-workspace';
import { useInitialAnchor } from '../use-initial-anchor';
import { useSession } from '../use-session';
import { StudioMobileHeader } from '../lab-header';
import { useWorkspaceCloudSync } from '../use-workspace-cloud-sync';
import { StudioNavigation } from '../studio-navigation';
import { WorkspaceHome } from '@/components/WorkspaceHome';
import { useResearchShell } from '@/components/ResearchShellContext';
import { useSearchParams } from 'next/navigation';
import { useLocale } from '../locale-provider';
import { deleteWorkspaceProject, duplicateWorkspaceProject, emptyCalculationWorkspaceSummary, forceDeleteWorkspaceProject, purgeExpiredWorkspaceProjects, removeDeletedCloudProject, restoreWorkspaceProject, updateWorkspaceProject, type CalculationProjectSummary, type CalculationTrashProjectSummary } from '@/lib/workspace-storage';
import { phyniteProjects, type PhyniteProject } from '@/lib/phynite-api';
import { listMdTrajectories, mdLastActiveKey, removeMdTrajectory } from '@/lib/md-workspace';
import { mergeStudioProjects, projectCreateRequest } from '@/lib/project-navigation';
import { ProjectFilesExplorer, type ProjectFilesTarget } from '@/components/ProjectFilesExplorer';
import { WorkspaceResources } from '@/components/WorkspaceResources';

type WorkspaceProjectEntry = {
  key: string;
  primaryFormula?: string;
  id: string;
  kind: 'dft' | 'md';
  name: string;
  description: string;
  primaryStructure: CalculationProjectSummary['primaryStructure'];
  structureCount: number;
  assetCount: number;
  runCount: number;
  runningCount: number;
  activityState: CalculationProjectSummary['activityState'];
  activityLabel: string;
  updatedAt: string;
  href: string;
  tags: Array<'QE' | 'LAMMPS' | 'MD'>;
  remoteId?: string;
  local?: CalculationProjectSummary;
};

export function WorkspaceShell() {
  const shell = useResearchShell();
  const search = useSearchParams().toString();
  const { session, ready } = useSession();
  const cloud = useWorkspaceCloudSync(session?.user.id);
  const { t, intlLocale } = useLocale();
  const storedWorkspace = useCalculationWorkspace();
  const workspace = cloud.ready ? storedWorkspace : emptyCalculationWorkspaceSummary;
  useInitialAnchor(Boolean(session && ready && cloud.status === 'synced'));
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const optionsTrigger = useRef<HTMLButtonElement>(null);
  const [sort, setSort] = useState<'name' | 'activity' | 'recent'>('recent');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const activityLabels = useMemo(() => ({ idle: t('Not run', 'Belum dijalankan'), running: t('Running', 'Berjalan'), completed: t('Completed', 'Selesai'), error: t('Error', 'Error') }), [t]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const [createdId, setCreatedId] = useState('');
  const [createdKind, setCreatedKind] = useState<'created' | 'duplicated'>('created');
  const dialog = useRef<HTMLDialogElement>(null);
  const editDialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const remoteDeleteDialog = useRef<HTMLDialogElement>(null);
  const trashDialog = useRef<HTMLDialogElement>(null);
  const permanentDeleteDialog = useRef<HTMLDialogElement>(null);
  const [projectMenuId, setProjectMenuId] = useState('');
  const [editingProject, setEditingProject] = useState<CalculationProjectSummary | null>(null);
  const [deletingProject, setDeletingProject] = useState<CalculationProjectSummary | null>(null);
  const [deletingRemoteProject, setDeletingRemoteProject] = useState<WorkspaceProjectEntry | null>(null);
  const [remoteDeleteBusy, setRemoteDeleteBusy] = useState(false);
  const remoteDeleting = useRef(false);
  const [permanentDeleteBusy, setPermanentDeleteBusy] = useState(false);
  const permanentDeleting = useRef(false);
  const permanentDeletionApplied = useRef(false);
  const [permanentlyDeletingProject, setPermanentlyDeletingProject] = useState<CalculationTrashProjectSummary | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [projectActionError, setProjectActionError] = useState('');
  const [filesProject, setFilesProject] = useState<ProjectFilesTarget | null>(null);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [remoteProjects, setRemoteProjects] = useState<PhyniteProject[]>([]);
  useEffect(() => {
    if (shell || !session || !cloud.ready) return;
    let cancelled = false;
    phyniteProjects.list().then(({ projects }) => { if (!cancelled) setRemoteProjects(projects); }).catch(() => { if (!cancelled) setRemoteProjects([]); });
    return () => { cancelled = true; };
  }, [shell, session, cloud.ready]);
  const allProjectRows = useMemo<WorkspaceProjectEntry[]>(() => {
    return (shell?.projects ?? mergeStudioProjects(workspace.projects, remoteProjects, workspace.trashProjects)).map((item): WorkspaceProjectEntry => {
      const local = item.kind === 'dft' ? workspace.projects.find(project => project.id === item.id) : undefined;
      if (local) return { ...local, key: item.key, primaryFormula: item.primaryFormula, remoteId: item.remoteId, kind: 'dft', assetCount: local.structureCount, activityLabel: activityLabels[local.activityState], href: item.href, tags: item.tags, local };
      return {
        key: item.key, id: item.id, kind: item.kind, name: item.name, description: item.description, primaryStructure: null, structureCount: 0, assetCount: item.mdTrajectoryCount ?? 0, runCount: 0, runningCount: 0,
        activityState: 'idle', activityLabel: t('Workspace', 'Workspace'), updatedAt: item.updatedAt,
        href: item.href, tags: item.tags, remoteId: item.remoteId,
      };
    });
  }, [shell?.projects, workspace.projects, remoteProjects, workspace.trashProjects, activityLabels, t]);
  const projects = useMemo(() => allProjectRows.filter(project => `${project.name} ${project.description} ${project.primaryStructure?.formula ?? ''} ${project.tags.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => (direction === 'asc' ? 1 : -1) * (sort === 'name' ? a.name.localeCompare(b.name) : sort === 'activity' ? ({ idle: 0, completed: 1, error: 2, running: 3 }[a.activityState] - { idle: 0, completed: 1, error: 2, running: 3 }[b.activityState] || a.name.localeCompare(b.name)) : a.updatedAt.localeCompare(b.updatedAt))), [allProjectRows, direction, query, sort]);
  useEffect(() => { if (ready && !session) window.location.replace('/login?returnTo=/workspace'); }, [ready, session]);
  useEffect(() => {
    if (!session || cloud.status !== 'synced') return;
    try { purgeExpiredWorkspaceProjects(session.user.id); }
    catch { /* Cleanup retries after the next successful workspace synchronization. */ }
  }, [cloud.status, session]);
  useEffect(() => {
    if (!projectMenuId) return;
    const close = (event: PointerEvent) => { if (!(event.target instanceof Element && event.target.closest('[data-project-actions]'))) setProjectMenuId(''); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [projectMenuId]);
  const openCreate = () => { setCreateError(''); setName(''); setDescription(''); dialog.current?.showModal(); };
  useEffect(() => {
    if (cloud.status !== 'synced') return;
    const request = projectCreateRequest(window.location.href);
    if (!request.requested) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setCreateError('');
      setName('');
      setDescription('');
      if (!dialog.current?.open) dialog.current?.showModal();
      window.history.replaceState(window.history.state, '', request.nextHref);
    });
    return () => { cancelled = true; };
  }, [cloud.status, search]);
  const openProjectFiles = (project: WorkspaceProjectEntry) => {
    setProjectMenuId('');
    setFilesProject({ id: project.id, remoteId: project.remoteId, name: project.name, href: project.href, tags: project.tags, updatedAt: project.updatedAt });
  };
  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!session || cloud.status !== 'synced' || creating) return;
    setCreating(true); setCreateError('');
    try {
      const { project } = await phyniteProjects.create({ name, description, tags: [] });
      setRemoteProjects(items => [project, ...items]);
      dialog.current?.close();
      shell?.refreshProjects();
      if (shell) shell.navigate('projects', `/projects/${encodeURIComponent(project.id)}`);
      else window.location.assign(`/projects/${encodeURIComponent(project.id)}`);
    } catch { setCreateError(t('Project could not be created. Check the connection and device storage before trying again.', 'Project belum dapat dibuat. Periksa koneksi dan penyimpanan perangkat sebelum mencoba lagi.')); }
    finally { setCreating(false); }
  };
  const openEdit = (project: CalculationProjectSummary) => {
    setProjectMenuId(''); setProjectActionError(''); setEditingProject(project); setEditName(project.name); setEditDescription(project.description);
    window.requestAnimationFrame(() => editDialog.current?.showModal());
  };
  const saveProjectDetails = (event: FormEvent) => {
    event.preventDefault();
    if (!session || !editingProject) return;
    try {
      updateWorkspaceProject(session.user.id, editingProject.id, { name: editName, description: editDescription });
      editDialog.current?.close(); setEditingProject(null);
    } catch { setProjectActionError(t('Project details could not be saved.', 'Detail project belum dapat disimpan.')); }
  };
  const duplicateProject = (project: CalculationProjectSummary) => {
    if (!session) return;
    setProjectMenuId(''); setProjectActionError('');
    try { setCreatedKind('duplicated'); setCreatedId(duplicateWorkspaceProject(session.user.id, project.id)); setSort('recent'); setDirection('desc'); }
    catch { setProjectActionError(t('Project could not be duplicated.', 'Project belum dapat diduplikasi.')); }
  };
  const openDelete = (project: CalculationProjectSummary) => {
    setProjectMenuId(''); setProjectActionError('');
    if (project.runningCount) { setProjectActionError(t('Finish or cancel running calculations before deleting this project.', 'Selesaikan atau batalkan kalkulasi yang berjalan sebelum menghapus project ini.')); return; }
    setDeletingProject(project); window.requestAnimationFrame(() => deleteDialog.current?.showModal());
  };
  const confirmDeleteProject = () => {
    if (!session || !deletingProject) return;
    try { deleteWorkspaceProject(session.user.id, deletingProject.id); deleteDialog.current?.close(); setDeletingProject(null); }
    catch (failure) { setProjectActionError(failure instanceof Error ? failure.message : t('Project could not be moved to Trash.', 'Project belum dapat dipindahkan ke Trash.')); }
  };
  const openRemoteDelete = (project: WorkspaceProjectEntry) => {
    if (!project.remoteId) return;
    setProjectMenuId(''); setProjectActionError(''); setDeletingRemoteProject(project);
    window.requestAnimationFrame(() => remoteDeleteDialog.current?.showModal());
  };
  const confirmRemoteDelete = async () => {
    if (!session || !deletingRemoteProject?.remoteId || remoteDeleting.current) return;
    remoteDeleting.current = true;
    const projectId = deletingRemoteProject.remoteId;
    setRemoteDeleteBusy(true); setProjectActionError('');
    try {
      try { await phyniteProjects.delete(projectId); }
      catch (failure) { if (!(failure && typeof failure === 'object' && 'status' in failure && failure.status === 404 && 'code' in failure && failure.code === 'PROJECT_NOT_FOUND')) throw failure; }
      if (deletingRemoteProject.local) {
        removeDeletedCloudProject(session.user.id, projectId, [deletingRemoteProject.local.id]);
        await cloud.flush();
      }
      shell?.refreshProjects();
      setRemoteProjects(items => items.filter(item => item.id !== projectId));
      if (filesProject?.remoteId === projectId) setFilesProject(null);
      let cacheCleanupFailed = false;
      try {
        const cached = (await listMdTrajectories(session.user.id)).filter(record => record.cloud?.projectId === projectId);
        const removals = await Promise.allSettled(cached.map(record => removeMdTrajectory(session.user.id, record.id)));
        cacheCleanupFailed = removals.some(result => result.status === 'rejected');
        const cachedIds = new Set(cached.map(record => record.id));
        const lastActive = localStorage.getItem(mdLastActiveKey(session.user.id));
        if (lastActive && cachedIds.has(lastActive)) localStorage.removeItem(mdLastActiveKey(session.user.id));
      } catch { cacheCleanupFailed = true; }
      remoteDeleteDialog.current?.close(); setDeletingRemoteProject(null);
      if (cacheCleanupFailed) setProjectActionError(t('The cloud project was deleted, but some cached device files could not be removed.', 'Project cloud sudah dihapus, tetapi beberapa file cache di perangkat belum dapat dibersihkan.'));
    } catch (failure) {
      setProjectActionError(failure instanceof Error ? failure.message : t('The MD project could not be deleted.', 'Project MD belum dapat dihapus.'));
    } finally { remoteDeleting.current = false; setRemoteDeleteBusy(false); }
  };
  const restoreProject = (project: CalculationTrashProjectSummary) => {
    if (!session) return;
    try { restoreWorkspaceProject(session.user.id, project.id); }
    catch (failure) { setProjectActionError(failure instanceof Error ? failure.message : t('Project could not be restored.', 'Project belum dapat dipulihkan.')); }
  };
  const openPermanentDelete = (project: CalculationTrashProjectSummary) => {
    trashDialog.current?.close(); permanentDeletionApplied.current = false; setProjectActionError(''); setPermanentlyDeletingProject(project);
    window.requestAnimationFrame(() => permanentDeleteDialog.current?.showModal());
  };
  const confirmPermanentDelete = async () => {
    if (!session || !permanentlyDeletingProject || permanentDeleting.current) return;
    permanentDeleting.current = true; setPermanentDeleteBusy(true); setProjectActionError('');
    try {
      if (!permanentDeletionApplied.current) {
        const { projects } = await phyniteProjects.list();
        const remoteId = permanentlyDeletingProject.remoteId ?? projects.find(project => project.legacyId === permanentlyDeletingProject.id)?.id;
        if (remoteId) {
          try { await phyniteProjects.delete(remoteId); }
          catch (failure) { if (!(failure && typeof failure === 'object' && 'status' in failure && failure.status === 404 && 'code' in failure && failure.code === 'PROJECT_NOT_FOUND')) throw failure; }
          setRemoteProjects(items => items.filter(item => item.id !== remoteId));
          shell?.refreshProjects();
        }
        forceDeleteWorkspaceProject(session.user.id, permanentlyDeletingProject.id);
        permanentDeletionApplied.current = true;
      }
      await cloud.flush();
      permanentDeleteDialog.current?.close(); setPermanentlyDeletingProject(null);
    } catch (failure) { setProjectActionError(failure instanceof Error ? failure.message : t('Project could not be permanently deleted.', 'Project belum dapat dihapus permanen.')); }
    finally { permanentDeleting.current = false; setPermanentDeleteBusy(false); }
  };
  if (!ready || !session) return <WorkspaceLoading label={t('Opening workspace…', 'Membuka workspace…')} />;
  const sortOptions = [
    { value: 'recent:desc', label: t('Edited: newest first', 'Diedit: terbaru dahulu') },
    { value: 'recent:asc', label: t('Edited: oldest first', 'Diedit: terlama dahulu') },
    { value: 'name:asc', label: t('Name: A–Z', 'Nama: A–Z') },
    { value: 'name:desc', label: t('Name: Z–A', 'Nama: Z–A') },
    { value: 'activity:desc', label: t('Activity: running first', 'Aktivitas: berjalan dahulu') },
    { value: 'activity:asc', label: t('Activity: idle first', 'Aktivitas: belum dijalankan dahulu') },
  ];
  return <main className="lab-page studio-page studio-shell-page">
    <WorkspaceResources open={resourcesOpen} onOpen={() => setResourcesOpen(true)} onClose={() => setResourcesOpen(false)} owner={session.user.id} workload="qe" scope="workspace" jobs={[]} />
    <div className="studio-layout"><StudioNavigation active="workspace" standalone /><div className="studio-body"><StudioMobileHeader session={session} /><div className="studio-main studio-main--home" id="studio-content">
      <header className="studio-heading"><h1>Home</h1><div className="research-home-heading-actions">
        <button ref={searchTrigger} type="button" className="research-home-icon" aria-label={t('Search projects', 'Cari project')} title={t('Search projects', 'Cari project')} aria-expanded={searchOpen} aria-controls="home-project-search" onClick={() => { setSearchOpen(current => !current); setQuery(''); }}><Search size={17} /></button>
        <div className="studio-project-actions research-home-options" data-project-actions onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); setProjectMenuId(''); event.currentTarget.querySelector('button')?.focus(); return; }
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]'));
          if (!items.length) return;
          event.preventDefault();
          const index = items.indexOf(document.activeElement as HTMLButtonElement);
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : index < 0 ? event.key === 'ArrowUp' ? items.length - 1 : 0 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }}><button ref={optionsTrigger} type="button" className="research-home-icon" aria-label={t('Project options', 'Opsi project')} aria-haspopup="menu" aria-expanded={projectMenuId === 'home-options'} onClick={() => setProjectMenuId(current => current === 'home-options' ? '' : 'home-options')}><MoreHorizontal size={17} /></button>{projectMenuId === 'home-options' && <div role="menu" aria-label={t('Project options', 'Opsi project')} className="studio-project-menu">
          {sortOptions.map(option => <button key={option.value} type="button" role="menuitemradio" aria-checked={`${sort}:${direction}` === option.value} onClick={() => { const [column, order] = option.value.split(':'); setSort(column as typeof sort); setDirection(order as typeof direction); setProjectMenuId(''); optionsTrigger.current?.focus(); }}>{option.label}</button>)}
          <hr /><button type="button" role="menuitem" onClick={() => { setProjectMenuId(''); trashDialog.current?.showModal(); }}><Trash2 size={14} />{t('Trash', 'Trash')}{workspace.trashCount > 0 && <span>{workspace.trashCount}</span>}</button>
        </div>}</div>
        <button className="lab-button lab-button-primary" onClick={openCreate} disabled={cloud.status !== 'synced'}><Plus size={17} />{t('New project', 'Project baru')}</button>
      </div></header>
      {searchOpen && <label id="home-project-search" className="research-home-search"><Search size={16} /><input autoFocus type="search" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setQuery(''); setSearchOpen(false); searchTrigger.current?.focus(); } }} placeholder={t('Search projects or formula', 'Cari project atau rumus kimia')} aria-label={t('Search projects', 'Cari project')} /><button type="button" aria-label={t('Close search', 'Tutup pencarian')} onClick={() => { setQuery(''); setSearchOpen(false); searchTrigger.current?.focus(); }}><X size={15} /></button></label>}
      {cloud.status === 'error' && <div className="lab-notice" role="alert"><span>{t('Workspace synchronization is unavailable. Keep your browser data and reload to reconnect.', 'Sinkronisasi Workspace belum tersedia. Pertahankan data browser dan muat ulang untuk menyambungkan kembali.')}</span><button onClick={() => window.location.reload()}>{t('Reload', 'Muat ulang')}</button></div>}
      {projectActionError && <div className="lab-notice" role="alert"><span>{projectActionError}</span><button type="button" onClick={() => setProjectActionError('')}>{t('Dismiss', 'Tutup')}</button></div>}
      {createdId && <div className="studio-created" role="status"><span>{createdKind === 'duplicated' ? t('Project duplicated. Calculation history was left with the source project.', 'Project diduplikasi. Riwayat kalkulasi tetap berada di project sumber.') : t('Project created. Add a structure to begin.', 'Project dibuat. Tambahkan struktur untuk mulai.')}</span><a href={`/calculation?project=${encodeURIComponent(createdId)}`}>{t('Open project', 'Buka project')}<ArrowRight size={15} /></a><button aria-label={t('Dismiss', 'Tutup')} onClick={() => setCreatedId('')}><X size={15} /></button></div>}
      <WorkspaceHome projects={projects} query={query.trim()} renderActions={project => (<div className="studio-project-actions" data-project-actions onKeyDown={event => {
            if (event.key === 'Escape') { event.preventDefault(); setProjectMenuId(''); event.currentTarget.querySelector('button')?.focus(); return; }
            if (projectMenuId !== project.key || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
            if (!items.length) return;
            event.preventDefault();
            const index = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : index < 0 ? event.key === 'ArrowUp' ? items.length - 1 : 0 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
            items[next]?.focus();
          }}><button type="button" aria-label={t(`Actions for ${project.name}`, `Aksi untuk ${project.name}`)} aria-haspopup="menu" aria-expanded={projectMenuId === project.key} onClick={() => setProjectMenuId(current => current === project.key ? '' : project.key)}><MoreHorizontal size={17} /></button>{projectMenuId === project.key && <div role="menu" className="studio-project-menu"><button role="menuitem" type="button" onClick={() => openProjectFiles(project)}><FolderTree size={14} />{t('Project files', 'File project')}</button>{project.local ? <><button role="menuitem" type="button" onClick={() => openEdit(project.local!)}><Pencil size={14} />{t('Rename & describe', 'Ubah nama & deskripsi')}</button><button role="menuitem" type="button" onClick={() => duplicateProject(project.local!)}><Copy size={14} />{t('Duplicate project', 'Duplikasi project')}</button><button role="menuitem" type="button" className="is-danger" onClick={() => project.remoteId ? openRemoteDelete(project) : openDelete(project.local!)}><Trash2 size={14} />{project.remoteId ? t('Delete project', 'Hapus project') : t('Move to Trash', 'Pindahkan ke Trash')}</button></> : project.remoteId ? <button role="menuitem" type="button" className="is-danger" onClick={() => openRemoteDelete(project)}><Trash2 size={14} />{t('Delete project', 'Hapus project')}</button> : null}</div>}</div>)} />
    </div></div></div>
    <dialog ref={dialog} className="studio-dialog" aria-labelledby="create-project-title"><form onSubmit={event => void create(event)}><header><FolderOpen size={22} /><button type="button" className="lab-button lab-button-quiet" aria-label={t('Close', 'Tutup')} onClick={() => dialog.current?.close()}><X size={18} /></button></header><h2 id="create-project-title">{t('Create a project', 'Buat project')}</h2><p>{t('Use one project for a material, a comparison, or a research question.', 'Gunakan satu project untuk material, perbandingan, atau pertanyaan riset.')}</p><label>{t('Project name', 'Nama project')}<input autoFocus required maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder={t('e.g. MoS2 strain study', 'Contoh: Studi strain MoS2')} /></label><label>{t('Description', 'Deskripsi')}<span>{t('Optional', 'Opsional')}</span><textarea maxLength={500} rows={3} value={description} onChange={event => setDescription(event.target.value)} placeholder={t('What are you investigating?', 'Apa yang ingin diteliti?')} /></label>{createError && <p role="alert" className="lab-notice">{createError}</p>}<footer><button type="button" className="lab-button" onClick={() => dialog.current?.close()}>{t('Cancel', 'Batal')}</button><button className="lab-button lab-button-primary" disabled={!name.trim() || cloud.status !== 'synced' || creating}><Plus size={16} />{t('Create project', 'Buat project')}</button></footer></form></dialog>
    <dialog ref={editDialog} className="studio-dialog" aria-labelledby="edit-project-title" onClose={() => setEditingProject(null)}><form onSubmit={saveProjectDetails}><header><Pencil size={22} /><button type="button" className="lab-button lab-button-quiet" aria-label={t('Close', 'Tutup')} onClick={() => editDialog.current?.close()}><X size={18} /></button></header><h2 id="edit-project-title">{t('Project details', 'Detail project')}</h2><p>{t('Use a clear name and a short description of the research question.', 'Gunakan nama yang jelas dan deskripsi singkat tentang pertanyaan riset.')}</p><label>{t('Project name', 'Nama project')}<input autoFocus required maxLength={100} value={editName} onChange={event => setEditName(event.target.value)} /></label><label>{t('Description', 'Deskripsi')}<span>{t('Optional', 'Opsional')}</span><textarea maxLength={500} rows={4} value={editDescription} onChange={event => setEditDescription(event.target.value)} placeholder={t('Material, variable, method, or hypothesis', 'Material, variabel, metode, atau hipotesis')} /></label>{projectActionError && <p role="alert" className="lab-notice">{projectActionError}</p>}<footer><button type="button" className="lab-button" onClick={() => editDialog.current?.close()}>{t('Cancel', 'Batal')}</button><button className="lab-button lab-button-primary" disabled={!editName.trim()}>{t('Save changes', 'Simpan perubahan')}</button></footer></form></dialog>
    <dialog ref={deleteDialog} className="studio-dialog studio-project-delete-dialog" aria-labelledby="delete-project-title" onClose={() => setDeletingProject(null)}><form method="dialog" onSubmit={(event) => event.preventDefault()}><header><Trash2 size={22} /><button type="button" className="lab-button lab-button-quiet" aria-label={t('Close', 'Tutup')} onClick={() => deleteDialog.current?.close()}><X size={18} /></button></header><h2 id="delete-project-title">{t('Move project to Trash?', 'Pindahkan project ke Trash?')}</h2><p>{deletingProject ? t(`${deletingProject.name} will leave your project list. You can restore its ${deletingProject.structureCount} structures and ${deletingProject.runCount} run records from Trash for 15 days.`, `${deletingProject.name} akan keluar dari daftar project. ${deletingProject.structureCount} struktur dan ${deletingProject.runCount} catatan eksekusinya dapat dipulihkan dari Trash selama 15 hari.`) : ''}</p>{projectActionError && <p role="alert" className="lab-notice">{projectActionError}</p>}<footer><button type="button" className="lab-button" onClick={() => deleteDialog.current?.close()}>{t('Keep project', 'Pertahankan project')}</button><button type="button" className="lab-button lab-button-danger" onClick={confirmDeleteProject}><Trash2 size={15} />{t('Move to Trash', 'Pindahkan ke Trash')}</button></footer></form></dialog>
    <dialog ref={remoteDeleteDialog} className="studio-dialog studio-project-delete-dialog" aria-labelledby="delete-md-project-title" onCancel={event => { if (remoteDeleteBusy) event.preventDefault(); }} onClose={() => { if (!remoteDeleteBusy) setDeletingRemoteProject(null); }}><form method="dialog" onSubmit={(event) => event.preventDefault()}><header><Trash2 size={22} /><button type="button" className="lab-button lab-button-quiet" disabled={remoteDeleteBusy} aria-label={t('Close', 'Tutup')} onClick={() => remoteDeleteDialog.current?.close()}><X size={18} /></button></header><h2 id="delete-md-project-title">{t('Delete project?', 'Hapus project?')}</h2><p>{deletingRemoteProject ? t(`${deletingRemoteProject.name} and its workflow and cloud assets will be permanently deleted. This action cannot be undone.`, `${deletingRemoteProject.name} beserta workflow dan aset cloud-nya akan dihapus permanen. Tindakan ini tidak dapat dibatalkan.`) : ''}</p>{projectActionError && <p role="alert" className="lab-notice">{projectActionError}</p>}<footer><button type="button" className="lab-button" disabled={remoteDeleteBusy} onClick={() => remoteDeleteDialog.current?.close()}>{t('Keep project', 'Pertahankan project')}</button><button type="button" className="lab-button lab-button-danger" disabled={remoteDeleteBusy} onClick={() => void confirmRemoteDelete()}><Trash2 size={15} />{remoteDeleteBusy ? t('Deleting...', 'Menghapus...') : t('Delete permanently', 'Hapus permanen')}</button></footer></form></dialog>
    <dialog ref={trashDialog} className="studio-dialog studio-trash-dialog" aria-labelledby="trash-title"><div><header><div><Trash2 size={21} /><span><h2 id="trash-title">Trash</h2><p>{t('Projects are permanently deleted after 15 days.', 'Project dihapus permanen setelah 15 hari.')}</p></span></div><button type="button" className="lab-button lab-button-quiet" aria-label={t('Close Trash', 'Tutup Trash')} onClick={() => trashDialog.current?.close()}><X size={18} /></button></header>{projectActionError && <p role="alert" className="lab-notice">{projectActionError}</p>}{workspace.trashProjects.length ? <div className="studio-trash-list">{workspace.trashProjects.map(project => <article key={project.id}><div className="studio-trash-project"><strong>{project.name}</strong><p>{project.description || `${project.structureCount} ${t('structures', 'struktur')} · ${project.runCount} ${t('runs', 'eksekusi')}`}</p><small><Clock3 size={12} />{project.daysRemaining === 1 ? t('Last day to restore', 'Hari terakhir untuk memulihkan') : t(`${project.daysRemaining} days left`, `${project.daysRemaining} hari tersisa`)}</small></div><div className="studio-trash-actions"><button type="button" className="lab-button" onClick={() => restoreProject(project)}><ArchiveRestore size={14} />{t('Restore', 'Pulihkan')}</button><button type="button" className="lab-button lab-button-quiet is-danger" onClick={() => openPermanentDelete(project)}><Trash2 size={14} />{t('Delete permanently', 'Hapus permanen')}</button></div></article>)}</div> : <div className="studio-trash-empty"><Trash2 size={25} /><strong>{t('Trash is empty', 'Trash kosong')}</strong><p>{t('Projects moved here remain recoverable for 15 days.', 'Project yang dipindahkan ke sini dapat dipulihkan selama 15 hari.')}</p></div>}</div></dialog>
    <dialog ref={permanentDeleteDialog} className="studio-dialog studio-project-delete-dialog" aria-labelledby="permanent-delete-title" onCancel={event => { if (permanentDeleteBusy) event.preventDefault(); }} onClose={() => setPermanentlyDeletingProject(null)}><form method="dialog" onSubmit={(event) => event.preventDefault()}><header><Trash2 size={22} /><button type="button" className="lab-button lab-button-quiet" aria-label={t('Close', 'Tutup')} disabled={permanentDeleteBusy} onClick={() => permanentDeleteDialog.current?.close()}><X size={18} /></button></header><h2 id="permanent-delete-title">{t('Delete permanently?', 'Hapus permanen?')}</h2><p>{permanentlyDeletingProject ? t(`${permanentlyDeletingProject.name} cannot be restored after this action.`, `${permanentlyDeletingProject.name} tidak dapat dipulihkan setelah tindakan ini.`) : ''}</p>{projectActionError && <p role="alert" className="lab-notice">{projectActionError}</p>}<footer><button type="button" className="lab-button" disabled={permanentDeleteBusy} onClick={() => permanentDeleteDialog.current?.close()}>{t('Cancel', 'Batal')}</button><button type="button" className="lab-button lab-button-danger" disabled={permanentDeleteBusy} onClick={() => void confirmPermanentDelete()}><Trash2 size={15} />{t('Delete permanently', 'Hapus permanen')}</button></footer></form></dialog>
    <ProjectFilesExplorer key={filesProject?.id ?? 'closed-project-files'} project={filesProject} onClose={() => setFilesProject(null)} t={t} intlLocale={intlLocale} />
  </main>;
}
