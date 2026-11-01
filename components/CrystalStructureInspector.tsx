'use client';

import { Box } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useLocale } from '@/app/locale-provider';
import { appearanceFor } from '@/lib/crystal-render-model';
import { cellVolume, cellVectorsFromLattice, changeCellMetric, type CellMetric } from '@/lib/crystal-cell';
import { editCrystalCell } from '@/lib/crystal-editor';
import { structureFormula } from '@/lib/structure-formula';
import type { ParsedStructure } from '@/lib/structure-parsers';
import { CellRepeatControl, type CellRepeat } from './CellRepeatControl';
import { CommittedNumberInput } from './CommittedNumberInput';
import { CrystalStructureEditor } from './CrystalStructureEditor';
import { LabCheckbox, LabInspectorSection } from './LabControls';

export type CrystalSourceMetadata = {externalId?:string;bandGap?:number};

/** The same Inspect surface for workflow and legacy crystal editors. Display repeats never edit input. */
export function CrystalStructureInspector({ structure, viewKey, selected, onSelect, onChange, onAdd, onDelete, mode, onModeChange, repeat, onRepeatChange, open, onOpenChange, metadata }: {
  metadata?:CrystalSourceMetadata; structure:ParsedStructure; viewKey:string; selected:string|null; onSelect:(id:string)=>void;
  onChange:(next:ParsedStructure)=>void; onAdd:()=>void; onDelete:(id:string)=>void;
  mode:'simple'|'manual'; onModeChange:(mode:'simple'|'manual')=>void;
  repeat:CellRepeat; onRepeatChange:(repeat:CellRepeat)=>void; open:boolean; onOpenChange:(open:boolean)=>void;
}) {
  const {t}=useLocale();
  const errorId=useId();
  const [invalid,setInvalid]=useState<{key:CellMetric;message:string}|null>(null);
  const composition=useMemo(()=>{
    const counts=new Map<string,number>();
    for(const atom of structure.atoms) for(const site of atom.siteSpecies?.length?atom.siteSpecies:[{element:atom.species,occupancy:atom.occupancy??1}]) counts.set(site.element,(counts.get(site.element)??0)+site.occupancy);
    return [...counts];
  },[structure.atoms]);
  const metric=(key:CellMetric,value:number)=>{
    try {onChange({...structure,lattice:changeCellMetric(structure.lattice,key,value)});setInvalid(null);}
    catch(error) {setInvalid({key,message:(error as Error).message});}
  };
  return <LabInspectorSection title={t('Structure','Struktur')} icon={<Box size={16}/>} open={open} onOpenChange={onOpenChange}>
    <div className="crystal-inspect-summary">
      <div className="crystal-inspect-stats">
        <div><strong>{structure.atoms.length.toLocaleString()}</strong><span>{t('Atoms','Atom')}</span></div>
        <div><strong>{composition.length}</strong><span>{t('Species','Spesies')}</span></div>
        <div><strong>{Math.abs(cellVolume(cellVectorsFromLattice(structure.lattice))).toFixed(2)} Å³</strong><span>{t('Cell volume','Volume sel')}</span></div>
      </div>
      <div className="crystal-inspect-composition-bar" aria-hidden="true">{composition.map(([species,count])=><i key={species} style={{flex:count,background:appearanceFor(species).color}}/>)}</div>
      <div className="crystal-inspect-composition">{composition.map(([species,count])=><span key={species}><i style={{background:appearanceFor(species).color}}/>{species}<b>{Number(count.toFixed(4))}</b></span>)}</div>
    </div>
    <dl className="crystal-inspect-metadata"><div><dt>{t('Formula','Rumus')}</dt><dd>{structureFormula(structure.atoms)??'—'}</dd></div>{metadata?.externalId&&<div><dt>{t('External ID','ID eksternal')}</dt><dd>{metadata.externalId}</dd></div>}{typeof metadata?.bandGap==='number'&&Number.isFinite(metadata.bandGap)&&<div><dt>{t('Reference band gap','Band gap referensi')}</dt><dd>{metadata.bandGap.toFixed(3)} eV</dd></div>}</dl>
    <div className="crystal-inspect-subsection">
      <strong>{t('Structure parameters','Parameter struktur')}</strong>
      <div className="crystal-inspect-modes" role="group" aria-label={t('Structure parameter mode','Mode parameter struktur')}>
        <button aria-pressed={mode==='simple'} onClick={()=>onModeChange('simple')}>{t('Simple','Sederhana')}</button>
        <button aria-pressed={mode==='manual'} onClick={()=>onModeChange('manual')}>{t('Manual','Manual')}</button>
      </div>
      {mode==='simple'?<><div className="lattice-parameter-grid">{([['a','b','c'],['alpha','beta','gamma']] as const).map((row,index)=><div key={index} className="crystal-inspect-metric-row">{row.map((key,axis)=><label key={key} className="lattice-parameter-cell"><span>{index?['α','β','γ'][axis]:key}</span><CommittedNumberInput className="lattice-parameter-input" aria-label={index?`Lattice angle ${key}`:`Lattice parameter ${key.toUpperCase()}`} aria-invalid={invalid?.key===key||undefined} aria-describedby={invalid?.key===key?errorId:undefined} value={Number(structure.lattice[key].toFixed(6))} step={index?1:.01} onCommit={value=>metric(key,value)}/><span>{index?'°':'Å'}</span></label>)}</div>)}</div>{invalid&&<p id={errorId} className="crystal-builder-error" role="alert">{invalid.message}</p>}</>:<CrystalStructureEditor viewKey={`${viewKey}:units`} atoms={structure.atoms} lattice={structure.lattice} selectedAtomId={selected} onSelectAtom={onSelect} onCellVectorsChange={vectors=>onChange({...structure,lattice:editCrystalCell(structure.lattice,vectors)})} onAtomChange={(id,values)=>onChange({...structure,atoms:structure.atoms.map(atom=>atom.id===id?{...atom,...values}:atom)})} onAddAtom={onAdd} onDeleteAtom={onDelete}/>}
      <fieldset className="crystal-inspect-periodicity"><legend>{t('Periodicity','Periodisitas')}</legend>{['X','Y','Z'].map((axis,index)=><LabCheckbox key={axis} checked={(structure.lattice.periodic??[true,true,true])[index]} onCheckedChange={checked=>{const periodic=[...(structure.lattice.periodic??[true,true,true])] as [boolean,boolean,boolean];periodic[index]=checked;onChange({...structure,lattice:{...structure.lattice,periodic}});}}>{axis}</LabCheckbox>)}</fieldset>
    </div>
    <div className="crystal-inspect-subsection"><CellRepeatControl value={repeat} atomCount={structure.atoms.length} periodic={structure.lattice.periodic} maxAxis={8} onChange={onRepeatChange}/><p className="crystal-inspect-note">{t('Display only. Use Prepare → Supercell to change the calculation geometry.','Hanya tampilan. Gunakan Persiapan → Supercell untuk mengubah geometri kalkulasi.')}</p></div>
  </LabInspectorSection>;
}
