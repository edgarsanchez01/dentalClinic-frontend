import { dentalQuestions, medicalQuestions, personalLabels, validateSection, type Errors, type FormValues } from './intakeForm';

export const intakeSteps = ['Datos personales', 'Antecedentes médicos', 'Antecedentes dentales', 'Revisión y confirmación'];
export const medicalGroups = [
  { title: 'Alergias y medicamentos', keys: ['allergies', 'medications'] },
  { title: 'Salud y antecedentes', keys: ['medicalConditions', 'surgeriesOrHospitalizations'] },
  { title: 'Anestesia y sangrado', keys: ['anesthesiaReactions', 'bleedingOrAnticoagulants'] },
];
export const dentalGroups = [
  { title: 'Tu atención dental anterior', keys: ['previousTreatments', 'orthodonticsOrAppliances'] },
  { title: 'Cómo te encuentras hoy', keys: ['currentDiscomfort', 'gumBleedingOrSensitivity', 'consultationReason'] },
];
export function groupQuestions(section: 'medical' | 'dental', page: number): Record<string, string> {
  const groups = section === 'medical' ? medicalGroups : dentalGroups;
  const questions = section === 'medical' ? medicalQuestions : dentalQuestions;
  return Object.fromEntries(Object.entries(questions).filter(([key]) => groups[page]!.keys.includes(key)));
}
export function groupErrors(section: 'medical' | 'dental', page: number, errors: Errors): Errors {
  const group = (section === 'medical' ? medicalGroups : dentalGroups)[page]!;
  return Object.fromEntries(Object.entries(errors).filter(([key]) => group.keys.includes(key.split('.')[0]!)));
}
export function errorGroup(section: 'medical' | 'dental', errors: Errors): number {
  const groups = section === 'medical' ? medicalGroups : dentalGroups;
  return Math.max(0, groups.findIndex(group => Object.keys(errors).some(key => group.keys.includes(key.split('.')[0]!))));
}
export function savedSections(value: FormValues, today: string): boolean[] {
  return (['personal', 'medical', 'dental'] as const).map(section => !Object.keys(validateSection(section, value, today)).length);
}
export function errorTarget(key: string): string {
  if (key.endsWith('.answer')) return `${key.split('.')[0]}-YES`;
  if (key.endsWith('.details')) return `${key.split('.')[0]}-details`;
  if (key === 'canProvidePhone') return 'canProvidePhone-yes';
  return key;
}
export function errorLabel(key: string): string {
  const name = key.split('.')[0]!;
  const labels: Record<string, string> = { ...personalLabels, ...medicalQuestions, ...dentalQuestions, consultationReason: 'Motivo de consulta' };
  const label = labels[name] ?? 'Revisa este dato';
  return key.endsWith('.details') ? `Detalles de ${label.toLowerCase()}` : label;
}
export function displayBirthDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeZone: 'UTC' }).format(date) : value;
}

/** Presentación explícita mexicana; fechas completas viajan en el mismo contrato ISO. */
export function birthDateInput(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)}` : value;
}
export function birthDateValue(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 8);
  if (digits.length === 8) return `${digits.slice(4)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
  return [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4)].filter(Boolean).join('/');
}
