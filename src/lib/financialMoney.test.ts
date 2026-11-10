import { describe, expect, it } from 'vitest';
import { cents, formatMoney, MAX_CENTS, moneyFromCents, normalizeMoney, positiveId } from './financialMoney';

describe('Vista previa financiera exacta', () => {
  it('suma y compara centavos sin punto flotante ni epsilon', () => {
    expect(moneyFromCents(cents('0.10') + cents('0.20'))).toBe('0.30');
    expect(cents('100.01') > cents('100.00')).toBe(true);
    expect(cents('999999999999999.9900')).toBe(MAX_CENTS);
    expect(formatMoney('100.0100')).toBe('$100.01 MXN');
  });
  it.each(['-1', '1.001', '1e2', '1,000.00', '', '1000000000000000'])('rechaza el precio de entrada %s sin redondear', (value) => expect(normalizeMoney(value)).toBeNull());
  it('admite coma decimal y ceros tecnicos de respuesta, sin aceptar fracciones no monetarias', () => {
    expect(normalizeMoney('001,20')).toBe('1.20');
    expect(cents('0.0000')).toBe(0n);
    expect(() => cents('1.0001')).toThrow();
  });
  it('no acepta identificadores fraccionarios, negativos o inseguros', () => {
    for (const id of ['1.2', '-1', '0', '9007199254740992', 'abc']) expect(positiveId(id)).toBeNull();
    expect(positiveId('10')).toBe(10);
  });
});
