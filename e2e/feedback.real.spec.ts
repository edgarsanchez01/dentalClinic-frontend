import { expect, test } from '@playwright/test';

test.skip(!process.env.DENTALCLINIC_REAL_API_URL, 'Solo se ejecuta con el backend efímero de FeedbackBrowserIT.');

test('completar → correo falso → respuesta pública → reseñas privadas y permisos reales', async ({ browser }) => {
  const token = process.env.FEEDBACK_TEST_TOKEN!;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(`/feedback/${token}`);
  await expect(page.getByRole('radio', { name: '5 estrellas' })).toBeVisible();
  await page.screenshot({ path: '/tmp/opencode/feedback-form-mobile.png' });
  await page.getByRole('radio', { name: '5 estrellas' }).check();
  await page.getByLabel('Comentario (opcional)').fill('Atención clara y amable.');
  await page.getByRole('button', { name: 'Enviar reseña' }).click();
  await expect(page.getByText(/Tu reseña se guardó de forma privada/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.reload(); await expect(page.getByText(/ya fue respondida/)).toBeVisible();
  await context.close();

  for (const [identity, allowed, own] of [
    [process.env.FEEDBACK_TEST_OWNER!, true, true], [process.env.FEEDBACK_TEST_DENTIST!, true, true],
    [process.env.FEEDBACK_TEST_OTHER_DENTIST!, true, false], [process.env.FEEDBACK_TEST_RECEPTION!, false, false],
    [process.env.FEEDBACK_TEST_PATIENT!, false, false],
  ] as const) {
    const session = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const staff = await session.newPage();
    await staff.goto('/login');
    await staff.getByLabel('Correo electrónico').fill(identity);
    await staff.getByLabel('Contraseña', { exact: true }).fill(process.env.FEEDBACK_TEST_PASSWORD!);
    await staff.getByRole('button', { name: 'Entrar' }).click();
    await expect(staff.getByRole('heading', { name: identity })).toBeVisible();
    await staff.goto('/reviews');
    if (allowed) {
      await expect(staff.getByRole('heading', { name: 'Reseñas de pacientes' })).toBeVisible();
      await expect(staff.getByRole('link', { name: 'Reseñas', exact: true })).toBeVisible();
      await expect(staff.getByText(own ? 'Atención clara y amable.' : 'Aún no hay reseñas para mostrar.')).toBeVisible();
      expect(await staff.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await staff.screenshot({ path: `/tmp/opencode/feedback-${own ? 'own' : 'empty'}-desktop.png` });
    } else {
      await expect(staff.getByRole('heading', { name: 'Sin acceso' })).toBeVisible();
    }
    await session.close();
  }
});
