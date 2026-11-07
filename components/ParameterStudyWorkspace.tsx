'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, Box, ChevronRight, CircleAlert, Cpu, FlaskConical, GitBranch, Info, Layers3, MoveUpRight, Play, Plus, SlidersHorizontal } from 'lucide-react';
import { useLocale } from '@/app/locale-provider';
import { UiSelect } from './UiSelect';
import { createParameterStudy, parameterDefinition, previewParameterStudy, studyParameters, studyRange, studyTemplates, studyValues, type ParameterStudy, type StudyParameter, type StudyProvenance } from '@/lib/workflow-parameter-study';
import type { ProjectWorkflow, WorkflowAttempt } from '@/lib/project-workflow';
import '@/app/parameter-study.css';

export function ParameterStudyWorkspace({ graph, attempts, disabled, onApply, onOpen, onRun, onCanvas, onShowCases }: {
  graph: ProjectWorkflow; attempts: WorkflowAttempt[]; disabled: boolean;
  onApply: (result: Awaited<ReturnType<typeof createParameterStudy>>) => boolean;
  onShowCases: (nodeIds: string[]) => void; onOpen: (nodeId: string) => void; onRun: (targets: string[]) => void; onCanvas: () => void;
}) {
  const { t } = useLocale();
  const templates = useMemo(() => studyTemplates(graph), [graph]);
  const [templateId, setTemplateId] = useState(''), [parameter, setParameter] = useState<StudyParameter>('biaxial-ab');
  const [name, setName] = useState('Parameter study'), [valuesText, setValuesText] = useState('-2, -1, 0, 1, 2');
  const [range, setRange] = useState(false), [start, setStart] = useState('-2'), [stop, setStop] = useState('2'), [step, setStep] = useState('1');
  const [working, setWorking] = useState(false), [error, setError] = useState(''), [selectedStudy, setSelectedStudy] = useState('');
  const selectedTemplate = templates.find(node => node.id === templateId) ?? templates[0];
  const source = graph.nodes.find(node => graph.edges.some(edge => edge.target === selectedTemplate?.id && edge.source === node.id && ['structure', 'extract-frame'].includes(node.kind)));
  const analyses = graph.nodes.filter(node => ['bands', 'dos', 'phonon', 'btp2'].includes(node.kind) && graph.edges.some(edge => edge.source === selectedTemplate?.id && edge.target === node.id));
  const definition = parameterDefinition(parameter);
  const preview = useMemo(() => {
    try {
      if (range && [start, stop, step].some(value => !value.trim())) throw new Error(t('Complete the range.', 'Lengkapi rentang.'));
      const values = range ? studyRange(Number(start), Number(stop), Number(step)) : studyValues(valuesText);
      const study: ParameterStudy = { name, parameter, templateId: selectedTemplate?.id ?? '', values };
      return { study, cases: previewParameterStudy(graph, study), error: '' };
    } catch (failure) { return { study: null, cases: [], error: (failure as Error).message }; }
  }, [graph, name, parameter, range, start, stop, step, valuesText, selectedTemplate, t]);
  const studyNodes = graph.nodes.flatMap(node => {
    const raw = node.configuration.parameterStudy as Partial<StudyProvenance> | undefined;
    if (!raw || raw.version !== 1 || typeof raw.studyId !== 'string' || typeof raw.name !== 'string' || !Number.isFinite(raw.value) || !Number.isInteger(raw.caseIndex) || !studyParameters.some(parameter => parameter.id === raw.parameter)) return [];
    return [{ node, provenance: raw as StudyProvenance }];
  });
  const studies = [...new Map(studyNodes.map(item => [item.provenance.studyId, item.provenance])).values()];
  const currentId = studies.some(study => study.studyId === selectedStudy) ? selectedStudy : studies.at(-1)?.studyId;
  const currentNodes = studyNodes.filter(item => item.provenance.studyId === currentId);
  const caseIndices = [...new Set(currentNodes.map(item => item.provenance.caseIndex))].sort((a, b) => a - b);
  const apply = async () => {
    if (!preview.study) return;
    setWorking(true); setError('');
    try {
      const result = await createParameterStudy(graph, preview.study, { x: Math.max(0, ...graph.nodes.map(node => node.position.x)) + 360, y: Math.min(80, ...graph.nodes.map(node => node.position.y)) });
      if (!onApply(result)) throw new Error(t('The workflow changed while preparing this study. Review the preview and try again.', 'Workflow berubah saat studi disiapkan. Tinjau pratinjau dan coba lagi.'));
      setSelectedStudy(result.studyId);
    } catch (failure) { setError((failure as Error).message); }
    finally { setWorking(false); }
  };

  return <div className="parameter-study-workspace"><div className="study-content">
    <header className="study-page-header">
      <div>
        <span className="study-eyebrow"><FlaskConical size={15} aria-hidden="true" />{t('Workflow tools', 'Alat workflow')}</span>
        <h1>{t('Parameter study', 'Studi parameter')}</h1>
        <p>{t('Vary your crystal or SCF settings. Repeat the same analyses for every case.', 'Variasikan kristal atau pengaturan SCF. Ulangi analisis yang sama untuk setiap kasus.')}</p>
      </div>
      <button className="study-secondary" onClick={onCanvas}>{t('Open Canvas', 'Buka Kanvas')}<ArrowRight size={15} aria-hidden="true" /></button>
    </header>

    {!templates.length ? <>
      <section className="study-empty">
        <div className="study-empty-overview">
          <span className="study-kicker">{t('Before you create a study', 'Sebelum membuat studi')}</span>
          <h2>{t('Start with a reference workflow', 'Mulai dari workflow referensi')}</h2>
          <p>{t('Start with a connected workflow on Canvas. Each variation will get an independent copy of its SCF and analyses.', 'Mulai dengan workflow yang terhubung di Kanvas. Setiap variasi mendapat salinan SCF dan analisis yang independen.')}</p>
          <div className="study-workflow-diagram" role="img" aria-label={t('Crystal structure connects to SCF, then branches to optional Bands, DOS, Phonon and BTP2 analyses.', 'Struktur kristal terhubung ke SCF, lalu bercabang ke analisis opsional Bands, DOS, Phonon dan BTP2.')}>
            <div className="study-diagram-node"><Box size={25} strokeWidth={1.25} aria-hidden="true" /><strong>{t('Crystal', 'Kristal')}</strong><small>{t('Reference geometry', 'Geometri referensi')}</small></div>
            <span className="study-diagram-link" aria-hidden="true"><ChevronRight size={15} /></span>
            <div className="study-diagram-node"><Cpu size={25} strokeWidth={1.25} aria-hidden="true" /><strong>SCF</strong><small>{t('Shared settings', 'Pengaturan bersama')}</small></div>
            <span className="study-diagram-link" aria-hidden="true"><ChevronRight size={15} /></span>
            <div className="study-diagram-analyses"><span>Bands</span><span>DOS</span><span>Phonon</span><span>BTP2</span></div>
          </div>
          <div className="study-diagram-caption"><GitBranch size={15} aria-hidden="true" /><span>{t('One SCF per case, shared by its connected analyses.', 'Satu SCF per kasus, dipakai bersama oleh analisisnya.')}</span></div>
        </div>
        <div className="study-setup">
          <h3>{t('Prepare your template', 'Siapkan template Anda')}</h3>
          <ol>
            <li><span><strong>{t('Add your crystal', 'Tambahkan kristal')}</strong><small>{t('Load the reference geometry in a Crystal structure module.', 'Muat geometri referensi di modul Struktur kristal.')}</small></span></li>
            <li><span><strong>{t('Connect an SCF', 'Hubungkan SCF')}</strong><small>{t('Set the cutoffs, mesh and physical model in its editor.', 'Atur cutoff, mesh dan model fisik di editornya.')}</small></span></li>
            <li><span><strong>{t('Add analyses · optional', 'Tambahkan analisis · opsional')}</strong><small>{t('Connect Bands, DOS, Phonon or BTP2, then return here.', 'Hubungkan Bands, DOS, Phonon atau BTP2, lalu kembali ke sini.')}</small></span></li>
          </ol>
          <button className="study-primary" onClick={onCanvas}>{t('Build the template on Canvas', 'Buat template di Kanvas')}<ArrowRight size={16} aria-hidden="true" /></button>
        </div>
      </section>
      <section className="study-possibilities" aria-label={t('Available variations', 'Variasi yang tersedia')}>
        <h2>{t('What can you vary?', 'Apa yang bisa divariasikan?')}</h2>
        <div className="study-variation-families">
          <div><MoveUpRight size={19} strokeWidth={1.5} aria-hidden="true" /><h3>{t('Crystal geometry', 'Geometri kristal')}</h3><p>{t('Lattice strain, biaxial strain, volume, c/a and Cartesian shear.', 'Strain kisi, strain biaksial, volume, c/a dan shear Kartesian.')}</p><span>%</span></div>
          <div><Layers3 size={19} strokeWidth={1.5} aria-hidden="true" /><h3>{t('Numerical convergence', 'Konvergensi numerik')}</h3><p>{t('Wavefunction cutoff, charge-density cutoff and periodic k-mesh.', 'Cutoff fungsi gelombang, cutoff densitas muatan dan k-mesh periodik.')}</p><span>Ry · k-mesh</span></div>
          <div><SlidersHorizontal size={19} strokeWidth={1.5} aria-hidden="true" /><h3>{t('Electronic settings', 'Pengaturan elektronik')}</h3><p>{t('Bulk cell charge and electronic smearing width.', 'Muatan sel bulk dan lebar smearing elektronik.')}</p><span>e/cell · Ry</span></div>
        </div>
      </section>
    </> : <section className="study-builder" aria-label={t('New study', 'Studi baru')}>
      <div className="study-fields">
        <section className="study-form-section">
          <header className="study-section-heading"><span>1</span><div><h2>{t('Reference workflow', 'Workflow referensi')}</h2><p>{t('The settings to repeat for each case.', 'Pengaturan yang diulang untuk setiap kasus.')}</p></div></header>
          <label>{t('Study name', 'Nama studi')}<input value={name} maxLength={100} onChange={event => setName(event.target.value)} /></label>
          <UiSelect label={t('Workflow template · SCF', 'Template workflow · SCF')} value={selectedTemplate?.id ?? ''} options={templates.map(node => ({ value: node.id, label: node.name }))} onChange={setTemplateId} />
          <div className="study-template-modules">
            {source && <button onClick={() => onOpen(source.id)}><Box size={14} aria-hidden="true" /><span>{source.name}</span><ArrowRight size={12} aria-hidden="true" /></button>}
            {analyses.map(node => <button key={node.id} onClick={() => onOpen(node.id)}><GitBranch size={14} aria-hidden="true" /><span>{node.name}</span><ArrowRight size={12} aria-hidden="true" /></button>)}
            {!analyses.length && <small>{t('SCF only. Connect analyses on Canvas to include them.', 'Hanya SCF. Hubungkan analisis di Kanvas untuk menyertakannya.')}</small>}
          </div>
        </section>
        <section className="study-form-section">
          <header className="study-section-heading"><span>2</span><div><h2>{t('Parameter & values', 'Parameter & nilai')}</h2><p>{t('Change one parameter. Keep the rest.', 'Ubah satu parameter. Pertahankan yang lain.')}</p></div></header>
          <UiSelect label={t('Vary one parameter', 'Variasikan satu parameter')} value={parameter} options={studyParameters.map(item => ({ value: item.id, label: `${t(item.en, item.idLabel)} · ${item.unit}` }))} onChange={value => { const selected = parameterDefinition(value as StudyParameter); setParameter(selected.id); setValuesText(selected.values); setRange(false); setError(''); }} />
          <fieldset className="study-values">
            <legend>{t('Values', 'Nilai')} <span>{definition.unit}</span></legend>
            <div className="study-value-mode" role="group" aria-label={t('Value entry', 'Input nilai')}>
              <button aria-pressed={!range} onClick={() => setRange(false)}>{t('List', 'Daftar')}</button><button aria-pressed={range} onClick={() => setRange(true)}>{t('Range', 'Rentang')}</button>
            </div>
            {range ? <div className="study-range">{[[t('Start', 'Awal'), start, setStart], [t('Stop', 'Akhir'), stop, setStop], [t('Step', 'Interval'), step, setStep]].map(([label, value, setter]) => <label key={String(label)}>{String(label)}<input type="number" step="any" value={String(value)} onChange={event => (setter as (value: string) => void)(event.target.value)} /></label>)}</div> : <input aria-label={t('Parameter values', 'Nilai parameter')} value={valuesText} onChange={event => setValuesText(event.target.value)} />}
            <small>{t('2–32 distinct values. Review every case before creating it.', '2–32 nilai berbeda. Tinjau setiap kasus sebelum membuatnya.')}</small>
          </fieldset>
          <div className="study-method"><Info size={15} aria-hidden="true" /><p>{definition.geometry ? t('Affine geometry only: fractional coordinates stay fixed. Each case starts from the reference. No relaxation is implied.', 'Hanya geometri affine: koordinat fraksional tetap. Setiap kasus dimulai dari referensi. Belum ada relaksasi.') : parameter === 'charge' ? t('Positive charge removes electrons. This periodic charged-cell model is not chemical substitution or rigid-band carrier doping.', 'Muatan positif mengurangi elektron. Model sel periodik bermuatan ini bukan substitusi kimia atau doping carrier rigid-band.') : t('Only the selected SCF parameter changes. Analysis sampling and unvaried cutoffs stay fixed from the template.', 'Hanya parameter SCF terpilih yang berubah. Sampling analisis dan cutoff lainnya tetap mengikuti template.')}</p></div>
          <details className="study-method-details"><summary>{t('Method & comparison notes', 'Catatan metode & perbandingan')}</summary><p>{t('Lattice a/b/c strain follows lattice vectors. Simple Cartesian shear uses F = I + γ e_i ⊗ e_j, γ = percent/100. Automatic band paths may change with symmetry; use a valid shared custom path for pointwise comparisons.', 'Strain a/b/c mengikuti vektor kisi. Shear Kartesian sederhana memakai F = I + γ e_i ⊗ e_j, γ = persen/100. Jalur pita otomatis dapat berubah mengikuti simetri; gunakan jalur custom bersama yang valid untuk komparasi titik demi titik.')}</p></details>
        </section>
      </div>

      <section className="study-preview">
        <header className="study-section-heading"><span>3</span><div><h2>{t('Preview', 'Pratinjau')}</h2><p>{t('Review the cases before adding them to Canvas.', 'Tinjau kasus sebelum menambahkannya ke Kanvas.')}</p></div></header>
        {preview.error ? <div className="study-validation" role="status"><CircleAlert size={17} aria-hidden="true" /><p>{preview.error}</p></div> : <>
          <div className="study-count"><div><strong>{preview.cases.length}</strong><span>{t('cases', 'kasus')}</span></div><p>{preview.cases.length * (analyses.length + 1)} {t('compute modules', 'modul komputasi')}<small>{t('SCF + connected analyses', 'SCF + analisis terhubung')}</small></p></div>
          <div className="study-table-scroll"><table><thead><tr><th>{t('Value', 'Nilai')} ({definition.unit})</th><th>{t('Cell volume', 'Volume sel')} (Å³)</th><th>{definition.geometry ? t('Lattice a × b × c (Å)', 'Kisi a × b × c (Å)') : parameter === 'k-grid' ? t('Mesh (kx × ky × kz)', 'Mesh (kx × ky × kz)') : parameter === 'charge' ? t('Total charge', 'Muatan total') : parameter === 'smearing' ? t('Smearing', 'Smearing') : 'SCF cutoff (Ry)'}</th></tr></thead><tbody>{preview.cases.map(item => <tr key={item.value}><td>{item.value}</td><td>{item.volume.toPrecision(8)}</td><td>{definition.geometry ? `${item.structure.lattice.a.toFixed(3)} × ${item.structure.lattice.b.toFixed(3)} × ${item.structure.lattice.c.toFixed(3)}` : parameter === 'k-grid' ? `${item.draft.kPoint} × ${item.draft.kPointY} × ${item.draft.kPointZ}` : parameter === 'charge' ? `${item.draft.totalCharge} e/cell` : parameter === 'smearing' ? `${item.draft.smearing} Ry` : (item.draft.cutoffPolicy === 'manual' ? `${item.draft.cutoff} / ${item.draft.chargeDensityCutoff}` : t('Template auto', 'Otomatis template'))}</td></tr>)}</tbody></table></div>
        </>}
        <footer className="study-preview-footer">
          <p><GitBranch size={15} aria-hidden="true" />{t('Independent cases. Your template stays unchanged.', 'Kasus independen. Template Anda tetap sama.')}</p>
          {error && <p className="study-validation" role="alert">{error}</p>}
          <button className="study-primary study-create" disabled={disabled || working || !preview.study} onClick={() => void apply()}><Plus size={16} aria-hidden="true" />{working ? t('Preparing…', 'Menyiapkan…') : t('Create study', 'Buat studi')}</button>
          <small>{t('Creates modules only. Review and run when you’re ready.', 'Hanya membuat modul. Tinjau dan jalankan saat Anda siap.')}</small>
        </footer>
      </section>
    </section>}

    {!!studies.length && (() => {
      const referenceNode = graph.nodes.find(node => (node.configuration.studyReference as { studyId?: string } | undefined)?.studyId === currentId);
      const targetIds = [...(referenceNode ? [referenceNode.id] : []), ...currentNodes.map(item => item.node.id)];
      return <section className="study-results">
        <header className="study-results-header">
          <div><span className="study-kicker">{t('Saved in this project', 'Tersimpan di project ini')}</span><h2>{t('Study cases', 'Kasus studi')} <span className="study-case-count">{caseIndices.length}</span></h2></div>
          <UiSelect ariaLabel={t('Saved study', 'Studi tersimpan')} value={currentId ?? ''} options={studies.map(study => ({ value: study.studyId, label: study.name }))} onChange={setSelectedStudy} />
        </header>
        <p>{t('Independent snapshots. Editing the template leaves these cases unchanged.', 'Snapshot independen. Mengedit template tidak mengubah kasus ini.')}</p>
        <div className="study-table-scroll"><table><thead><tr><th>{t('Case', 'Kasus')}</th><th>{t('Modules and actual run states', 'Modul dan status eksekusi aktual')}</th></tr></thead><tbody>{caseIndices.map(index => {
          const members = currentNodes.filter(item => item.provenance.caseIndex === index), provenance = members[0].provenance;
          return <tr key={index}><th><small className="study-case-index">{t('Case', 'Kasus')} {index + 1}</small>{provenance.value} <span className="study-case-unit">{provenance.unit}</span></th><td><div className="study-case-modules">{members.map(({ node }) => {
            const attempt = attempts.find(attempt => attempt.nodeId === node.id);
            return <button key={node.id} onClick={() => onOpen(node.id)}><span>{node.name}<ArrowRight size={12} aria-hidden="true" /></span><small>{attempt ? attempt.status : t('Not run', 'Belum dijalankan')}</small></button>;
          })}</div></td></tr>;
        })}</tbody></table></div>
        <div className="study-results-actions"><button className="study-secondary" onClick={() => onShowCases(targetIds)}>{t('Show cases on Canvas', 'Lihat kasus di Kanvas')}<ArrowRight size={15} aria-hidden="true" /></button><button className="study-primary" disabled={disabled} onClick={() => onRun(currentNodes.filter(item => item.node.kind !== 'structure').map(item => item.node.id))}><Play size={14} aria-hidden="true" />{t('Review study run', 'Tinjau eksekusi studi')}</button></div>
        {currentNodes[0] && <details className="study-provenance"><summary>{t('Source & provenance', 'Sumber & provenance')} <span>SHA-256</span></summary><dl><dt>{t('Source crystal', 'Kristal sumber')}</dt><dd>{currentNodes[0].provenance.sourceSha256}</dd><dt>{t('Workflow template', 'Template workflow')}</dt><dd>{currentNodes[0].provenance.templateSha256}</dd></dl></details>}
      </section>;
    })()}
  </div></div>;
}
