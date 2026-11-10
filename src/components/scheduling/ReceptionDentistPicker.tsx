import { useEffect, useMemo, useRef, useState } from 'react';
import type { PublicScheduleDto } from '../../api/scheduling';

type Dentist = PublicScheduleDto['dentists'][number];
const fullName = (dentist: Dentist) => `${dentist.firstName} ${dentist.lastName}`.trim();
const normalized = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim();
const PAGE_SIZE = 20;

/** One compact searchable disclosure at every viewport, with a bounded set of options. */
export function ReceptionDentistPicker({ dentists, selectedId, onSelect }: {
  dentists: Dentist[]; selectedId: number; onSelect: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [active, setActive] = useState(-1);
  // Virtual option focus follows arrows, not pointer hover; the combobox retains DOM focus.
  const [keyboardActive, setKeyboardActive] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const entries = useMemo(() => dentists.filter((dentist) => normalized(fullName(dentist)).includes(normalized(search))), [dentists, search]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(entries.length / PAGE_SIZE) - 1));
  const start = currentPage * PAGE_SIZE;
  const visible = open;
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => { if (list.current) list.current.scrollTop = 0; }, [currentPage, search]);
  useEffect(() => {
    if (visible && active >= start && active < start + PAGE_SIZE) list.current?.children[active - start]?.scrollIntoView?.({ block: 'nearest' });
  }, [active, start, visible]);

  function close() { setOpen(false); setKeyboardActive(false); toggle.current?.focus(); }
  function pick(id: number) {
    onSelect(id); setSearch('');
    const index = dentists.findIndex((dentist) => dentist.dentistId === id);
    setPage(Math.floor(Math.max(0, index) / PAGE_SIZE)); setActive(-1);
    close();
  }
  function move(delta: number) {
    if (!entries.length) return;
    const base = active < 0 ? delta > 0 ? start - 1 : Math.min(start + PAGE_SIZE, entries.length) : active;
    const next = (base + delta + entries.length) % entries.length;
    setActive(next); setPage(Math.floor(next / PAGE_SIZE)); setKeyboardActive(true);
  }

  return <div className="rs-picker" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    {dentists.length > 1 ? <button ref={toggle} type="button" className="reception-button reception-button-secondary rs-change"
      aria-expanded={open} aria-controls={visible ? 'rs-professional-picker' : undefined} onClick={() => open ? close() : setOpen(true)}>
      Cambiar dentista
    </button> : null}
    {dentists.length === 1 ? <p className="rs-note rs-directory-single">Único dentista disponible</p> : null}
    {visible ? <div id="rs-professional-picker" className="rs-picker-panel">
      <div className="rs-field">
        <label htmlFor="rs-professional-search">Buscar dentista</label>
        <input ref={input} id="rs-professional-search" type="text" role="combobox" autoComplete="off" spellCheck={false}
          aria-expanded="true" aria-controls="rs-professional-options" aria-autocomplete="list" aria-describedby="rs-picker-hint"
          aria-activedescendant={active >= start && active < start + PAGE_SIZE && entries[active] ? `rs-professional-${entries[active].dentistId}` : undefined}
          placeholder="Nombre o apellidos" value={search}
          onBlur={() => setKeyboardActive(false)} onPointerDown={() => setKeyboardActive(false)}
          onChange={(event) => { setSearch(event.target.value); setPage(0); setActive(-1); }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); move(event.key === 'ArrowDown' ? 1 : -1); }
            else if (event.key === 'Enter') { event.preventDefault(); if (entries[active]) pick(entries[active].dentistId); }
            else if (event.key === 'Escape') { event.preventDefault(); close(); }
          }} />
      </div>
      <ul ref={list} id="rs-professional-options" role="listbox" aria-label="Dentistas disponibles" className="rs-picker-list">
        {entries.slice(start, start + PAGE_SIZE).map((dentist, index) => <li key={dentist.dentistId} id={`rs-professional-${dentist.dentistId}`} role="option"
          aria-selected={selectedId === dentist.dentistId} aria-posinset={start + index + 1} aria-setsize={entries.length}
          className={start + index === active ? `is-active${keyboardActive ? ' is-keyboard-active' : ''}` : undefined}
          onMouseDown={(event) => event.preventDefault()} onMouseMove={() => { setActive(start + index); setKeyboardActive(false); }} onClick={() => pick(dentist.dentistId)}>
          <span>{fullName(dentist)}</span>{selectedId === dentist.dentistId ? <>{' '}<span className="rs-picker-current">Seleccionado</span></> : null}
        </li>)}
      </ul>
      <p className="rs-note" role="status">{entries.length ? `${start + 1}–${Math.min(start + PAGE_SIZE, entries.length)} de ${entries.length}` : 'No hay dentistas que coincidan con la búsqueda.'}</p>
      {entries.length > PAGE_SIZE ? <div className="rs-directory-pages">
        <button type="button" className="reception-button reception-button-secondary" disabled={currentPage === 0}
          onClick={() => { input.current?.focus(); setPage(currentPage - 1); setActive(-1); }}>Anteriores</button>
        <button type="button" className="reception-button reception-button-secondary" disabled={start + PAGE_SIZE >= entries.length}
          onClick={() => { input.current?.focus(); setPage(currentPage + 1); setActive(-1); }}>Siguientes</button>
      </div> : null}
      <p className="sr-only" id="rs-picker-hint">Usa las flechas y Enter para seleccionar. Escape cierra sin cambiar.</p>
    </div> : null}
  </div>;
}
