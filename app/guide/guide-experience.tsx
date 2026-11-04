'use client';

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ComponentType, SVGProps } from 'react';
import { Activity, Archive, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, Atom, BookOpen, Check, ChevronRight, Cloud, Copy, CreditCard, Cpu, FileText, FolderOpen, Globe, Keyboard, Layers, List, Maximize2, Monitor, MousePointer2, Printer, Search, Settings2, ShieldCheck, SlidersHorizontal, Terminal, Wrench, X } from 'lucide-react';
import { Footer } from '../footer';
import { Navbar } from '../navbar';
import { PublicReveal } from '../public-motion';
import { CalculationIcon, FiguresIcon, MdLabIcon, PhyniteAiIcon } from '../tool-icons';
import { useLocale } from '../locale-provider';
import { getGuideSections, guideTopicKind, searchGuide } from '@/lib/guide-library';
import type { GuideBlock } from '@/lib/guide-content';
import { guidePath, legacyGuideDestination } from '@/lib/guide-routing';
import { materializeGuideSections } from '@/lib/guide-release';
import type { LocalReleaseMetadata } from '@/lib/local-release-metadata';

function TopicIcon({ id, size = 17 }: { id: string; size?: number }) {
  const Icon = ({ workflow: BookOpen, project: FolderOpen, 'npm-local-app': Terminal,
    structure: Atom, edit: MousePointer2, periodicity: Layers, 'slab-workflow': Layers,
    'quickstart-silicon': CalculationIcon, calculation: CalculationIcon, configure: SlidersHorizontal,
    convergence: Activity, execution: Cpu, 'quickstart-md': MdLabIcon, 'local-compute': Monitor,
    'ai-providers': PhyniteAiIcon, 'cloud-sync': Cloud, saving: Archive, billing: CreditCard,
    'storage-backup': Archive, 'settings-reference': Settings2, language: Globe,
    results: FiguresIcon, figures: FiguresIcon, alignment: SlidersHorizontal, studies: Activity,
    reuse: Layers, advanced: SlidersHorizontal, export: ArrowDownToLine, publication: FiguresIcon,
    troubleshooting: Wrench, diagnostics: ShieldCheck, shortcuts: Keyboard, 'field-reference': FileText,
    account: Cloud, roadmap: BookOpen, reference: BookOpen } as Record<string, ComponentType<SVGProps<SVGSVGElement> & { size?: number }>>)[id] ?? BookOpen;
  return <Icon size={size} aria-hidden="true" />;
}

function subscribeGuideTheme(listener: () => void) {
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-workspace-theme', 'data-site-theme'] });
  return () => observer.disconnect();
}

function currentGuideTheme() {
  const theme = document.documentElement.dataset.workspaceTheme ?? document.documentElement.dataset.siteTheme;
  return theme === 'light' ? 'light' : 'dark';
}

function CodeExample({ code }: { code: string }) {
  const { t } = useLocale();
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return <div className="docs-code"><div><span>{t('Example / commands', 'Contoh / perintah')}</span><button onClick={async () => { try { await navigator.clipboard.writeText(code); setStatus('copied'); } catch { setStatus('error'); } if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setStatus('idle'), 2200); }}>{status === 'copied' ? <Check size={14} /> : <Copy size={14} />}{status === 'copied' ? t('Copied', 'Disalin') : status === 'error' ? t('Select and copy the text', 'Pilih dan salin teks') : t('Copy', 'Salin')}</button></div><pre><code>{code}</code></pre></div>;
}

function VisualFigure({ visual, eager = false }: { visual: NonNullable<GuideBlock['visuals']>[number]; eager?: boolean }) {
  const { t } = useLocale();
  const theme = useSyncExternalStore(subscribeGuideTheme, currentGuideTheme, () => 'dark');
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const captionId = useId();
  const source = (theme === 'light' ? visual.lightSrc : visual.darkSrc) ?? visual.src;
  const picture = (enlarged = false) => <picture>
    {visual.mobileSrc && !enlarged && <source media="(max-width: 540px)" srcSet={visual.mobileSrc} width={visual.mobileWidth} height={visual.mobileHeight} />}
    <img src={source} alt={visual.alt} width={visual.width} height={visual.height} loading={enlarged || eager ? 'eager' : 'lazy'} decoding="async" />
  </picture>;
  const close = () => { dialog.current?.close(); setExpanded(false); trigger.current?.focus(); };
  return <figure className={`docs-visual docs-visual-${visual.kind}`}>
    {visual.kind === 'screenshot' ? <><button ref={trigger} type="button" className="docs-visual-open" aria-haspopup="dialog" aria-label={`${t('Enlarge screenshot', 'Perbesar screenshot')}: ${visual.alt}`} onClick={() => { setExpanded(true); dialog.current?.showModal(); }}>
      {picture()}<span className="docs-visual-zoom"><Maximize2 size={14} aria-hidden="true" />{t('Enlarge', 'Perbesar')}</span>
    </button><dialog ref={dialog} className="docs-image-dialog" aria-label={visual.alt} aria-describedby={visual.caption ? captionId : undefined} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(); } }}>
      <header><a href={source} target="_blank" rel="noreferrer">{t('Open full resolution', 'Buka resolusi penuh')}<ArrowUpRight size={14} aria-hidden="true" /></a><button type="button" onClick={close} aria-label={t('Close screenshot', 'Tutup screenshot')}><X size={20} aria-hidden="true" /></button></header>
      <div className="docs-image-expanded">{expanded && picture(true)}</div>
      {visual.caption && <p id={captionId}>{visual.caption}</p>}
    </dialog></> : picture()}
    {visual.caption && <figcaption>{visual.caption}</figcaption>}
  </figure>;
}

function ArticleBlock({ block, id }: { block: GuideBlock; id: string }) {
  const { t } = useLocale();
  return <section className="docs-block" id={id}><h2>{block.title}</h2>{block.visuals?.map((visual, index) => <VisualFigure key={`${visual.src}-${index}`} visual={visual} />)}{block.paragraphs?.map(paragraph => <p key={paragraph}>{paragraph}</p>)}{block.steps && <ol className="docs-steps">{block.steps.map(step => <li key={step}>{step}</li>)}</ol>}{block.bullets && <ul>{block.bullets.map(bullet => <li key={bullet}>{bullet}</li>)}</ul>}{block.table && <div className="docs-table-scroll" role="region" aria-label={block.title} tabIndex={0}><table><thead><tr>{block.table.headings.map(heading => <th key={heading} scope="col">{heading}</th>)}</tr></thead><tbody>{block.table.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => column === 0 ? <th key={column} scope="row">{cell}</th> : <td key={column}>{cell}</td>)}</tr>)}</tbody></table></div>}{block.code && <CodeExample code={block.code} />}{block.links && <ul className="docs-related-links">{block.links.map(link => <li key={link.href}><a href={link.href} {...(link.href.startsWith('https://') ? { target: '_blank', rel: 'noreferrer' } : {})}>{link.label}<ArrowUpRight size={13} /></a></li>)}</ul>}{block.note && <aside className="docs-note"><strong>{t('Note', 'Catatan')}</strong><p>{block.note}</p></aside>}</section>;
}

export function GuideExperience({ topic = '', release }: { topic?: string; release: LocalReleaseMetadata }) {
  const { locale, t } = useLocale();
  const sections = useMemo(() => materializeGuideSections(getGuideSections(locale), release), [locale, release]);
  const [query, setQuery] = useState('');
  const [tocOpen, setTocOpen] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const previousTopic = useRef('');
  const groups = [...new Set(sections.map(section => section.group))];
  const selected = sections.find(section => section.id === topic);
  const results = useMemo(() => searchGuide(sections, query), [sections, query]);
  const sectionIndex = sections.findIndex(section => section.id === topic);
  const searching = Boolean(query.trim());
  useEffect(() => {
    const update = () => {
      const destination = legacyGuideDestination(window.location.pathname, window.location.hash, window.location.search);
      if (destination) window.location.replace(destination);
    };
    queueMicrotask(update);
    window.addEventListener('hashchange', update);
    const shortcut = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable="true"],[role="combobox"],[role="listbox"]')) return;
      if ((event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !event.metaKey && !event.ctrlKey)) { event.preventDefault(); search.current?.focus(); }
    };
    window.addEventListener('keydown', shortcut);
    return () => { window.removeEventListener('hashchange', update); window.removeEventListener('keydown', shortcut); };
  }, []);
  useEffect(() => {
    const scroll = () => {
      const anchor = document.getElementById(window.location.hash.slice(1));
      if (anchor) anchor.scrollIntoView({ block: 'start' });
      else if (previousTopic.current !== topic) { window.scrollTo({ top: 0 }); title.current?.focus({ preventScroll: true }); }
      previousTopic.current = topic;
      const panel = navigation.current;
      const active = panel?.querySelector<HTMLElement>('a[aria-current="page"]');
      if (panel && active && panel.scrollHeight > panel.clientHeight) {
        const offset = active.getBoundingClientRect().top - panel.getBoundingClientRect().top;
        if (offset < 12 || offset > panel.clientHeight - 90) panel.scrollTop += offset - 70;
      }
    };
    const frame = requestAnimationFrame(scroll);
    window.addEventListener('hashchange', scroll);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('hashchange', scroll); };
  }, [topic, locale]);
  const downloadHref = `/downloads/phynite-user-guide${locale === 'id' ? '-id' : ''}.md`;
  const overviewVisual = sections.find(section => section.id === 'npm-local-app')?.blocks.flatMap(block => block.visuals ?? []).find(visual => visual.kind === 'screenshot');
  const featured = [
    { id: 'quickstart-silicon', icon: CalculationIcon, label: t('Run your first calculation', 'Jalankan kalkulasi pertama'), detail: t('Silicon, from import to execution.', 'Silikon, dari impor hingga eksekusi.') },
    { id: 'quickstart-md', icon: MdLabIcon, label: t('Run your first MD simulation', 'Jalankan simulasi MD pertama'), detail: t('Argon, from setup to trajectory.', 'Argon, dari pengaturan hingga trajectory.') },
    { id: 'publication', icon: FiguresIcon, label: t('Prepare a paper figure', 'Siapkan figur paper'), detail: t('Sources, alignment, panels, and export.', 'Sumber, alignment, panel, dan ekspor.') },
    { id: 'ai-providers', icon: PhyniteAiIcon, label: t('Connect an AI provider', 'Hubungkan provider AI'), detail: t('Codex or Antigravity, models, and limits.', 'Codex atau Antigravity, model, dan limit.') },
    { id: 'cloud-sync', icon: Cloud, label: t('Understand Cloud and Sync', 'Pahami Cloud dan Sync'), detail: t('Login, revisions, conflicts, and online compute.', 'Login, revision, konflik, dan compute online.') },
    { id: 'storage-backup', icon: Archive, label: t('Protect research data', 'Lindungi data riset'), detail: t('Storage, QE wavefunctions, export, and backup.', 'Storage, wavefunction QE, ekspor, dan backup.') },
    { id: 'settings-reference', icon: Settings2, label: t('Customize Settings', 'Sesuaikan Pengaturan'), detail: t('Appearance, notifications, keyboard, profile, and usage.', 'Tampilan, notifikasi, keyboard, profil, dan pemakaian.') },
    { id: 'troubleshooting', icon: Wrench, label: t('Recover a failed run', 'Pulihkan run yang gagal'), detail: t('Identify the first cause, read logs, and retry safely.', 'Temukan penyebab pertama, baca log, lalu ulangi dengan aman.') },
  ];
  return <main className="public-experience lab-page studio-page docs-page" data-public-locale={locale}><a className="docs-skip" href="#docs-content">{t('Skip to content', 'Langsung ke isi')}</a><Navbar refined />
    <div className="docs-toolbar"><a href={guidePath(locale)}><BookOpen size={17} />Phynite {t('Documentation', 'Dokumentasi')}</a><label className="docs-search"><Search size={17} /><input ref={search} type="search" placeholder={t('Search documentation', 'Cari dokumentasi')} aria-label={t('Search documentation', 'Cari dokumentasi')} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setQuery(''); event.currentTarget.blur(); } }} />{query ? <button aria-label={t('Clear search', 'Hapus pencarian')} onClick={() => { setQuery(''); search.current?.focus(); }}><X size={15} /></button> : <kbd>/</kbd>}</label><a href={downloadHref} download className="docs-download" aria-label={t('Download complete guide', 'Unduh panduan lengkap')}><ArrowDownToLine size={16} /><span>{t('Download', 'Unduh')}</span></a></div>
    <div className="docs-layout"><aside ref={navigation} className={`docs-navigation ${tocOpen ? 'is-open' : ''}`}><button className="docs-mobile-toc" onClick={() => setTocOpen(value => !value)} aria-expanded={tocOpen}><List size={17} />{t('Browse documentation', 'Jelajahi dokumentasi')}<ChevronRight size={16} /></button><nav aria-label={t('Documentation topics', 'Topik dokumentasi')}><a className="docs-overview-link" href={guidePath(locale)} aria-current={!topic ? 'page' : undefined}>{t('Documentation overview', 'Ringkasan dokumentasi')}</a>{groups.map(group => <div key={group}><p>{group}</p>{sections.filter(section => section.group === group).map(section => <a href={guidePath(locale, section.id)} key={section.id} aria-current={topic === section.id ? 'page' : undefined}><TopicIcon id={section.id} /><span>{section.title}</span></a>)}</div>)}</nav></aside>
      <div className="docs-center" id="docs-content">
        {searching ? <><PublicReveal as="header" className="docs-article-heading"><p className="lab-eyebrow">{t('Documentation search', 'Pencarian dokumentasi')}</p><h1 ref={title} tabIndex={-1}>{t('Search results', 'Hasil pencarian')}</h1><p role="status">{results.length} {t('topics match', 'topik cocok dengan')} “{query}”</p></PublicReveal><div className="docs-search-results">{results.map(section => <a key={section.id} href={guidePath(locale, section.id)} onClick={() => setQuery('')}><span>{section.group} / {guideTopicKind(section.id, locale)}</span><h2><TopicIcon id={section.id} size={20} />{section.title}<ArrowUpRight size={17} /></h2><p>{section.intro}</p></a>)}{!results.length && <div className="docs-note"><p>{t('Try a broader term such as vacuum, DOS, or compute. Search uses the selected documentation language; scientific keywords work in both.', 'Coba istilah seperti vakum, DOS, atau komputasi. Pencarian mengikuti bahasa dokumentasi; keyword ilmiah dapat dipakai di keduanya.')}</p></div>}</div></> : selected ? <>
          <nav className="docs-breadcrumbs" aria-label={t('Breadcrumb', 'Jejak navigasi')}><a href={guidePath(locale)}>{t('Documentation', 'Dokumentasi')}</a><ChevronRight size={12} /><span>{selected.group}</span></nav>
          <PublicReveal as="header" className="docs-article-heading"><div className="docs-article-meta"><span><TopicIcon id={selected.id} />{guideTopicKind(selected.id, locale)}</span><span>{Math.max(1, Math.ceil(JSON.stringify(selected).split(/\s+/).length / 200))} {t('min read', 'menit baca')}</span></div><h1 ref={title} tabIndex={-1}>{selected.title}</h1><p>{selected.intro}</p><div className="docs-article-actions"><button onClick={() => window.print()}><Printer size={14} />{t('Print topic', 'Cetak topik')}</button><a href={downloadHref} download><ArrowDownToLine size={14} />{t('Complete guide', 'Panduan lengkap')}</a></div></PublicReveal>
          <article className="docs-article">{selected.blocks.map((block, index) => <ArticleBlock key={`${selected.id}-${index}`} block={block} id={`docs-${selected.id}-${index + 1}`} />)}</article>
          <nav className="docs-pagination" aria-label={t('Adjacent topics', 'Topik berurutan')}>{sectionIndex > 0 ? <a href={guidePath(locale, sections[sectionIndex - 1].id)}><ArrowLeft size={16} /><span><small>{t('Previous', 'Sebelumnya')}</small>{sections[sectionIndex - 1].title}</span></a> : <span />}{sectionIndex < sections.length - 1 && <a href={guidePath(locale, sections[sectionIndex + 1].id)}><span><small>{t('Next', 'Berikutnya')}</small>{sections[sectionIndex + 1].title}</span><ArrowRight size={16} /></a>}</nav>
        </> : topic ? <div className="lab-empty"><h1 ref={title} tabIndex={-1}>{t('Topic not found', 'Topik tidak ditemukan')}</h1><p>{t('Choose a topic from the navigation or search the documentation.', 'Pilih topik dari navigasi atau cari dokumentasi.')}</p><a className="lab-button" href={guidePath(locale)}>{t('Documentation overview', 'Ringkasan dokumentasi')}</a></div> : <>
          <PublicReveal as="header" className="docs-article-heading docs-home-heading">
            <p className="lab-eyebrow">{t('Phynite Lab documentation', 'Dokumentasi Phynite Lab')}</p>
            <h1 ref={title} tabIndex={-1}>{t('Your research, step by step.', 'Riset Anda, langkah demi langkah.')}</h1>
            <p>{t('Prepare a structure, run QE or MD, and keep the evidence behind every result. Start with your first project or go straight to a tool.', 'Siapkan struktur, jalankan QE atau MD, dan simpan bukti di balik setiap hasil. Mulai dari project pertama atau langsung ke panduan alat.')}</p>
            <div className="docs-home-meta"><span><Terminal size={14} aria-hidden="true" />npm {release.version}</span><span>Node.js {release.nodeRequirement}</span><span>{t('English & Bahasa Indonesia', 'Bahasa Indonesia & English')}</span></div>
          </PublicReveal>
          <section className="docs-start" aria-label={t('Choose how to start', 'Pilih cara memulai')}>
            <div className="docs-start-paths">
              <a href={guidePath(locale, 'npm-local-app')}><Monitor size={22} aria-hidden="true" /><div><h2>{t('On your computer', 'Di komputer Anda')}</h2><p>{t('Install the npm app. Your projects and scientific compute stay local; no Phynite login is required.', 'Instal aplikasi npm. Project dan compute ilmiah tersimpan lokal; tidak perlu login Phynite.')}</p><span>{t('Install & first launch', 'Instal & buka pertama kali')}<ArrowRight size={15} aria-hidden="true" /></span></div></a>
              <a href={guidePath(locale, 'local-compute')}><Cloud size={22} aria-hidden="true" /><div><h2>{t('On the hosted website', 'Di website hosted')}</h2><p>{t('Sign in to the website, then choose a paired personal worker or available Cloud compute.', 'Masuk ke website, lalu pilih worker pribadi terhubung atau compute Cloud yang tersedia.')}</p><span>{t('Compare compute options', 'Bandingkan pilihan compute')}<ArrowRight size={15} aria-hidden="true" /></span></div></a>
            </div>
            {overviewVisual && <VisualFigure visual={overviewVisual} eager />}
          </section>
          <section className="docs-study-route"><h2>{t('From installation to a first result', 'Dari instalasi ke hasil pertama')}</h2><p>{t('Follow this path once, then use the guides below for your next study.', 'Ikuti alur ini sekali, lalu gunakan panduan di bawah untuk studi berikutnya.')}</p><ol>{[
            ['npm-local-app', t('Install', 'Instal'), t('Open your local workspace', 'Buka workspace lokal')],
            ['local-compute', t('Prepare compute', 'Siapkan compute'), t('Runtime, isolation, potentials', 'Runtime, isolasi, potensial')],
            ['quickstart-silicon', t('Run a reference', 'Jalankan referensi'), t('A small silicon calculation', 'Kalkulasi silikon kecil')],
            ['results', t('Read the result', 'Baca hasil'), t('Logs, convergence, provenance', 'Log, konvergensi, provenance')],
            ['storage-backup', t('Keep the evidence', 'Simpan bukti'), t('Export and back up your work', 'Ekspor dan backup pekerjaan')],
          ].map(([id, label, detail], index) => <li key={id}><a href={guidePath(locale, id)}><span className="docs-journey-step">{index + 1}</span><span><strong>{label}</strong><small>{detail}</small></span></a></li>)}</ol></section>
          <section className="docs-featured-section"><h2>{t('Choose a task', 'Pilih tugas')}</h2><div className="docs-featured">{featured.map(item => <a href={guidePath(locale, item.id)} key={item.id}><item.icon size={22} aria-hidden="true" /><h3>{item.label}</h3><p>{item.detail}</p><ArrowUpRight size={17} aria-hidden="true" /></a>)}</div></section>
          <section className="docs-directory" aria-label={t('All documentation', 'Semua dokumentasi')}>{groups.map(group => <div key={group}><h2>{group}</h2>{sections.filter(section => section.group === group).map(section => <a key={section.id} href={guidePath(locale, section.id)}><TopicIcon id={section.id} /><span>{section.title}</span><ChevronRight size={14} /></a>)}</div>)}</section>
        </>}
        <footer className="docs-footer"><p>{t('Scientific references', 'Referensi ilmiah')}</p><div><a href="https://www.quantum-espresso.org/Doc/INPUT_PW.html" target="_blank" rel="noreferrer">Quantum ESPRESSO<ArrowUpRight size={12} /></a><a href="https://docs.materialsproject.org/" target="_blank" rel="noreferrer">Materials Project<ArrowUpRight size={12} /></a><a href="https://seekpath.readthedocs.io/" target="_blank" rel="noreferrer">SeeK-path<ArrowUpRight size={12} /></a><a href="https://www.boltztrap.org/" target="_blank" rel="noreferrer">BoltzTraP2<ArrowUpRight size={12} /></a></div><p>{t('Use the documentation for your solver version alongside these procedures. A completed run still needs scientific validation.', 'Gunakan dokumentasi versi solver bersama prosedur ini. Run yang selesai tetap memerlukan validasi ilmiah.')}</p></footer>
      </div>
      {selected && !searching && <aside className="docs-on-page"><p>{t('On this page', 'Pada halaman ini')}</p><nav aria-label={t('On this page', 'Pada halaman ini')}>{selected.blocks.map((block, index) => <a key={index} href={`#docs-${selected.id}-${index + 1}`}>{block.title}</a>)}</nav><a className="docs-support" href="/contact">{t('Get support', 'Hubungi dukungan')}<ArrowUpRight size={14} /></a></aside>}
      <div className="docs-site-footer"><Footer compact /></div>
    </div>
  </main>;
}
