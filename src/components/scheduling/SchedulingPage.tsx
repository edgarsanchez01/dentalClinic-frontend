import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { schedulingApi } from '../../api/scheduling';
import { useAuthStore } from '../../app/authStore';
import { OwnerViewSwitch } from '../app/OwnerViewSwitch';
import { FormAlert } from '../auth/ui';
import { ReceptionEmptyState, ReceptionPage, ReceptionPageHeader, ReceptionQueryState } from '../reception/ReceptionUI';
import { ScheduleManagementGroup, SectionCard } from './ScheduleManagementHeading';
import { ClinicScheduleManagement } from './ClinicScheduleManagement';
import { DentistHoursSection } from './ProfessionalScheduleManagement';
import { DateField } from './ScheduleManagementFields';
import { ClinicScheduleReference, DentistExceptions, DentistReference, ReceptionScheduling, ScheduleSection } from './ReceptionScheduling';
import { ScheduleAvailability } from './ScheduleAvailability';
import { useScheduleAvailability } from './useScheduleAvailability';
import { fullName, shortTime, todayLocal, useDentistOptions } from './schedulingManagement';
import './dentist-management.css';

/** Orquestación por contexto. Las consultas y editores conservan sus identidades propias. */
export function SchedulingPage() {
  const role = useAuthStore((state) => state.user?.role);
  const managementIdentity = useAuthStore((state) => `${state.sessionVersion}:${state.user?.id}:${state.user?.dentistId}`);
  const [params] = useSearchParams();
  const personal = role === 'OWNER' && params.get('scope') === 'mine';
  if (role !== 'OWNER' && role !== 'DENTIST' && role !== 'RECEPTIONIST') return null;
  if (role === 'RECEPTIONIST') return <ReceptionScheduling />;
  if (role === 'DENTIST' || personal) {
    const consultation = <ReceptionPage><DentistScheduleConsultation>
      <div id="professional-schedule-tools" tabIndex={-1} className="reception-sections grid gap-6"><DentistHoursSection key={managementIdentity} personal={personal} /></div>
    </DentistScheduleConsultation></ReceptionPage>;
    return <><OwnerViewSwitch area="scheduling" />{personal ? <div className="dentist-shell">{consultation}</div> : consultation}</>;
  }
  // OWNER global: navegación de anclas, nunca pestañas que oculten editores legacy.
  return <div className="clinical-editorial schedule-owner-management"><OwnerViewSwitch area="scheduling" /><ReceptionPage>
    <ReceptionPageHeader title="Horarios" intro="Apertura de la clínica, descansos, excepciones, ausencias y disponibilidad calculada." />
    <nav aria-label="Apartados de horarios" className="my-6 flex flex-wrap gap-x-6 gap-y-2">
      <Link className="ce-link" to={{ search: params.toString(), hash: '#schedule-clinic' }} onClick={() => document.getElementById('schedule-clinic')?.scrollIntoView({ block: 'start' })}>Clínica</Link>
      <Link className="ce-link" to={{ search: params.toString(), hash: '#schedule-professionals' }} onClick={() => document.getElementById('schedule-professionals')?.scrollIntoView({ block: 'start' })}>Profesionales</Link>
      <Link className="ce-link" to={{ search: params.toString(), hash: '#schedule-availability' }} onClick={() => document.getElementById('schedule-availability')?.scrollIntoView({ block: 'start' })}>Disponibilidad</Link>
    </nav>
    <div className="reception-sections grid gap-8">
      <ScheduleManagementGroup id="schedule-clinic" label="Gestión de clínica" title="Clínica" intro="Semana de apertura, excepciones y política de reservas.">
        <ClinicScheduleManagement canEdit={role === 'OWNER'} />
      </ScheduleManagementGroup>
      <ScheduleManagementGroup id="schedule-professionals" label="Gestión de profesionales" title="Profesionales" intro="Selecciona el calendario privado que vas a gestionar.">
        <DentistHoursSection />
      </ScheduleManagementGroup>
      <ScheduleManagementGroup id="schedule-availability" label="Consulta pública de disponibilidad" title="Consulta pública" intro="La selección de esta consulta es independiente del profesional en edición; no modifica ningún horario.">
        <AvailabilitySection />
      </ScheduleManagementGroup>
    </div>
  </ReceptionPage></div>;
}

function DentistScheduleConsultation({ children }: { children: ReactNode }) {
  const dentistId = useAuthStore((state) => state.user?.dentistId);
  return <OwnScheduleConsultation key={dentistId ?? 'unassociated'} dentistId={dentistId}>{children}</OwnScheduleConsultation>;
}
function OwnScheduleConsultation({ dentistId, children }: { dentistId: number | undefined; children: ReactNode }) {
  const { search } = useLocation();
  const associated = typeof dentistId === 'number' && Number.isInteger(dentistId) && dentistId > 0;
  const directory = useQuery({ queryKey: ['public-schedule'], queryFn: schedulingApi.getPublicSchedule });
  const week = useQuery({ queryKey: ['dentist-schedule', dentistId], queryFn: () => schedulingApi.getDentistSchedule(dentistId!), enabled: associated, placeholderData: () => undefined });
  const exceptions = useQuery({ queryKey: ['dentist-exceptions', dentistId], queryFn: () => schedulingApi.listDentistExceptions(dentistId!), enabled: associated, placeholderData: () => undefined });
  const timeOff = useQuery({ queryKey: ['timeoff', dentistId], queryFn: () => schedulingApi.listTimeOff(dentistId!), enabled: associated, placeholderData: () => undefined });
  const dentists = directory.isSuccess ? directory.data.dentists : [];
  const ownProfile = dentists.find((item) => item.dentistId === dentistId);
  const ownName = ownProfile ? fullName(ownProfile.firstName, ownProfile.lastName) : 'Mi perfil profesional';
  const [selected, setSelected] = useState<number | null>(null);
  const professional = dentists.find((item) => item.dentistId === selected) ?? ownProfile ?? dentists[0];
  const availability = useScheduleAvailability(professional?.dentistId, directory.data?.timezone);
  return <div className="dentist-scheduling-flow grid min-w-0 gap-6">
    <div className="reception-scheduling">
      <ReceptionPageHeader title="Horarios" intro="Consulta tu semana habitual, las referencias de la clínica y la disponibilidad calculada." action={associated ? <Link className="reception-button reception-button-secondary" to={{ search, hash: '#professional-schedule-tools' }} onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const target = document.getElementById('professional-schedule-tools');
        const activeTab = target?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
        (activeTab ?? target)?.focus({ preventScroll: true });
        target?.scrollIntoView({ block: 'start' });
      }}>Gestionar mi horario</Link> : undefined} />
      <section className="rs-directory" aria-label="Profesional en consulta">
        <div className="rs-context-identity"><p className="rs-note">Mi horario</p><p className="rs-selected-name">{ownName}</p></div>
        <p className="rs-context-zone rs-note">{week.data && week.data.dentistId === dentistId && !week.isError ? `Zona horaria: ${week.data.timezone}` : week.isError ? 'Zona horaria no disponible' : associated ? 'Cargando zona horaria…' : 'Sin perfil profesional asociado'}</p>
      </section>
      <div className="rs-detail">
        {associated ? <>
          <DentistReference dentistId={dentistId} name={ownName} week={week} intro="Vista habitual de atención de tu perfil profesional." />
          <div className="rs-exceptions"><DentistExceptions name={ownName} exceptions={exceptions} timeOff={timeOff} /></div>
        </> : <ScheduleSection id="rs-dentist-week" title="Horario semanal" className="rs-professional"><ReceptionEmptyState title="Sin perfil profesional asociado">No hay un perfil de dentista disponible para tu cuenta. No se consultan horarios privados de otros profesionales.</ReceptionEmptyState></ScheduleSection>}
      </div>
    </div>
    {children}
    <div className="reception-scheduling">
      <ScheduleAvailability name={professional ? fullName(professional.firstName, professional.lastName) : undefined} model={availability}>
        <ReceptionQueryState query={directory} label="el directorio de dentistas">
          {directory.isSuccess && !dentists.length ? <ReceptionEmptyState title="Todavía no hay dentistas registrados.">La consulta de disponibilidad estará disponible cuando haya profesionales en el directorio autorizado.</ReceptionEmptyState> : null}
          {professional ? <div className="rs-field"><label htmlFor="availability-dentist">Dentista</label>
            <select id="availability-dentist" value={professional.dentistId} onChange={(event) => {
              const next = Number(event.target.value);
              if (next !== professional.dentistId && dentists.some((item) => item.dentistId === next)) { setSelected(next); availability.changeProfessional(); }
            }}>{dentists.map((item) => <option key={item.dentistId} value={item.dentistId}>{fullName(item.firstName, item.lastName)}</option>)}</select>
            <p className="rs-note">Consulta pública de intervalos. No cambia tu calendario privado ni tus herramientas de gestión.</p>
          </div> : null}
        </ReceptionQueryState>
      </ScheduleAvailability>
      <ClinicScheduleReference />
    </div>
  </div>;
}

/** Consulta legacy OWNER conservada; migrarla a useScheduleAvailability no pertenece a F7. */
function AvailabilitySection() {
  const { dentists, isLoading } = useDentistOptions();
  const [dentistId, setDentistId] = useState<number | null>(null);
  const [from, setFrom] = useState(todayLocal());
  const [duration, setDuration] = useState(30);
  const [request, setRequest] = useState<{ dentistId: number; from: string; duration: number } | null>(null);
  const query = useQuery({ queryKey: ['availability', request], queryFn: () => schedulingApi.availability(request!), enabled: request !== null });
  const slotsByDate = useMemo(() => {
    const map = new Map<string, { startTime: string; endTime: string }[]>();
    for (const slot of query.data?.slots ?? []) {
      const list = map.get(slot.startDate) ?? [];
      list.push({ startTime: slot.startTime, endTime: slot.endTime });
      map.set(slot.startDate, list);
    }
    return [...map.entries()];
  }, [query.data]);
  const effectiveDentist = dentistId ?? dentists[0]?.dentistId ?? null;
  return <SectionCard className="ce-admin-form" title="Disponibilidad" subtitle="Cálculo en la zona horaria de la clínica.">
    {isLoading ? <p className="text-ink-muted">Cargando…</p> : null}
    {dentists.length > 0 && effectiveDentist !== null ? <form className="grid max-w-[40rem] gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end" onSubmit={(event) => { event.preventDefault(); setRequest({ dentistId: effectiveDentist, from, duration }); }}>
      <div><label htmlFor="availability-dentist" className="block text-[length:var(--text-body-sm)] font-medium text-ink">Dentista</label>
        <select id="availability-dentist" value={effectiveDentist} onChange={(event) => setDentistId(Number(event.target.value))} className="mt-1.5 w-full rounded-control bg-input-fill px-3 py-2 text-ink ring-1 ring-hairline focus-visible:ring-2 focus-visible:ring-primary">{dentists.map((dentist) => <option key={dentist.dentistId} value={dentist.dentistId}>{fullName(dentist.firstName, dentist.lastName)}</option>)}</select>
      </div>
      <DateField id="availability-from" label="Fecha" value={from} onChange={setFrom} />
      <div><label htmlFor="availability-duration" className="block text-[length:var(--text-body-sm)] font-medium text-ink">Duración (min)</label>
        <input id="availability-duration" type="number" min={5} step={5} value={duration} onChange={(event) => setDuration(Number(event.target.value))} className="mt-1.5 w-28 rounded-control bg-input-fill px-3 py-2 text-ink ring-1 ring-hairline focus-visible:ring-2 focus-visible:ring-primary" />
      </div>
      <button type="submit" className="h-10 rounded-control bg-primary px-5 text-[length:var(--text-body-app)] font-medium text-paper outline-none transition-colors hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-primary">Buscar</button>
    </form> : null}
    {query.isFetching ? <p className="mt-4 text-ink-muted">Calculando…</p> : null}
    {query.isError ? <FormAlert>No se pudo calcular la disponibilidad.</FormAlert> : null}
    {query.isSuccess && slotsByDate.length === 0 ? <p className="mt-4 text-[length:var(--text-body-app)] text-ink-secondary">No hay huecos para los criterios indicados.</p> : null}
    {slotsByDate.length > 0 ? <div className="mt-4 grid gap-4">{slotsByDate.map(([date, slots]) => <div key={date}>
      <h3 className="tabular text-[length:var(--text-body-sm)] font-medium text-ink">{date}</h3>
      <ul className="mt-2 flex flex-wrap gap-2">{slots.map((slot) => <li key={`${date}-${slot.startTime}`} className="tabular rounded-xs bg-primary-subtle px-2.5 py-1 text-[length:var(--text-body-sm)] text-primary-ink">{shortTime(slot.startTime)}–{shortTime(slot.endTime)}</li>)}</ul>
    </div>)}</div> : null}
  </SectionCard>;
}
