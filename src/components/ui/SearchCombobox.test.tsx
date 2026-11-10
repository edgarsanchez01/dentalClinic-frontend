import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { SearchCombobox, type SearchOption } from './SearchCombobox';

const options: SearchOption[] = [{ id: 'a', label: 'Primera' }, { id: 'b', label: 'Segunda', description: 'Referencia b' }];
afterEach(cleanup);

function Control({ disabled = false, entries = options, onSelect = vi.fn() }: {
  disabled?: boolean; entries?: SearchOption[]; onSelect?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  return <SearchCombobox label="Entidad" listLabel="Resultados" inputValue={text} selectedId={selected}
    options={entries} open={open} onOpenChange={setOpen} onInputChange={setText}
    onSelect={id => { onSelect(id); setSelected(id); setText(entries.find(e => e.id === id)!.label); }}
    onClear={() => { setSelected(null); setText(''); }} clearText="Limpiar" clearLabel="Limpiar entidad"
    disabled={disabled} status="ready" loadingMessage="Buscando" emptyMessage="Sin resultados" hint="Ayuda" />;
}

it('dos instancias no comparten IDs ni referencias ARIA', () => {
  render(<><Control /><Control /></>);
  const inputs = screen.getAllByRole('combobox');
  inputs.forEach(input => fireEvent.focus(input));
  const ids = Array.from(document.querySelectorAll('[id]')).map(el => el.id);
  expect(new Set(ids).size).toBe(ids.length);
  inputs.forEach(input => {
    expect(document.getElementById(input.getAttribute('aria-controls')!)).toHaveAttribute('role', 'listbox');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)).toHaveTextContent('Ayuda');
  });
});

it('abre sin seleccionar, navega con wrap y confirma una sola vez por ID', () => {
  const picked = vi.fn(); render(<Control onSelect={picked} />);
  const input = screen.getByRole('combobox'); fireEvent.focus(input);
  expect(input).not.toHaveAttribute('aria-activedescendant'); expect(picked).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  expect(document.getElementById(input.getAttribute('aria-activedescendant')!)).toHaveTextContent('Segunda');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(picked).toHaveBeenCalledExactlyOnceWith('a');
  expect(input).toHaveValue('Primera'); expect(input).toHaveAttribute('aria-expanded', 'false');
});

it('Enter abierto sin opción activa no envía el formulario; Escape no borra', () => {
  const submit = vi.fn(); render(<form onSubmit={submit}><Control /></form>);
  const input = screen.getByRole('combobox'); fireEvent.focus(input);
  expect(fireEvent.keyDown(input, { key: 'Enter' })).toBe(false); expect(submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('option', { name: 'Primera' })); fireEvent.focus(input);
  fireEvent.keyDown(input, { key: 'Escape' }); expect(input).toHaveValue('Primera');
  expect(input).toHaveAttribute('aria-expanded', 'false');
});

it('limpiar devuelve foco y Tab no se cancela; blur exterior cierra', () => {
  render(<><Control /><button>Fuera</button></>);
  const input = screen.getByRole('combobox'); fireEvent.change(input, { target: { value: 'x' } });
  fireEvent.click(screen.getByRole('button', { name: 'Limpiar entidad' }));
  expect(input).toHaveFocus(); expect(input).toHaveValue('');
  expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true);
  expect(fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })).toBe(true);
  fireEvent.blur(input, { relatedTarget: screen.getByText('Fuera') }); expect(input).toHaveAttribute('aria-expanded', 'false');
});

it('pointer exterior cierra y mover el puntero permite seleccionar sin perder el foco', () => {
  render(<Control />); const input = screen.getByRole('combobox'); act(() => input.focus());
  const option = screen.getByRole('option', { name: /Segunda\s*Referencia b/ });
  fireEvent.mouseEnter(option); expect(input).toHaveAttribute('aria-activedescendant', option.id);
  expect(fireEvent.mouseDown(option)).toBe(false);
  fireEvent.pointerDown(document.body); expect(input).toHaveAttribute('aria-expanded', 'false');
});

it('IME no intercepta flechas, Enter ni Escape', () => {
  const picked = vi.fn(); render(<Control onSelect={picked} />);
  const input = screen.getByRole('combobox'); fireEvent.focus(input);
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Escape']) expect(fireEvent.keyDown(input, { key, isComposing: true })).toBe(true);
  expect(input).not.toHaveAttribute('aria-activedescendant'); expect(input).toHaveAttribute('aria-expanded', 'true');
  expect(picked).not.toHaveBeenCalled();
});

it('disabled no abre ni emite cambios', () => {
  const picked = vi.fn(); render(<Control disabled onSelect={picked} />);
  const input = screen.getByRole('combobox'); expect(input).toBeDisabled(); fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'x' } }); fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(input).toHaveValue(''); expect(screen.queryByRole('listbox')).not.toBeInTheDocument(); expect(picked).not.toHaveBeenCalled();
});

it('opciones retiradas no dejan active descendant huérfano', () => {
  const view = render(<Control />); const input = screen.getByRole('combobox'); fireEvent.focus(input);
  fireEvent.keyDown(input, { key: 'ArrowUp' }); expect(input).toHaveAttribute('aria-activedescendant');
  view.rerender(<Control entries={[]} />); expect(input).not.toHaveAttribute('aria-activedescendant');
  expect(screen.getByRole('status')).toHaveTextContent('Sin resultados');
});

it('required/error se describen sin validar texto como identidad', () => {
  render(<SearchCombobox label="Campo" listLabel="Opciones" inputValue="Texto no seleccionado" selectedId={null}
    options={[]} open={false} onOpenChange={vi.fn()} onInputChange={vi.fn()} onSelect={vi.fn()} onClear={vi.fn()}
    clearLabel="Limpiar" clearText="Limpiar" required hint="Obligatorio" error="Elige una opción"
    status="idle" loadingMessage="Cargando" emptyMessage="Vacío" />);
  const input = screen.getByRole('combobox'); expect(input).toHaveAttribute('aria-required', 'true');
  expect(input).toHaveAttribute('aria-invalid', 'true'); expect(input).toHaveAccessibleDescription('Obligatorio Elige una opción');
});

it('la UI no importa API, sesión, auth o TanStack', () => {
  const source = readFileSync('src/components/ui/SearchCombobox.tsx', 'utf8');
  expect(source).not.toMatch(/from ['"][^'"]*(?:api\/|app\/|auth\/|@tanstack)/);
});
