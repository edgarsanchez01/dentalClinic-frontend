import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { tokenStore } from '../../api/http';
import type { ToothHistoryDto, ToothRecordDto } from '../../api/odontogram';
import type { TreatmentDto } from '../../api/treatments';
import { OdontogramSection } from './OdontogramSection';

function response(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as Response;
}

function stub(routes: (url: string, init?: RequestInit) => Response | undefined) {
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const result = routes(url, init);
    if (result) return Promise.resolve(result);
    // Por defecto un paciente sin tratamientos, salvo que la prueba indique lo contrario.
    if (url.includes('/clinical/treatments')) return Promise.resolve(response(200, []));
    return Promise.reject(new Error(`Sin stub para ${url}`));
  });
}

function spyOnFetch(routes: (url: string, init?: RequestInit) => Response | undefined) {
  const calls: Array<{ url: string; method: string; body: Record<string, unknown> | undefined }> = [];
  stub((url, init) => {
    const method = init?.method ?? 'GET';
    const body = init && typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ url, method, body });
    return routes(url, init);
  });
  return calls;
}

function renderSection(summary = false, patientId = 1, editable = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OdontogramSection patientId={patientId} summary={summary} editable={editable} />
    </QueryClientProvider>,
  );
}

function fullRecord(overrides: Partial<ToothRecordDto>): ToothRecordDto {
  return {
    id: 1,
    patientId: 1,
    toothFdi: 16,
    dentition: 'PERMANENT',
    condition: 'CARIES',
    notes: 'Caries en oclusal',
    treatmentIds: [12],
    createdAt: '2026-03-01T00:00:00Z',
    history: [],
    surfaces: [
      {
        id: 2,
        toothRecordId: 1,
        surface: 'OCCLUSAL',
        condition: 'CARIES',
        createdAt: '2026-03-01T00:00:00Z',
        history: [],
      },
    ],
    ...overrides,
  };
}

function treatment(overrides: Partial<TreatmentDto>): TreatmentDto {
  return {
    id: 12,
    patientId: 1,
    description: 'Obturación de composite',
    status: 'PLANNED',
    createdAt: '2026-03-01T00:00:00Z',
    toothFdis: [],
    ...overrides,
  };
}

beforeEach(() => {
  tokenStore.set(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Odontograma — personal clínico (staff)', () => {
  it('carga las piezas con estilos de condición y muestra el detalle con superficies y observaciones', async () => {
    stub((url) => {
      if (url.includes('/api/patients/1/odontogram')) {
        return response(200, [fullRecord({})]);
      }
      return undefined;
    });
    renderSection();

    const tooth = await screen.findByRole('button', { name: /Pieza 16 Superior derecho/ });
    expect(tooth).toHaveTextContent('16');

    fireEvent.click(tooth);

    expect(await screen.findByRole('heading', { name: 'Pieza 16' })).toBeInTheDocument();
    expect(screen.getByText('Superior derecho · Permanente')).toBeInTheDocument();
    expect(screen.getByText('Oclusal')).toBeInTheDocument();
    expect(screen.getByText('Observaciones:')).toBeInTheDocument();
    expect(screen.getByText('Caries en oclusal')).toBeInTheDocument();
    expect(screen.getByText('Tratamientos vinculados: 1')).toBeInTheDocument();
  });

  it('la superficie no registrada se muestra como "Sin registro" en el detalle', async () => {
    stub((url) => {
      if (url.includes('/api/patients/1/odontogram')) return response(200, [fullRecord({})]);
      return undefined;
    });
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: /Pieza 16 Superior derecho/ }));

    expect(await screen.findByRole('heading', { name: 'Pieza 16' })).toBeInTheDocument();
    expect(screen.getByText('Mesial')).toBeInTheDocument();
    expect(screen.getAllByText('Sin registro').length).toBeGreaterThan(0);
  });

  it('el estado vacío explica que no hay condiciones registradas', async () => {
    stub((url) => {
      if (url.includes('/api/patients/1/odontogram')) return response(200, []);
      return undefined;
    });
    renderSection();

    expect(await screen.findByText('Sin condiciones registradas')).toBeInTheDocument();
    expect(screen.getByText(/Todavía no hay hallazgos anotados/)).toBeInTheDocument();
  });

  it('un error de carga muestra el aviso y permite reintentar', async () => {
    let calls = 0;
    stub((url) => {
      if (url.includes('/api/patients/1/odontogram')) {
        calls += 1;
        return calls === 1 ? response(500, { message: 'boom' }) : response(200, []);
      }
      return undefined;
    });
    renderSection();

    expect(await screen.findByText('No se pudo cargar el odontograma.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByText('Sin condiciones registradas')).toBeInTheDocument();
  });

  it('el toggle de dentición filtra entre permanente y temporal', async () => {
    stub((url) => {
      if (url.includes('/api/patients/1/odontogram')) {
        return response(200, [fullRecord({}), fullRecord({ id: 3, toothFdi: 51, dentition: 'TEMPORARY', condition: 'SEALED', notes: 'Sellador', treatmentIds: [], surfaces: [] })]);
      }
      return undefined;
    });
    renderSection();

    expect(await screen.findByRole('button', { name: /Pieza 16 Superior derecho/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pieza 51/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Temporal' }));

    expect(await screen.findByRole('button', { name: /Pieza 51 Superior derecho/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pieza 16/ })).not.toBeInTheDocument();
  });

  it('la vista de lista enumera todas las piezas, registradas o no', async () => {
    stub((url) => {
      if (url.includes('/api/patients/1/odontogram')) return response(200, [fullRecord({})]);
      return undefined;
    });
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Lista' }));

    expect(await screen.findByText('16 · Superior derecho')).toBeInTheDocument();
    const rows = screen.getAllByRole('row');
    expect(rows.length).toBe(33); // cabecera + 32 piezas permanentes
  });
});

describe('Odontograma — resumen del propio paciente', () => {
  it('muestra el resumen y carga las superficies al seleccionar una pieza, sin datos clínicos extra', async () => {
    stub((url) => {
      if (url.endsWith('/api/patients/1/odontogram')) {
        return response(200, [{ toothFdi: 26, dentition: 'PERMANENT', condition: 'RESTORED' }]);
      }
      if (url.includes('/api/patients/1/odontogram/26/surfaces')) {
        return response(200, [{ surface: 'DISTAL', condition: 'RESTORED' }]);
      }
      return undefined;
    });
    renderSection(true);

    fireEvent.click(await screen.findByRole('button', { name: /Pieza 26 Superior izquierdo/ }));

    const detail = (await screen.findByRole('heading', { name: 'Pieza 26' })).closest('section')!;
    const detailQueries = within(detail);
    const distalCell = (await detailQueries.findByText('Distal')).closest('div')!;
    expect(within(distalCell).getByText('Restauración')).toBeInTheDocument();
    expect(screen.queryByText('Observaciones:')).not.toBeInTheDocument();
    expect(screen.queryByText(/Tratamientos vinculados/)).not.toBeInTheDocument();
  });
});

describe('Odontograma — edición clínica (DENTIST, F7.4.3.4)', () => {
  it('registra una pieza sin registro con POST, la muestra al instante y pasa a actualizar', async () => {
    const calls = spyOnFetch((url, init) => {
      if (url.includes('/api/patients/1/odontogram') && init?.method === 'POST') {
        return response(201, fullRecord({ id: 9, toothFdi: 17, condition: 'HEALTHY', notes: 'Revisar en 6 meses', treatmentIds: [], surfaces: [] }));
      }
      if (url.includes('/api/patients/1/odontogram')) return response(200, [fullRecord({})]);
      return undefined;
    });
    renderSection(false, 1, true);

    fireEvent.click(await screen.findByRole('button', { name: /Pieza 17 Superior derecho.*sin registro/ }));
    expect(await screen.findByRole('heading', { name: 'Pieza 17' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar pieza' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Condición de la pieza'), { target: { value: 'HEALTHY' } });
    fireEvent.change(screen.getByLabelText('Observaciones (opcional)'), { target: { value: 'Revisar en 6 meses' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar pieza' }));

    await waitFor(() => {
      const post = calls.find((call) => call.method === 'POST');
      expect(post?.url).toContain('/api/patients/1/odontogram');
      expect(post?.body).toMatchObject({ toothFdi: 17, condition: 'HEALTHY', notes: 'Revisar en 6 meses', treatmentIds: [] });
    });
    expect(await screen.findByText('Pieza 17 guardada.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Guardar pieza' })).toBeInTheDocument();
  });

  it('actualiza una pieza existente con PUT conservando los tratamientos vinculados', async () => {
    const calls = spyOnFetch((url, init) => {
      if (url.endsWith('/api/patients/1/odontogram/16') && init?.method === 'PUT') {
        return response(200, fullRecord({ condition: 'SEALED', notes: 'Sellador aplicado' }));
      }
      if (url.includes('/api/patients/1/odontogram')) return response(200, [fullRecord({})]);
      return undefined;
    });
    renderSection(false, 1, true);

    fireEvent.click(await screen.findByRole('button', { name: /Pieza 16 Superior derecho/ }));
    expect(await screen.findByRole('heading', { name: 'Pieza 16' })).toBeInTheDocument();
    expect(screen.getByLabelText('Condición de la pieza')).toHaveValue('CARIES');
    expect(screen.getByLabelText('Observaciones (opcional)')).toHaveValue('Caries en oclusal');
    expect(screen.getByText('Condición actual: Caries. Guardar aquí actualiza la pieza.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Condición de la pieza'), { target: { value: 'SEALED' } });
    fireEvent.change(screen.getByLabelText('Observaciones (opcional)'), { target: { value: 'Sellador aplicado' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar pieza' }));

    await waitFor(() => {
      const put = calls.find((call) => call.method === 'PUT');
      expect(put?.url).toContain('/api/patients/1/odontogram/16');
      expect(put?.body).toMatchObject({ condition: 'SEALED', notes: 'Sellador aplicado', treatmentIds: [12] });
    });
    expect(await screen.findByText('Pieza 16 guardada.')).toBeInTheDocument();
  });

  it('registra una superficie nueva de la pieza con POST', async () => {
    const calls = spyOnFetch((url, init) => {
      if (url.includes('/api/patients/1/odontogram/16/surfaces') && init?.method === 'POST') {
        return response(201, { id: 5, toothRecordId: 1, surface: 'MESIAL', condition: 'CARIES', notes: 'caries mesial', createdAt: '2026-03-02T00:00:00Z', history: [] });
      }
      if (url.includes('/api/patients/1/odontogram')) return response(200, [fullRecord({})]);
      return undefined;
    });
    renderSection(false, 1, true);

    fireEvent.click(await screen.findByRole('button', { name: /Pieza 16 Superior derecho/ }));
    fireEvent.click(screen.getByText('Superficies de la pieza'));
    fireEvent.change(screen.getByLabelText('Superficie a editar'), { target: { value: 'MESIAL' } });
    fireEvent.change(await screen.findByLabelText('Condición de la superficie Mesial'), { target: { value: 'CARIES' } });
    fireEvent.change(screen.getByLabelText('Observaciones de Mesial'), { target: { value: 'caries mesial' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar superficie mesial' }));

    await waitFor(() => {
      const post = calls.find((call) => call.method === 'POST');
      expect(post?.url).toContain('/api/patients/1/odontogram/16/surfaces');
      expect(post?.body).toMatchObject({ surface: 'MESIAL', condition: 'CARIES', notes: 'caries mesial' });
    });
    expect(await screen.findByText('Superficie Mesial guardada.')).toBeInTheDocument();
  });

  it('actualiza una superficie existente con PUT', async () => {
    const calls = spyOnFetch((url, init) => {
      if (url.endsWith('/api/patients/1/odontogram/16/surfaces/OCCLUSAL') && init?.method === 'PUT') {
        return response(200, { id: 2, toothRecordId: 1, surface: 'OCCLUSAL', condition: 'RESTORED', notes: null, createdAt: '2026-03-01T00:00:00Z', history: [] });
      }
      if (url.includes('/api/patients/1/odontogram')) return response(200, [fullRecord({})]);
      return undefined;
    });
    renderSection(false, 1, true);

    fireEvent.click(await screen.findByRole('button', { name: /Pieza 16 Superior derecho/ }));
    fireEvent.click(screen.getByText('Superficies de la pieza'));
    expect(await screen.findByLabelText('Condición de la superficie Oclusal')).toHaveValue('CARIES');
    fireEvent.change(screen.getByLabelText('Condición de la superficie Oclusal'), { target: { value: 'RESTORED' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar superficie oclusal' }));

    await waitFor(() => {
      const put = calls.find((call) => call.method === 'PUT');
      expect(put?.url).toContain('/api/patients/1/odontogram/16/surfaces/OCCLUSAL');
      expect(put?.body).toMatchObject({ condition: 'RESTORED', notes: null });
    });
    expect(await screen.findByText('Superficie Oclusal guardada.')).toBeInTheDocument();
  });

  it('no permite registrar superficies hasta que la pieza tenga condición', async () => {
    stub((url) => {
      if (url.includes('/api/patients/1/odontogram')) return response(200, [fullRecord({})]);
      return undefined;
    });
    renderSection(false, 1, true);

    fireEvent.click(await screen.findByRole('button', { name: /Pieza 17 Superior derecho.*sin registro/ }));

    expect(await screen.findByText(/Registra primero la condición de la pieza/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Condición de la superficie Mesial')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar superficie mesial' })).not.toBeInTheDocument();
  });

  it('maneja el 409 como conflicto y resincroniza con el backend', async () => {
    let getCalls = 0;
    const calls = spyOnFetch((url, init) => {
      if (url.includes('/api/patients/1/odontogram') && init?.method === 'POST') {
        return response(409, { status: 409, error: 'Conflict', message: 'La pieza 17 ya tiene un registro; actualízala con PUT.', path: '/api/patients/1/odontogram', timestamp: '2026-03-01T00:00:00Z' });
      }
      if (url.includes('/api/patients/1/odontogram')) {
        getCalls += 1;
        return response(200, [fullRecord({})]);
      }
      return undefined;
    });
    renderSection(false, 1, true);

    fireEvent.click(await screen.findByRole('button', { name: /Pieza 17 Superior derecho.*sin registro/ }));
    fireEvent.change(await screen.findByLabelText('Condición de la pieza'), { target: { value: 'HEALTHY' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar pieza' }));

    expect(await screen.findByText(/La pieza 17 ya tiene un registro; actualízala con PUT/)).toBeInTheDocument();
    await waitFor(() => {
      expect(getCalls).toBeGreaterThanOrEqual(2);
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    });
  });

  it('la pieza seleccionada muestra el historial embebido pero sin controles de edición en modo lectura', async () => {
    stub((url) => {
      if (url.includes('/api/patients/1/odontogram')) {
        return response(200, [
          fullRecord({
            history: [{ id: 1, previousCondition: null, newCondition: 'CARIES', actorUserId: 5, actorName: 'Dra. Ana', changedAt: '2026-03-01T00:00:00Z' }],
          }),
        ]);
      }
      return undefined;
    });
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: /Pieza 16 Superior derecho/ }));

    expect(await screen.findByText('Historial')).toBeInTheDocument();
    expect(screen.getByText('Registro inicial')).toBeInTheDocument();
    expect(screen.getByText(/Dra\. Ana/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar pieza' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Condición de la pieza')).not.toBeInTheDocument();
  });
});

describe('Odontograma — pestañas y línea de tiempo del historial', () => {
  it('despliega el historial sin ocultar ni desmontar el editor', async () => {
    stub((url) => {
      if (url.includes('/api/patients/1/odontogram')) return response(200, [fullRecord({})]);
      return undefined;
    });
    renderSection(false, 1, true);

    fireEvent.click(await screen.findByRole('button', { name: /Pieza 16 Superior derecho/ }));

    const history = screen.getByText('Historial de esta pieza');
    fireEvent.change(screen.getByLabelText('Observaciones (opcional)'), { target: { value: 'Borrador conservado' } });
    expect(screen.getByLabelText('Condición de la pieza')).toBeVisible();
    expect(screen.getByText(/Sin movimientos registrados/)).not.toBeVisible();

    fireEvent.click(history);
    expect(history.closest('details')).toHaveAttribute('open');
    expect(screen.getByLabelText('Condición de la pieza')).toBeVisible();
    expect(screen.getByText(/Sin movimientos registrados/)).toBeVisible();

    fireEvent.click(history);
    expect(history.closest('details')).not.toHaveAttribute('open');
    expect(screen.getByLabelText('Observaciones (opcional)')).toHaveValue('Borrador conservado');
  });

  it('ordena la cronología de pieza y superficies del evento más reciente al más antiguo', async () => {
    stub((url) => {
      if (url.includes('/api/patients/1/odontogram')) {
        return response(200, [
          fullRecord({
            history: [
              { id: 1, previousCondition: null, newCondition: 'CARIES', actorUserId: 5, actorName: 'Dra. Ana', changedAt: '2026-03-01T09:00:00Z' },
              { id: 2, previousCondition: 'CARIES', newCondition: 'SEALED', actorUserId: 6, actorName: 'Dr. Beto', changedAt: '2026-03-05T09:00:00Z' },
            ],
            surfaces: [
              {
                id: 10,
                toothRecordId: 1,
                surface: 'OCCLUSAL',
                condition: 'RESTORED',
                createdAt: '2026-03-01T00:00:00Z',
                history: [
                  { id: 5, previousCondition: null, newCondition: 'RESTORED', actorUserId: 5, actorName: 'Dra. Ana', changedAt: '2026-03-03T09:00:00Z' },
                ],
              },
            ],
          }),
        ]);
      }
      return undefined;
    });
    renderSection(false, 1, true);

    fireEvent.click(await screen.findByRole('button', { name: /Pieza 16 Superior derecho/ }));
    fireEvent.click(screen.getByText('Historial de esta pieza'));

    const list = screen.getByRole('list', { name: 'Historial de cambios' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Sellado');
    expect(items[0]).toHaveTextContent('Actualización');
    expect(items[0]).toHaveTextContent('Dr. Beto');
    expect(items[1]).toHaveTextContent('Superficie · Oclusal');
    expect(items[1]).toHaveTextContent('Registro inicial');
    expect(items[2]).toHaveTextContent('Caries');
    expect(items[2]).toHaveTextContent('Dra. Ana');
  });

  it('representa el alta de condición como "Sin registro previo", nunca "undefined"', async () => {
    const entries = [
      { id: 1, previousCondition: null, newCondition: 'CROWN', actorUserId: 5, actorName: 'Dra. Ana', changedAt: '2026-03-02T09:00:00Z' },
      { id: 2, previousCondition: undefined, newCondition: 'CARIES', actorUserId: 6, actorName: 'Dr. Beto', changedAt: '2026-03-01T09:00:00Z' },
    ] as unknown as ToothHistoryDto[];
    stub((url) => {
      if (url.includes('/api/patients/1/odontogram')) {
        return response(200, [fullRecord({ history: entries, surfaces: [] })]);
      }
      return undefined;
    });
    renderSection(false, 1, true);

    fireEvent.click(await screen.findByRole('button', { name: /Pieza 16 Superior derecho/ }));
    fireEvent.click(screen.getByText('Historial de esta pieza'));

    const list = screen.getByRole('list', { name: 'Historial de cambios' });
    expect(within(list).getAllByText('Sin registro previo')).toHaveLength(2);
    expect(within(list).queryByText(/undefined/)).not.toBeInTheDocument();
    expect(within(list).getByText('Corona')).toBeInTheDocument();
  });

  it('explica el estado vacío cuando la pieza no tiene movimientos registrados', async () => {
    stub((url) => {
      if (url.includes('/api/patients/1/odontogram')) {
        return response(200, [fullRecord({ history: [], surfaces: [] })]);
      }
      return undefined;
    });
    renderSection(false, 1, true);

    fireEvent.click(await screen.findByRole('button', { name: /Pieza 16 Superior derecho/ }));
    fireEvent.click(screen.getByText('Historial de esta pieza'));

    expect(screen.getByText(/Sin movimientos registrados/)).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Historial de cambios' })).not.toBeInTheDocument();
  });
});

describe('Odontograma — tratamientos relacionados (F7.4.4)', () => {
  it('carga los tratamientos del paciente correcto y precarga los ya vinculados', async () => {
    const calls = spyOnFetch((url) => {
      if (url.includes('/clinical/treatments')) {
        return response(200, [
          treatment({ id: 12, description: 'Obturación de composite' }),
          treatment({ id: 13, description: 'Endodoncia', status: 'IN_PROGRESS' }),
        ]);
      }
      if (url.includes('/api/patients/1/odontogram')) {
        return response(200, [fullRecord({ treatmentIds: [12] })]);
      }
      return undefined;
    });
    renderSection(false, 1, true);

    fireEvent.click(await screen.findByRole('button', { name: /Pieza 16 Superior derecho/ }));
    fireEvent.click(await screen.findByText('Tratamientos relacionados', { selector: 'summary' }));

    expect(screen.getByRole('checkbox', { name: /Obturación de composite/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Endodoncia/ })).not.toBeChecked();

    const listCall = calls.find((call) => call.url.includes('/clinical/treatments'));
    expect(listCall?.method).toBe('GET');
    expect(listCall?.url).toContain('/api/patients/1/clinical/treatments');
  });

  it('asocia y desvincula tratamientos sin eliminar el tratamiento clínico', async () => {
    const calls = spyOnFetch((url, init) => {
      if (url.includes('/clinical/treatments')) {
        return response(200, [
          treatment({ id: 12, description: 'Obturación de composite' }),
          treatment({ id: 13, description: 'Endodoncia', status: 'IN_PROGRESS' }),
        ]);
      }
      if (url.endsWith('/api/patients/1/odontogram/16') && init?.method === 'PUT') {
        return response(200, fullRecord({ treatmentIds: [13] }));
      }
      if (url.includes('/api/patients/1/odontogram')) {
        return response(200, [fullRecord({ treatmentIds: [12] })]);
      }
      return undefined;
    });
    renderSection(false, 1, true);

    fireEvent.click(await screen.findByRole('button', { name: /Pieza 16 Superior derecho/ }));
    fireEvent.click(screen.getByText('Tratamientos relacionados', { selector: 'summary' }));
    const linked = await screen.findByRole('checkbox', { name: /Obturación de composite/ });
    expect(linked).toBeChecked();

    fireEvent.click(linked); // desvincula 12
    fireEvent.click(screen.getByRole('checkbox', { name: /Endodoncia/ })); // asocia 13
    fireEvent.click(screen.getByRole('button', { name: 'Guardar pieza' }));

    await waitFor(() => {
      const put = calls.find((call) => call.method === 'PUT');
      expect(put?.url).toContain('/api/patients/1/odontogram/16');
      expect(put?.body).toMatchObject({ treatmentIds: [13] });
    });

    // Desvincular no borra el tratamiento clínico: no se emite ningún DELETE.
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    expect(await screen.findByText('Pieza 16 guardada.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Endodoncia/ })).toBeChecked();
  });

  it('refresca los tratamientos tras cambiar los vínculos desde el odontograma', async () => {
    const calls = spyOnFetch((url, init) => {
      if (url.includes('/clinical/treatments')) {
        return response(200, [treatment({ id: 12, description: 'Obturación de composite' })]);
      }
      if (url.endsWith('/api/patients/1/odontogram/16') && init?.method === 'PUT') {
        return response(200, fullRecord({ treatmentIds: [12] }));
      }
      if (url.includes('/api/patients/1/odontogram')) {
        return response(200, [fullRecord({ treatmentIds: [] })]);
      }
      return undefined;
    });
    renderSection(false, 1, true);

    fireEvent.click(await screen.findByRole('button', { name: /Pieza 16 Superior derecho/ }));
    fireEvent.click(screen.getByText('Tratamientos relacionados', { selector: 'summary' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Obturación de composite/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar pieza' }));

    expect(await screen.findByText('Pieza 16 guardada.')).toBeInTheDocument();

    await waitFor(() => {
      const treatmentGets = calls.filter(
        (call) => call.method === 'GET' && call.url.includes('/clinical/treatments'),
      );
      expect(treatmentGets.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('conserva los vínculos existentes al editar solo condición u observaciones', async () => {
    const calls = spyOnFetch((url, init) => {
      if (url.includes('/clinical/treatments')) {
        return response(200, [
          treatment({ id: 12, description: 'Obturación de composite' }),
          treatment({ id: 13, description: 'Endodoncia', status: 'IN_PROGRESS' }),
        ]);
      }
      if (url.endsWith('/api/patients/1/odontogram/16') && init?.method === 'PUT') {
        return response(200, fullRecord({ condition: 'SEALED', notes: 'Sellador', treatmentIds: [12, 13] }));
      }
      if (url.includes('/api/patients/1/odontogram')) {
        return response(200, [fullRecord({ treatmentIds: [12, 13] })]);
      }
      return undefined;
    });
    renderSection(false, 1, true);

    fireEvent.click(await screen.findByRole('button', { name: /Pieza 16 Superior derecho/ }));
    expect(await screen.findByRole('checkbox', { name: /Obturación de composite/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Endodoncia/ })).toBeChecked();

    fireEvent.change(screen.getByLabelText('Condición de la pieza'), { target: { value: 'SEALED' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar pieza' }));

    await waitFor(() => {
      const put = calls.find((call) => call.method === 'PUT');
      expect(put?.body).toMatchObject({ condition: 'SEALED', treatmentIds: [12, 13] });
    });
  });

  it('muestra un estado vacío claro cuando el paciente no tiene tratamientos', async () => {
    stub((url) => {
      if (url.includes('/clinical/treatments')) return response(200, []);
      if (url.includes('/api/patients/1/odontogram')) {
        return response(200, [fullRecord({ treatmentIds: [] })]);
      }
      return undefined;
    });
    renderSection(false, 1, true);

    fireEvent.click(await screen.findByRole('button', { name: /Pieza 16 Superior derecho/ }));

    expect(await screen.findByText(/todavía no tiene tratamientos registrados/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('maneja el error de carga y bloquea el guardado hasta reintentar', async () => {
    let treatmentCalls = 0;
    stub((url) => {
      if (url.includes('/clinical/treatments')) {
        treatmentCalls += 1;
        return treatmentCalls === 1 ? response(500, { message: 'boom' }) : response(200, []);
      }
      if (url.includes('/api/patients/1/odontogram')) {
        return response(200, [fullRecord({ treatmentIds: [] })]);
      }
      return undefined;
    });
    renderSection(false, 1, true);

    fireEvent.click(await screen.findByRole('button', { name: /Pieza 16 Superior derecho/ }));

    expect(await screen.findByText('No se pudieron cargar los tratamientos.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Condición de la pieza'), { target: { value: 'SEALED' } });
    expect(screen.getByRole('button', { name: 'Guardar pieza' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar tratamientos' }));

    expect(await screen.findByText(/todavía no tiene tratamientos registrados/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar pieza' })).toBeEnabled();
  });

  it('no ofrece tratamientos ni controles clínicos fuera de OWNER/DENTIST', async () => {
    const calls = spyOnFetch((url) => {
      if (url.includes('/api/patients/1/odontogram')) {
        return response(200, [fullRecord({})]);
      }
      return undefined;
    });
    renderSection(); // staff en solo lectura

    fireEvent.click(await screen.findByRole('button', { name: /Pieza 16 Superior derecho/ }));

    expect(await screen.findByText('Historial')).toBeInTheDocument();
    expect(screen.queryByText('Tratamientos relacionados')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(calls.some((call) => call.url.includes('/clinical/treatments'))).toBe(false);
  });

  it('el resumen del paciente no carga tratamientos ni muestra la sección', async () => {
    const calls = spyOnFetch((url) => {
      if (url.endsWith('/api/patients/1/odontogram')) {
        return response(200, [{ toothFdi: 16, dentition: 'PERMANENT', condition: 'CARIES' }]);
      }
      if (url.includes('/surfaces')) return response(200, []);
      return undefined;
    });
    renderSection(true);

    fireEvent.click(await screen.findByRole('button', { name: /Pieza 16 Superior derecho/ }));

    expect(await screen.findByRole('heading', { name: 'Pieza 16' })).toBeInTheDocument();
    expect(screen.queryByText('Tratamientos relacionados')).not.toBeInTheDocument();
    expect(calls.some((call) => call.url.includes('/clinical/treatments'))).toBe(false);
  });
});

describe('Odontograma — corrección FDI desde la perspectiva frontal del profesional', () => {
  function tooth(fdi: number, dentition: 'PERMANENT' | 'TEMPORARY'): ToothRecordDto {
    return fullRecord({ id: fdi, toothFdi: fdi, dentition, condition: 'CARIES', notes: `Nota ${fdi}`, treatmentIds: [], surfaces: [] });
  }

  it('la mandíbula coloca el cuadrante derecho (4) a la izquierda del espectador y el izquierdo (3) a la derecha', async () => {
    stub((url) => {
      if (url.includes('/api/patients/1/odontogram')) {
        return response(200, [tooth(48, 'PERMANENT'), tooth(31, 'PERMANENT')]);
      }
      return undefined;
    });
    renderSection();

    await screen.findByRole('button', { name: /Pieza 48 Inferior derecho/ });
    const right = screen.getByRole('button', { name: /Pieza 48 Inferior derecho/ });
    const left = screen.getByRole('button', { name: /Pieza 31 Inferior izquierdo/ });
    expect(parseFloat(right.style.left)).toBeLessThan(parseFloat(left.style.left));
  });

  it('la maxila mantiene el cuadrante derecho (1) a la izquierda del espectador y el izquierdo (2) a la derecha', async () => {
    stub((url) => {
      if (url.includes('/api/patients/1/odontogram')) {
        return response(200, [tooth(18, 'PERMANENT'), tooth(21, 'PERMANENT')]);
      }
      return undefined;
    });
    renderSection();

    await screen.findByRole('button', { name: /Pieza 18 Superior derecho/ });
    const right = screen.getByRole('button', { name: /Pieza 18 Superior derecho/ });
    const left = screen.getByRole('button', { name: /Pieza 21 Superior izquierdo/ });
    expect(parseFloat(right.style.left)).toBeLessThan(parseFloat(left.style.left));
  });

  it.each([
    [48, 'Inferior derecho', 'Permanente'],
    [31, 'Inferior izquierdo', 'Permanente'],
    [85, 'Inferior derecho', 'Temporal'],
    [71, 'Inferior izquierdo', 'Temporal'],
  ] as const)(
    'la pieza %s se ubica como %s (%s) y su detalle lo confirma',
    async (fdi, label, dentitionLabel) => {
      stub((url) => {
        if (url.includes('/api/patients/1/odontogram')) {
          return response(200, [tooth(fdi, dentitionLabel === 'Temporal' ? 'TEMPORARY' : 'PERMANENT')]);
        }
        return undefined;
      });
      renderSection();
      if (dentitionLabel === 'Temporal') fireEvent.click(await screen.findByRole('button', { name: 'Temporal' }));

      fireEvent.click(await screen.findByRole('button', { name: new RegExp(`Pieza ${fdi} ${label}`) }));
      expect(await screen.findByRole('heading', { name: `Pieza ${fdi}` })).toBeInTheDocument();
      expect(screen.getByText(`${label} · ${dentitionLabel}`)).toBeInTheDocument();
    },
  );

  it('registra una pieza inferior derecha permanente y envía el FDI 48 como toothFdi', async () => {
    const calls = spyOnFetch((url, init) => {
      if (url.includes('/api/patients/1/odontogram') && init?.method === 'POST') {
        return response(201, fullRecord({ id: 9, toothFdi: 48, condition: 'HEALTHY', notes: '', treatmentIds: [], surfaces: [] }));
      }
      if (url.includes('/api/patients/1/odontogram')) return response(200, []);
      return undefined;
    });
    renderSection(false, 1, true);

    fireEvent.click(await screen.findByRole('button', { name: /Pieza 48 Inferior derecho.*sin registro/ }));
    expect(await screen.findByRole('heading', { name: 'Pieza 48' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Condición de la pieza'), { target: { value: 'HEALTHY' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar pieza' }));

    await waitFor(() => {
      const post = calls.find((call) => call.method === 'POST');
      expect(post?.url).toContain('/api/patients/1/odontogram');
      expect(post?.body).toMatchObject({ toothFdi: 48, condition: 'HEALTHY' });
    });
  });

  it('registra una pieza inferior izquierda temporal y envía el FDI 71 como toothFdi', async () => {
    const calls = spyOnFetch((url, init) => {
      if (url.includes('/api/patients/1/odontogram') && init?.method === 'POST') {
        return response(201, fullRecord({ id: 10, toothFdi: 71, dentition: 'TEMPORARY', condition: 'HEALTHY', notes: '', treatmentIds: [], surfaces: [] }));
      }
      if (url.includes('/api/patients/1/odontogram')) return response(200, []);
      return undefined;
    });
    renderSection(false, 1, true);

    fireEvent.click(await screen.findByRole('button', { name: 'Temporal' }));
    fireEvent.click(await screen.findByRole('button', { name: /Pieza 71 Inferior izquierdo.*sin registro/ }));
    expect(await screen.findByRole('heading', { name: 'Pieza 71' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Condición de la pieza'), { target: { value: 'HEALTHY' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar pieza' }));

    await waitFor(() => {
      const post = calls.find((call) => call.method === 'POST');
      expect(post?.body).toMatchObject({ toothFdi: 71, condition: 'HEALTHY' });
    });
  });

  it('la vista de lista enumera la mandíbula con el cuadrante derecho antes que el izquierdo', async () => {
    stub((url) => {
      if (url.includes('/api/patients/1/odontogram')) {
        return response(200, [tooth(48, 'PERMANENT'), tooth(31, 'PERMANENT')]);
      }
      return undefined;
    });
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Lista' }));
    const table = screen.getByRole('table');
    const text = table.textContent ?? '';
    expect(text.indexOf('48 · Inferior derecho')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('31 · Inferior izquierdo')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('48 · Inferior derecho')).toBeLessThan(text.indexOf('31 · Inferior izquierdo'));
  });
});
