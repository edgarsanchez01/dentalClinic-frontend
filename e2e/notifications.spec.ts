import { expect, test } from '@playwright/test';

for (const width of [320, 390, 1280]) {
  test(`notificaciones: teclado, marcado y navegación a ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    let read = false;
    let marks = 0;
    const notification = {
      id: 12, title: 'Cita reprogramada', body: 'Consulta el nuevo horario.\nEste aviso permanece en el buzón.',
      priority: 'HIGH', read: false, createdAt: '2026-10-12T09:00:00Z',
    };
    await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/notifications/12/read') {
        marks += 1;
        expect(route.request().method()).toBe('POST');
        expect(route.request().postData()).toBeNull();
        read = true;
        await route.fulfill({ json: { ...notification, read: true, readAt: '2026-10-12T10:00:00Z' } });
        return;
      }
      const body = path === '/api/auth/refresh' ? { accessToken: 'notifications-e2e' }
        : path === '/api/auth/me' ? { id: 1, email: 'owner@clinic.com', role: 'OWNER', active: true, createdAt: '2026-01-01' }
        : path === '/api/onboarding/status' ? { status: 'COMPLETED', clinicConfigured: true }
        : path === '/api/notifications/unread-count' ? { unread: read ? 0 : 3 }
        : path === '/api/notifications' ? { content: [{ ...notification, read }], page: 0, size: 20, totalElements: 1, totalPages: 1 }
        : {};
      await route.fulfill({ json: body });
    });
    await page.route('**/actuator/**', (route) => route.fulfill({ json: { status: 'UP' } }));
    await page.goto('/');
    const bell = page.getByRole('link', { name: 'Notificaciones: 3 sin leer' });
    await expect(bell).toBeVisible();
    expect((await bell.boundingBox())!.width).toBeGreaterThanOrEqual(44);
    expect((await bell.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await bell.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/notifications$/);
    await expect(page.getByRole('heading', { name: 'Notificaciones', exact: true })).toBeVisible();
    const notice = page.getByRole('article', { name: 'Cita reprogramada' });
    await expect(notice.getByText('No leída', { exact: true })).toBeVisible();
    expect(marks).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const trigger = page.getByRole('button', { name: 'Abrir menú de navegación' });
    const desktop = page.getByRole('navigation', { name: 'Navegación de escritorio' });
    if (width < 768) {
      await expect(desktop).toBeHidden();
      await trigger.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Menú de navegación', exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Cerrar menú' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    } else {
      await expect(desktop).toBeVisible();
      await expect(trigger).toBeHidden();
    }
    const mark = notice.getByRole('button', { name: 'Marcar como leída' });
    expect((await mark.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await mark.focus();
    await page.keyboard.press('Enter');
    await expect(notice.getByText('Leída', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Notificaciones: 0 sin leer' })).toBeVisible();
    await expect(notice).toBeVisible();
    await expect(mark).toHaveCount(0);
    expect(marks).toBe(1);
    await page.screenshot({ path: test.info().outputPath(`notifications-${width}.png`), fullPage: true });
  });
}
