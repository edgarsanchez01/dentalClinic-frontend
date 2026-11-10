import { describe, expect, it } from 'vitest';

import { ApiError } from '../../api/http';
import { odontogramWriteErrorMessage } from './errorMessage';

describe('odontogramWriteErrorMessage', () => {
  it('deja pasar el mensaje del backend en 400 (datos inválidos)', () => {
    const error = new ApiError(400, null, 'La superficie es obligatoria.');
    expect(odontogramWriteErrorMessage(error, 'fallback')).toBe('La superficie es obligatoria.');
  });

  it('traduce 403 a un permiso denegado, sin revelar el backend', () => {
    const error = new ApiError(403, null, 'Forbidden');
    expect(odontogramWriteErrorMessage(error, 'fallback')).toBe(
      'No tienes permiso para modificar el odontograma.',
    );
  });

  it('traduce 404 indicando que hay que recargar', () => {
    const error = new ApiError(404, null, 'Not Found');
    expect(odontogramWriteErrorMessage(error, 'fallback')).toBe(
      'La pieza o la superficie ya no existe; recarga el odontograma.',
    );
  });

  it('conserva el mensaje orientativo del backend en 409 (conflicto de estado)', () => {
    const error = new ApiError(409, null, 'La pieza 9 ya tiene un registro; actualízala con PUT.');
    expect(odontogramWriteErrorMessage(error, 'fallback')).toBe(
      'La pieza 9 ya tiene un registro; actualízala con PUT.',
    );
  });

  it('usa el mensaje del backend como respaldo para otros estados', () => {
    const error = new ApiError(500, null, 'boom');
    expect(odontogramWriteErrorMessage(error, 'fallback')).toBe('boom');
  });

  it('cae al mensaje genérico cuando el fallo no viene del API', () => {
    expect(odontogramWriteErrorMessage(new Error('boom'), 'No se pudo guardar la pieza.')).toBe(
      'No se pudo guardar la pieza.',
    );
  });
});