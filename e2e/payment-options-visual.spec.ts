import { expect, test, type Page } from '@playwright/test';
import { checkoutAppointment, checkoutContext, contextCharge } from '../src/test/checkoutFixtures';

const out = '/tmp/opencode/dc-payment-options-visual';
async function fixture(page: Page, role: 'OWNER' | 'RECEPTIONIST') {
  const forbidden: string[] = [];
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const send = (json: unknown) => route.fulfill({ json });
    if (path === '/api/auth/refresh') return send({ accessToken: 'payment-options-visual' });
    if (request.method() !== 'GET') { forbidden.push(`${request.method()} ${path}`); return route.abort('blockedbyclient'); }
    if (path === '/api/auth/me') return send({ id: 2, role, dentistId: 99, active: true, email: 'synthetic@example.test', createdAt: checkoutAppointment.createdAt });
    if (path === '/api/onboarding/status') return send({ status: 'COMPLETED', clinicConfigured: true });
    if (path === '/api/notifications/unread-count') return send({ unread: 0 });
    if (path === '/api/public/schedule') return send({ timezone: 'UTC', days: [], exceptions: [], dentists: [] });
    if (path === '/api/appointments/7') return send({ ...checkoutAppointment, status: 'COMPLETED', completedAt: checkoutAppointment.endAt });
    if (path === '/api/appointments/7/financial-context') return send(checkoutContext({ associationState: 'SINGLE_ACTIVE', chargeCount: 1, charges: [contextCharge()] }));
    forbidden.push(`Unexpected GET ${path}`); return route.fulfill({ status: 404, json: {} });
  });
  return forbidden;
}
async function fonts(page: Page) {
  await page.evaluate(async () => {
    await Promise.all([400, 500, 600].map(weight => document.fonts.load(`${weight} 16px "IBM Plex Sans"`)));
    await document.fonts.ready;
  });
}
async function options(page: Page) {
  return page.locator('.collection-payment-choice').evaluateAll(labels => labels.map(label => {
    const bounds = label.getBoundingClientRect(), radio = label.querySelector('input')!.getBoundingClientRect();
    const title = label.querySelector('strong')!.getBoundingClientRect(), description = label.querySelector('small')!.getBoundingClientRect();
    const c = getComputedStyle(label);
    return { width: bounds.width, height: bounds.height, radio: [radio.x - bounds.x, radio.y - bounds.y], title: [title.x - bounds.x, title.y - bounds.y], description: [description.x - bounds.x, description.y - bounds.y], radius: c.borderRadius, border: c.borderWidth, padding: c.padding, background: c.backgroundColor, borderColor: c.borderColor, shadow: c.boxShadow };
  }));
}

for (const width of [1440, 768, 390]) test(`opciones compartidas, tres selecciones y campos alineados a ${width}px`, async ({ context }) => {
  const roleStyles: unknown[] = [];
  for (const role of ['OWNER', 'RECEPTIONIST'] as const) {
    const page = await context.newPage(); await page.setViewportSize({ width, height: 1000 });
    const forbidden = await fixture(page, role);
    await page.goto('/collections/7');
    await expect(page.getByRole('button', { name: 'Revisar cobro' })).toBeEnabled(); await fonts(page);
    const labels = page.locator('.collection-payment-choice');
    const baseline = await options(page);
    const before = await page.getByRole('complementary', { name: 'Resumen financiero del cobro' }).innerText();
    const snapshots = [];
    for (const name of ['Pago completo', 'Pago parcial', 'Sin pago nuevo']) {
      const radio = page.getByRole('radio', { name, exact: true });
      await radio.check(); await page.mouse.move(0, 0);
      await expect(radio).toBeChecked();
      const styles = await options(page); snapshots.push(styles);
      styles.forEach((style, index) => {
        expect(style.radius).toBe('12px'); expect(style.border).toBe('1px'); expect(style.padding).toBe('16px'); expect(style.shadow).toBe('none');
        expect(style.radio).toEqual(styles[0]!.radio); expect(style.title).toEqual(styles[0]!.title); expect(style.description).toEqual(styles[0]!.description);
        expect(style.width).toBe(baseline[index]!.width); expect(style.height).toBe(baseline[index]!.height);
      });
      const selected = styles[['Pago completo', 'Pago parcial', 'Sin pago nuevo'].indexOf(name)]!;
      expect(styles.filter(style => style.background === selected.background)).toHaveLength(1);
      expect(styles.filter(style => style.borderColor === selected.borderColor)).toHaveLength(1);
      expect(await labels.evaluateAll(nodes => nodes[1]!.getBoundingClientRect().top - nodes[0]!.getBoundingClientRect().bottom)).toBe(12);
      if (name === 'Pago parcial') {
        const method = page.getByLabel('Método de pago'), amount = page.getByLabel('Importe abonado (MXN)');
        const m = (await method.boundingBox())!, a = (await amount.boundingBox())!;
        expect(m.height).toBe(50); expect(a.height).toBe(50);
        if (width === 390) { expect(a.x).toBe(m.x); expect(a.y).toBeGreaterThan(m.y + m.height); }
        else { expect(a.y).toBe(m.y); expect(a.x - m.x - m.width).toBe(16); }
        await amount.fill('123.45');
        await expect(amount).toHaveCSS('outline-offset', '-2px');
      }
      if ((role === 'OWNER' && width === 1440) || (role === 'RECEPTIONIST' && width === 390 && name === 'Pago parcial')) {
        await page.locator('[aria-labelledby="collection-payment-title"]').evaluate(el => el.scrollIntoView({ block: 'center' }));
        await page.locator('[aria-labelledby="collection-payment-title"]').screenshot({ path: `${out}/${role}-${width}-${name.replaceAll(' ', '-')}.png` });
      }
      expect(await page.getByRole('complementary', { name: 'Resumen financiero del cobro' }).innerText()).toBe(before);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
    roleStyles.push(snapshots);
    // Arrow keys preserve native radio semantics; only the option surface draws focus.
    const full = page.getByRole('radio', { name: 'Pago completo', exact: true });
    await page.keyboard.press('Tab'); await full.focus(); await page.keyboard.press('ArrowDown');
    const partial = page.getByRole('radio', { name: 'Pago parcial', exact: true });
    await expect(partial).toBeChecked(); await expect(partial).toBeFocused();
    const focus = await partial.evaluate(input => ({ radio: getComputedStyle(input).outlineStyle, surface: getComputedStyle(input.closest('label')!).outlineStyle, width: getComputedStyle(input.closest('label')!).outlineWidth }));
    expect(focus.radio).toBe('none'); expect(focus.surface).toBe('solid');
    expect(parseFloat(focus.width)).toBeGreaterThanOrEqual(2);
    await page.getByLabel('Importe abonado (MXN)').fill('123.45');
    await page.getByRole('button', { name: 'Revisar cobro' }).click();
    await expect(page.getByRole('heading', { name: 'Revisar y confirmar' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Confirmar cobro' })).toBeDisabled();
    expect(forbidden).toEqual([]); await page.close();
  }
  expect(roleStyles[0]).toEqual(roleStyles[1]);
});
