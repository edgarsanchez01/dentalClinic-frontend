import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { schedulingApi, type DentistScheduleDto, type ScheduleDayDto, type ScheduleExceptionDto, type TimeOffDto } from '../../api/scheduling';
import { ReceptionEmptyState, ReceptionPageHeader, ReceptionQueryState } from '../reception/ReceptionUI';
import { ReceptionDentistPicker } from './ReceptionDentistPicker';
import { ReceptionWeeklyCalendar } from './ReceptionWeeklyCalendar';
import { useMediaQuery } from '../../app/useMediaQuery';
import { readableDate } from './scheduleDates';
import { ScheduleAvailability } from './ScheduleAvailability';
import { useScheduleAvailability } from './useScheduleAvailability';
import './reception-scheduling.css';

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const shortTime = (value?: string | null) => value?.slice(0, 5) ?? '';
const range = (start?: string | null, end?: string | null) => start && end
  ? `${shortTime(start)}–${shortTime(end)}` : 'Horario sin definir';

export function ScheduleSection({ title, intro, children, id, className = '' }: { title: ReactNode; intro?: string; children: ReactNode; id: string; className?: string }) {
  return <section className={`rs-section ${className}`} aria-labelledby={id}>
    <div className="rs-heading"><h2 id={id}>{title}</h2>{intro ? <p>{intro}</p> : null}</div>
    {children}
  </section>;
}

/** The contract has one daily window plus N breaks; never turn these into available slots. */
export function ReceptionScheduleWeek({ days, timezone }: { days: ScheduleDayDto[]; timezone: string }) {
  if (days.length === 0) return <div><p className="rs-note rs-zone">Zona horaria: {timezone}</p><p className="rs-note rs-inline-empty">No hay horario semanal registrado.</p></div>;
  return <div className="rs-week-content">
    <p className="rs-note rs-zone">Zona horaria: {timezone}</p>
    <dl className="rs-week" aria-label="Horario semanal">
      {DAY_NAMES.map((name, index) => {
        const day = days.find((item) => item.dayOfWeek === index + 1);
        return <div className="reception-week-row rs-day" data-state={!day ? 'missing' : day.open ? 'open' : 'closed'} key={name}>
          <dt>{name}</dt>
          <dd>
            <span className={day?.open ? 'rs-time' : 'rs-day-state'}>{!day ? 'Sin configurar' : day.open ? range(day.startTime, day.endTime) : 'Cerrado'}</span>
            {day?.open && day.breaks.length > 0 ? <ul className="rs-breaks" aria-label={`Descansos del ${name.toLowerCase()}`}>
              {[...day.breaks].sort((a, b) => a.startTime.localeCompare(b.startTime)).map((item, i) =>
                <li key={`${item.startTime}-${i}`}>Descanso: <span className="rs-time">{range(item.startTime, item.endTime)}</span></li>)}
            </ul> : null}
          </dd>
        </div>;
      })}
    </dl>
  </div>;
}

function ExceptionList({ items }: { items: ScheduleExceptionDto[] }) {
  if (!items.length) return <p className="rs-note rs-inline-empty">Sin excepciones registradas.</p>;
  return <ul className="rs-events">
    {[...items].sort((a, b) => a.date.localeCompare(b.date)).map((item) => <li key={item.date}>
      <time dateTime={item.date} className="rs-event-date" aria-label={readableDate(item.date)}>
        <span aria-hidden="true" className="rs-date-day">{item.date.slice(8, 10)}</span>
        <span aria-hidden="true" className="rs-date-month">{new Intl.DateTimeFormat('es', { timeZone: 'UTC', month: 'short', year: 'numeric' }).format(new Date(`${item.date}T12:00:00Z`))}</span>
        <span className="sr-only">{item.date}</span>
      </time>
      <div className="rs-event-body">
        <span className={`rs-event-kind ${item.closed ? 'rs-event-closed' : ''}`}>{item.closed ? 'Cerrado' : <>Apertura especial · <span className="rs-time">{range(item.startTime, item.endTime)}</span></>}</span>
        {item.reason ? <p>{item.reason}</p> : null}
      </div>
    </li>)}
  </ul>;
}

/** Shared read presentation only. Callers determine and authorize the resource identity. */
export function DentistReference({ dentistId, name, week, intro = 'Vista habitual de atención del profesional seleccionado.' }: { dentistId: number; name: string; week: UseQueryResult<DentistScheduleDto>; intro?: string }) {
  return <ScheduleSection id="rs-dentist-week" title="Horario semanal" intro={intro} className="rs-professional">
    <span className="sr-only">{name}</span>
    <ReceptionQueryState query={week} label="el horario del dentista">
      {week.data?.dentistId === dentistId ? <ReceptionWeeklyCalendar key={dentistId} days={week.data.days} timezone={week.data.timezone} /> : null}
    </ReceptionQueryState>
  </ScheduleSection>;
}

export function DentistExceptions({ name, exceptions, timeOff }: { name: string; exceptions: UseQueryResult<ScheduleExceptionDto[]>; timeOff: UseQueryResult<TimeOffDto[]> }) {
  return <>
    <ScheduleSection id="rs-dentist-exceptions" title="Excepciones del dentista">
      <span className="sr-only">{name}</span>
      <ReceptionQueryState query={exceptions} label="las excepciones del dentista">
        {exceptions.data ? <ExceptionList items={exceptions.data} /> : null}
      </ReceptionQueryState>
    </ScheduleSection>
    <ScheduleSection id="rs-dentist-timeoff" title="Ausencias del dentista">
      <span className="sr-only">{name}</span>
      <ReceptionQueryState query={timeOff} label="las ausencias del dentista">
        {timeOff.data?.length === 0 ? <p className="rs-note rs-inline-empty">Sin ausencias registradas.</p> : null}
        {timeOff.data?.length ? <ul className="rs-events rs-timeoff">
          {[...timeOff.data].sort((a, b) => a.startDate.localeCompare(b.startDate) || (a.startTime ?? '').localeCompare(b.startTime ?? '')).map((item) => <li key={item.id}>
            <span className="rs-event-kind">{item.allDay ? 'Días completos' : 'Franja parcial'}</span>
            <span className="rs-time">{item.allDay ? `${item.startDate} → ${item.endDate} (todo el día)` : `${item.startDate} · ${range(item.startTime, item.endTime)}`}</span>
            {item.reason ? <p>{item.reason}</p> : null}
          </li>)}
        </ul> : null}
      </ReceptionQueryState>
    </ScheduleSection>
  </>;
}

/** Reception-only composition. No mutation hooks or booking actions are mounted here. */
export function ReceptionScheduling() {
  const directory = useQuery({ queryKey: ['public-schedule'], queryFn: schedulingApi.getPublicSchedule });
  const [selected, setSelected] = useState<number | null>(null);
  const context = useRef<HTMLElement>(null);
  const compact = useMediaQuery('(max-width: 1100px)');
  useEffect(() => {
    if (compact && selected !== null) {
      const section = document.getElementById('rs-dentist-week')?.closest('section');
      section?.style.setProperty('scroll-margin-top', `${(context.current?.getBoundingClientRect().height ?? 0) + 24}px`);
      section?.scrollIntoView?.({ block: 'start' });
    }
  }, [compact, selected]);
  const dentists = directory.data?.dentists ?? [];
  const dentist = directory.isSuccess ? dentists.find((item) => item.dentistId === selected) ?? dentists[0] : undefined;
  const name = dentist ? `${dentist.firstName} ${dentist.lastName}`.trim() : '';
  const dentistId = dentist?.dentistId;
  // Each resource is scoped to the same selected ID. No previous-professional placeholders.
  const week = useQuery({ queryKey: ['dentist-schedule', dentistId], queryFn: () => schedulingApi.getDentistSchedule(dentistId!), enabled: dentistId !== undefined, placeholderData: () => undefined });
  const dentistExceptions = useQuery({ queryKey: ['dentist-exceptions', dentistId], queryFn: () => schedulingApi.listDentistExceptions(dentistId!), enabled: dentistId !== undefined, placeholderData: () => undefined });
  const timeOff = useQuery({ queryKey: ['timeoff', dentistId], queryFn: () => schedulingApi.listTimeOff(dentistId!), enabled: dentistId !== undefined, placeholderData: () => undefined });
  const professionalLoading = week.isFetching || dentistExceptions.isFetching || timeOff.isFetching;
  const professionalError = week.isError || dentistExceptions.isError || timeOff.isError;
  const availability = useScheduleAvailability(dentistId, directory.data?.timezone);

  return <div className="reception-page reception-scheduling">
    <ReceptionPageHeader title="Horarios" intro="Consulta los horarios de atención y la disponibilidad de los profesionales." />
    <section ref={context} className="rs-directory" aria-label="Profesional en consulta">
      <ReceptionQueryState query={directory} label="el directorio de dentistas">
        {directory.isSuccess && !dentists.length ? <ReceptionEmptyState title="Todavía no hay dentistas registrados.">La consulta estará disponible cuando haya profesionales en el directorio autorizado.</ReceptionEmptyState> : null}
        {dentist ? <>
        <div className="rs-context-identity"><p className="rs-note">Dentista</p><p className="rs-selected-name" id="rs-active-name">{name}</p></div>
        <p className="rs-context-zone rs-note">{week.data && week.data.dentistId === dentistId && !week.isError ? `Zona horaria: ${week.data.timezone}` : week.isError ? 'Zona horaria no disponible' : 'Cargando zona horaria…'}</p>
        <ReceptionDentistPicker dentists={dentists} selectedId={dentist.dentistId} onSelect={(next) => {
          if (next !== dentist.dentistId && dentists.some((item) => item.dentistId === next)) { setSelected(next); availability.changeProfessional(); }
        }} />
        </> : null}
      </ReceptionQueryState>
    </section>
    <div className="rs-detail">
      <p className="sr-only rs-context-status" role="status" aria-live="polite" aria-atomic="true">{dentist ? professionalLoading
        ? `Consultando la información de ${name}…`
        : professionalError ? `Dentista seleccionado: ${name}. No se pudo cargar toda su información. Revisa los bloques con error y reintenta.`
          : `Horario de ${name} cargado.` : ''}</p>
      {dentist ? <DentistReference dentistId={dentist.dentistId} name={name} week={week} /> :
        <ScheduleSection id="rs-dentist-week" title="Horario semanal" className="rs-professional"><p className="rs-note">Selecciona un dentista del directorio para consultar su horario.</p></ScheduleSection>}
      {professionalError && dentist ? <p className="rs-note">Parte de la información de {name} no se pudo cargar. Reintenta en el bloque con error.</p> : null}
      <div className="rs-exceptions">
        {dentist ? <DentistExceptions name={name} exceptions={dentistExceptions} timeOff={timeOff} /> : null}
      </div>
    </div>
    <ScheduleAvailability name={dentist ? name : undefined} model={availability} />
    <ClinicScheduleReference />
  </div>;
}

/** Approved clinic reference. Reading these resources grants no configuration rights. */
export function ClinicScheduleReference() {
  const clinic = useQuery({ queryKey: ['clinic-schedule'], queryFn: schedulingApi.getClinicSchedule });
  const exceptions = useQuery({ queryKey: ['clinic-exceptions'], queryFn: schedulingApi.listClinicExceptions });
  const policy = useQuery({ queryKey: ['booking-policy'], queryFn: schedulingApi.getPolicy });
  return <section className="rs-clinic" aria-labelledby="rs-clinic-title">
    <h2 id="rs-clinic-title">Información de la clínica</h2>
    <div className="rs-clinic-columns">
      <ScheduleSection id="rs-clinic-week" title="Horario de la clínica" className="rs-clinic-week">
        <ReceptionQueryState query={clinic} label="el horario de la clínica">
          {clinic.data ? <ReceptionScheduleWeek days={clinic.data.days} timezone={clinic.data.timezone} /> : null}
        </ReceptionQueryState>
      </ScheduleSection>
      <div className="rs-clinic-rules">
      <ScheduleSection id="rs-clinic-exceptions" title="Excepciones de la clínica">
        <ReceptionQueryState query={exceptions} label="las excepciones de la clínica">
          {exceptions.data ? <ExceptionList items={exceptions.data} /> : null}
        </ReceptionQueryState>
      </ScheduleSection>
    <ScheduleSection id="rs-policy" title="Política de reservas" className="rs-policy-section">
      <ReceptionQueryState query={policy} label="la política de reservas">
        {policy.data ? <dl className="rs-policy">
          <div><dt>Horizonte de reservas</dt><dd>{policy.data.maxAdvanceDays} <span>días</span></dd></div>
          <div><dt>Anticipación mínima de reserva</dt><dd>{policy.data.minBookingLeadTimeHours} <span>h</span></dd></div>
          <div><dt>Anticipación de cancelación</dt><dd>{policy.data.cancellationLeadTimeHours} <span>h</span></dd></div>
          <div><dt>Zona horaria de la clínica</dt><dd className="rs-timezone">{policy.data.timezone}</dd></div>
        </dl> : null}
      </ReceptionQueryState>
    </ScheduleSection>
      </div>
    </div>
    </section>;
}
