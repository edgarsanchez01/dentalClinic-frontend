import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { type ConfirmChargeInput } from '../../api/financial';
import { useAuthStore } from '../../app/authStore';
import { cents, formatMoney, MAX_CENTS, moneyFromCents, normalizeMoney, positiveId } from '../../lib/financialMoney';
import { FormAlert } from '../auth/ui';
import { ReceptionPageHeader } from '../reception/ReceptionUI';
import { FinancialAppointmentPicker, FinancialPatientPicker, ReceptionPatientPicker } from './FinancialPickers';
import { useFinancialAppointment, useFinancialPatient } from './financialQueries';
import { FinancialOperationFeedback } from './FinancialOperationFeedback';
import { canManageCharges, control, patientLabel, primary, secondary, useIsReception } from './financialUi';
import { useFinancialOperation } from './useFinancialOperation';
import { ChargeConceptEditor, ChargeConceptReview, ChargePreview, type ConceptDraft } from './ChargeConceptEditor';
import { FINANCIAL_PAGE_CLASS } from './financialPresentation';

type WizardStep = 1 | 2 | 3;
const STEP_TITLES: Record<WizardStep, string> = { 1: 'Seleccionar paciente', 2: 'Conceptos del cargo', 3: 'Revisar y confirmar' };
function emptyConcept(): ConceptDraft { return { key: crypto.randomUUID(), description: '', quantity: '1', unitPrice: '' }; }

export function CreateChargePage() {
  const role = useAuthStore((state) => state.user?.role);
  if (!canManageCharges(role)) return null;
  return <ManualChargeForm />;
}

function ManualChargeForm() {
  const [params] = useSearchParams();
  const user = useAuthStore((state) => state.user);
  const reception = useIsReception();
  const navigate = useNavigate();
  const client = useQueryClient();
  const form = useRef<HTMLFormElement>(null);
  const operation = useFinancialOperation<ConfirmChargeInput>('confirm-charge', 'FIN_CONFIRM_CHARGE', input => input,
    async (receipt, isCurrent) => {
      await client.invalidateQueries({ queryKey: ['financial-charges'], refetchType: 'none' });
      if (!isCurrent()) return;
      const id = receipt.effect!.chargeId;
      navigate(`/finances/${id}`, { state: { financialNotice: `Cargo #${id} confirmado. El detalle consulta el estado vigente.` } });
    }, 'write');
  const recovered = operation.intent?.payload;
  const [patientId, setPatientId] = useState<number | null>(recovered?.patientId ?? positiveId(params.get('patientId')));
  const [appointmentId, setAppointmentId] = useState<number | null>(recovered?.appointmentId ?? positiveId(params.get('appointmentId')));
  const [concepts, setConcepts] = useState<ConceptDraft[]>(() => recovered?.items.map((item) => ({
    key: crypto.randomUUID(), description: item.description, quantity: String(item.quantity), unitPrice: item.unitPrice,
  })) ?? [emptyConcept()]);
  const [notes, setNotes] = useState(recovered?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [validationError, setValidationError] = useState<string | null>(null);
  // El asistente es explícito: una intención recuperada reabre directamente en la
  // revisión (etapa 3) para reintentar el mismo envío; el resto empieza en la etapa 1.
  const [step, setStep] = useState<WizardStep>(() => (operation.intent ? 3 : 1));
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  useEffect(() => {
    if (reception && previousStep.current !== step) {
      heading.current?.focus();
      heading.current?.scrollIntoView?.({ block: 'nearest' });
    }
    previousStep.current = step;
  }, [reception, step]);
  const patient = useFinancialPatient(patientId);
  const appointment = useFinancialAppointment(appointmentId);
  const ownOnly = user?.role === 'DENTIST';
  const validPatient = patient.data?.id === patientId && !patient.isError;
  const validAppointment = appointment.data?.patientId === patientId && !appointment.isError
    && (!ownOnly || (user?.dentistId !== undefined && appointment.data?.dentistId === user.dentistId));
  const serverErrors = operation.intent?.fieldErrors ?? {};
  let preview = 0n;
  let previewValid = true;
  for (const item of concepts) {
    const price = normalizeMoney(item.unitPrice);
    if (!price || !/^\d+$/.test(item.quantity) || Number(item.quantity) < 1 || Number(item.quantity) > 2147483647) previewValid = false;
    else preview += cents(price) * BigInt(item.quantity);
  }
  if (preview > MAX_CENTS) previewValid = false;
  const patientReady = patientId !== null && validPatient;
  const appointmentReady = !ownOnly && appointmentId === null ? true : validAppointment;
  const ready = patientReady && appointmentReady && previewValid && preview > 0n;
  const stepState = (done: boolean, current: boolean) => (done ? 'done' : current ? 'current' : 'pending');
  const wizard = reception || ownOnly;
  const visibleStep: WizardStep = wizard ? step : 3;

  function patientErrors(): Record<string, string> {
    const next: Record<string, string> = {};
    if (!patientId || !validPatient) next.patientId = 'Selecciona un paciente verificado por la API.';
    if ((ownOnly || appointmentId !== null) && !validAppointment) next.appointmentId = ownOnly
      ? 'Selecciona una atención propia del mismo paciente.' : 'La cita debe pertenecer al mismo paciente.';
    return next;
  }
  function conceptErrors(): Record<string, string> {
    const next: Record<string, string> = {};
    concepts.forEach((item, index) => {
      if (!item.description.trim() || item.description.length > 4000) next[`items[${index}].description`] = 'Escribe una descripción de hasta 4000 caracteres.';
      if (!/^\d+$/.test(item.quantity) || Number(item.quantity) < 1 || Number(item.quantity) > 2147483647) next[`items[${index}].quantity`] = 'La cantidad debe ser un entero positivo.';
      if (normalizeMoney(item.unitPrice) === null) next[`items[${index}].unitPrice`] = 'Escribe un precio no negativo con hasta dos decimales y sin miles.';
    });
    if (!previewValid || preview <= 0n) next.total = 'El total debe ser positivo y estar dentro del importe admitido.';
    return next;
  }
  function validate(): Record<string, string> { return { ...patientErrors(), ...conceptErrors() }; }

  function focusFirst(next: Record<string, string>, fallback = 'select') {
    const name = Object.keys(next)[0]!;
    const target = form.current?.querySelector<HTMLElement>(`[name="${name}"]`) ?? form.current?.querySelector<HTMLElement>(fallback);
    target?.focus();
  }

  /** Avanza solo con la etapa actual válida; conserva todos los datos introducidos. */
  function goToStep(target: WizardStep) {
    if (target <= step) { setValidationError(null); setErrors({}); setStep(target); return; }
    const next = target === 2 ? patientErrors() : validate();
    if (target === 2 && Object.keys(next).length === 0 && !patientReady) next.patientId = 'Selecciona un paciente verificado por la API.';
    if (Object.keys(next).length) {
      setErrors(next); setValidationError(target === 2
        ? 'Verifica el paciente antes de continuar.' : 'Revisa los campos antes de confirmar el cargo.');
      focusFirst(next); return;
    }
    setErrors({}); setValidationError(null); setStep(target);
  }

  return <div className={FINANCIAL_PAGE_CLASS}>
    {reception ? <ReceptionPageHeader title="Crear cargo manual" intro="Selecciona al paciente, captura los conceptos y confirma el cargo en MXN."
      action={<Link className="reception-button reception-button-secondary" to="/finances">Volver a finanzas</Link>} /> : null}
    {reception ? <ol className="reception-finances-steps" aria-label="Pasos para crear el cargo manual">
      {([1, 2, 3] as const).map((index) => {
        const state = index === visibleStep ? 'current' : stepState(index < visibleStep, false);
        const hint = index === 1 ? (patientReady ? 'Verificado por la API' : 'Selecciona y verifica')
          : index === 2 ? (ready ? 'Importes capturados' : 'Descripción, cantidad y precio')
            : 'El servidor calcula el total';
        return <li key={index} className="reception-finances-step" data-state={state} aria-current={index === visibleStep ? 'step' : undefined}>
          <span className="reception-finances-step-index" aria-hidden="true">{index}</span>
          <span className="reception-finances-step-text">
            <strong>{index === 1 ? 'Paciente' : index === 2 ? 'Conceptos' : 'Revisión y confirmación'}</strong>
            <small>{hint}</small>
          </span>
        </li>;
      })}
    </ol> : null}
    {!reception ? <ReceptionPageHeader
      title="Crear cargo manual"
      intro="Confirmar registra una obligación administrativa en MXN. Reservar o completar una cita no crea cargos."
      action={<Link className="reception-button reception-button-secondary" to="/finances">Volver a finanzas</Link>}
    /> : null}
    {wizard ? <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      Paso {visibleStep} de 3: {STEP_TITLES[visibleStep]}
    </p> : null}
    {reception ? <h2 ref={heading} tabIndex={-1} className="reception-finances-step-heading">{STEP_TITLES[visibleStep]}</h2> : null}
    <p className="reception-readonly-note">Si ya iniciaste este cargo, <Link className="underline" to="/finances">consulta tus operaciones pendientes</Link> antes de crear otra solicitud.</p>
    <FinancialOperationFeedback {...operation} />
    <form ref={form} noValidate aria-label="Crear cargo manual" className="reception-section"
      onSubmit={(event) => {
        event.preventDefault(); if (operation.locked) return;
        if (wizard && visibleStep !== 3) { goToStep(3); return; }
        const next = validate(); setErrors(next); setValidationError(null);
        if (Object.keys(next).length) {
          setValidationError('Revisa los campos antes de confirmar el cargo.');
          focusFirst(next); return;
        }
        void operation.submit({ patientId: patientId!, appointmentId, notes: notes.trim() || null,
          items: concepts.map((item) => ({ description: item.description.trim(), quantity: Number(item.quantity), unitPrice: normalizeMoney(item.unitPrice)! })) });
      }}>
      {validationError ? <FormAlert>{validationError}</FormAlert> : null}
      {!wizard || visibleStep === 1 ? <fieldset disabled={operation.locked} className="reception-card grid min-w-0 gap-4">
        <legend className="sr-only">Paciente y atención administrativa</legend>
        {wizard ? <p className="reception-finances-step-note">Busca al paciente, verifica su registro autorizado y continúa con los conceptos.</p> : null}
        {reception
          ? <ReceptionPatientPicker value={patientId} required onChange={(id) => { setPatientId(id); setAppointmentId(null); setErrors({}); }} disabled={operation.locked} />
          : <FinancialPatientPicker value={patientId} required onChange={(id) => { setPatientId(id); setAppointmentId(null); setErrors({}); }} disabled={operation.locked} />}
        {patientId !== null && patient.isPending && !reception ? <p role="status">Verificando paciente seleccionado…</p> : null}
        {patientId ? <FinancialAppointmentPicker key={patientId} patientId={patientId} value={appointmentId} onChange={(id) => { setAppointmentId(id); setErrors({}); }} disabled={operation.locked} /> : null}
        {appointmentId !== null && appointment.isPending ? <p role="status">Verificando atención seleccionada…</p> : null}
        {errors.patientId || errors.appointmentId ? <FormAlert>{errors.patientId || errors.appointmentId}</FormAlert> : null}
        {wizard ? <div className="flex flex-wrap gap-2">
          <button type="button" className={`${primary} justify-self-start`} disabled={reception && (!patientReady || !appointmentReady || operation.locked)} onClick={() => goToStep(2)}>Continuar a conceptos</button>
        </div> : null}
      </fieldset> : null}
      {wizard && visibleStep === 2 && patientReady ? <section className="reception-finances-context" aria-label="Contexto del paciente">
        <span className="reception-finances-context-label">Paciente seleccionado</span>
        <span className="reception-finances-context-value">{patientLabel(patient.data, patientId!)}</span>
        <span className="reception-finances-context-meta">{appointmentId !== null ? `Cita #${appointmentId}` : 'Sin cita vinculada'}</span>
      </section> : null}
      {!wizard || visibleStep === 2 ? <fieldset disabled={operation.locked} className="reception-card grid min-w-0 gap-4">
        <legend className="sr-only">Conceptos históricos del cargo</legend>
        {!reception ? <>
          <h2 className="text-[length:var(--text-h5)]">Conceptos</h2>
          {concepts.map((item, index) => {
            const set = (field: keyof Omit<ConceptDraft, 'key'>) => (value: string) => setConcepts((previous) => previous.map((entry) => entry.key === item.key ? { ...entry, [field]: value } : entry));
            return <ChargeConceptEditor key={item.key} item={item} index={index} layout="full" errors={errors} serverErrors={serverErrors}
              onChange={(field, value) => set(field)(value)} remove={<button type="button" className={`${secondary} justify-self-start`} disabled={concepts.length === 1} onClick={() => setConcepts((previous) => previous.filter((entry) => entry.key !== item.key))}>Quitar concepto {index + 1}</button>} />;
          })}
          <button type="button" className={`${secondary} justify-self-start`} onClick={() => setConcepts((previous) => [...previous, emptyConcept()])}>Añadir concepto</button>
          <ChargePreview total={previewValid ? formatMoney(moneyFromCents(preview)) : 'Revisa los importes'} note="El servidor calcula el total definitivo. Descripciones y precios se conservan como datos históricos. Hasta dos decimales; sin impuestos automáticos.">
            {errors.total ? <FormAlert>{errors.total}</FormAlert> : null}
          </ChargePreview>
          <label htmlFor="charge-notes">Notas administrativas (opcional)</label>
          <textarea id="charge-notes" className={control} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </> : <>
        <h2 className="reception-finances-step-heading">Conceptos</h2>
        <p className="reception-finances-step-note">Describe cada concepto, ajusta la cantidad y su precio unitario. El total lo determina el servidor.</p>
        <div className="reception-concepts">
          {concepts.map((item, index) => {
            const set = (field: keyof Omit<ConceptDraft, 'key'>) => (value: string) => setConcepts((previous) => previous.map((entry) => entry.key === item.key ? { ...entry, [field]: value } : entry));
            return <ChargeConceptEditor key={item.key} item={item} index={index} layout="wizard" errors={errors} serverErrors={serverErrors}
              onChange={(field, value) => set(field)(value)} remove={<button type="button" className="reception-concept-remove" disabled={concepts.length === 1}
                onClick={() => setConcepts((previous) => previous.filter((entry) => entry.key !== item.key))}>Quitar concepto {index + 1}</button>} />;
          })}
        </div>
        <button type="button" className={`${secondary} justify-self-start`} onClick={() => setConcepts((previous) => [...previous, emptyConcept()])}>Añadir concepto</button>
        {preview > 0n ? <ChargePreview total={previewValid ? formatMoney(moneyFromCents(preview)) : 'Revisa los importes'} note="Orientación de captura. El servidor calcula el total, el estado y el saldo definitivos. Hasta dos decimales; sin impuestos automáticos." /> : null}
        {errors.total ? <FormAlert>{errors.total}</FormAlert> : null}
        <div className="reception-finances-notes">
          <label htmlFor="charge-notes">Notas administrativas (opcional)</label>
          <textarea id="charge-notes" className={control} rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
        </>}
        {wizard ? <div className="reception-finances-nav">
          <button type="button" className={secondary} onClick={() => goToStep(1)}>Volver al paciente</button>
          <button type="button" className={primary} onClick={() => goToStep(3)}>Revisar cargo</button>
        </div> : null}
      </fieldset> : null}
      {reception && visibleStep === 3 && patientReady ? <section className="reception-finances-review" aria-label="Revisión antes de confirmar">
        <h2 className="text-[length:var(--text-h5)]">Revisión antes de confirmar</h2>
        <dl>
          <div><dt>Paciente</dt><dd>{patientLabel(patient.data, patientId!)}</dd></div>
          <div><dt>Atención</dt><dd>{appointmentId !== null ? `Cita #${appointmentId}` : 'Sin cita'}</dd></div>
          <div><dt>Notas administrativas</dt><dd>{notes.trim() || 'Sin notas'}</dd></div>
        </dl>
        <ChargeConceptReview items={concepts} />
        <p className="reception-finances-review-total">Total de vista previa: {previewValid ? formatMoney(moneyFromCents(preview)) : 'Revisa los importes'}</p>
        <p className="reception-finances-cell-meta">El total definitivo, el estado y el saldo los calcula el servidor al confirmar. Esta vista previa no se envía.</p>
      </section> : null}
      {!reception || visibleStep === 3 ? <div className="reception-finances-nav">
        {wizard && reception ? <button type="button" className={secondary} onClick={() => goToStep(2)}>Volver a conceptos</button> : null}
        <button type="submit" className={`${primary} justify-self-start`} disabled={operation.locked || (ownOnly && user?.dentistId === undefined)}>
          {operation.pending ? 'Confirmando cargo…' : 'Confirmar cargo manual'}
        </button>
      </div> : null}
    </form>
  </div>;
}
