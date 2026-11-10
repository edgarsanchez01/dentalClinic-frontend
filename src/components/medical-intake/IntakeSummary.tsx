import type { IntakeDeclaration, IntakePersonal, Question } from '../../api/medicalIntake';
import { answerLabels, dentalQuestions, medicalQuestions, personalLabels, relationships, type FormValues } from './intakeForm';
import { displayBirthDate } from './intakeFlow';

export function IntakeSummary({ value, onEdit }: { value: FormValues; onEdit?: (step: number) => void }) {
  const field = (key: keyof IntakePersonal) => {
        const data = value.personal[key];
        if (data === undefined || data === '') return null;
        return <div key={key}><dt>{personalLabels[key]}</dt>
          <dd>{typeof data === 'boolean' ? data ? 'Sí' : 'No puede proporcionar teléfono' : key === 'responsibleAdultRelationship' ? relationships[data as keyof typeof relationships] : key === 'birthDate' ? displayBirthDate(data) : data}</dd></div>;
  };
  const edit = (step: number, label: string) => onEdit ? <button type="button" className="intake-link" onClick={() => onEdit(step)}>Editar {label}</button> : null;
  return <div className="intake-summary [overflow-wrap:anywhere]">
    <section className="intake-summary-section" aria-label="Resumen de datos personales">
      <div className="intake-summary-heading"><h3>Datos personales</h3>{edit(0, 'datos personales')}</div>
      <dl className="intake-summary-personal grid gap-3 sm:grid-cols-2">{(['firstName', 'lastName', 'birthDate'] as const).map(field)}
        {value.personal.canProvidePhone === false ? field('canProvidePhone') : field('phone')}
      </dl>
      <details><summary>{value.personal.responsibleAdultName ? 'Contacto de emergencia y adulto responsable' : 'Contacto de emergencia'}</summary>
        <dl className="intake-summary-personal grid gap-3 sm:grid-cols-2">{(['emergencyContactName', 'emergencyContactRelationship', 'emergencyContactPhone', 'responsibleAdultName', 'responsibleAdultRelationship', 'responsibleAdultPhone'] as const).map(field)}</dl>
      </details>
    </section>
    {(['medical', 'dental'] as const).map((section, index) => <section key={section} className="intake-summary-section" aria-label={`Resumen de antecedentes ${section === 'medical' ? 'médicos' : 'dentales'}`}>
      <div className="intake-summary-heading"><h3>{section === 'medical' ? 'Antecedentes médicos' : 'Antecedentes dentales'}</h3>{edit(index + 1, section === 'medical' ? 'antecedentes médicos' : 'antecedentes dentales')}</div>
      <dl>{Object.entries(section === 'medical' ? medicalQuestions : dentalQuestions).map(([key, label]) => {
         const question = (value[section] as Partial<Record<string, Question>>)[key];
        return <div key={key} className="intake-summary-row"><dt>{label}</dt><dd><span className="intake-summary-response">{question ? answerLabels[question.answer] : 'Sin responder'}</span>{question?.answer === 'YES' && question.details ? <p className="intake-summary-detail">{question.details}</p> : null}</dd></div>;
       })}</dl>
      {section === 'dental' ? <dl className="intake-summary-row"><dt>Motivo de consulta</dt><dd>{value.dental.consultationReason || 'Sin indicar'}</dd></dl> : null}
    </section>)}
  </div>;
}

export function DeclarationView({ declaration }: { declaration: IntakeDeclaration }) {
  return <article className="space-y-4 [overflow-wrap:anywhere]">
    <p className="font-medium">Declaración confirmada · Revisión {declaration.revision}</p>
    <p className="text-ink-secondary">Confirmada el <time dateTime={declaration.confirmedAt}>{new Intl.DateTimeFormat('es', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(declaration.confirmedAt))} UTC</time> · {declaration.confirmedBy === 'PATIENT' ? 'Paciente' : 'Adulto responsable'}</p>
    <IntakeSummary value={declaration} />
    <p className="whitespace-pre-wrap">{declaration.declarationText}</p>
    <p className="text-ink-secondary">Versión de declaración: {declaration.declarationVersion}. Cuestionario: {declaration.questionnaireVersion}.</p>
    <details><summary className="min-h-11 cursor-pointer py-3">Aviso de privacidad aceptado</summary><p className="whitespace-pre-wrap">{declaration.privacy.noticeText}</p><p>Versión: {declaration.privacy.noticeVersion}</p></details>
  </article>;
}
