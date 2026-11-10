import { expect, test, type Locator, type Page } from '@playwright/test';

// Validación integrada 1B.3 (previa a E5): ejercita la SPA E3 contra el backend E2 real
// y PostgreSQL 16 con V001–V015, sin intercepción de red. El backend lo arranca
// OdontogramHistoryBrowserIT (Testcontainers efímero) y define las variables de entorno.

test.skip(
  !process.env.DENTALCLINIC_REAL_API_URL,
  'Solo se ejecuta con el backend efímero de OdontogramHistoryBrowserIT.',
);

async function loginAs(page: Page, email: string): Promise<void> {
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(process.env.DENTALCLINIC_TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

async function x(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  expect(box, 'la pieza debe estar visible para medir su posición').not.toBeNull();
  return box!.x;
}

test('1B.3 real · FDI, escrituras y reconstrucción histórica (DENTIST)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const patientId = process.env.DENTALCLINIC_PATIENT_ID!;
  const writes: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if ((request.method() === 'POST' || request.method() === 'PUT') && path.includes('/odontogram')) {
      writes.push({ method: request.method(), path, body: request.postData() ? request.postDataJSON() : null });
    }
  });

  await page.goto(`/patients/${patientId}`);
  await loginAs(page, process.env.DENTALCLINIC_DENTIST_EMAIL!);
  const section = page.getByRole('region', { name: 'Odontograma', exact: true });
  await expect(section.getByRole('heading', { name: 'Odontograma', exact: true })).toBeVisible();

  // ---- FDI permanente: vista frontal del profesional (derecha del paciente a la izquierda) ----
  const upperRight = section.getByRole('group', { name: 'Superior derecho', exact: true });
  const upperLeft = section.getByRole('group', { name: 'Superior izquierdo', exact: true });
  const lowerRight = section.getByRole('group', { name: 'Inferior derecho', exact: true });
  const lowerLeft = section.getByRole('group', { name: 'Inferior izquierdo', exact: true });
  await expect(upperRight.getByRole('button', { name: /Pieza 18 Superior derecho Permanente/ })).toBeVisible();
  await expect(upperLeft.getByRole('button', { name: /Pieza 28 Superior izquierdo Permanente/ })).toBeVisible();
  await expect(lowerRight.getByRole('button', { name: /Pieza 48 Inferior derecho Permanente/ })).toBeVisible();
  await expect(lowerLeft.getByRole('button', { name: /Pieza 38 Inferior izquierdo Permanente/ })).toBeVisible();
  expect(await x(lowerRight)).toBeLessThan(await x(lowerLeft));
  expect(await x(upperRight)).toBeLessThan(await x(upperLeft));
  expect(await x(lowerRight.getByRole('button', { name: /Pieza 48 / })))
    .toBeLessThan(await x(lowerRight.getByRole('button', { name: /Pieza 41 / })));
  expect(await x(lowerLeft.getByRole('button', { name: /Pieza 31 / })))
    .toBeLessThan(await x(lowerLeft.getByRole('button', { name: /Pieza 38 / })));

  // ---- FDI temporal ----
  await section.getByRole('button', { name: 'Temporal', exact: true }).click();
  const tempLowerRight = section.getByRole('group', { name: 'Inferior derecho', exact: true });
  const tempLowerLeft = section.getByRole('group', { name: 'Inferior izquierdo', exact: true });
  await expect(tempLowerRight.getByRole('button', { name: /Pieza 85 Inferior derecho Temporal/ })).toBeVisible();
  await expect(tempLowerLeft.getByRole('button', { name: /Pieza 75 Inferior izquierdo Temporal/ })).toBeVisible();
  expect(await x(tempLowerRight)).toBeLessThan(await x(tempLowerLeft));
  expect(await x(tempLowerRight.getByRole('button', { name: /Pieza 85 / })))
    .toBeLessThan(await x(tempLowerRight.getByRole('button', { name: /Pieza 81 / })));
  await section.getByRole('button', { name: 'Permanente', exact: true }).click();

  // ---- Escritura real: pieza 48 (Inferior derecho) + superficie Oclusal ----
  await section.getByRole('button', { name: /Pieza 48 Inferior derecho Permanente: sin registro/ }).click();
  await expect(section.getByRole('heading', { name: 'Pieza 48', exact: true })).toBeVisible();
  await section.getByLabel('Condición de la pieza').selectOption('CARIES');
  await section.getByLabel('Observaciones (opcional)', { exact: true }).fill('Caries oclusal validada 1B.3');
  await section.getByRole('button', { name: 'Registrar pieza', exact: true }).click();
  await expect(section.getByText('Pieza 48 guardada.', { exact: true })).toBeVisible();
  await section.getByLabel('Condición de la superficie Oclusal').selectOption('RESTORED');
  await section.getByRole('button', { name: /Registrar Oclusal/ }).click();
  await expect(section.getByText('Superficie Oclusal guardada.', { exact: true })).toBeVisible();

  // ---- Escritura real: pieza 31 (Inferior izquierdo) ----
  await section.getByRole('button', { name: /Pieza 31 Inferior izquierdo Permanente: sin registro/ }).click();
  await expect(section.getByRole('heading', { name: 'Pieza 31', exact: true })).toBeVisible();
  await section.getByLabel('Condición de la pieza').selectOption('FRACTURED');
  await section.getByRole('button', { name: 'Registrar pieza', exact: true }).click();
  await expect(section.getByText('Pieza 31 guardada.', { exact: true })).toBeVisible();

  const toothCreates = writes.filter((write) => write.method === 'POST' && write.path.endsWith('/odontogram'));
  expect(toothCreates.map((write) => write.body?.toothFdi)).toEqual(expect.arrayContaining([48, 31]));

  // ---- Reconstrucción histórica por instante (futuro respecto al evento) ----
  await section.getByRole('button', { name: 'Consulta histórica', exact: true }).click();
  const futureInstant = new Date(Date.now() + 3_600_000).toISOString().slice(0, 16);
  await section.getByLabel('Fecha y hora (UTC)').fill(futureInstant);
  await section.getByRole('button', { name: 'Consultar estado histórico' }).click();
  const point = section.getByRole('region', { name: 'Estado histórico por instante' });
  await expect(point.getByRole('button', { name: /Pieza 48 .*condición Caries/ })).toBeVisible();
  await expect(point.getByRole('button', { name: /Pieza 31 .*condición Fractura/ })).toBeVisible();

  // ---- Contexto de cita/ocurrencia: los tres estados son consultas distintas ----
  await section.getByLabel('Consultar por').selectOption('attention');
  await section.getByLabel('Número de cita').fill(process.env.DENTALCLINIC_APPOINTMENT_ID!);
  await section.getByLabel('Ocurrencia dental a consultar').fill(process.env.DENTALCLINIC_OCCURRENCE_VERSION!);
  await section.getByRole('button', { name: 'Consultar estado histórico' }).click();
  await expect(section.getByRole('region', { name: 'Estado en la captura' })).toBeVisible();
  await expect(section.getByRole('region', { name: 'Cambios atribuidos a la atención' })).toBeVisible();
  const current = section.getByRole('region', { name: 'Estado actual del paciente' });
  await expect(current).toBeVisible();
  await expect(current.getByRole('button', { name: /Pieza 48 .*condición Caries/ })).toBeVisible();
  await expect(section.getByText(/Cita #\d+ · ocurrencia \d+ · actual:/)).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('odontogram-reconstruction.png'), fullPage: true });
});

for (const role of ['PATIENT', 'RECEPTIONIST'] as const) {
  test(`1B.3 real · ${role} no accede al historial dental`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const restricted: string[] = [];
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (/\/odontogram\/(history|at)/.test(path)) restricted.push(path);
    });

    if (role === 'PATIENT') {
      await page.goto(`/patients/${process.env.DENTALCLINIC_PATIENT_ID}`);
      await loginAs(page, process.env.DENTALCLINIC_PATIENT_EMAIL!);
      await expect(page.getByRole('heading', { name: 'Mis datos', exact: true })).toBeVisible();
    } else {
      await page.goto(`/appointments/${process.env.DENTALCLINIC_APPOINTMENT_ID}`);
      await loginAs(page, process.env.DENTALCLINIC_RECEPTIONIST_EMAIL!);
      await expect(
        page.getByRole('heading', { name: `Cita #${process.env.DENTALCLINIC_APPOINTMENT_ID}`, exact: true }),
      ).toBeVisible();
    }

    await expect(page.getByRole('button', { name: 'Consulta histórica', exact: true })).toHaveCount(0);
    expect(restricted).toEqual([]);
  });
}
