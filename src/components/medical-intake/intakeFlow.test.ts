import { describe, expect, it } from 'vitest';
import { birthDateInput, birthDateValue, displayBirthDate, errorGroup, errorTarget, groupErrors, groupQuestions } from './intakeFlow';
import { validateSection } from './intakeForm';
import { intakeDraft } from '../../test/intakeFixtures';

describe('UX-02: presentación y navegación, sin modificar el contrato clínico', () => {
  it('los grupos incluyen exactamente las seis preguntas médicas y cuatro dentales', () => {
    const medical = [0, 1, 2].flatMap(page => Object.keys(groupQuestions('medical', page)));
    const dental = [0, 1].flatMap(page => Object.keys(groupQuestions('dental', page)));
    expect(medical).toHaveLength(6); expect(new Set(medical).size).toBe(6);
    expect(dental).toHaveLength(4); expect(new Set(dental).size).toBe(4);
    for (const page of [0, 1, 2]) expect(Object.keys(groupQuestions('medical', page))).toHaveLength(2);
  });
  it('la validación de un grupo no inventa respuestas en los demás', () => {
    const errors = { 'allergies.answer': 'Falta', 'medicalConditions.answer': 'Falta' };
    expect(groupErrors('medical', 0, errors)).toEqual({ 'allergies.answer': 'Falta' });
    expect(errorGroup('medical', { 'anesthesiaReactions.answer': 'Falta' })).toBe(2);
    expect(errorGroup('dental', { consultationReason: 'Falta' })).toBe(1);
  });
  it('asocia errores a controles reales y no a ids de modelo inexistentes', () => {
    expect(errorTarget('allergies.answer')).toBe('allergies-YES');
    expect(errorTarget('allergies.details')).toBe('allergies-details');
    expect(errorTarget('canProvidePhone')).toBe('canProvidePhone-yes');
    expect(errorTarget('birthDate')).toBe('birthDate');
  });
  it('presenta día/mes/año sin depender de la configuración regional del navegador', () => {
    expect(birthDateInput('1990-04-10')).toBe('10/04/1990');
    expect(birthDateValue('10/04/1990')).toBe('1990-04-10');
    expect(birthDateValue('10041990')).toBe('1990-04-10');
    expect(displayBirthDate('1990-04-10')).toBe('10 de abril de 1990');
  });
  it('conserva la edición parcial en memoria y no deja enviarla como fecha válida', () => {
    const partial = birthDateValue('10/04/19');
    expect(birthDateInput(partial)).toBe('10/04/19');
    const form = { personal: { ...intakeDraft().personal, birthDate: partial }, medical: {}, dental: {} };
    expect(validateSection('personal', form, '2026-10-18', false).birthDate).toBeDefined();
    expect(birthDateValue('')).toBe('');
  });
  it.each(['31/02/2020', '29/02/2023', '19/10/2026', '01/01/0000'])('fecha inválida o futura %s conserva validación previa', value => {
    const form = { personal: { ...intakeDraft().personal, birthDate: birthDateValue(value) }, medical: {}, dental: {} };
    expect(validateSection('personal', form, '2026-10-18').birthDate).toBeDefined();
  });
  it('una fecha bisiesta real conserva el contrato ISO', () => {
    const form = { personal: { ...intakeDraft().personal, birthDate: birthDateValue('29/02/2000') }, medical: {}, dental: {} };
    expect(validateSection('personal', form, '2026-10-18').birthDate).toBeUndefined();
  });
});
