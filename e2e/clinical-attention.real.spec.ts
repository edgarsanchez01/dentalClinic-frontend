import { expect, test } from '@playwright/test';

test.skip(!process.env.DENTALCLINIC_REAL_API_URL, 'Solo se ejecuta con el backend efímero de ClinicalTraceBrowserIT.');

for (const [width, idKey, startKey, endKey] of [[1280, 'DENTALCLINIC_APPOINTMENT_A', 'DENTALCLINIC_START_A', 'DENTALCLINIC_END_A'],
  [320, 'DENTALCLINIC_APPOINTMENT_B', 'DENTALCLINIC_START_B', 'DENTALCLINIC_END_B']] as const) {
  test(`1B.1 HTTP real · ${width}px · notas, evolución y conflicto sin cierre prematuro`, async ({ page }) => {
    const id = process.env[idKey]!;
    await page.setViewportSize({ width, height: 900 });
    const writes: Array<{ path: string; body: unknown }> = [];
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() === 'POST' && (path.includes('/clinical') || path.endsWith('/complete'))) {
        writes.push({ path, body: request.postData() ? request.postDataJSON() : null });
      }
    });
    await page.goto(`/appointments/${id}`);
    await page.getByLabel('Correo electrónico').fill(process.env.DENTALCLINIC_DENTIST_EMAIL!);
    await page.getByLabel('Contraseña', { exact: true }).fill(process.env.DENTALCLINIC_TEST_PASSWORD!);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.getByRole('tab', { name: 'Atención clínica', exact: true }).click();
    await expect(page.getByText('Notas vinculadas a esta atención: 0.')).toBeVisible();
    await page.getByLabel('Nueva nota clínica').fill(`Nota contextual ${width}`);
    // También ejerce conservación del borrador con teclado/paneles.
    await page.getByRole('tab', { name: 'Resumen', exact: true }).press('Enter');
    await page.getByRole('tab', { name: 'Atención clínica', exact: true }).press('Enter');
    await expect(page.getByLabel('Nueva nota clínica')).toHaveValue(`Nota contextual ${width}`);
    await page.getByRole('button', { name: 'Añadir nota', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Notas de esta atención' }).getByText(`Nota contextual ${width}`, { exact: true })).toBeVisible();
    expect(writes[0]?.body).toEqual({ content: `Nota contextual ${width}`, appointmentContext: { appointmentId: Number(id), occurrenceVersion: 1 } });

    await page.getByLabel('Guardar como registro general, sin cita').check();
    await page.getByLabel('Nueva nota clínica').fill(`Nota general ${width}`);
    await page.getByRole('button', { name: 'Añadir nota', exact: true }).click();
    await expect(page.getByLabel('Nueva nota clínica')).toHaveValue('');
    await page.getByRole('tab', { name: 'Historial', exact: true }).click();
    await expect(page.getByText(`Nota general ${width}`, { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Atención clínica', exact: true }).click();
    await expect(page.getByText(`Nota general ${width}`, { exact: true })).not.toBeVisible();

    await page.getByRole('tab', { name: 'Tratamientos', exact: true }).click();
    await page.getByRole('button', { name: 'Evolución', exact: true }).click();
    await page.getByLabel('Nueva nota de evolución').fill(`Se realizó instrumentación ${width}`);
    await page.getByRole('button', { name: 'Registrar nota', exact: true }).click();
    await expect(page.getByLabel('Nueva nota de evolución')).toHaveValue('');
    await page.getByRole('tab', { name: 'Atención clínica', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Evoluciones de esta atención' }).getByText(`Se realizó instrumentación ${width}`, { exact: true })).toBeVisible();

    await page.getByLabel('Nueva nota clínica').fill(`Borrador anterior ${width}`);
    // Operación real de otro usuario; no interception/stubbing de citas ni clínica.
    const moved = await page.request.post(`/api/appointments/${id}/reschedule`, {
      headers: { Authorization: `Bearer ${process.env.DENTALCLINIC_OWNER_TOKEN}` },
      data: { startAt: process.env[startKey], endAt: process.env[endKey], expectedOccurrenceVersion: 1 },
    });
    expect(moved.status()).toBe(200);
    await page.getByRole('button', { name: 'Añadir nota', exact: true }).click();
    await expect(page.getByText(/La cita fue reprogramada mientras escribías/)).toBeVisible();
    await expect(page.getByLabel('Nueva nota clínica')).toHaveValue(`Borrador anterior ${width}`);
    await expect(page.getByRole('region', { name: 'Formulario de nota clínica' }).getByText(/Se guardará en: esta cita/)).toBeVisible();
    await page.getByRole('region', { name: 'Formulario de nota clínica' }).getByRole('button', { name: 'Vincular a la programación actual' }).click();
    await page.getByRole('button', { name: 'Añadir nota', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Notas de esta atención' }).getByText(`Borrador anterior ${width}`, { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Evoluciones de esta atención' }).getByText(`Se realizó instrumentación ${width}`, { exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Tratamientos', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`attention-${width}.png`), fullPage: true });

    await expect(page.getByRole('button', { name: /Completar cita|Confirmar y completar cita|Registrar pago/ })).toHaveCount(0);
    expect(writes.some(item => item.path.endsWith('/complete') || item.path.endsWith('/checkout'))).toBe(false);
    await expect(page.getByRole('button', { name: 'Registrar llegada' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Iniciar consulta' })).toHaveCount(0);
  });
}
