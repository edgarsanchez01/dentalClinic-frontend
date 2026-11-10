import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToothEditor } from './ToothEditor';
import { DentalArcades, ToothSilhouette } from './DentalArcades';
import { dentalCurrent } from '../../test/odontogramFixtures';
import type { ToothRecordDto } from '../../api/odontogram';
import { DENTAL_SILHOUETTES } from '../../assets/dental';
import { CONDITION_ORDER } from './odontogramUi';

const props = (record?: ToothRecordDto) => ({ fdi: 16, record, treatments: [], treatmentsLoading: false, treatmentsError: false,
  onReloadTreatments: vi.fn(), saving: false, onSaveTooth: vi.fn(), onSaveSurface: vi.fn(), onClose: vi.fn(), integrated: true, progressive: true });

describe('UX-05E · editor dental conservador', () => {
  it('una pieza sin registro no preselecciona Sano ni permite guardar sin condición', () => {
    render(<ToothEditor {...props()} />);
    expect(screen.getByLabelText('Condición de la pieza')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Guardar pieza' })).toBeDisabled();
    expect(screen.getByText(/Registra primero la condición/)).toBeVisible();
  });
  it('guardar pieza no envía los borradores de superficies', () => {
    const p = props(dentalCurrent({ toothFdi: 16, treatmentIds: [] }));
    render(<ToothEditor {...p} />);
    fireEvent.change(screen.getByLabelText('Observaciones (opcional)'), { target: { value: 'Observación de pieza' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar pieza' }));
    expect(p.onSaveTooth).toHaveBeenCalledWith({ condition: 'RESTORED', notes: 'Observación de pieza', treatmentIds: [] });
    expect(p.onSaveSurface).not.toHaveBeenCalled();
  });
  it('la respuesta de una superficie limpia solo esa superficie y conserva las otras', async () => {
    const record = dentalCurrent({ toothFdi: 16, treatmentIds: [], notes: '' });
    const p = props(record), dirty = vi.fn();
    const view = render(<ToothEditor {...p} onDirtyChange={dirty} />);
    fireEvent.click(screen.getByText('Superficies de la pieza'));
    fireEvent.change(screen.getByLabelText('Condición de la superficie Oclusal'), { target: { value: 'CARIES' } });
    fireEvent.change(screen.getByLabelText('Superficie a editar'), { target: { value: 'MESIAL' } });
    fireEvent.change(screen.getByLabelText('Condición de la superficie Mesial'), { target: { value: 'RESTORED' } });
    await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(true));
    const oclusal = { id: 1, toothRecordId: record.id, surface: 'OCCLUSAL' as const, condition: 'CARIES' as const, createdAt: record.createdAt, history: [] };
    view.rerender(<ToothEditor {...p} record={{ ...record, surfaces: [oclusal] }} onDirtyChange={dirty} />);
    expect(dirty).toHaveBeenLastCalledWith(true);
    expect(screen.getByLabelText('Condición de la superficie Mesial')).toHaveValue('RESTORED');
    view.rerender(<ToothEditor {...p} record={{ ...record, surfaces: [oclusal, { ...oclusal, id: 2, surface: 'MESIAL', condition: 'RESTORED' }] }} onDirtyChange={dirty} />);
    await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
  });
  it('un fallo de tratamientos bloquea guardar pieza sin eliminar sus vínculos', () => {
    const p = props(dentalCurrent({ toothFdi: 16, treatmentIds: [9] }));
    render(<ToothEditor {...p} treatmentsError />);
    expect(screen.getByRole('button', { name: 'Guardar pieza' })).toBeDisabled();
    expect(p.onSaveTooth).not.toHaveBeenCalled();
  });
  it('el gráfico compartido permite seleccionar directamente incluso piezas sin registro', () => {
    const select = vi.fn();
    render(<DentalArcades dentition="PERMANENT" teeth={[]} onSelect={select} />);
    expect(screen.getAllByRole('button')).toHaveLength(32);
    fireEvent.click(screen.getByRole('button', { name: /Pieza 16 Superior derecho/ }));
    expect(select).toHaveBeenCalledWith(16);
  });
  it('las familias temporales no introducen premolares y no dependen de condiciones', () => {
    const { container } = render(<><ToothSilhouette fdi={11} /><ToothSilhouette fdi={13} /><ToothSilhouette fdi={14} /><ToothSilhouette fdi={16} /><ToothSilhouette fdi={54} /></>);
    expect([...container.querySelectorAll('svg')].map(node => node.getAttribute('data-family'))).toEqual(['incisor', 'canine', 'premolar', 'molar', 'molar']);
    expect(container.querySelectorAll('[data-condition="UNREGISTERED"]')).toHaveLength(5);
  });
  it('UX-05H distingue coronas temporales y permanentes sin cambiar la familia FDI', () => {
    const { container } = render(<>{[11, 51, 13, 53, 16, 55].map(fdi => <ToothSilhouette key={fdi} fdi={fdi} />)}</>);
    const symbols = [...container.querySelectorAll('svg')];
    for (const index of [0, 2, 4]) {
      expect(symbols[index]).toHaveAttribute('data-dentition', 'PERMANENT');
      expect(symbols[index + 1]).toHaveAttribute('data-dentition', 'TEMPORARY');
      expect(symbols[index].querySelector('[data-outline="crown"]')?.getAttribute('d'))
        .not.toBe(symbols[index + 1].querySelector('[data-outline="crown"]')?.getAttribute('d'));
    }
    expect(symbols.every(symbol => symbol.getAttribute('viewBox') === '0 0 44 44')).toBe(true);
    expect(symbols.every(symbol => symbol.getAttribute('width') === '44' && symbol.getAttribute('height') === '44')).toBe(true);
    expect(container.querySelectorAll('.dc-crown-outline[vector-effect="non-scaling-stroke"]')).toHaveLength(6);
  });
  it('UX-05M reutiliza cuatro familias anatómicas con volumen y una silueta distinta por familia', () => {
    const { container } = render(<>{[11, 13, 14, 16, 46].map(fdi => <ToothSilhouette key={fdi} fdi={fdi} />)}</>);
    const symbols = [...container.querySelectorAll('svg')];
    expect(symbols.map(symbol => symbol.getAttribute('data-family'))).toEqual(['incisor', 'canine', 'premolar', 'molar', 'molar']);
    expect(new Set(symbols.slice(0, 4).map(symbol => symbol.querySelector('[data-outline="crown"]')?.getAttribute('d'))).size).toBe(4);
    expect(symbols.every(symbol => symbol.querySelector('.dc-crown-outline')?.getAttribute('fill') === 'none')).toBe(true);
    expect(container.querySelectorAll('.dc-tooth-unrecorded .dc-crown-outline')).toHaveLength(5);
    expect(container.querySelectorAll('[data-layer="volume"]')).toHaveLength(5);
  });
  it('UX-05H conserva etiquetas de estado y símbolos distintos, sin convertir sin registro en sano', () => {
    const teeth = [
      { fdi: 11, condition: 'HEALTHY' as const, notes: undefined, treatmentCount: null },
      { fdi: 14, condition: 'RESTORED' as const, notes: undefined, treatmentCount: null },
      { fdi: 16, condition: 'CARIES' as const, notes: undefined, treatmentCount: null },
      { fdi: 26, condition: 'FRACTURED' as const, notes: undefined, treatmentCount: null },
    ];
    render(<DentalArcades dentition="PERMANENT" teeth={teeth} selectedFdi={16} onSelect={vi.fn()} />);
    const unknown = screen.getByRole('button', { name: /^Pieza 18 .*sin registro/ });
    const healthy = screen.getByRole('button', { name: /^Pieza 11 .*Sano/ });
    expect(unknown).toHaveAttribute('data-dental-knowledge', 'unregistered');
    expect(unknown.querySelector('svg')).toHaveClass('dc-tooth-unrecorded');
    expect(unknown.querySelector('.dc-crown-outline')).toBeInTheDocument();
    expect(unknown.querySelector('.dc-fdi')).toHaveTextContent(/^18$/);
    expect(healthy.querySelector('svg')).not.toHaveClass('dc-tooth-unrecorded');
    expect(healthy).toHaveAccessibleName(/Sano confirmado/);
    expect(healthy.querySelector('.dc-registration')).toBeNull();
    expect(healthy.querySelector('.dc-condition-mark')).toBeNull();
    expect(screen.getByRole('button', { name: /^Pieza 16 .*Caries/ })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('svg[data-condition="CARIES"] .dc-condition-dot')).toBeInTheDocument();
    expect(document.querySelector('svg[data-condition="RESTORED"] .dc-condition-mark')?.getAttribute('d'))
      .not.toBe(document.querySelector('svg[data-condition="FRACTURED"] .dc-condition-mark')?.getAttribute('d'));
  });

  it('UX-05M incorpora exactamente las siete geometrías del inventario sin duplicarlas', () => {
    const { container } = render(<>{[11, 13, 14, 16, 51, 53, 55].map(fdi => <ToothSilhouette key={fdi} fdi={fdi} />)}</>);
    const symbols = [...container.querySelectorAll('svg')];
    for (const [index, resource] of DENTAL_SILHOUETTES.entries()) {
      const original = new DOMParser().parseFromString(resource.markup, 'image/svg+xml');
      expect(symbols[index]).toHaveAttribute('data-resource', resource.id);
      expect(symbols[index].querySelector('[data-outline="crown"]')?.getAttribute('d')?.replace(/\s+/g, ' '))
        .toBe(original.querySelector('[data-outline="crown"]')?.getAttribute('d')?.replace(/\s+/g, ' '));
      for (const layer of ['geometry', 'volume', 'detail']) expect(symbols[index].querySelector(`[data-layer="${layer}"]`)).not.toBeNull();
    }
  });

  it('UX-05M aísla ids y referencias de piezas repetidas y gráficos simultáneos', () => {
    const { container } = render(<>
      <DentalArcades dentition="PERMANENT" teeth={[]} onSelect={vi.fn()} />
      <DentalArcades dentition="TEMPORARY" teeth={[]} onSelect={vi.fn()} />
      <DentalArcades dentition="PERMANENT" teeth={[]} onSelect={vi.fn()} historical />
    </>);
    const ids = [...container.querySelectorAll('[id]')].map(node => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const symbol of container.querySelectorAll('svg')) {
      const localIds = new Set([...symbol.querySelectorAll('[id]')].map(node => node.id));
      for (const use of symbol.querySelectorAll('use')) expect(localIds.has(use.getAttribute('href')!.slice(1))).toBe(true);
      for (const node of symbol.querySelectorAll('[fill], [clip-path]')) {
        const ref = /url\(#([^)]+)\)/.exec(node.getAttribute('fill') ?? node.getAttribute('clip-path') ?? '');
        if (ref) expect(localIds.has(ref[1])).toBe(true);
      }
    }
  });

  it('UX-05M conserva cada indicador clínico fuera de la anatomía rotada', () => {
    const { container } = render(<>{CONDITION_ORDER.map(condition => <ToothSilhouette key={condition} fdi={16} condition={condition} />)}</>);
    for (const symbol of container.querySelectorAll('svg')) {
      expect(symbol.querySelector('[data-anatomy]')).toHaveAttribute('transform', 'rotate(180 22 22) translate(22 22) scale(1.12) translate(-22 -22)');
      expect(symbol.querySelector('[data-anatomy] .dc-condition-mark')).toBeNull();
      const condition = symbol.getAttribute('data-condition');
      expect(symbol.querySelector('.dc-condition-mark') === null).toBe(condition === 'HEALTHY');
      expect(symbol.querySelector('[data-layer="geometry"]')).not.toBeNull();
    }
  });

  it('UX-05O conserva sin registro histórico en etiquetas sin añadir sufijos a los FDI', () => {
    render(<DentalArcades dentition="PERMANENT" historical teeth={[
      { fdi: 11, condition: null, conditionText: 'Sin registro previo', notes: undefined, treatmentCount: null },
      { fdi: 12, condition: null, conditionText: 'No reconstruible', notes: undefined, treatmentCount: null },
      { fdi: 13, condition: 'HEALTHY', notes: undefined, treatmentCount: null },
    ]} onSelect={vi.fn()} />);
    const absent = screen.getByRole('button', { name: /Pieza 11 .*Sin registro previo/ });
    const unknown = screen.getByRole('button', { name: /Pieza 12 .*No reconstruible/ });
    const healthy = screen.getByRole('button', { name: /Pieza 13 .*Sano confirmado/ });
    expect(absent.querySelector('.dc-fdi')).toHaveTextContent(/^11$/);
    expect(absent).toHaveAttribute('data-dental-knowledge', 'unregistered');
    expect(absent.querySelector('.dc-dental-unknown')).toBeNull();
    expect(unknown.querySelector('.dc-registration')).toBeNull();
    expect(unknown.querySelector('.dc-dental-unknown')).toHaveTextContent('?');
    expect(healthy.querySelector('.dc-registration, .dc-dental-unknown')).toBeNull();
  });

  it('UX-05O mantiene solo números FDI al seleccionar y cambiar de pieza', () => {
    const onSelect = vi.fn();
    const view = render(<DentalArcades dentition="PERMANENT" teeth={[]} onSelect={onSelect} />);
    const labels = () => [...view.container.querySelectorAll('.dc-fdi')].map(node => node.textContent);
    const before = labels();
    expect(before).toHaveLength(32);
    expect(before.every(label => /^\d{2}$/.test(label ?? ''))).toBe(true);
    view.rerender(<DentalArcades dentition="PERMANENT" teeth={[]} selectedFdi={16} onSelect={onSelect} />);
    expect(labels()).toEqual(before);
    expect(screen.getByRole('status')).toHaveTextContent('Pieza 16 · Sin registro');
    view.rerender(<DentalArcades dentition="PERMANENT" teeth={[]} selectedFdi={13} onSelect={onSelect} />);
    expect(labels()).toEqual(before);
    expect(screen.getByRole('button', { name: /^Pieza 16 / })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /^Pieza 13 / })).toHaveAttribute('aria-pressed', 'true');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('UX-05O centra la selección en la corona visible y no en el botón', () => {
    const bounds = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains('dc-crown-outline')) return new DOMRect(110, 201, 30, 38);
      if (this.classList.contains('dc-dental-piece')) return new DOMRect(100, 200, 44, 44);
      return new DOMRect();
    });
    const left = vi.spyOn(Element.prototype, 'clientLeft', 'get').mockReturnValue(1);
    const top = vi.spyOn(Element.prototype, 'clientTop', 'get').mockReturnValue(1);
    try {
      render(<DentalArcades dentition="PERMANENT" teeth={[]} selectedFdi={16} onSelect={vi.fn()} />);
      const button = screen.getByRole('button', { name: /^Pieza 16 / });
      expect(button.style.getPropertyValue('--tooth-selection-x')).toBe('24px');
      expect(button.style.getPropertyValue('--tooth-selection-y')).toBe('19px');
      expect(button.style.getPropertyValue('--tooth-selection-width')).toBe('30px');
      expect(button.style.getPropertyValue('--tooth-selection-height')).toBe('38px');
      expect(button.style.getPropertyValue('--tooth-selection-line-y')).toBe('40px');
    } finally {
      bounds.mockRestore();
      left.mockRestore();
      top.mockRestore();
    }
  });
});
