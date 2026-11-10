import { describe, expect, it } from 'vitest';
import { intakePersonal } from '../../test/intakeFixtures';
import { dentalQuestions, medicalQuestions, minorAt, personalPayload, validateSection, type FormValues } from './intakeForm';

const today = '2026-10-17';
const form = (): FormValues => ({ personal: { ...intakePersonal }, medical: {}, dental: {} });
describe('Validación espejo del contrato 17.7', () => {
  it.each(['2026-02-30', '2026-10-18', '0000-01-01', 'not-date'])('rechaza nacimiento %s', birthDate => {
    const value = form(); value.personal.birthDate = birthDate;
    expect(validateSection('personal', value, today)).toHaveProperty('birthDate');
  });
  it('admite fechas reales antiguas y usa el día clínico para cumplir 18 años', () => {
    expect(minorAt('2008-10-18', today)).toBe(true);
    expect(minorAt('2008-10-17', today)).toBe(false);
    expect(validateSection('personal', { ...form(), personal: { ...intakePersonal, birthDate: '0001-01-01' } }, today)).toEqual({});
  });
  it('menor exige responsable y adulto no lo envía', () => {
    const value = form(); value.personal.birthDate = '2015-01-01';
    expect(validateSection('personal', value, today)).toMatchObject({ responsibleAdultName: expect.any(String), responsibleAdultPhone: expect.any(String), responsibleAdultRelationship: expect.any(String) });
    value.personal.responsibleAdultName = 'Adulto sintético'; value.personal.responsibleAdultPhone = '555'; value.personal.responsibleAdultRelationship = 'MOTHER';
    expect(validateSection('personal', value, today)).toEqual({});
    expect(personalPayload({ ...value.personal, birthDate: '1990-01-01' }, today)).not.toHaveProperty('responsibleAdultName');
  });
  it('teléfono explícito, contacto de emergencia y borrador parcial', () => {
    const value = form(); delete value.personal.canProvidePhone; delete value.personal.phone; delete value.personal.emergencyContactPhone;
    expect(validateSection('personal', value, today)).toHaveProperty('canProvidePhone');
    value.personal.canProvidePhone = false; value.personal.emergencyContactPhone = '555';
    expect(validateSection('personal', value, today)).toEqual({});
    expect(validateSection('medical', value, today, false)).toEqual({});
    expect(validateSection('dental', value, today)).toHaveProperty('consultationReason');
  });
  it.each(Object.keys(medicalQuestions))('exige respuesta para %s y detalles solo opcionales hasta 2000', key => {
    const value = form();
    expect(validateSection('medical', value, today)).toHaveProperty(`${key}.answer`);
    Object.assign(value.medical, { [key]: { answer: 'YES', details: 'x'.repeat(2000) } });
    expect(validateSection('medical', value, today)[`${key}.details`]).toBeUndefined();
    Object.assign(value.medical, { [key]: { answer: 'YES', details: 'x'.repeat(2001) } });
    expect(validateSection('medical', value, today)[`${key}.details`]).toBeDefined();
  });
  it.each(Object.keys(dentalQuestions))('exige respuesta dental para %s', key => {
    expect(validateSection('dental', form(), today)[`${key}.answer`]).toBeDefined();
  });
  it('motivo de consulta permite exactamente 1000 caracteres', () => {
    const value = form(); value.dental.consultationReason = 'x'.repeat(1000);
    expect(validateSection('dental', value, today).consultationReason).toBeUndefined();
    value.dental.consultationReason += 'x';
    expect(validateSection('dental', value, today).consultationReason).toBeDefined();
  });
});
