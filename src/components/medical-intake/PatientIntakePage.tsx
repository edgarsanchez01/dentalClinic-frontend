import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { medicalIntakeApi, type IntakeConfirmation, type IntakeDefinition, type IntakeDraft } from '../../api/medicalIntake';
import { schedulingApi } from '../../api/scheduling';
import { ApiError } from '../../api/http';
import { useAuthStore } from '../../app/authStore';
import { patientReturnTo } from '../../app/patientOnboarding';
import { useGuardedNavigate, useUnsavedChanges } from '../../app/unsavedChanges';
import { FormAlert } from '../auth/ui';
import { FieldError, intakeControl, PersonalFields, QuestionFields } from './IntakeFields';
import { IntakeSummary } from './IntakeSummary';
import { dentalQuestions, medicalQuestions, minorAt, personalPayload, validateSection, type Errors, type FormValues, type Section } from './intakeForm';
import { IntakeLayout, IntakeProgress } from './IntakeLayout';
import { IntakePrivacy } from './IntakePrivacy';
import { dentalGroups, errorGroup, errorLabel, errorTarget, groupErrors, groupQuestions, intakeSteps as steps, medicalGroups, savedSections } from './intakeFlow';

const sections: Section[] = ['personal', 'medical', 'dental'];
const primary = 'intake-button intake-button-primary';
const secondary = 'intake-button';
const valuesOf = (draft: IntakeDraft): FormValues => ({ personal: draft.personal, medical: draft.medical ?? {}, dental: draft.dental ?? {} });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const messages: Record<string, string> = {
  INTAKE_VALIDATION_FAILED: 'Revisa los campos indicados antes de continuar.', INTAKE_INVALID_FORMAT: 'Revisa el formato de los datos indicados.',
  INTAKE_VERSION_CONFLICT: 'El borrador cambió en otra pestaña o en la clínica. Compara las versiones antes de continuar.',
  INTAKE_PRIVACY_REQUIRED: 'Lee el aviso y acepta explícitamente el guardado antes de enviar antecedentes.',
  INTAKE_DEFINITION_OUTDATED: 'La definición del cuestionario cambió. Actualízala y revisa los nuevos textos antes de continuar.',
  INTAKE_STATE_CONFLICT: 'El estado cambió. Recupera la versión actual para continuar.',
  INTAKE_IDEMPOTENCY_CONFLICT: 'La operación no coincide con la registrada. Recupera la versión del servidor antes de confirmar de nuevo.',
  MEDICAL_ONBOARDING_REQUIRED: 'Completa el cuestionario antes de reservar.',
};

export function PatientIntakePage({ revision = false }: { revision?: boolean }) {
  const user = useAuthStore(state => state.user);
  // A new editor must not initialize its form from a previous mount's stale cached draft.
  const [editorId] = useState(() => crypto.randomUUID());
  const load = useQuery({ queryKey: ['medical-intake', 'editor', editorId], gcTime: 0, staleTime: Infinity, retry: false,
    queryFn: async () => {
      const [definition, draft, schedule] = await Promise.all([medicalIntakeApi.definition(), medicalIntakeApi.draft(), schedulingApi.getPublicSchedule()]);
      if (!schedule.timezone) throw new Error('Clinic timezone unavailable');
      return { definition, draft, timezone: schedule.timezone };
    }, enabled: user?.role === 'PATIENT',
  });
  if (user?.role !== 'PATIENT') return <Navigate replace to="/" />;
  if (load.isPending) return <IntakeLayout><main id="intake-main" className="intake-success"><h1>Preparando tu cuestionario</h1><p role="status">Recuperando tu cuestionario…</p></main></IntakeLayout>;
  if (load.isError) return <IntakeLayout><main id="intake-main" className="intake-success"><h1>No pudimos recuperar tu información</h1><FormAlert>No se pudo recuperar el cuestionario. No se ha asumido que esté completado.</FormAlert><button className={secondary} onClick={() => void load.refetch()}>Reintentar cuestionario</button></main></IntakeLayout>;
  if (!revision && !load.data.draft.status.pending) return <Navigate replace to="/patient-profile" />;
  return <IntakeWizard initial={load.data.draft} initialDefinition={load.data.definition} timezone={load.data.timezone} />;
}

function IntakeWizard({ initial, initialDefinition, timezone }: { initial: IntakeDraft; initialDefinition: IntakeDefinition; timezone: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const guardedNavigate = useGuardedNavigate();
  const [params] = useSearchParams();
  const destination = patientReturnTo(params.get('returnTo'));
  const [server, setServer] = useState(initial);
  const [definition, setDefinition] = useState(initialDefinition);
  const [form, setForm] = useState<FormValues>(() => valuesOf(initial));
  const formRef = useRef(form);
  const serverRef = useRef(server);
  useEffect(() => { formRef.current = form; serverRef.current = server; }, [form, server]);
  const [step, setStep] = useState(0);
  const [pages, setPages] = useState({ medical: 0, dental: 0 });
  const [returnToReview, setReturnToReview] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [errorAttempt, setErrorAttempt] = useState(0);
  const [savingState, setSavingState] = useState('Información recuperada');
  const [conflict, setConflict] = useState<IntakeDraft | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [finished, setFinished] = useState(false);
  const [exit, setExit] = useState(false);
  const operation = useRef<{ payload: IntakeConfirmation; revision: boolean } | null>(null);
  const lock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  const errorFocus = useRef<string | null>(null);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const baseline = valuesOf(server);
  const dirty = sections.some(section => !same(form[section], baseline[section]));
  useUnsavedChanges(!finished && (dirty || uncertain));
  useEffect(() => { heading.current?.focus(); }, [step, pages]);
  const privacyValid = server.privacy?.noticeVersion === definition.noticeVersion && server.privacy.acknowledged && server.privacy.processingAccepted;
  function change<S extends Section>(section: S, value: FormValues[S]) {
    const next = { ...form, [section]: value };
    formRef.current = next;
    setForm(next); setConfirmed(false);
    if (errorCode === 'INTAKE_VALIDATION_FAILED' || errorCode === 'INTAKE_INVALID_FORMAT') {
      const remainingValidation = validateSection(section, next, today);
      const remaining = Object.fromEntries(Object.entries(errors).filter(([key]) => remainingValidation[key]));
      setErrors(remaining);
      if (!Object.keys(remaining).length) setError('');
    }
  }

  function adopt(next: IntakeDraft, saved?: Section, submitted?: FormValues[Section]) {
    const previous = valuesOf(serverRef.current);
    const authoritative = valuesOf(next);
    setForm(current => {
      const updated = { ...authoritative };
      for (const section of sections) {
        const changedLocally = section === saved ? !same(current[section], submitted) : !same(current[section], previous[section]);
        if (changedLocally) Object.assign(updated, { [section]: current[section] });
      }
      formRef.current = updated;
      return updated;
    });
    serverRef.current = next; setServer(next);
    queryClient.setQueryData(['medical-intake', 'draft'], next);
  }
  function validate(section: Section, complete: boolean, visiblePage?: number) {
    const all = validateSection(section, formRef.current, today, complete);
    const found = visiblePage !== undefined && section !== 'personal' ? groupErrors(section, visiblePage, all) : all;
    if (Object.keys(found).length) {
      setErrors(found); setStep(sections.indexOf(section));
      if (section !== 'personal') setPages(current => ({ ...current, [section]: errorGroup(section, found) }));
      throw new ApiError(400, { status: 400, error: 'Bad Request', message: '', path: '', timestamp: '', code: 'INTAKE_VALIDATION_FAILED', fieldErrors: found }, '');
    }
  }
  async function save(section: Section, complete = true) {
    validate(section, complete);
    if (!same(formRef.current[section], valuesOf(serverRef.current)[section])) {
      if (section !== 'personal' && !privacyValid) throw new ApiError(409, { status: 409, error: 'Conflict', message: '', path: '', timestamp: '', code: 'INTAKE_PRIVACY_REQUIRED' }, '');
      const version = serverRef.current.status.version;
      const submitted = formRef.current[section];
      const next = section === 'personal' ? await medicalIntakeApi.personal(version, personalPayload(formRef.current.personal, today))
        : section === 'medical' ? await medicalIntakeApi.medical(version, formRef.current.medical) : await medicalIntakeApi.dental(version, formRef.current.dental);
      adopt(next, section, submitted);
      if (section === 'personal') {
        void queryClient.invalidateQueries({ queryKey: ['patient'] });
        void queryClient.invalidateQueries({ queryKey: ['patients'] });
      }
    }
  }
  const action = useMutation({ retry: false, mutationFn: async (run: () => Promise<void>) => {
    errorFocus.current = null; setError(''); setErrors({}); setErrorCode(''); setSavingState('Guardando…');
    try { await run(); setSavingState('Guardado'); }
    catch (cause) {
      const code = cause instanceof ApiError ? cause.body?.code ?? '' : '';
      setErrorCode(code); setSavingState('No se pudo guardar');
      errorFocus.current = cause instanceof ApiError && Object.keys(cause.fieldErrors).length ? errorTarget(Object.keys(cause.fieldErrors)[0]!) : null;
      setErrorAttempt(value => value + 1);
      setError(messages[code] ?? 'No se pudo confirmar el resultado. Comprueba la conexión y vuelve a intentarlo.');
      if (cause instanceof ApiError) {
        setErrors(cause.fieldErrors);
        const first = Object.keys(cause.fieldErrors)[0]?.split('.')[0];
        const section = first && Object.hasOwn(medicalQuestions, first) ? 'medical' : first && (Object.hasOwn(dentalQuestions, first) || first === 'consultationReason') ? 'dental' : null;
        if (section) { setStep(sections.indexOf(section)); setPages(current => ({ ...current, [section]: errorGroup(section, cause.fieldErrors) })); }
      }
      if (code === 'INTAKE_PRIVACY_REQUIRED') {
        setStep(1); setAcknowledged(false); setAccepted(false); setConfirmed(false);
        try {
          const [currentDefinition, currentDraft] = await Promise.all([medicalIntakeApi.definition(), medicalIntakeApi.draft()]);
          setDefinition(currentDefinition); adopt(currentDraft);
        } catch { /* Retain local data; no acceptance is inferred from a failed read. */ }
      }
      if (code === 'INTAKE_VERSION_CONFLICT' || code === 'INTAKE_STATE_CONFLICT' || code === 'INTAKE_IDEMPOTENCY_CONFLICT') {
        try { setConflict(await medicalIntakeApi.draft()); } catch { /* Local form is retained; explicit recovery remains available. */ }
      }
    } finally { lock.current = false; }
  } });
  useEffect(() => {
    // Los campos están disabled durante la mutación; esperar a que vuelvan a ser enfocables.
    if (!errorAttempt || action.isPending) return;
    const target = errorFocus.current ? document.getElementById(errorFocus.current) : null;
    if (target) { target.focus(); target.scrollIntoView?.({ block: 'center' }); }
    else errorSummary.current?.focus();
  }, [errorAttempt, action.isPending]);
  function run(task: () => Promise<void>) {
    // Reservar antes de mutate: un segundo submit no debe reemplazar el observer de una petición viva.
    if (lock.current) return;
    lock.current = true;
    action.mutate(task);
  }
  const currentSection = sections[step];
  const currentPage = currentSection === 'medical' || currentSection === 'dental' ? pages[currentSection] : 0;
  const groups = currentSection === 'medical' ? medicalGroups : dentalGroups;
  async function advance() {
    if (!currentSection) return;
    if (currentSection !== 'personal' && currentPage < groups.length - 1) {
      validate(currentSection, true, currentPage);
      // PUT reemplaza la sección: siempre enviar todas las respuestas acumuladas.
      await save(currentSection, false);
      setPages(current => ({ ...current, [currentSection]: currentPage + 1 }));
    } else {
      await save(currentSection);
      setStep(returnToReview ? 3 : step + 1);
      setReturnToReview(false);
    }
  }
  async function back(target?: number) {
    if (currentSection && (currentSection === 'personal' || privacyValid)) await save(currentSection, false);
    if (target !== undefined) { setStep(target); setReturnToReview(false); }
    else if ((currentSection === 'medical' || currentSection === 'dental') && currentPage > 0) setPages(current => ({ ...current, [currentSection]: currentPage - 1 }));
    else setStep(step - 1);
    setErrors({}); setError('');
  }
  async function confirm() {
    if (!operation.current) {
      for (const section of sections) await save(section);
      operation.current = { revision: serverRef.current.status.progress === 'COMPLETED', payload: {
        expectedVersion: serverRef.current.status.version, operationId: crypto.randomUUID(), questionnaireVersion: definition.questionnaireVersion,
        declarationVersion: definition.declarationVersion, declarationConfirmed: true,
        confirmedBy: minorAt(formRef.current.personal.birthDate, today) ? 'RESPONSIBLE_ADULT' : 'PATIENT',
      } };
    }
    setUncertain(true);
    try {
      await medicalIntakeApi.confirm(operation.current.payload, operation.current.revision);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) { operation.current = null; setUncertain(false); }
      throw cause;
    }
    // Replay may refer to an older version: never reuse ConfirmationResult.version for writes.
    const [status, draft] = await Promise.all([medicalIntakeApi.status(), medicalIntakeApi.draft()]);
    await useAuthStore.getState().refreshProfile();
    queryClient.setQueryData(['medical-intake', 'status'], status);
    adopt(draft);
    await Promise.all([queryClient.invalidateQueries({ queryKey: ['medical-intake', 'declarations'] }), queryClient.invalidateQueries({ queryKey: ['patient'] }), queryClient.invalidateQueries({ queryKey: ['appointments'] }), queryClient.invalidateQueries({ queryKey: ['intake-session'] })]);
    setUncertain(false); setFinished(true);
  }
  useEffect(() => { if (exit && !dirty) navigate('/appointments', { state: { notice: 'Borrador guardado. Completa el cuestionario antes de reservar.' } }); }, [exit, dirty, navigate]);

  const blocked = action.isPending || uncertain || !!conflict;
  const completed = [...savedSections(valuesOf(server), today), finished];
  const stageIntro = step === 0 ? 'Completa tus datos y los de una persona de contacto. Al guardar, se actualiza tu ficha personal.'
    : step === 1 ? 'Responde según lo que recuerdes. Si tienes dudas, puedes decirlo o hablarlo en consulta.'
      : step === 2 ? 'Cuéntanos sobre tu atención dental y el motivo de tu visita, con tus propias palabras.'
        : 'Revisa tus respuestas. Puedes editar cada sección antes de confirmar.';
  if (finished) return <IntakeLayout><main id="intake-main" className="intake-success" tabIndex={-1}>
    <h1>Tu información está lista</h1>
    <p role="status">{initial.status.progress === 'COMPLETED' ? 'Tu nueva revisión quedó confirmada. Las declaraciones anteriores se conservan.' : 'Tu cuestionario quedó confirmado. Ya puedes continuar y elegir una cita.'}</p>
    <p>Podrás consultar tu información y confirmar una nueva revisión desde tu perfil.</p>
    <button className={primary} type="button" autoFocus onClick={() => navigate(initial.status.progress === 'COMPLETED' ? '/patient-profile' : destination, { replace: true })}>
      {initial.status.progress === 'COMPLETED' ? 'Ver mi información' : destination === '/appointments?create=1' ? 'Continuar a la reserva' : destination === '/' ? 'Ir a mi inicio' : 'Continuar'}
    </button>
  </main></IntakeLayout>;

  return <IntakeLayout><main id="intake-main" tabIndex={-1} className="intake-frame">
    <header className="intake-intro"><h1>{initial.status.progress === 'COMPLETED' ? 'Actualizar mi información' : 'Tu información de salud'}</h1>
      <p>Vamos paso a paso. Puedes guardar tus respuestas y continuar más tarde.</p>
    </header>
    <div className="intake-workspace"><aside>
      <IntakeProgress step={step} completed={completed} disabled={blocked} onBack={target => run(() => back(target))} />
      <div className="intake-sidebar-note"><p>Son cuatro etapas. En los antecedentes verás solo dos preguntas a la vez.</p></div>
    </aside><div className="intake-panel">
      <p className="intake-save-status" role="status" aria-live="polite"><strong>Etapa {step + 1} de 4.</strong>{' '}{action.isPending ? 'Guardando…' : error ? 'Error al guardar' : dirty ? 'Cambios sin guardar' : savingState}</p>
      {error ? <div ref={errorSummary} tabIndex={-1} className="intake-error" role="alert"><p>{error}</p>
        {Object.entries(errors).length ? <ul>{Object.entries(errors).map(([key, text]) => <li key={key}><a href={`#${errorTarget(key)}`} onClick={event => {
          event.preventDefault(); document.getElementById(errorTarget(key))?.focus();
        }}>{errorLabel(key)}: {text}</a></li>)}</ul> : null}
        {errorCode === 'INTAKE_DEFINITION_OUTDATED' ? <button className={secondary} onClick={() => run(async () => { setDefinition(await medicalIntakeApi.definition()); setAcknowledged(false); setAccepted(false); setConfirmed(false); })}>Actualizar definición sin borrar mis respuestas</button> : null}
        {['INTAKE_VERSION_CONFLICT', 'INTAKE_STATE_CONFLICT', 'INTAKE_IDEMPOTENCY_CONFLICT'].includes(errorCode) && !conflict ? <button className={secondary} onClick={() => run(async () => setConflict(await medicalIntakeApi.draft()))}>Consultar versión del servidor</button> : null}
      </div> : null}
      {conflict ? <section aria-label="Resolver conflicto" className="intake-conflict">
        <h2>Compara antes de guardar</h2><p>No se ha sobrescrito ninguna respuesta. Tu formulario local sigue intacto.</p>
        <details><summary>Ver versión del servidor</summary><IntakeSummary value={valuesOf(conflict)} /></details>
        <details><summary>Ver mis cambios locales</summary><IntakeSummary value={form} /></details>
        <div className="intake-actions"><button className={secondary} onClick={() => {
          serverRef.current = conflict; formRef.current = valuesOf(conflict); setServer(conflict); setForm(valuesOf(conflict)); setConflict(null); setError(''); setErrors({}); setConfirmed(false);
        }}>Usar servidor y descartar cambios locales</button>
          <button className={secondary} onClick={() => { serverRef.current = conflict; setServer(conflict); setConflict(null); setError(''); setErrors({}); setConfirmed(false); setSavingState('Cambios locales conservados. Revisa y pulsa Siguiente para guardarlos.'); }}>Conservar mis cambios para revisión manual</button></div>
      </section> : null}
      <form noValidate aria-busy={action.isPending} onSubmit={event => { event.preventDefault(); if (step === 1 && !privacyValid) return; if (uncertain) run(confirm); else if (step < 3) run(advance); else if (confirmed) run(confirm); }}>
        <div className="intake-stage-heading"><h2 ref={heading} tabIndex={-1}>{steps[step]}</h2><p>{stageIntro}</p></div>
        <fieldset disabled={blocked} className="min-w-0">
          {step === 0 ? <PersonalFields value={form.personal} onChange={personal => change('personal', personal)} errors={errors} today={today} /> : null}
          {step === 1 && !privacyValid ? <IntakePrivacy definition={definition} acknowledged={acknowledged} accepted={accepted} onAcknowledge={setAcknowledged} onAccept={setAccepted}
            onContinue={() => run(async () => { adopt(await medicalIntakeApi.privacy(serverRef.current.status.version, definition.noticeVersion)); heading.current?.focus(); })} /> : null}
          {(step === 1 && privacyValid) || step === 2 ? <>
            <div className="intake-group-head"><h3>{groups[currentPage]!.title}</h3><p className="intake-group-count">Grupo {currentPage + 1} de {groups.length}</p></div>
            <QuestionFields questions={groupQuestions(step === 1 ? 'medical' : 'dental', currentPage)} value={step === 1 ? form.medical : form.dental as Parameters<typeof QuestionFields>[0]['value']}
              options={definition.answerOptions} errors={errors} onChange={(key, question) => step === 1 ? change('medical', { ...form.medical, [key]: question }) : change('dental', { ...form.dental, [key]: question })} />
            {step === 2 && currentPage === dentalGroups.length - 1 ? <div className="auth-field intake-reason"><label htmlFor="consultationReason">Motivo de consulta</label>
              <textarea id="consultationReason" className={intakeControl} rows={4} maxLength={1000} autoComplete="off" required value={form.dental.consultationReason ?? ''}
                aria-invalid={!!errors.consultationReason} aria-describedby={`reason-help${errors.consultationReason ? ' consultationReason-error' : ''}`} onChange={event => change('dental', { ...form.dental, consultationReason: event.target.value })} />
              <p id="reason-help" className="auth-hint">Describe con tus palabras por qué deseas consultar. Por ejemplo: una revisión o una molestia que quieres comentar. No necesitas un diagnóstico. Hasta 1000 caracteres.</p><FieldError id="consultationReason" error={errors.consultationReason} /></div> : null}
          </> : null}
          {step === 3 ? <><IntakeSummary value={form} onEdit={target => { setStep(target); setPages({ medical: 0, dental: 0 }); setReturnToReview(true); setConfirmed(false); setError(''); setErrors({}); }} />
            <div className="intake-declaration"><h3>Tu confirmación</h3><p className="whitespace-pre-wrap">{definition.declarationText}</p>
              <p className="intake-help">Confirma: {minorAt(form.personal.birthDate, today) ? 'adulto responsable del menor' : 'paciente'}.</p>
              <label className="intake-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /><span>Confirmo la declaración mostrada y he revisado mis respuestas.</span></label>
              <details><summary>Información de esta declaración</summary><p className="intake-document-meta">Declaración demostrativa: {definition.declarationVersion}. Cuestionario: {definition.questionnaireVersion}.</p></details>
            </div></> : null}
        </fieldset>
        {uncertain ? <p role="status" className="intake-help">El resultado de la confirmación aún no está verificado. Reintenta la misma operación; no cambies los datos ni recargues esta pestaña.</p> : null}
        <div className="intake-actions">
          <button type="button" className={secondary} disabled={step === 0 || blocked} onClick={() => run(() => back())}>Anterior</button>
          {step !== 1 || privacyValid ? <button type="submit" className={primary} disabled={action.isPending || !!conflict || (!uncertain && step === 3 && !confirmed)}>{uncertain ? 'Reintentar la misma confirmación' : step === 3 ? initial.status.progress === 'COMPLETED' ? 'Confirmar nueva revisión' : 'Confirmar y continuar' : 'Siguiente'}</button> : null}
          {returnToReview ? <button type="button" className={secondary} disabled={blocked} onClick={() => run(async () => { if (currentSection) await save(currentSection); setStep(3); setReturnToReview(false); })}>Volver a la revisión</button> : null}
          <button type="button" className={`${secondary} intake-save-exit`} disabled={blocked} onClick={() => run(async () => { for (const section of sections) await save(section, false); setExit(true); })}>Guardar y salir</button>
        </div>
        <p className="intake-help intake-save-help">Guardamos al avanzar o volver. Usa «Guardar y salir» para continuar más tarde.</p>
      </form>
      <nav className="intake-links" aria-label="Sesión y citas"><Link className="intake-link" to="/appointments">Consultar o cancelar mis citas</Link><Link className="intake-link" to="/change-password">Gestionar contraseña y sesión</Link>
        <button type="button" className="intake-link" onClick={() => guardedNavigate(() => { void useAuthStore.getState().logout().catch(() => { /* Session data is already cleared locally. */ }); })}>Cerrar sesión</button>
      </nav>
    </div></div>
  </main></IntakeLayout>;
}
