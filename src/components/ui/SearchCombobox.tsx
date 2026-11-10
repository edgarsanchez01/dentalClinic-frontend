import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import './ui.css';

export interface SearchOption {
  id: string;
  label: string;
  description?: string;
}

export interface SearchComboboxProps {
  id?: string;
  name?: string;
  label: string;
  listLabel: string;
  placeholder?: string;
  inputValue: string;
  selectedId: string | null;
  options: readonly SearchOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInputChange: (text: string) => void;
  onSelect: (id: string) => void;
  onClear: () => void;
  clearLabel: string;
  clearText: string;
  required?: boolean;
  disabled?: boolean;
  hint: string;
  hintVisible?: boolean;
  error?: string;
  status: 'idle' | 'loading' | 'ready' | 'error';
  refreshing?: boolean;
  loadingMessage: string;
  emptyMessage: string;
  errorFeedback?: ReactNode;
  more?: { label: string; disabled: boolean; onLoad: () => void };
  selectionFeedback?: ReactNode;
}

/** Controlled interaction only. Data, identity resolution and messages belong to the caller. */
export function SearchCombobox({ id: suppliedId, name, label, listLabel, placeholder, inputValue, selectedId,
  options, open, onOpenChange, onInputChange, onSelect, onClear, clearLabel, clearText,
  required = false, disabled = false, hint, hintVisible = false, error, status, refreshing = false,
  loadingMessage, emptyMessage, errorFeedback, more, selectionFeedback }: SearchComboboxProps) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const root = useRef<HTMLFieldSetElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(-1);
  const busy = status === 'loading' || refreshing;
  const activeOption = open && active >= 0 && active < options.length ? `${id}-option-${active}` : undefined;

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) { onOpenChange(false); setActive(-1); }
    }
    function sizePopup() {
      const bottom = input.current?.getBoundingClientRect().bottom ?? 0;
      const viewport = window.visualViewport;
      const edge = viewport ? viewport.height + viewport.offsetTop : window.innerHeight;
      const reserve = window.innerWidth < 768 ? 96 : 24;
      root.current?.style.setProperty('--combobox-popup-space', `${Math.max(80, edge - bottom - reserve)}px`);
    }
    sizePopup();
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', sizePopup);
    window.visualViewport?.addEventListener('resize', sizePopup);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', sizePopup);
      window.visualViewport?.removeEventListener('resize', sizePopup);
    };
  }, [open, onOpenChange]);
  useEffect(() => {
    if (activeOption) document.getElementById(activeOption)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeOption]);

  function openList() { if (!disabled) { onOpenChange(true); setActive(-1); } }
  function closeList() { onOpenChange(false); setActive(-1); }
  function pick(next: string) { if (!disabled) { onSelect(next); closeList(); } }
  function move(delta: number) {
    if (!open) { openList(); return; }
    if (options.length === 0) return;
    const base = active === -1 ? (delta > 0 ? -1 : options.length) : active;
    setActive(((base + delta) % options.length + options.length) % options.length);
  }
  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled || event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
    else if (event.key === 'Enter' && open) { event.preventDefault(); if (activeOption) pick(options[active]!.id); }
    else if (event.key === 'Escape' && open) { event.preventDefault(); closeList(); }
  }
  return <fieldset ref={root} disabled={disabled} className="ce-combobox-root max-w-full min-w-0"
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) closeList(); }}>
    <div className="ce-combobox">
      <label className="ce-combobox-label" htmlFor={`${id}-combobox`}>{label}</label>
      <div className="ce-combobox-field">
        <input ref={input} id={`${id}-combobox`} name={name} type="text" className="ce-combobox-input" role="combobox"
          autoComplete="off" spellCheck={false} aria-expanded={open} aria-controls={`${id}-listbox`}
          aria-autocomplete="list" aria-haspopup="listbox" aria-required={required}
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`} aria-invalid={error ? true : undefined}
          aria-activedescendant={activeOption} placeholder={placeholder} value={inputValue}
          onChange={event => { if (!disabled) { onInputChange(event.target.value); openList(); } }}
          onKeyDown={onKeyDown} onFocus={openList} onClick={openList} />
        {selectedId !== null || inputValue ? <button type="button" className="ce-combobox-toggle" aria-label={clearLabel}
          onClick={() => { if (!disabled) { onClear(); input.current?.focus(); openList(); } }}>{clearText}</button> : null}
      </div>
      {open ? <div className="ce-combobox-panel">
        <ul id={`${id}-listbox`} role="listbox" aria-label={listLabel} aria-busy={busy} className="ce-combobox-list">
          {options.map((option, index) => <li key={option.id} id={`${id}-option-${index}`} role="option"
            aria-selected={option.id === selectedId} className={`ce-combobox-option${active === index ? ' is-active' : ''}`}
            onMouseDown={event => event.preventDefault()}
            onMouseEnter={() => setActive(index)} onClick={() => pick(option.id)}
            onMouseMove={() => { if (active !== index) setActive(index); }}>
            <span className="ce-combobox-option-name">{option.label}</span>
            {option.description !== undefined ? <span className="ce-combobox-option-meta">{option.description}</span> : null}
          </li>)}
        </ul>
        {more ? <button type="button" className="ce-combobox-more" disabled={more.disabled}
          onMouseDown={event => event.preventDefault()}
          onClick={() => { if (!disabled) { input.current?.focus(); setActive(-1); more.onLoad(); } }}>{more.label}</button> : null}
        <div className="ce-combobox-status">
          {busy ? <p role="status">{loadingMessage}</p> : null}
          {status === 'error' ? errorFeedback : null}
          {status === 'ready' && !busy && options.length === 0 ? <p role="status">{emptyMessage}</p> : null}
        </div>
      </div> : null}
    </div>
    {selectionFeedback}
    <p id={`${id}-hint`} className={hintVisible ? 'ce-combobox-hint' : 'sr-only'}>{hint}</p>
    {error ? <p id={`${id}-error`} role="alert">{error}</p> : null}
  </fieldset>;
}
