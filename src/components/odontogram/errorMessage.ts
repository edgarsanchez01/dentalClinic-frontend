import { ApiError } from '../../api/http';

/**
 * Mensajes comprensibles para la escritura del odontograma (F7.4.3.4). El backend es
 * autoritativo: aqui solo se traducen los estados que no dependen del cuerpo devuelto.
 *  - 400: dato invalido (FDI, condicion o superficie); el backend ya responde en espanol.
 *  - 403: la matriz §7.4 deja la escritura clinica a OWNER y DENTIST.
 *  - 404: el recurso dejo de existir; conviene recargar.
 *  - 409: ya existe un registro (el API usa POST crear / PUT actualizar); el backend indica cual.
 */
export function odontogramWriteErrorMessage(cause: unknown, fallback: string): string {
  if (cause instanceof ApiError) {
    if (cause.status === 403) {
      return 'No tienes permiso para modificar el odontograma.';
    }
    if (cause.status === 404) {
      return 'La pieza o la superficie ya no existe; recarga el odontograma.';
    }
    if (cause.status === 409) {
      return cause.message;
    }
    return cause.message || fallback;
  }
  return fallback;
}