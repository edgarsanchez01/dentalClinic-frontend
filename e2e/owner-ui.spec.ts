import { expect, test, type Page } from '@playwright/test';
import { ownerUiFixture } from './ownerUiFixture';

async function ready(page: Page) {
  await expect(page.locator('h1')).toHaveCount(1);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}
async function capture(page: Page, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
}

for (const width of [320, 390, 768, 1280, 1440]) {
  test(`OWNER identidad, jerarquía y Día/Semana/Mes ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await ownerUiFixture(page);
    await page.goto('/'); await ready(page);
    await expect(page.locator('h1')).toHaveCSS('color', 'rgb(25, 63, 67)');
    await expect(page.getByRole('region', { name: 'Citas de hoy' })).toHaveCSS('border-radius', '12px');
    await expect(page.getByRole('region', { name: 'Siguiente paciente' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Resumen financiero' })).toContainText('$1,700.00 MXN');
    await expect(page.getByRole('region', { name: 'Notificaciones personales' })).toContainText('Aviso de prueba');
    await capture(page, `owner-home-${width}`);
    for (const view of ['day', 'week', 'month']) {
      await page.goto(`/appointments?date=2026-10-26&view=${view}`); await ready(page);
      await expect(page.locator('h1')).toHaveCSS('color', 'rgb(25, 63, 67)');
      const create = page.getByRole('button', { name: 'Crear cita', exact: true });
      await create.focus(); await expect(create).toHaveCSS('outline-width', '2px');
      expect((await create.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expect(page.getByRole('button', { name: view === 'day' ? 'Día' : view === 'week' ? 'Semana' : 'Mes', exact: true })).toHaveAttribute('aria-pressed', 'true');
      if (view === 'week') {
        await expect(page.getByRole('region', { name: 'Agenda semanal' })).toContainText('Vista previa: 4 de 5 citas.');
        await page.getByRole('button', { name: /^Ver agenda completa/ }).click();
        await expect(page.getByRole('region', { name: 'Agenda del día', exact: true })).toContainText('Paciente Del equipo 4');
        await page.getByRole('button', { name: 'Semana', exact: true }).click();
      }
      if (view === 'month') {
        await expect(page.getByRole('region', { name: 'Agenda mensual' })).toBeVisible();
        await expect(page.getByRole('button', { name: /Ver 5 citas del/ })).toBeVisible();
      }
      if (width < 768 && view === 'day') {
        await expect(page.getByRole('region', { name: 'Agenda del día' })).toBeVisible();
      }
      await capture(page, `owner-${view}-${width}`);
    }
    if (width < 768) {
      await page.getByRole('button', { name: 'Abrir menú de navegación' }).click();
      const menu = page.getByRole('dialog', { name: 'Menú de navegación' });
      await expect(menu.getByRole('link', { name: 'Equipo', exact: true })).toBeVisible();
      await page.keyboard.press('Escape'); await expect(menu).not.toBeVisible();
      await expect(page.getByRole('button', { name: 'Abrir menú de navegación' })).toBeFocused();
    }
  });
}

for (const personal of [false, true]) {
  test(`OWNER reserva existente ${personal ? 'personal' : 'clínica'} conserva payload e idempotencia`, async ({ page }) => {
    const calls = await ownerUiFixture(page);
    await page.goto(`/appointments?create=1&patientId=4&date=2026-10-26${personal ? '&scope=mine' : ''}`);
    await page.getByLabel('Servicio', { exact: true }).selectOption('1');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    if (personal) await expect(page.getByRole('combobox', { name: 'Dentista', exact: true })).toBeDisabled();
    else await page.getByRole('combobox', { name: 'Dentista', exact: true }).selectOption('8');
    await page.getByRole('button', { name: '11:00–12:00', exact: true }).click();
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    const post = page.waitForRequest(r => r.url().includes('/api/appointments') && r.method() === 'POST');
    await page.getByRole('button', { name: 'Reservar cita', exact: true }).click();
    const request = await post;
    await expect(page.getByText('Cita creada correctamente.')).toBeVisible();
    expect(request.headers()['idempotency-key']).toBeTruthy();
    expect(calls.filter(c => c.path === '/api/appointments' && c.method === 'POST')).toHaveLength(1);
    expect(request.postDataJSON()).toMatchObject({ patientId: 4, dentistId: personal ? 7 : 8, serviceId: 1, startAt: '2026-10-26T11:00:00Z', endAt: '2026-10-26T12:00:00Z' });
  });
}

test('OWNER filtros, acceso mensual al resto y contexto de retorno', async ({ page }) => {
  const calls = await ownerUiFixture(page); await page.goto('/appointments?date=2026-10-26&view=month'); await ready(page);
  await page.getByRole('button', { name: /Ver 5 citas del/ }).click();
  await expect(page.getByRole('button', { name: 'Mes', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Citas del día seleccionado' }).getByRole('button', { name: /^Abrir cita de/ })).toHaveCount(5);
  await page.getByRole('button', { name: /^Ver agenda completa/ }).click();
  await expect(page.getByRole('button', { name: 'Día', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Filtrar por dentista').selectOption('7');
  await page.getByLabel('Filtrar por estado').selectOption('SCHEDULED'); await ready(page);
  await expect.poll(() => calls.some(c => c.path === '/api/appointments' && c.params.get('dentistId') === '7' && c.params.get('status') === 'SCHEDULED')).toBe(true);
  await page.getByRole('button', { name: /^Abrir cita de Paciente Propio a las 09:00 Programada/ }).click();
  expect(new URL(page.url()).searchParams.get('returnTo')).toContain('dentistId=7');
  expect(new URL(page.url()).searchParams.get('returnTo')).toContain('status=SCHEDULED');
});

for (const state of ['empty', 'error']) {
  test(`OWNER agenda ${state} no confunde error, vacío y disponibilidad`, async ({ page }) => {
    await ownerUiFixture(page, 'OWNER', state); await page.goto('/appointments?view=week&date=2026-10-26'); await ready(page);
    if (state === 'empty') {
      await expect(page.getByRole('heading', { name: 'Una semana por organizar' })).toBeVisible();
      await expect(page.getByText('Un día sin citas no implica disponibilidad.', { exact: false })).toBeVisible();
    } else {
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Una semana por organizar' })).toHaveCount(0);
    }
    await capture(page, `owner-${state}`);
  });
}

// Opt-in comparison against the byte-preserved tree from before this task.
if (process.env.DC_OWNER_UI_BASELINE) {
  for (const role of ['PATIENT', 'RECEPTIONIST', 'DENTIST', 'OWNER']) {
    for (const width of [390, 1440]) {
      test(`comparativa antes/después ${role} ${width}`, async ({ page, browser }) => {
        await page.setViewportSize({ width, height: 900 }); await ownerUiFixture(page, role);
        const before = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
        await ownerUiFixture(before, role);
        try {
          const paths = role === 'OWNER' ? ['/', '/appointments?view=day&date=2026-10-26', '/appointments?view=week&date=2026-10-26', '/appointments?view=month&date=2026-10-26', '/services', '/scheduling', '/users', '/clinic', '/finances']
            : ['/', '/appointments?view=day&date=2026-10-26', '/appointments?view=week&date=2026-10-26', '/appointments?view=month&date=2026-10-26'];
          for (const [i, path] of paths.entries()) {
            await before.goto(`http://127.0.0.1:5295${path}`); await ready(before);
            await page.goto(path); await ready(page);
            const targetBefore = role === 'OWNER' && i > 3 ? before.getByRole('main') : before.locator('body');
            const targetAfter = role === 'OWNER' && i > 3 ? page.getByRole('main') : page.locator('body');
            if (role === 'OWNER' && i > 3) {
              // The authorized chrome has a taller rail and a different topbar.
              // Compare module content without flex stretch or fractional crop offsets.
              for (const target of [targetBefore, targetAfter]) await target.evaluate(element => {
                const el = element as HTMLElement;
                el.style.alignSelf = 'flex-start';
                const top = el.getBoundingClientRect().top;
                el.style.transform = `translateY(${Math.round(top) - top}px)`;
              });
            }
            const a = await targetBefore.screenshot({ path: test.info().outputPath(`before-${i}.png`) });
            const b = await targetAfter.screenshot({ path: test.info().outputPath(`after-${i}.png`) });
            if (role === 'OWNER' && i > 3) {
              // Inherited styles AND module dimensions must remain identical.
              // Pixel crops can differ at text edges when the authorized topbar
              // moves the module through a fractional physical pixel.
              const presentation = (element: Element) => [element, ...element.querySelectorAll('*')].map(el => {
                const css = getComputedStyle(el);
                return [el.tagName, el.textContent, ...['color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'width', 'height', 'display', 'padding', 'margin', 'border', 'borderRadius', 'boxShadow', 'gap', 'gridTemplateColumns'].map(p => css[p as keyof CSSStyleDeclaration])];
              });
              expect(await targetAfter.evaluate(presentation), `${path} module styles/dimensions`).toEqual(await targetBefore.evaluate(presentation));
            } else {
              // Against the pre-HOME baseline, only OWNER / Inicio changes.
              // Citas and other roles must retain strict pixel equality.
              expect(a.equals(b), `${role} ${path}`).toBe(role !== 'OWNER' || i > 0);
            }
          }
        } finally { await before.close(); }
      });
    }
  }
}
