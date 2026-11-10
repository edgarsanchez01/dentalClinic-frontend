import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { checkoutAppointment } from '../../test/checkoutFixtures';
import { reflectCompletionInAgenda } from './agendaCache';

describe('agenda tras finalización clínica verificada', () => {
  it.each(['day', 'week', 'month'])('%s actualiza sin duplicar y excluye del filtro Programada', view => {
    const client = new QueryClient();
    const all = ['appointments', { view }];
    const scheduled = ['appointments', { view, status: 'SCHEDULED' }];
    const completed = ['appointments', { view, status: 'COMPLETED' }];
    const page = { content: [checkoutAppointment], page: 0, size: 100, totalPages: 1, totalElements: 1 };
    client.setQueryData(all, page); client.setQueryData(scheduled, page);
    client.setQueryData(completed, { ...page, content: [], totalElements: 0 });
    const completedAppointment = { ...checkoutAppointment, status: 'COMPLETED' as const, completedAt: '2026-10-22T17:00:00Z' };
    reflectCompletionInAgenda(client, completedAppointment);
    reflectCompletionInAgenda(client, completedAppointment);
    expect(client.getQueryData(all)).toMatchObject({ content: [{ status: 'COMPLETED' }], totalElements: 1 });
    expect(client.getQueryData(scheduled)).toMatchObject({ content: [], totalElements: 0 });
    expect(client.getQueryData(completed)).toMatchObject({ content: [], totalElements: 0 });
    expect(client.getQueryState(all)?.isInvalidated).toBe(true);
    client.clear();
  });
});
