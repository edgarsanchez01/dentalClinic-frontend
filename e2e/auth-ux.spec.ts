import { expect, test, type Page } from '@playwright/test';

/** SPA/Chromium reales, API simulada. El proxy de la configuración apunta a puerto 9. */
async function anonymous(page: Page) {
  await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ status: 401, json: {} }));
}

for (const width of [320, 375, 390, 768, 1280, 1440]) {
  test(`familia de autenticación sin overflow a ${width}px`, async ({ page }) => {
    await anonymous(page);
    await page.setViewportSize({ width, height: 900 });
    for (const [name, route, title] of [
      ['login', '/login', 'Iniciar sesión'],
      ['register', '/register', 'Crear cuenta de paciente'],
      ['forgot', '/forgot-password', 'Recuperar contraseña'],
      ['reset', '/reset-password?token=sintetico', 'Restablecer contraseña'],
      ['activate', '/activate?token=sintetico', 'Activar cuenta'],
    ]) {
      await page.goto(route);
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const input = page.locator('input').first();
      if (width < 1024) {
        expect((await input.boundingBox())!.y).toBeLessThan(380);
        await expect(page.getByRole('complementary', { name: 'DentalClinic' })).toBeHidden();
      }
      for (const control of await page.locator('.auth-layout input, .auth-layout button, .auth-home, .auth-footer a').all()) {
        const box = await control.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
      }
      // La comprobación de contraste utiliza los colores realmente calculados por Chromium.
      const contrast = await page.evaluate(() => {
        function rgb(value: string) { return value.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => { const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }); }
        function luminance(value: string) { const [r, g, b] = rgb(value); return .2126 * r + .7152 * g + .0722 * b; }
        const root = getComputedStyle(document.querySelector('.auth-layout')!);
        const ratio = (a: string, b: string) => { const values = [luminance(a), luminance(b)].sort((x, y) => y - x); return (values[0] + .05) / (values[1] + .05); };
        // Resolve custom-property hex values through the browser, not a source-code assumption.
        const resolved = (token: string) => { const el = document.createElement('span'); el.style.color = root.getPropertyValue(token); document.body.append(el); const result = getComputedStyle(el).color; el.remove(); return result; };
        return {
          body: ratio(resolved('--auth-ink'), resolved('--auth-canvas')),
          muted: ratio(resolved('--auth-muted'), resolved('--auth-canvas')),
          primary: ratio(resolved('--auth-paper'), resolved('--auth-petrol')),
          brand: ratio(resolved('--auth-sage'), resolved('--auth-petrol')),
          border: ratio(resolved('--auth-border'), resolved('--auth-paper')),
        };
      });
      for (const key of ['body', 'muted', 'primary', 'brand'] as const) expect(contrast[key]).toBeGreaterThanOrEqual(4.5);
      expect(contrast.border).toBeGreaterThanOrEqual(3);
      await page.screenshot({ path: `/tmp/opencode/ux01/evidence/${name}-${width}.png`, fullPage: true });
    }
  });
}

test('teclado, mostrar contraseña, errores asociados y corrección sin perder foco', async ({ page }) => {
  await anonymous(page);
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Ir al formulario' })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Correo electrónico', { exact: true })).toBeFocused();
  await page.getByLabel('Correo electrónico', { exact: true }).fill('prueba@example.test');
  await page.keyboard.press('Tab');
  const password = page.getByLabel('Contraseña', { exact: true });
  await expect(password).toBeFocused();
  await password.fill('frase de prueba');
  await page.keyboard.press('Tab');
  const toggle = page.getByRole('button', { name: 'Mostrar contraseña', exact: true });
  await expect(toggle).toBeFocused();
  expect(await toggle.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Space');
  await expect(password).toHaveAttribute('type', 'text');
  await expect(page.getByRole('button', { name: 'Ocultar contraseña' })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByLabel('Correo electrónico', { exact: true }).fill('incorrecto');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('alert')).toBeFocused();
  await page.getByRole('link', { name: 'Escribe un correo con un formato válido.' }).click();
  await expect(page.getByLabel('Correo electrónico', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Correo electrónico', { exact: true })).toHaveAttribute('aria-describedby', 'email-error');
  await page.getByLabel('Correo electrónico', { exact: true }).fill('corregido@example.test');
  await expect(page.getByLabel('Correo electrónico', { exact: true })).toBeFocused();
  await page.screenshot({ path: '/tmp/opencode/ux01/evidence/login-validation.png', fullPage: true });
});

test('solicitud de recuperación lenta, envío único y confirmación honesta', async ({ page }) => {
  await anonymous(page);
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route(url => url.pathname === '/api/auth/password/forgot', async route => {
    calls++; await waiting; await route.fulfill({ status: 202 });
  });
  await page.goto('/forgot-password');
  await page.getByLabel('Correo electrónico', { exact: true }).fill('prueba@example.test');
  await page.getByRole('button', { name: 'Solicitar enlace' }).click();
  await expect(page.getByRole('button', { name: 'Enviando…' })).toBeDisabled();
  await page.locator('form').evaluate(form => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(calls).toBe(1);
  await page.screenshot({ path: '/tmp/opencode/ux01/evidence/forgot-loading.png', fullPage: true });
  release();
  await expect(page.getByRole('heading', { name: 'Solicitud recibida' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Esta confirmación no acredita el envío');
  await page.screenshot({ path: '/tmp/opencode/ux01/evidence/forgot-confirmation.png', fullPage: true });
});

for (const activation of [false, true]) {
  test(`enlace ausente, caducado y éxito de ${activation ? 'activación' : 'reset'}`, async ({ page }) => {
    await anonymous(page);
    const route = activation ? '/activate' : '/reset-password';
    const apiPath = activation ? '/api/auth/activate' : '/api/auth/password/reset';
    const action = activation ? 'Activar cuenta' : 'Restablecer';
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(route);
    await expect(page.getByRole('alert')).toContainText('El enlace es inválido');
    expect(await page.locator('input').count()).toBe(0);
    await page.route(url => url.pathname === apiPath, r => r.fulfill({ status: 401, json: { message: 'Token no válido.' } }));
    await page.goto(`${route}?token=sintetico`);
    await page.getByLabel('Nueva contraseña', { exact: true }).fill('a');
    await page.getByLabel('Repite la contraseña', { exact: true }).fill('a');
    await page.getByRole('button', { name: action, exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('ha caducado o ya se utilizó');
    expect(await page.locator('input').count()).toBe(0);
    await page.screenshot({ path: `/tmp/opencode/ux01/evidence/${activation ? 'activate' : 'reset'}-expired.png`, fullPage: true });
    await page.route(url => url.pathname === apiPath, r => r.fulfill({ status: 204 }));
    await page.goto(`${route}?token=sintetico-nuevo`);
    await page.getByLabel('Nueva contraseña', { exact: true }).fill('a');
    await page.getByLabel('Repite la contraseña', { exact: true }).fill('a');
    await page.getByRole('button', { name: action, exact: true }).click();
    await expect(page.getByRole('heading', { name: activation ? 'Cuenta activada' : 'Contraseña actualizada', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Iniciar sesión', exact: true })).toBeVisible();
    await page.screenshot({ path: `/tmp/opencode/ux01/evidence/${activation ? 'activate' : 'reset'}-success.png`, fullPage: true });
  });
}

test('zoom de texto y movimiento reducido mantienen campos y acciones legibles', async ({ page }) => {
  await anonymous(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: 'Crear cuenta de paciente' })).toBeVisible();
  await page.addStyleTag({ content: '.auth-layout { font-size: 200%; } .auth-layout input, .auth-layout button, .auth-layout label, .auth-layout p, .auth-layout a { font-size: 1em !important; }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Crear cuenta', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Crear cuenta', exact: true })).toBeVisible();
  expect(await page.locator('input').first().evaluate(el => parseFloat(getComputedStyle(el).transitionDuration))).toBeLessThan(.001);
});
