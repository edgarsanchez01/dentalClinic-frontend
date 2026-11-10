import { useState, type CSSProperties } from 'react';
import type { ScheduleDayDto } from '../../api/scheduling';
import { useMediaQuery } from '../../app/useMediaQuery';
import { CALENDAR_DAYS, HOUR_HEIGHT, calendarRange, calendarScale, projectCalendarDay } from './reception-calendar-model';

/** A recurring week, not a dated agenda. All plotted blocks are noninteractive and redundant. */
export function ReceptionWeeklyCalendar({ days, timezone }: { days: ScheduleDayDto[]; timezone: string }) {
  const daily = useMediaQuery('(max-width: 1100px)');
  const [selectedDay, setSelectedDay] = useState(0);
  const scale = calendarScale(days);
  if (!days.length) return <div className="rs-calendar-empty"><p className="rs-note">Zona horaria: {timezone}</p><p>No hay horario semanal registrado.</p></div>;
  const shown = daily ? [selectedDay] : CALENDAR_DAYS.map((_, index) => index);
  const ticks = scale ? Array.from({ length: scale.endHour - scale.startHour + 1 }, (_, index) => scale.startHour + index) : [];
  return <div className={`rs-week rs-calendar${daily ? ' rs-calendar-daily' : ''}`}>
    <div className="rs-calendar-toolbar">
      <p className="rs-note rs-zone">Zona horaria: {timezone}</p>
      <p className="rs-calendar-legend"><span>Atención habitual</span><span>Descanso</span><span>Cerrado</span></p>
    </div>
    {daily ? <div className="rs-calendar-navigation">
      <div className="rs-field"><label htmlFor="rs-calendar-day">Día de la semana</label>
        <select id="rs-calendar-day" value={selectedDay} onChange={(event) => setSelectedDay(Number(event.target.value))}>
          {CALENDAR_DAYS.map((name, index) => <option key={name} value={index}>{name}</option>)}
        </select>
      </div>
      <div className="rs-calendar-day-actions">
        <button type="button" className="reception-button reception-button-secondary" disabled={selectedDay === 0} onClick={() => setSelectedDay(selectedDay - 1)}>Día anterior</button>
        <button type="button" className="reception-button reception-button-secondary" disabled={selectedDay === 6} onClick={() => setSelectedDay(selectedDay + 1)}>Día siguiente</button>
      </div>
    </div> : null}
    {!scale ? <p className="rs-note rs-calendar-no-work">No hay jornadas representables. Consulta el estado y las horas de cada día.</p> : null}
    <div className="rs-calendar-columns" style={{ '--calendar-columns': shown.length, '--calendar-height': `${scale?.height ?? 120}px`, '--calendar-hour': `${HOUR_HEIGHT}px` } as CSSProperties}>
      {scale ? <div className="rs-calendar-axis" aria-hidden="true"><div className="rs-calendar-day-heading" />
        <div className="rs-calendar-axis-body">{ticks.map((hour) => <span key={hour} style={{ top: `${(hour - scale.startHour) * HOUR_HEIGHT}px` }}>{String(hour).padStart(2, '0')}:00</span>)}</div>
      </div> : <div aria-hidden="true" />}
      {shown.map((index) => {
        const name = CALENDAR_DAYS[index]!;
        const day = days.find((item) => item.dayOfWeek === index + 1);
        const { segments, issue } = projectCalendarDay(day);
        const state = !day ? 'missing' : day.open ? issue ? 'invalid' : 'open' : 'closed';
        return <section className="rs-calendar-day rs-day" data-state={state} key={name} aria-labelledby={`rs-calendar-title-${index}`}>
          <div className="rs-calendar-day-heading"><h3 id={`rs-calendar-title-${index}`}>{name}</h3>
            <p className={day?.open ? 'rs-time' : 'rs-day-state'}>{!day ? 'Sin configurar' : day.open ? calendarRange(day.startTime, day.endTime) : 'Cerrado'}</p>
          </div>
          <div className="rs-calendar-plot" aria-hidden="true">
            {scale ? segments.map((item, i) => {
              const height = (item.end - item.start) / 3600 * HOUR_HEIGHT;
              return <div key={i} className={`rs-calendar-block rs-calendar-${item.kind}${height < 28 ? ' rs-calendar-tiny' : ''}`} data-kind={item.kind}
                style={{ top: `${(item.start / 3600 - scale.startHour) * HOUR_HEIGHT}px`, height: `${height}px` }}>
                {height >= 28 ? <span className="rs-calendar-block-kind">{item.kind === 'work' ? 'Atención' : 'Descanso'}</span> : null}
                {height >= 54 ? <span className="rs-calendar-block-time">{calendarRange(item.startTime, item.endTime)}</span> : null}
              </div>;
            }) : null}
            {state !== 'open' ? <span className="rs-calendar-day-message">{state === 'closed' ? 'Sin atención habitual' : state === 'missing' ? 'Sin horario' : 'Revisar horario recibido'}</span> : null}
          </div>
          {issue ? <p className="rs-note rs-calendar-issue">No se puede representar esta jornada en la escala. Se conservan las horas recibidas.</p> : null}
          {day?.open ? <div className="rs-calendar-day-details">
            {day.breaks.length ? <ul className="rs-breaks" aria-label={`Descansos del ${name.toLowerCase()}`}>
              {[...day.breaks].sort((a, b) => a.startTime.localeCompare(b.startTime)).map((item, i) => <li key={i}>Descanso: <span className="rs-time">{calendarRange(item.startTime, item.endTime)}</span></li>)}
            </ul> : <p className="rs-note">Sin descansos registrados</p>}
          </div> : null}
        </section>;
      })}
    </div>
    <p className="rs-note rs-week-footnote">Semana habitual, sin fechas. No representa disponibilidad real ni permite reservar.</p>
  </div>;
}
