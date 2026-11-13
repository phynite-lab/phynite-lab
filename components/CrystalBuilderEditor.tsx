'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Axis3D, Crosshair, DatabaseSearch, FileUp, MousePointer2, Move, Plus, Redo2, Rotate3D, Scan, Settings2, Ruler, Save, Trash2, Undo2 } from 'lucide-react';
import { useLocale } from '@/app/locale-provider';
import { CrystalStructureInspector, type CrystalSourceMetadata } from './CrystalStructureInspector';
import { LabInspectorSection } from './LabControls';
import { CrystalBuilderTools } from './CrystalBuilderTools';
import { CrystalDisplayPanel, type CrystalDisplaySettings } from './CrystalDisplayPanel';
import { UiSelect } from './UiSelect';
import { MaterialsProjectBrowser } from './MaterialsProjectBrowser';
import { crystalDatabaseInput } from '@/lib/crystal-database-input';
import { CommittedNumberInput } from './CommittedNumberInput';
import { LAB_VIEW_PRESETS, getLabViewPreset } from '@/lib/lab-camera';
import { crystalScalarColors, previewCrystalModifiers, type CrystalModifier, type CrystalColorMap, type CrystalColorProperty } from '@/lib/crystal-builder';
import { cellOffsetFromAtomInstance } from '@/lib/crystal-render-model';
import { cellVectorsFromLattice } from '@/lib/crystal-cell';
import { crystalMeasurement } from '@/lib/crystal-editor';
import { createCIF, createXYZ, createXSF, createPOSCAR, parseStructureFile, STRUCTURE_FILE_ACCEPT, type ParsedStructure } from '@/lib/structure-parsers';
import type { CustomAtom } from './CrystalViewer';
import type { CameraViewRequest } from './CrystalEditorViewport';
import type { CrystalSceneExporter } from './CrystalSceneExport';
import '@/app/crystal-builder.css';
const Viewport = dynamic(() => import('./CrystalEditorViewport').then(module => module.CrystalEditorViewport), { ssr:false });
const defaults: CrystalDisplaySettings = { displayStyle:'ball-stick',atomScale:1,bondScale:1,bondCutoff:0,forceScale:2.5,showBonds:true,showCell:true,showLabels:false,showForces:false,supercell:[1,1,1] };
type Tool = 'select'|'move'|'rotate'|'measure'|'add'|'delete';
type ViewState = { display:CrystalDisplaySettings; rotation:[number,number,number]; color:CrystalColorProperty; palette:CrystalColorMap; modifiers:CrystalModifier[]; cellMode:'simple'|'manual'; sections:{structure:boolean;prepare:boolean;display:boolean;export:boolean}; moveSpace:'world'|'local'; constraint:'free'|'x'|'y'|'z'|'xy'|'xz'|'yz'; snap:number };
const initialView:ViewState={display:defaults,rotation:[0,0,0],color:'element',palette:'viridis',modifiers:[],cellMode:'simple',sections:{structure:true,prepare:false,display:true,export:true},moveSpace:'world',constraint:'free',snap:0};
export function CrystalBuilderEditor({ structure, onChange, onSave, saveStatus, viewKey, theme, actions, inspectorVisible=true, metadata, database=false }: { actions?:ReactNode;inspectorVisible?:boolean;metadata?:CrystalSourceMetadata;structure:ParsedStructure; onChange:(structure:ParsedStructure)=>void | boolean; onSave:()=>Promise<void>; saveStatus:string; viewKey:string; theme:'light'|'dark'; database?:boolean }) {
  const [repairError, setRepairError] = useState('');
  try { cellVectorsFromLattice(structure.lattice); if(!Array.isArray(structure.atoms)||!structure.atoms.every(atom=>[atom.x,atom.y,atom.z].every(Number.isFinite))) throw new Error('Invalid atom coordinates.'); }
  catch(error) { return <div className="crystal-builder-editor"><p role="alert">{repairError || (error as Error).message} Import a valid structure to repair this input.</p><input aria-label="Repair structure input" type="file" accept={STRUCTURE_FILE_ACCEPT} onChange={event=>{const file=event.target.files?.[0];if(file)void parseStructureFile(file).then(onChange).catch(failure=>setRepairError(failure.message));}}/></div>; }
  return <CrystalBuilderSurface structure={structure} onChange={onChange} onSave={onSave} saveStatus={saveStatus} viewKey={viewKey} theme={theme} actions={actions} inspectorVisible={inspectorVisible} metadata={metadata} database={database}/>;
}
function CrystalBuilderSurface({ structure, onChange, onSave, saveStatus, viewKey, theme, actions, inspectorVisible=true, metadata, database=false }: { actions?:ReactNode;inspectorVisible?:boolean;metadata?:CrystalSourceMetadata;structure:ParsedStructure; onChange:(structure:ParsedStructure)=>void | boolean; onSave:()=>Promise<void>; saveStatus:string; viewKey:string; theme:'light'|'dark'; database?:boolean }) {
  const { t }=useLocale();
  const [miller, setMiller] = useState({ enabled: false, h: 1, k: 0, l: 0, offset: 0.5 });
  const [view,setView]=useState(initialView), [loaded,setLoaded]=useState(false), [tool,setTool]=useState<Tool>('select');
  const [selected,setSelected]=useState<string|null>(null), [focus,setFocus]=useState(0), [fit,setFit]=useState(0), [camera,setCamera]=useState<CameraViewRequest|null>(null);
  const [measureMode,setMeasureMode]=useState<'distance'|'angle'|'dihedral'>('distance'), [points,setPoints]=useState<Array<{atomId:string;instanceId:string}>>([]);
  const [error,setError]=useState(''), [draggingFile,setDraggingFile]=useState(false), [importing,setImporting]=useState(false), [saving,setSaving]=useState(false), [exporting,setExporting]=useState(false);
  const [databaseOpen,setDatabaseOpen]=useState(false);
  const [history,setHistory]=useState<{past:ParsedStructure[];future:ParsedStructure[]}>({past:[],future:[]});
  const latest=useRef(structure), file=useRef<HTMLInputElement>(null), scene=useRef<CrystalSceneExporter|null>(null);
  useEffect(()=>{ latest.current=structure; },[structure]);
  useEffect(()=>{
    try { const saved=JSON.parse(localStorage.getItem(viewKey)??'null'); if(saved?.display && Array.isArray(saved.rotation) && saved.rotation.length===3 && saved.rotation.every(Number.isFinite)) queueMicrotask(()=>setView({...initialView,...saved,modifiers:Array.isArray(saved.modifiers)?saved.modifiers:[],cellMode:saved.cellMode==='manual'?'manual':'simple',sections:{...initialView.sections,...saved.sections,...(saved.section==='prepare'?{prepare:true}:{})},display:{...defaults,...saved.display,supercell:Array.isArray(saved.display.supercell)&&saved.display.supercell.length===3&&saved.display.supercell.every((n:unknown)=>Number.isInteger(n)&&Number(n)>=1&&Number(n)<=12)?saved.display.supercell:defaults.supercell}})); } catch {}
    queueMicrotask(()=>setLoaded(true));
  },[viewKey]);
  useEffect(()=>{ if(loaded) try { localStorage.setItem(viewKey,JSON.stringify(view)); }catch{} },[loaded,view,viewKey]);
  const patch=(next:Partial<ViewState>)=>setView(current=>({...current,...next}));
  const apply=(next:ParsedStructure)=>{
    cellVectorsFromLattice(next.lattice);
    if(!next.atoms.every(atom=>[atom.x,atom.y,atom.z].every(Number.isFinite))) throw new Error(t('Atom coordinates must be finite.','Koordinat atom harus terbatas.'));
    const previous = structuredClone(latest.current);
    if (onChange(next) === false) { setError(t('The input could not be applied. Resolve the Canvas save error and try again.', 'Input belum dapat diterapkan. Selesaikan kesalahan penyimpanan Kanvas lalu coba lagi.')); return false; }
    setHistory(current=>({past:[...current.past.slice(-49),previous],future:[]})); latest.current=next; setError(''); return true;
  };
  const importingFile = useRef(false), dragDepth = useRef(0), importRevision = useRef(0);
  useEffect(() => () => { importRevision.current++; }, []);
  const importFile = async (source: File, emptyOnly = false) => {
    if (importingFile.current) return;
    importingFile.current = true; setImporting(true); setError('');
    const revision = ++importRevision.current;
    try {
      const next = await parseStructureFile(source);
      if (revision !== importRevision.current) return;
      if (!next.atoms.length) throw new Error(t('The file contains no atoms. Choose a valid structure file.', 'Berkas tidak berisi atom. Pilih berkas struktur yang valid.'));
      if (emptyOnly && latest.current.atoms.length) throw new Error(t('This structure is no longer empty. Use Import structure to replace it.', 'Struktur ini sudah berisi atom. Gunakan Impor struktur untuk menggantinya.'));
      apply(next);
    } catch (failure) { if (revision === importRevision.current) setError(failure instanceof Error ? failure.message : t('The structure could not be imported.', 'Struktur belum dapat diimpor.')); }
    finally { if (revision === importRevision.current) { importingFile.current = false; setImporting(false); } }
  };
  const fileDrag = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files');
  const undo=()=>{ const previous=history.past.at(-1); if(previous){if(onChange(previous)===false)return;setHistory({past:history.past.slice(0,-1),future:[structuredClone(structure),...history.future]});latest.current=previous;setError('');} };
  const redo=()=>{ const next=history.future[0]; if(next){if(onChange(next)===false)return;setHistory({past:[...history.past,structuredClone(structure)],future:history.future.slice(1)});latest.current=next;setError('');} };
  const preview=useMemo(()=>previewCrystalModifiers(structure.atoms,structure.lattice,view.modifiers),[structure,view.modifiers]);
  const shown=view.modifiers.some(modifier=>modifier.enabled)&&!preview.error ? {...structure,atoms:preview.atoms,lattice:preview.lattice}:structure;
  const colors=useMemo(()=>crystalScalarColors(shown.atoms,shown.lattice,view.color,view.palette),[shown.atoms,shown.lattice,view.color,view.palette]);
  const add=()=>{ const next:CustomAtom={id:`atom_${crypto.randomUUID()}`,species:'C',x:.5,y:.5,z:.5};apply({...structure,atoms:[...structure.atoms,next]});setSelected(next.id); };
  const remove=(id:string)=>{ if(structure.atoms.length<=1)return;apply({...structure,atoms:structure.atoms.filter(atom=>atom.id!==id)});setSelected(null); };
  const select=(atomId:string|null,instanceId?:string)=>{
    setSelected(atomId);
    if(atomId && tool==='delete')remove(atomId);
    if(atomId && tool==='measure')setPoints(current=>{ const next={atomId,instanceId:instanceId??`${atomId}@0,0,0`};return current.some(item=>item.instanceId===next.instanceId)?current:current.length>=(measureMode==='distance'?2:measureMode==='angle'?3:4)?[next]:[...current,next]; });
  };
  let measured:number|null=null, measurementError='';
  try { measured=crystalMeasurement(measureMode,points.flatMap(point=>{ const atom=structure.atoms.find(item=>item.id===point.atomId);if(!atom)return[];const offset=cellOffsetFromAtomInstance(atom.id,point.instanceId);return [[atom.x+offset[0],atom.y+offset[1],atom.z+offset[2]] as [number,number,number]]; }),structure.lattice); }catch(failure){measurementError=(failure as Error).message;}
  const download=(blob:Blob,name:string)=>{const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const exportStructure=(format:'cif'|'xyz'|'xsf'|'poscar')=>{
    try {
      const content=({cif:createCIF,xyz:createXYZ,xsf:createXSF,poscar:createPOSCAR}[format])(structure.name,structure.atoms,structure.lattice);
      download(new Blob([content],{type:'text/plain'}),`${structure.name}.${format}`);setError('');
    } catch(failure) { setError((failure as Error).message); }
  };
  const fitCrystal=()=>{try{localStorage.removeItem(`${viewKey}:camera`);}catch{}setFit(value=>value+1);};
  const toolButton=(value:Tool,Icon:typeof MousePointer2,label:string)=><button key={value} aria-label={label} title={label} aria-pressed={tool===value} onClick={()=>{setTool(value);setPoints([]);if(value==='add')add();}}><Icon size={18}/></button>;
  return <div className="crystal-builder-editor" data-workflow-editor data-file-drag={draggingFile} onDragEnter={event => {
    if (!fileDrag(event)) return;
    event.preventDefault(); event.stopPropagation(); dragDepth.current++;
    if (!structure.atoms.length) setDraggingFile(true);
  }} onDragOver={event => {
    if (!fileDrag(event)) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = structure.atoms.length || importing ? 'none' : 'copy';
  }} onDragLeave={event => {
    if (!fileDrag(event)) return;
    event.preventDefault(); event.stopPropagation(); dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (!dragDepth.current) setDraggingFile(false);
  }} onDrop={event => {
    if (!fileDrag(event)) return;
    event.preventDefault(); event.stopPropagation(); dragDepth.current = 0; setDraggingFile(false);
    if (structure.atoms.length) { setError(t('Use Import structure to replace the current structure.', 'Gunakan Impor struktur untuk mengganti struktur saat ini.')); return; }
    if (event.dataTransfer.files.length !== 1) { setError(t('Drop one structure file at a time.', 'Letakkan satu berkas struktur sekaligus.')); return; }
    void importFile(event.dataTransfer.files[0], true);
  }} onKeyDown={event=>{
    if((event.target as Element).closest('input,textarea,select,[contenteditable=true],[role=dialog]'))return;
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.stopPropagation();if(event.shiftKey)redo();else undo();}
    if(event.key==='Escape'){setTool('select');setPoints([]);}
  }}>
  {error&&<p role="alert" className="crystal-builder-error">{error}<button aria-label={t('Dismiss error','Tutup kesalahan')} onClick={()=>setError('')}>×</button></p>}
  <div className="crystal-builder-body"><div className="crystal-builder-viewport">
  <div className="crystal-builder-actions" role="toolbar" aria-label={t('Structure actions','Aksi struktur')}>
    <button aria-label="Undo crystal edit" title={t('Undo','Urungkan')} disabled={!history.past.length} onClick={undo}><Undo2 size={18}/></button><button aria-label="Redo crystal edit" title={t('Redo','Ulangi')} disabled={!history.future.length} onClick={redo}><Redo2 size={18}/></button>
    {actions}{database && <button type="button" aria-label={t('Crystal database','Database kristal')} aria-haspopup="dialog" aria-expanded={databaseOpen} onClick={()=>setDatabaseOpen(true)}><DatabaseSearch size={18}/><span>{t('Crystal database','Database kristal')}</span></button>}<button aria-label={t('Import structure','Impor struktur')} disabled={importing} onClick={()=>file.current?.click()}><FileUp size={18}/><span>{t('Import structure','Impor struktur')}</span></button>
    <input ref={file} hidden type="file" accept={STRUCTURE_FILE_ACCEPT} onChange={event=>{const source=event.target.files?.[0];if(source)void importFile(source);event.target.value='';}}/>
    <button aria-label={t('Save input','Simpan input')} disabled={saving||!structure.atoms.length} onClick={()=>{setSaving(true);void onSave().catch(failure=>setError(failure.message)).finally(()=>setSaving(false));}}><Save size={18}/><span>{t('Save input','Simpan input')}</span></button>
    <small role="status">{saving?t('Saving…','Menyimpan…'):saveStatus==='synced'?t('Saved','Tersimpan'):t('Local draft','Draft lokal')}</small>
  </div>
  {loaded&&shown.atoms.length>0?<div className="crystal-builder-scene"><Viewport miller={miller.enabled ? { indices: [miller.h, miller.k, miller.l], offset: miller.offset } : undefined} atoms={shown.atoms} lattice={shown.lattice} {...view.display} selectedAtomId={selected} onSelectAtom={select} focusRequest={focus} viewRequest={camera} fitKey={`${viewKey}:${fit}`} cameraStorageKey={`${viewKey}:camera`} theme={theme} objectRotation={view.rotation} activeTool={tool} atomColors={colors.colors} exportRef={scene} moveSpace={view.moveSpace} moveConstraint={view.constraint} moveSnap={view.snap>0?view.snap:null} measurementInstanceIds={points.map(point=>point.instanceId)} onMoveAtom={(id,position)=>apply({...structure,atoms:structure.atoms.map(atom=>atom.id===id?{...atom,x:position[0],y:position[1],z:position[2]}:atom)})} onRotateObject={rotation=>patch({rotation})} onEmptyClick={()=>{if(tool==='add')add();}}/></div>:<div className="crystal-builder-drop-zone" data-dragging={draggingFile} aria-busy={importing}>
    <FileUp size={24} aria-hidden="true" /><strong>{draggingFile ? t('Drop to import structure', 'Lepaskan untuk mengimpor struktur') : t('Drop a structure file here', 'Letakkan berkas struktur di sini')}</strong>
    <p>CIF · POSCAR · XYZ · XSF · Quantum ESPRESSO</p><button type="button" disabled={importing} onClick={() => file.current?.click()}>{t('Choose a file', 'Pilih berkas')}</button>
    <small role="status">{importing ? t('Reading structure…', 'Membaca struktur…') : t('Or add an atom with the builder tools.', 'Atau tambahkan atom dengan tool builder.')}</small>
  </div>}
  <div className="crystal-builder-tool-rail" role="toolbar" aria-label={t('Crystal builder tools','Tool crystal builder')} aria-orientation="vertical">
    <div>{toolButton('select',MousePointer2,t('Select atoms','Pilih atom'))}{toolButton('measure',Ruler,t('Measure','Ukur'))}</div>
    <div>{toolButton('move',Move,t('Move atom','Pindah atom'))}{toolButton('rotate',Rotate3D,t('Rotate view','Putar tampilan'))}{toolButton('add',Plus,t('Add atom','Tambah atom'))}{toolButton('delete',Trash2,t('Delete atom','Hapus atom'))}</div>
    <div><UiSelect ariaLabel={t('Crystal camera preset','Preset kamera kristal')} displayValue={<Axis3D size={18}/>} value="" options={[{value:'',label:t('View','Tampilan')},...LAB_VIEW_PRESETS.map(preset=>({value:preset.id,label:preset.label}))]} onChange={value=>{if(!value)return;const preset=getLabViewPreset(value as Parameters<typeof getLabViewPreset>[0]);setCamera({id:Date.now(),direction:preset.direction,up:preset.up});}}/>
    <button aria-label="Fit crystal" title={t('Fit crystal','Paskan kristal')} onClick={fitCrystal}><Crosshair size={18}/></button><button aria-label={t('Focus selected','Fokus pilihan')} title={t('Focus selected','Fokus pilihan')} disabled={!selected} onClick={()=>setFocus(value=>value+1)}><Scan size={18}/></button></div>
  </div>
  {tool==='measure'&&<div className="crystal-builder-floating"><UiSelect ariaLabel="Measurement type" value={measureMode} options={[{value:'distance',label:'Distance · Å'},{value:'angle',label:'Angle · °'},{value:'dihedral',label:'Dihedral · °'}]} onChange={value=>{setMeasureMode(value as typeof measureMode);setPoints([]);}}/><output>{measurementError|| (measured===null?`${points.length}/${measureMode==='distance'?2:measureMode==='angle'?3:4} atoms selected`:`${measured.toFixed(5)} ${measureMode==='distance'?'Å':'°'}`)}</output><button onClick={()=>setPoints([])}>{t('Clear','Bersihkan')}</button></div>}
  {tool==='move'&&<div className="crystal-builder-floating"><UiSelect ariaLabel="Move coordinates" value={view.moveSpace} options={[{value:'world',label:'World'},{value:'local',label:'Local'}]} onChange={value=>patch({moveSpace:value as ViewState['moveSpace']})}/><UiSelect ariaLabel="Move constraint" value={view.constraint} options={['free','x','y','z','xy','xz','yz'].map(value=>({value,label:value.toUpperCase()}))} onChange={value=>patch({constraint:value as ViewState['constraint']})}/><label>Snap <CommittedNumberInput aria-label="Move snap" value={view.snap} min={0} step={.01} onCommit={snap=>patch({snap})}/></label></div>}
  </div><aside hidden={!inspectorVisible} className="crystal-builder-inspector" aria-label={t('Crystal inspector','Inspector kristal')}>
    <div className="crystal-inspect-heading">{t('Inspect','Inspeksi')}</div>
    <CrystalStructureInspector metadata={metadata} structure={structure} viewKey={viewKey} selected={selected} onSelect={id=>select(id)} onChange={apply} onAdd={add} onDelete={remove} mode={view.cellMode} onModeChange={cellMode=>patch({cellMode})} repeat={view.display.supercell} onRepeatChange={supercell=>patch({display:{...view.display,supercell}})} open={view.sections.structure} onOpenChange={structure=>patch({sections:{...view.sections,structure}})}/>
    <LabInspectorSection title={t('Prepare','Persiapan')} icon={<Settings2 size={16}/>} open={view.sections.prepare} onOpenChange={prepare=>patch({sections:{...view.sections,prepare}})}><CrystalBuilderTools modifiers={view.modifiers} onChange={modifiers=>patch({modifiers})} preview={preview} originalCount={structure.atoms.length} onApply={()=>{if(!preview.error&&preview.atoms.length){apply({...structure,atoms:preview.atoms,lattice:preview.lattice});patch({modifiers:[]});}}}/></LabInspectorSection>
    <CrystalDisplayPanel settings={view.display} onChange={display=>patch({display:{...view.display,...display}})} hasForces={structure.atoms.some(atom=>[atom.fx,atom.fy,atom.fz].every(Number.isFinite))} onExport={exportStructure} onSceneExport={format=>{if(!scene.current){setError(t('The scene is still loading.','Scene masih dimuat.'));return;}setExporting(true);void scene.current(format).then(blob=>download(blob,`${structure.name}.${format}`)).catch(failure=>setError(failure.message)).finally(()=>setExporting(false));}} exporting={exporting} sections={view.sections} onSectionChange={(section,open)=>patch({sections:{...view.sections,[section]:open}})}/>
    <LabInspectorSection title={t('Miller plane', 'Bidang Miller')} defaultOpen={false}><label><input type="checkbox" checked={miller.enabled} onChange={event => setMiller(current => ({ ...current, enabled: event.target.checked }))} />{t('Show lattice plane', 'Tampilkan bidang kisi')}</label>{(['h', 'k', 'l', 'offset'] as const).map(key => <label key={key}>{key}<input type="number" aria-label={`Miller ${key}`} step={key === 'offset' ? 0.1 : 1} value={miller[key]} onChange={event => { const value = Number(event.target.value); if (Number.isFinite(value) && (key === 'offset' || Number.isSafeInteger(value))) setMiller(current => ({ ...current, [key]: value })); }} /></label>)}<p>{t('h·u + k·v + l·w = offset in fractional lattice coordinates. A plane outside the displayed cell is not visible.', 'h·u + k·v + l·w = offset pada koordinat fraksional kisi. Bidang di luar sel tampilan tidak terlihat.')}</p>{miller.enabled && !miller.h && !miller.k && !miller.l && <p role="alert">{t('At least one index must be nonzero.', 'Minimal satu indeks harus bukan nol.')}</p>}</LabInspectorSection>
    <LabInspectorSection title={t('Atom colors','Warna atom')} defaultOpen={false}><UiSelect ariaLabel="Atom color property" value={view.color} options={['element','x','y','z','force'].map(value=>({value,label:value}))} onChange={color=>patch({color:color as CrystalColorProperty})}/><UiSelect ariaLabel="Color map" value={view.palette} options={[{value:'viridis',label:'Viridis'},{value:'coolwarm',label:'Cool/warm'}]} onChange={palette=>patch({palette:palette as CrystalColorMap})}/></LabInspectorSection>
  </aside></div>
  {database && <MaterialsProjectBrowser open={databaseOpen} target="structure" databaseName={structure.name} onClose={()=>setDatabaseOpen(false)} onImport={materials=>{
    if(materials.length!==1)throw new Error(t('Choose one structure for this module.','Pilih satu struktur untuk modul ini.'));
    if(!apply(crystalDatabaseInput(materials[0])))throw new Error(t('The structure could not be applied to this module. Resolve the Canvas save error first.','Struktur belum dapat diterapkan ke modul ini. Selesaikan kesalahan penyimpanan Kanvas dahulu.'));
    setSelected(null);setPoints([]);patch({modifiers:[]});fitCrystal();
  }}/>}
  </div>;
}
