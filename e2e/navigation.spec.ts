import { expect, test, type Page } from '@playwright/test';

async function openHome(page: Page) {
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/api/auth/refresh' ? { accessToken: 'navigation-test' }
      : path === '/api/auth/me' ? {
        id: 1, email: 'owner@clinic.com', role: 'OWNER', active: true,
        createdAt: '2026-01-01T00:00:00Z', dentistId: 7,
      } : path === '/api/onboarding/status' ? { status: 'COMPLETED', clinicConfigured: true }
      : path === '/api/notifications/unread-count' ? { unread: 0 }
      : path === '/api/patients' ? { content: [], totalElements: 0, totalPages: 0, size: 20, number: 0 } : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/actuator/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'UP' }),
  }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Resumen de la clínica' })).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test.describe('H-A09 — navegación real en Chromium', () => {
  for (const width of [320, 390, 767, 768, 1280]) {
    test(`visibilidad y geometría a ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await openHome(page);
      const desktop = page.getByRole('navigation', { name: 'Navegación de escritorio' });
      const trigger = page.getByRole('button', { name: 'Abrir menú de navegación', exact: true });
      await expectNoHorizontalOverflow(page);
      if (width < 768) {
        await expect(desktop).toBeHidden();
        await expect(trigger).toBeVisible();
        await trigger.click();
        const dialog = page.getByRole('dialog', { name: 'Menú de navegación', exact: true });
        await expect(dialog).toBeVisible();
        const nav = dialog.getByRole('navigation', { name: 'Navegación móvil' });
        await expect(nav.getByRole('link')).toHaveCount(13);
        await expect(nav.getByRole('link', { name: 'Atenciones por cobrar', exact: true })).toHaveAttribute('href', '/collections');
        await expect(nav.getByRole('link', { name: 'Reseñas', exact: true })).toHaveAttribute('href', '/reviews');
        for (const link of await nav.getByRole('link').all()) {
          await expect(link).toBeVisible();
          expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        }
        await expectNoHorizontalOverflow(page);
        await page.screenshot({ path: test.info().outputPath('menu-mobile.png') });
        await dialog.getByRole('button', { name: 'Cerrar menú', exact: true }).click();
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
      } else {
        await expect(desktop).toBeVisible();
        await expect(trigger).toBeHidden();
        await expect(desktop.getByRole('link')).toHaveCount(13);
        await expect(desktop.getByRole('link', { name: 'Atenciones por cobrar', exact: true })).toHaveAttribute('href', '/collections');
        await expect(desktop.getByRole('link', { name: 'Reseñas', exact: true })).toHaveAttribute('href', '/reviews');
        await page.screenshot({ path: test.info().outputPath('shell-desktop.png') });
      }
    });
  }

  test('teclado nativo, Escape, foco aislado y cierre al navegar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await openHome(page);
    const trigger = page.getByRole('button', { name: 'Abrir menú de navegación', exact: true });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Menú de navegación', exact: true });
    const close = dialog.getByRole('button', { name: 'Cerrar menú', exact: true });
    await expect(close).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('link', { name: 'Inicio', exact: true })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('link', { name: 'Contraseña', exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    // Native showModal makes background controls inert, even to programmatic focus.
    await page.getByRole('banner').getByRole('button', { name: 'Cerrar sesión' }).evaluate((button) => button.focus());
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
    await page.keyboard.press('Space');
    await dialog.getByRole('link', { name: 'Inicio', exact: true }).click();
    await expect(dialog).toBeHidden();
    await trigger.click();
    await dialog.getByRole('link', { name: 'Contraseña', exact: true }).click();
    await expect(page).toHaveURL(/\/change-password$/);
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
  });

  test('texto al 200%, scroll vertical y cambio a escritorio con el menú abierto', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 480 });
    await openHome(page);
    // Text enlargement, not a matchMedia mock or a claim of physical-device testing.
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await page.getByRole('button', { name: 'Abrir menú de navegación', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Menú de navegación', exact: true });
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const last = dialog.getByRole('link', { name: 'Contraseña', exact: true });
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await page.screenshot({ path: test.info().outputPath('menu-text-200.png') });
    await dialog.getByRole('link', { name: 'Pacientes', exact: true }).click();
    await expect(page).toHaveURL(/\/patients$/);
    await expect(page.getByRole('heading', { name: 'Pacientes', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Abrir menú de navegación', exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 800 });
    // 48rem uses the browser initial font size for media queries, like Tailwind md.
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('navigation', { name: 'Navegación de escritorio' })
      .getByRole('link', { name: 'Pacientes', exact: true })).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
  });
});
