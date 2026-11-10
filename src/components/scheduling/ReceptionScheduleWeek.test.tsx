import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ScheduleDayDto } from '../../api/scheduling';
import { ReceptionScheduleWeek } from './ReceptionScheduling';

describe('UX-04G semana de consulta', () => {
  const day: ScheduleDayDto = { dayOfWeek: 1, open: true, startTime: '09:15:00', endTime: '18:45:00', breaks: [] };

  it('distingue un horario no registrado de una semana cerrada', () => {
    const { rerender } = render(<ReceptionScheduleWeek days={[]} timezone="Europe/Madrid" />);
    expect(screen.getByText('No hay horario semanal registrado.')).toBeInTheDocument();
    expect(screen.queryByText('Cerrado')).not.toBeInTheDocument();
    rerender(<ReceptionScheduleWeek days={[{ ...day, open: false, startTime: null, endTime: null }]} timezone="Europe/Madrid" />);
    expect(screen.getByText('Cerrado')).toBeInTheDocument();
    expect(screen.getAllByText('Sin configurar')).toHaveLength(6);
  });

  it('ordena días y múltiples descansos sin generar ventanas de disponibilidad', () => {
    const days = [{ ...day, dayOfWeek: 3 }, { ...day, breaks: [{ startTime: '16:30:00', endTime: '16:45:00' }, { startTime: '13:00:00', endTime: '14:00:00' }] }];
    const original = JSON.stringify(days);
    const { container } = render(<ReceptionScheduleWeek days={days} timezone="Europe/Madrid" />);
    expect(Array.from(container.querySelectorAll('dt')).map((el) => el.textContent)).toEqual(['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']);
    expect(within(screen.getByRole('list', { name: 'Descansos del lunes' })).getAllByRole('listitem').map((el) => el.textContent)).toEqual(['Descanso: 13:00–14:00', 'Descanso: 16:30–16:45']);
    expect(screen.getAllByText('09:15–18:45')).toHaveLength(2);
    expect(screen.queryByText('09:15–13:00')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(container.querySelector('input,select')).toBeNull();
    expect(JSON.stringify(days)).toBe(original);
  });

  it('un día abierto sin horas no recibe horas fallback', () => {
    render(<ReceptionScheduleWeek days={[{ ...day, startTime: null, endTime: null }]} timezone="America/Mexico_City" />);
    expect(screen.getByText('Horario sin definir')).toBeInTheDocument();
    expect(screen.queryByText('09:00–18:00')).not.toBeInTheDocument();
    expect(screen.getByText('Zona horaria: America/Mexico_City')).toBeInTheDocument();
  });

});
