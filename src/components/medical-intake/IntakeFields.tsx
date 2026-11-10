import type { Answer, IntakePersonal, Question } from '../../api/medicalIntake';
import { AuthFormField } from '../auth/AuthForm';
import { answerLabels, minorAt, personalLabels, relationships, type Errors } from './intakeForm';
import { birthDateInput, birthDateValue } from './intakeFlow';

export const intakeControl = 'auth-input intake-control';
export function FieldError({ id, error }: { id: string; error: string | undefined }) {
  return error ? <p id={`${id}-error`} className="auth-field-error">{error}</p> : null;
}
export function PersonalFields({ value, onChange, errors, today }: { value: IntakePersonal; onChange: (value: IntakePersonal) => void; errors: Errors; today: string }) {
  function field(key: Exclude<keyof IntakePersonal, 'canProvidePhone' | 'responsibleAdultRelationship'>, max: number, type = 'text') {
    return <AuthFormField key={key} id={key} label={personalLabels[key]} type={type} maxLength={max}
      value={value[key] ?? ''} autoComplete="off" error={errors[key]} onChange={text => onChange({ ...value, [key]: text })} />;
  }
  return <div className="intake-personal">
    <section className="intake-personal-section" aria-labelledby="personal-info-title">
      <h3 id="personal-info-title">Información personal</h3>
      <div className="intake-two-fields">{field('firstName', 100)}{field('lastName', 100)}</div>
      <div className="auth-field intake-birth-date"><label htmlFor="birthDate">Fecha de nacimiento</label>
        <input id="birthDate" name="birthDate" type="text" inputMode="numeric" lang="es-MX" required maxLength={10} placeholder="DD/MM/AAAA" className={intakeControl}
          value={birthDateInput(value.birthDate ?? '')} autoComplete="off" aria-invalid={!!errors.birthDate}
          aria-describedby={`birthDate-help${errors.birthDate ? ' birthDate-error' : ''}`} onChange={event => onChange({ ...value, birthDate: birthDateValue(event.target.value) })} />
        <p id="birthDate-help" className="auth-hint">Día / mes / año. Por ejemplo, 10/04/1990.</p><FieldError id="birthDate" error={errors.birthDate} />
      </div>
    </section>
    <section className="intake-personal-section" aria-labelledby="personal-contact-title">
      <h3 id="personal-contact-title">Datos de contacto</h3>
      <fieldset className="intake-phone-choice"><legend>¿Puedes proporcionar teléfono?</legend>
        <div className="intake-options">{[true, false].map(option => <label key={String(option)} className="intake-option">
          <input id={`canProvidePhone-${option ? 'yes' : 'no'}`} type="radio" name="canProvidePhone" value={String(option)} checked={value.canProvidePhone === option} onChange={() => onChange({ ...value, canProvidePhone: option })}
            aria-invalid={!!errors.canProvidePhone} aria-describedby={errors.canProvidePhone ? 'canProvidePhone-error' : undefined} />
          <span>{option ? 'Sí, puedo proporcionarlo' : 'No puedo proporcionar teléfono'}</span></label>)}</div>
        <FieldError id="canProvidePhone" error={errors.canProvidePhone} />
      </fieldset>
      {value.canProvidePhone !== false ? field('phone', 50, 'tel') : <p className="intake-help">Puedes continuar sin teléfono. Completa los datos del contacto de emergencia.</p>}
    </section>
    <section className="intake-personal-section" aria-labelledby="emergency-title">
      <h3 id="emergency-title">Contacto de emergencia</h3>
      <p className="intake-help">La persona a la que contactar en una emergencia. No implica representación legal.</p>
      {field('emergencyContactName', 200)}
      <div className="intake-two-fields">{field('emergencyContactRelationship', 100)}{field('emergencyContactPhone', 50, 'tel')}</div>
    </section>
    {minorAt(value.birthDate, today) ? <section className="intake-personal-section" aria-labelledby="responsible-title">
      <h3 id="responsible-title">Adulto responsable del menor</h3>
      <p className="intake-help">El adulto revisa y confirma las respuestas de este paciente. Estos datos no verifican ni acreditan la representación legal.</p>
      {field('responsibleAdultName', 200)}
      <div className="intake-two-fields"><div className="auth-field"><label htmlFor="responsibleAdultRelationship">Parentesco del responsable</label>
        <select id="responsibleAdultRelationship" className={intakeControl} required value={value.responsibleAdultRelationship ?? ''}
          aria-invalid={!!errors.responsibleAdultRelationship} aria-describedby={errors.responsibleAdultRelationship ? 'responsibleAdultRelationship-error' : undefined}
          onChange={event => onChange({ ...value, responsibleAdultRelationship: event.target.value as NonNullable<IntakePersonal['responsibleAdultRelationship']> })}>
          <option value="" disabled>Selecciona una opción</option>{Object.entries(relationships).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select><FieldError id="responsibleAdultRelationship" error={errors.responsibleAdultRelationship} /></div>
        {field('responsibleAdultPhone', 50, 'tel')}</div>
    </section> : null}
  </div>;
}

export function QuestionFields({ questions, value, options, errors, onChange }: {
  questions: Record<string, string>; value: Partial<Record<string, Question>>; options: Answer[]; errors: Errors; onChange: (key: string, question: Question) => void;
}) {
  return <div className="intake-questions">{Object.entries(questions).map(([key, label]) => <fieldset key={key} className="intake-question">
    <legend>{label}</legend>
    <div className="intake-options">{options.map(answer => <label key={answer} className="intake-option">
      <input id={`${key}-${answer}`} type="radio" name={key} value={answer} checked={value[key]?.answer === answer}
        aria-invalid={!!errors[`${key}.answer`]} aria-describedby={errors[`${key}.answer`] ? `${key}.answer-error` : undefined}
        onChange={() => onChange(key, value[key]?.answer === answer ? value[key]! : { answer })} /><span>{answerLabels[answer]}</span>
    </label>)}</div>
    <FieldError id={`${key}.answer`} error={errors[`${key}.answer`]} />
    {value[key]?.answer === 'YES' ? <div className="auth-field intake-question-detail"><label htmlFor={`${key}-details`}>Detalles de {label.toLowerCase()} (opcional)</label>
      <textarea id={`${key}-details`} className={intakeControl} rows={3} maxLength={2000} autoComplete="off" value={value[key]?.details ?? ''}
        aria-invalid={!!errors[`${key}.details`]} aria-describedby={`${key}-help${errors[`${key}.details`] ? ` ${key}.details-error` : ''}`}
        onChange={event => onChange(key, { answer: 'YES', details: event.target.value })} />
      <p id={`${key}-help`} className="auth-hint">Escribe solo lo que recuerdes. No necesitas conocer dosis, diagnósticos ni fechas exactas. Hasta 2000 caracteres.</p>
      <FieldError id={`${key}.details`} error={errors[`${key}.details`]} /></div> : null}
  </fieldset>)}</div>;
}
