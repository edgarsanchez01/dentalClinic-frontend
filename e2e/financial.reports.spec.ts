import { expect, test, type Page } from '@playwright/test';

async function backend(page: Page, role: string) {
  const reads: string[] = [];
  const portfolio = { asOf: '2026-10-15T12:00:00Z', confirmedCharges: 4, billedAmount: 300, appliedAmount: 140,
    pendingBalance: 160, statusCounts: { pendiente: 1, parcial: 1, pagado: 1, anulado: 1 } };
  const cashFlow = { from: null, to: null, grossAmount: 5, reversalAmount: 10, netAmount: -5,
    methods: [
      { method: 'CASH', grossAmount: 5, reversalAmount: 10, netAmount: -5 },
      { method: 'CARD', grossAmount: 0, reversalAmount: 0, netAmount: 0 },
      { method: 'TRANSFER', grossAmount: 0, reversalAmount: 0, netAmount: 0 },
      { method: 'OTHER', grossAmount: 0, reversalAmount: 0, netAmount: 0 },
    ] };
  const charges = { patientId: null, status: null, from: null, to: null, confirmedCharges: 2, billedAmount: 150,
    appliedAmount: 30, pendingBalance: 120,
    byPatient: [{ patientId: 10, chargeCount: 1, billedAmount: 100, appliedAmount: 30, pendingBalance: 70 }] };
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown;
    if (path === '/api/auth/refresh') body = { accessToken: 'financial-reports-token' };
    else if (path === '/api/auth/me') body = { id: 1, email: 'staff@clinic.com', role, active: true, patientId: null, createdAt: '2026-01-01T00:00:00Z' };
    else if (path === '/api/onboarding/status') body = { status: 'COMPLETED', clinicConfigured: true };
    else if (path === '/api/notifications/unread-count') body = { unread: 0 };
    else if (path === '/api/patients') body = { content: [{ id: 10, firstName: 'Ada', lastName: 'Prueba', active: true, createdAt: '2026-01-01T00:00:00Z' }],
      page: 0, size: 10, totalElements: 1, totalPages: 1 };
    else if (path === '/api/financial/reports/portfolio') { reads.push(path); body = portfolio; }
    else if (path === '/api/financial/reports/cash-flow') { reads.push(path + url.search); body = cashFlow; }
    else if (path === '/api/financial/reports/charges') { reads.push(path + url.search); body = charges; }
    else { await route.fulfill({ status: 404, json: {} }); return; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return { reads };
}

test('F4C OWNER consulta los tres reportes financieros', async ({ page }) => {
  const api = await backend(page, 'OWNER');
  await page.goto('/finances/reports');
  await expect(page.getByRole('heading', { name: 'Reportes financieros' })).toBeVisible();
  await expect(page.getByText('$300.00 MXN', { exact: true })).toBeVisible();
  await expect(page.getByText('$160.00 MXN', { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('reports-portfolio.png'), fullPage: true });

  await page.getByRole('tab', { name: 'Cobros por período' }).click();
  await expect(page.getByText('Cobro neto', { exact: true })).toBeVisible();
  await expect(page.getByText('-$5.00 MXN', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('reports-cashflow.png'), fullPage: true });

  await page.getByRole('tab', { name: 'Cargos y saldos' }).click();
  await expect(page.getByText('Paciente #10')).toBeVisible();
  await expect(page.getByText('$120.00 MXN', { exact: true }).first()).toBeVisible();

  expect(api.reads).toEqual(['/api/financial/reports/portfolio', '/api/financial/reports/cash-flow', '/api/financial/reports/charges']);
});

for (const role of ['DENTIST', 'PATIENT']) {
  test(`F4C ${role} no accede a los reportes financieros`, async ({ page }) => {
    const api = await backend(page, role);
    await page.goto('/finances/reports');
    await expect(page.getByRole('heading', { name: 'Sin acceso' })).toBeVisible();
    expect(api.reads).toEqual([]);
  });
}
