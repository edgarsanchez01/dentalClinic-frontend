import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReceptionDentistPicker } from './ReceptionDentistPicker';

const dentists = [
  { dentistId: 7, firstName: 'Ana', lastName: 'Prueba', days: [] },
  { dentistId: 8, firstName: 'Luis', lastName: 'Sintético', days: [] },
];
afterEach(() => vi.unstubAllGlobals());

describe('UX-04G.3 directorio de profesionales', () => {
  it('UX-04G.4.1 diferencia hover y foco virtual sin cambiar active descendant ni selección', () => {
    const onSelect = vi.fn();
    render(<ReceptionDentistPicker dentists={dentists} selectedId={7} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar dentista' }));
    const input = screen.getByRole('combobox');
    const selected = screen.getByRole('option', { name: 'Ana Prueba Seleccionado' });
    const other = screen.getByRole('option', { name: 'Luis Sintético' });
    fireEvent.mouseMove(other);
    expect(other).toHaveClass('is-active'); expect(other).not.toHaveClass('is-keyboard-active');
    expect(input).toHaveAttribute('aria-activedescendant', other.id);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(selected).toHaveClass('is-active', 'is-keyboard-active');
    expect(selected).toHaveAttribute('aria-selected', 'true'); expect(input).toHaveFocus();
    fireEvent.mouseMove(selected);
    expect(selected).not.toHaveClass('is-keyboard-active');
    expect(selected).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(other).toHaveClass('is-keyboard-active');
    fireEvent.pointerDown(input);
    expect(other).not.toHaveClass('is-keyboard-active');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(selected).toHaveClass('is-keyboard-active');
    fireEvent.blur(input, { relatedTarget: screen.getByRole('button', { name: 'Cambiar dentista' }) });
    expect(selected).not.toHaveClass('is-keyboard-active');
    expect(input).toHaveAttribute('aria-activedescendant', selected.id);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('UX-04G.4.1 mantiene Enter sobre la opción activada por el puntero', () => {
    const onSelect = vi.fn();
    render(<ReceptionDentistPicker dentists={dentists} selectedId={7} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar dentista' }));
    const input = screen.getByRole('combobox');
    fireEvent.mouseMove(screen.getByRole('option', { name: 'Luis Sintético' }));
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(8);
    expect(screen.getByRole('button', { name: 'Cambiar dentista' })).toHaveFocus();
  });

  it('un único profesional sigue identificado y no ofrece un cambio inexistente', () => {
    render(<ReceptionDentistPicker dentists={dentists.slice(0, 1)} selectedId={7} onSelect={vi.fn()} />);
    expect(screen.getByText('Único dentista disponible')).toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('buscar no cambia el ID, admite tildes y no elige texto libre', () => {
    const onSelect = vi.fn();
    render(<ReceptionDentistPicker dentists={dentists} selectedId={7} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar dentista' }));
    const input = screen.getByRole('combobox', { name: 'Buscar dentista' }); input.focus();
    expect(screen.getByRole('option', { name: 'Ana Prueba Seleccionado' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.change(input, { target: { value: 'sintetico' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(input, { key: 'Enter' }); expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', 'rs-professional-8');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(8);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Cambiar dentista' })).toHaveFocus();
  });

  it('vacío y Escape conservan la selección y cierran el selector', () => {
    const onSelect = vi.fn();
    render(<ReceptionDentistPicker dentists={dentists} selectedId={7} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar dentista' }));
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'ninguno' } });
    expect(screen.getByRole('status')).toHaveTextContent('No hay dentistas que coincidan');
    fireEvent.keyDown(input, { key: 'ArrowUp' }); fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cambiar dentista' })).toHaveFocus();
  });

  it('en móvil abre, enfoca, cancela y elige sin duplicar el selector', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    const onSelect = vi.fn();
    render(<ReceptionDentistPicker dentists={dentists} selectedId={7} onSelect={onSelect} />);
    const toggle = screen.getByRole('button', { name: 'Cambiar dentista' });
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument(); fireEvent.click(toggle);
    const input = screen.getByRole('combobox'); expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'ArrowDown' }); fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' }); expect(toggle).toHaveFocus();
    fireEvent.click(toggle); fireEvent.click(screen.getByRole('option', { name: 'Luis Sintético' }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(8);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument(); expect(toggle).toHaveFocus();
  });

  it('180 profesionales montan como máximo20 filas y las flechas atraviesan páginas', () => {
    const many = Array.from({ length: 180 }, (_, index) => ({ dentistId: index + 1, firstName: 'Profesional', lastName: String(index + 1), days: [] }));
    const onSelect = vi.fn();
    render(<ReceptionDentistPicker dentists={many} selectedId={1} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar dentista' }));
    expect(screen.getAllByRole('option')).toHaveLength(20);
    const input = screen.getByRole('combobox');
    for (let i = 0; i < 21; i++) fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant', 'rs-professional-21');
    expect(screen.getByRole('status')).toHaveTextContent('21–40 de 180');
    fireEvent.keyDown(input, { key: 'Enter' }); expect(onSelect).toHaveBeenCalledWith(21);
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar dentista' }));
    const reopened = screen.getByRole('combobox');
    fireEvent.change(reopened, { target: { value: 'Profesional 180' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(reopened, { key: 'ArrowDown' }); fireEvent.keyDown(reopened, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith(180);
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar dentista' }));
    expect(screen.getByRole('status')).toHaveTextContent('161–180 de 180');
    expect(screen.getAllByRole('option')).toHaveLength(20);
  });
});
