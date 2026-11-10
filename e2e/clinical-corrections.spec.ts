import { expect, test } from '@playwright/test';

const ROOT = { id: 1, content: 'Nota original del paciente', authorDentistId: 3, authorName: 'Olivia Profesional', createdAt: '2026-10-13T16:00:00Z' };
const CORRECTION = {
  id: 2,
  content: 'Nota corregida del paciente',
  authorDentistId: 4,
  authorName: 'Carlos Dentista',
  createdAt: '2026-10-13T17:00:00Z',
  correctsRecordId: 1,
  correctionReason: 'Se transcribió mal el diagnóstico.',
};

/**
 * Fase 1B.2 — corrección clínica append-only. El backend no se levanta: se intercepta `/api/**`
 * para comprobar el flujo real del SPA (corregir conserva el original y muestra la versión previa).
 */
for (const role of ['DENTIST', 'OWNER'] as const) {
  test(`Fase 1B.2 ${role} corrige una nota y ve la versión anterior`, async ({ page }) => {
    const writes: Array<{ path: string; body: unknown }> = [];
    let notes: unknown[] = [ROOT];
    await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const method = request.method();
      let body: unknown;
      if (path === '/api/auth/refresh') body = { accessToken: 'clinical-corrections-test' };
      else if (path === '/api/auth/me') body = { id: 10, role, dentistId: 3, email: 'actor@dc.test', active: true, createdAt: '2026-01-01T00:00:00Z' };
      else if (path === '/api/onboarding/status') body = { status: 'COMPLETED', clinicConfigured: true };
      else if (path === '/api/notifications/unread-count') body = { unread: 0 };
      else if (path === '/api/patients/1') body = { id: 1, firstName: 'Ana', lastName: 'Pérez', active: true };
      else if (path === '/api/patients/1/clinical') body = { patientId: 1, medicalBackground: null, allergies: null };
      else if (path === '/api/patients/1/odontogram') body = [];
      else if (path === '/api/patients/1/clinical/treatments') body = [];
      else if (path === '/api/patients/1/clinical/notes/1/corrections') {
        const input = request.postDataJSON() as { content: string; correctionReason: string };
        writes.push({ path, body: input });
        notes = [ROOT, { ...CORRECTION, content: input.content, correctionReason: input.correctionReason }];
        body = notes[1];
      } else if (path === '/api/patients/1/clinical/notes') {
        body = notes;
      } else {
        await route.fulfill({ status: 404, json: {} });
        return;
      }
      await route.fulfill({ status: method === 'POST' ? 201 : 200, json: body });
    });

    await page.goto('/patients/1');
    await expect(page.getByText('Nota original del paciente', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Corregir', exact: true }).click();
    const contentField = page.getByLabel('Contenido corregido');
    await expect(contentField).toHaveValue('Nota original del paciente');
    await contentField.fill('Nota corregida del paciente');
    const save = page.getByRole('button', { name: 'Guardar corrección' });
    await expect(save).toBeDisabled();
    await page.getByLabel('Motivo de la corrección').fill('Se transcribió mal el diagnóstico.');
    await save.click();

    await expect(page.getByText('Nota corregida del paciente', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Corregida · ver versiones anteriores (1)')).toBeVisible();
    await page.getByText('Corregida · ver versiones anteriores (1)').click();
    await expect(page.getByText('Nota original del paciente', { exact: true })).toBeVisible();
    await expect(page.getByText('Motivo: Se transcribió mal el diagnóstico.')).toBeVisible();
    expect(writes).toEqual([{
      path: '/api/patients/1/clinical/notes/1/corrections',
      body: { content: 'Nota corregida del paciente', correctionReason: 'Se transcribió mal el diagnóstico.' },
    }]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`clinical-correction-${role}.png`), fullPage: true });
  });
}
