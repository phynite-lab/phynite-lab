'use client';

import { useEffect, useRef, useState } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightSpecialChars, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import { defaultHighlightStyle, syntaxHighlighting, StreamLanguage } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { useLocale } from '@/app/locale-provider';

/** Syntax and preview only: no interpreter, TeX engine or user HTML is executed. */
export default function AiArtifactTextEditor({ initialValue, format, disabled, onChange, onSave, ariaLabel, onSelectionChange, searchable = false }: { ariaLabel?: string; searchable?: boolean; onSelectionChange?: (selection: { start: number; end: number }) => void; initialValue: string; format: string; disabled?: boolean; onChange: (text: string) => void; onSave: () => void }) {
  const { t } = useLocale();
  const host = useRef<HTMLDivElement>(null), editor = useRef<EditorView | null>(null), callbacks = useRef({ onChange, onSave, onSelectionChange });
  const editable = useRef(new Compartment());
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState({ length: 0, undo: 0, redo: 0 });
  useEffect(() => { callbacks.current = { onChange, onSave, onSelectionChange }; }, [onChange, onSave, onSelectionChange]);
  useEffect(() => {
    if (!host.current) return;
    const language = format === 'python' ? python() : format === 'latex' ? StreamLanguage.define(stex) : format === 'markdown' ? markdown() : [];
    const view = new EditorView({ parent: host.current, state: EditorState.create({ doc: initialValue, extensions: [
      lineNumbers(), highlightSpecialChars(), drawSelection(), highlightActiveLine(), history(), syntaxHighlighting(defaultHighlightStyle), language, EditorView.lineWrapping,
      editable.current.of([EditorState.readOnly.of(false), EditorView.editable.of(true)]),
      keymap.of([{ key: 'Mod-s', run: () => { callbacks.current.onSave(); return true; } }, ...defaultKeymap, ...historyKeymap]),
      EditorView.contentAttributes.of({ 'aria-label': ariaLabel ?? t('Artifact source editor', 'Editor sumber artefak'), spellcheck: 'false' }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
        if (update.docChanged || update.selectionSet) callbacks.current.onSelectionChange?.({ start: update.state.selection.main.from, end: update.state.selection.main.to });
        if (update.docChanged || update.selectionSet) setSelection({ length: update.state.selection.ranges.reduce((n, r) => n + r.to - r.from, 0), undo: undoDepth(update.state), redo: redoDepth(update.state) });
      }),
      EditorView.theme({ '&': { fontSize: 'var(--ui-code-size, 13px)', color: 'var(--panel-text)', backgroundColor: 'var(--panel-bg)' }, '.cm-scroller': { fontFamily: 'var(--font-code, monospace)', overflow: 'auto' }, '.cm-content': { minHeight: '220px', caretColor: 'var(--panel-text)' }, '.cm-gutters': { backgroundColor: 'var(--panel-raised)', color: 'var(--panel-muted)', borderColor: 'var(--panel-border)' }, '&.cm-focused': { outline: '2px solid var(--ai-focus)', outlineOffset: '-2px' }, '.cm-activeLine': { backgroundColor: 'var(--panel-raised)' }, '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'color-mix(in srgb, var(--panel-text) 18%, transparent)' } }),
    ] }) });
    editor.current = view;
    return () => { editor.current = null; view.destroy(); };
    // The owner keys the editor by immutable source version and explicit discard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { editor.current?.dispatch({ effects: editable.current.reconfigure([EditorState.readOnly.of(Boolean(disabled)), EditorView.editable.of(!disabled)]) }); }, [disabled]);
  const findNext = () => {
    const view = editor.current; if (!view || !query) return;
    const text = view.state.doc.toString(), from = view.state.selection.main.to;
    const found = text.indexOf(query, from), start = found < 0 ? text.indexOf(query) : found;
    if (start >= 0) { view.dispatch({ selection: { anchor: start, head: start + query.length }, effects: EditorView.scrollIntoView(start, { y: 'center' }) }); view.focus(); }
  };
  return <div className="ai-artifact-text-editor">{searchable && <form className="note-find" onSubmit={event => { event.preventDefault(); findNext(); }}><label>{t('Find in note', 'Cari di catatan')}<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label><button type="submit" disabled={!query}>{t('Find next', 'Cari berikutnya')}</button></form>}<div className="ai-artifact-edit-history"><button type="button" disabled={disabled || !selection.undo} onClick={() => { if (editor.current) { undo(editor.current); editor.current.focus(); } }}>{t('Undo', 'Urungkan')}</button><button type="button" disabled={disabled || !selection.redo} onClick={() => { if (editor.current) { redo(editor.current); editor.current.focus(); } }}>{t('Redo', 'Ulangi')}</button><small>{t(`${selection.length} selected characters`, `${selection.length} karakter dipilih`)}</small></div><div ref={host} /></div>;
}
