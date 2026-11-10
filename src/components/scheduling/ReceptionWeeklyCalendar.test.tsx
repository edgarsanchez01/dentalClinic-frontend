import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScheduleDayDto } from '../../api/scheduling';
import { ReceptionWeeklyCalendar } from './ReceptionWeeklyCalendar';

const days: ScheduleDayDto[] = Array.from({ length: 7 }, (_, index) => ({ dayOfWeek: index + 1, open: index < 5,
  startTime: index < 5 ? '09:00:00' : null, endTime: index < 5 ? '18:00:00' : null,
  breaks: index === 0 ? [{ startTime: '13:00:00', endTime: '14:00:00' }, { startTime: '16:00:00', endTime: '16:15:00' }] : [],
}));
afterEach(() => vi.unstubAllGlobals());

describe('UX-04G.4 calendario visual habitual', () => {
  it('muestra siete días sin fechas, intervalos exactos y descansos no interactivos', () => {
    const { container } = render(<ReceptionWeeklyCalendar days={days} timezone="Europe/Madrid" />);
    expect(screen.getAllByRole('heading', { level: 3 }).map((item) => item.textContent)).toEqual(['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']);
    expect(screen.getAllByText('Cerrado')).toHaveLength(3); // legend + two actual closed days
    const monday = screen.getByRole('region', { name: 'Lunes' });
    expect(within(monday).getByRole('list', { name: 'Descansos del lunes' })).toHaveTextContent('13:00–14:00');
    const blocks = monday.querySelectorAll<HTMLElement>('.rs-calendar-block');
    expect(blocks).toHaveLength(5);
    expect(blocks[0]!.style.top).toBe('40px'); expect(blocks[0]!.style.height).toBe('160px');
    expect(blocks[3]!.style.height).toBe('10px');
    expect(container.querySelector('.rs-calendar-plot')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('time,input,button,a')).toBeNull();
  });
  it('un profesional sin jornada no recibe cuadrícula ni bloques aparentemente disponibles', () => {
    const { container } = render(<ReceptionWeeklyCalendar days={[]} timezone="Europe/Madrid" />);
    expect(screen.getByText('No hay horario semanal registrado.')).toBeInTheDocument();
    expect(container.querySelector('.rs-calendar-columns')).toBeNull();
  });
  it('en móvil ofrece un día, siete opciones y controles reales con límites', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<ReceptionWeeklyCalendar days={days} timezone="Europe/Madrid" />);
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1);
    expect(screen.getAllByRole('option')).toHaveLength(7);
    expect(screen.getByRole('button', { name: 'Día anterior' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Día siguiente' }));
    expect(screen.getByRole('heading', { name: 'Martes' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Día de la semana'), { target: { value: '6' } });
    expect(screen.getByRole('heading', { name: 'Domingo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Día siguiente' })).toBeDisabled();
    expect(screen.getByRole('region', { name: 'Domingo' })).toHaveTextContent('Cerrado');
  });
});
