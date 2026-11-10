import type { Answer, Dental, IntakePersonal, Medical } from '../../api/medicalIntake';

export const medicalQuestions: Record<keyof Medical, string> = {
  allergies: 'Alergias y reacciones', medications: 'Medicamentos actuales', medicalConditions: 'Condiciones médicas relevantes',
  surgeriesOrHospitalizations: 'Cirugías u hospitalizaciones', anesthesiaReactions: 'Reacciones a anestesia', bleedingOrAnticoagulants: 'Sangrado o anticoagulantes',
};
export const dentalQuestions: Record<Exclude<keyof Dental, 'consultationReason'>, string> = {
  previousTreatments: 'Tratamientos anteriores', orthodonticsOrAppliances: 'Ortodoncia o aparatos', currentDiscomfort: 'Molestias actuales', gumBleedingOrSensitivity: 'Sangrado de encías o sensibilidad',
};
export const answerLabels: Record<Answer, string> = { YES: 'Sí', NO: 'No', UNKNOWN: 'No lo sé', DISCUSS_IN_CONSULTATION: 'Prefiero hablarlo en consulta' };
export const relationships = { MOTHER: 'Madre', FATHER: 'Padre', LEGAL_GUARDIAN: 'Tutor legal' };
export const personalLabels: Record<keyof IntakePersonal, string> = {
  firstName: 'Nombre', lastName: 'Apellidos', birthDate: 'Fecha de nacimiento', phone: 'Teléfono', canProvidePhone: '¿Puedes proporcionar teléfono?',
  emergencyContactName: 'Nombre del contacto de emergencia', emergencyContactRelationship: 'Relación con el contacto de emergencia', emergencyContactPhone: 'Teléfono del contacto de emergencia',
  responsibleAdultName: 'Nombre del adulto responsable', responsibleAdultRelationship: 'Parentesco del responsable', responsibleAdultPhone: 'Teléfono del responsable',
};
export type Section = 'personal' | 'medical' | 'dental';
export type FormValues = { personal: IntakePersonal; medical: Medical; dental: Dental };
export type Errors = Record<string, string>;
function birthDateValid(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function minorAt(birthDate: string | undefined, today: string): boolean {
  if (!birthDate || !birthDateValid(birthDate)) return false;
  let age = Number(today.slice(0, 4)) - Number(birthDate.slice(0, 4));
  if (today.slice(5) < birthDate.slice(5)) age--;
  return age < 18;
}
export function personalPayload(personal: IntakePersonal, today: string): IntakePersonal {
  const next = { ...personal };
  if (!minorAt(next.birthDate, today)) {
    delete next.responsibleAdultName; delete next.responsibleAdultRelationship; delete next.responsibleAdultPhone;
  }
  return next;
}
/** Mirrors IntakeValidation; server remains authoritative (including the clinic-zone age). */
export function validateSection(section: Section, form: FormValues, today: string, complete = true): Errors {
  const errors: Errors = {};
  const text = (key: string, value: string | undefined, max: number, required: boolean) => {
    if (required && !value?.trim()) errors[key] = 'Este dato es obligatorio.';
    if (value && (value.length > max || value.includes('\0'))) errors[key] = `Introduce como máximo ${max} caracteres, sin caracteres nulos.`;
  };
  if (section === 'personal') {
    const p = form.personal;
    text('firstName', p.firstName, 100, true); text('lastName', p.lastName, 100, true);
    if ((complete && !p.birthDate) || (p.birthDate && (!birthDateValid(p.birthDate) || p.birthDate > today))) errors.birthDate = 'Introduce una fecha real y no futura.';
    if (complete && p.canProvidePhone === undefined) errors.canProvidePhone = 'Indica si puedes proporcionar teléfono.';
    text('phone', p.phone, 50, complete && p.canProvidePhone === true);
    text('emergencyContactName', p.emergencyContactName, 200, complete);
    text('emergencyContactRelationship', p.emergencyContactRelationship, 100, complete);
    text('emergencyContactPhone', p.emergencyContactPhone, 50, complete);
    const minor = minorAt(p.birthDate, today);
    text('responsibleAdultName', p.responsibleAdultName, 200, complete && minor);
    text('responsibleAdultPhone', p.responsibleAdultPhone, 50, complete && minor);
    if (complete && minor && !p.responsibleAdultRelationship) errors.responsibleAdultRelationship = 'Indica madre, padre o tutor legal.';
  } else {
    const questions = section === 'medical' ? medicalQuestions : dentalQuestions;
    for (const key of Object.keys(questions)) {
      const q = (form[section] as Medical)[key as keyof Medical];
      if ((complete && !q?.answer) || (q && !Object.hasOwn(answerLabels, q.answer))) errors[`${key}.answer`] = 'Selecciona una respuesta.';
      text(`${key}.details`, q?.details, 2000, false);
      if (q?.details?.trim() && q.answer !== 'YES') errors[`${key}.details`] = 'Los detalles solo se guardan con respuesta Sí.';
    }
    if (section === 'dental') text('consultationReason', form.dental.consultationReason, 1000, complete);
  }
  return errors;
}
