import { expect, test, type Page } from '@playwright/test';
import { ownerUiFixture } from './ownerUiFixture';

const NOW = '2026-10-26T12:15:00Z';
async function fixture(page: Page, role = 'OWNER', mode = 'normal') {
  const calls = await ownerUiFixture(page, role);
  await page.clock.setFixedTime(new Date(NOW));
  const names = ['Alicia Ríos', 'Daniela Montes', 'Elena Salas', 'Gabriel Pérez', 'Inés Romero', 'Julián Acosta', 'Lucía Soto', 'Paula Herrera'];
  const states = ['COMPLETED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'SCHEDULED', 'SCHEDULED', 'SCHEDULED', 'SCHEDULED'];
  const visits = names.map((name, i) => {
    const startAt = `2026-10-26T${String(9 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}:00Z`;
    return { id: i === 7 ? 20 : i + 30, patientId: i === 7 ? 4 : i + 10, patientUserId: 10,
      patientFirstName: name.split(' ')[0], patientLastName: name.split(' ').slice(1).join(' '), dentistId: 7,
      dentistFirstName: 'Ana', dentistLastName: 'Propietaria', startAt, endAt: new Date(Date.parse(startAt) + 30 * 60_000).toISOString(),
      durationMinutes: 30, status: states[i], occurrenceVersion: 1, createdByUserId: 1, createdAt: NOW,
      notes: 'NOTA CLÍNICA NO PUBLICABLE', reason: 'MOTIVO NO PUBLICABLE',
      service: { id: 1, name: ['Valoración integral', 'Limpieza dental', 'Revisión de tratamiento'][i % 3], durationMinutes: 30, referencePrice: '100.00', active: true } };
  });
  const foreign = { ...visits[7]!, id: 99, dentistId: 8, patientFirstName: 'AJENO', patientLastName: 'OTRO PROFESIONAL' };
  await page.route(url => ['/api/appointments', '/api/appointments/20', '/api/patients/4', '/api/notifications', '/api/availability/policy'].includes(url.pathname)
    || (mode === 'missing' && url.pathname === '/api/auth/me'), async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    calls.push({ path, params: url.searchParams, method: request.method(), body: null });
    if (path === '/api/auth/me') { await route.fulfill({ json: { id: 1, email: 'synthetic@example.test', role: 'OWNER', active: true, createdAt: NOW } }); return; }
    if (path === '/api/availability/policy') { await route.fulfill({ json: { timezone: mode === 'zone' ? 'invalid/zone' : 'UTC', maxAdvanceDays: 90, minBookingLeadTimeHours: 2, cancellationLeadTimeHours: 12 } }); return; }
    if (path === '/api/appointments/20') { await route.fulfill({ json: visits[7] }); return; }
    if (path === '/api/patients/4') { await route.fulfill({ json: { id: 4, firstName: 'Paula', lastName: 'Herrera', active: true } }); return; }
    if (path === '/api/notifications') {
      const content = mode === 'empty' ? [] : Array.from({ length: 5 }, (_, i) => ({ id: i + 1, title: ['Cambio en tu agenda', 'Recordatorio de cita', 'Aviso de tu bandeja', 'Actualización de cita', 'Información de tu cuenta'][i],
        body: 'Consulta los detalles de este aviso en tu bandeja personal. La información completa sigue disponible.', read: i === 1, priority: i === 0 ? 'HIGH' : 'NORMAL', createdAt: '2026-10-26T11:45:00Z' }));
      await route.fulfill({ json: { content, page: 0, size: 5, totalElements: content.length, totalPages: content.length ? 1 : 0 } }); return;
    }
    if (mode === 'loading') { await new Promise(() => {}); return; }
    if (mode === 'error') { await route.fulfill({ status: 503, json: { message: 'Agenda no disponible' } }); return; }
    const from = Date.parse(url.searchParams.get('from') ?? '1970-01-01'), to = url.searchParams.has('to') ? Date.parse(url.searchParams.get('to')!) : Infinity;
    const size = Number(url.searchParams.get('size') ?? 20), current = Number(url.searchParams.get('page') ?? 0);
    const entries = mode === 'empty' ? [] : [...visits, foreign].filter(a => Date.parse(a.startAt) >= from && Date.parse(a.startAt) < to
      && (!url.searchParams.has('status') || a.status === url.searchParams.get('status'))
      && (!url.searchParams.has('dentistId') || String(a.dentistId) === url.searchParams.get('dentistId'))
      && (role !== 'PATIENT' || a.patientId === 4));
    await route.fulfill({ json: { content: mode === 'foreign' ? [foreign] : entries.slice(current * size, (current + 1) * size), page: current, size, totalElements: entries.length, totalPages: Math.ceil(entries.length / size) } });
  });
  return calls;
}

async function ready(page: Page) {
  await expect(page.locator('h1')).toHaveCount(1);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('status', { name: /^Cargando / })).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
}

async function contrast(page: Page) {
  const readings = await page.locator('.owner-workspace .dentist-home h1, .owner-workspace .dentist-home h2, .owner-workspace .dentist-home h3, .owner-workspace .dentist-caption, .owner-workspace .dentist-status, .owner-workspace .dentist-home a, .owner-workspace .dentist-notification p').evaluateAll(elements => {
    const context = document.createElement('canvas').getContext('2d')!;
    const light = (color: string) => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; });
      return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    return elements.filter(el => el.getBoundingClientRect().width > 0).map(el => {
      let ancestor: Element | null = el, background = 'rgb(255, 255, 255)';
      while (ancestor) { const c = getComputedStyle(ancestor).backgroundColor; if (c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') { background = c; break; } ancestor = ancestor.parentElement; }
      const a = light(getComputedStyle(el).color), b = light(background);
      return { text: el.textContent, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
  });
  for (const reading of readings) expect(reading.ratio, reading.text ?? '').toBeGreaterThanOrEqual(4.5);
}

for (const width of [1440, 768, 390, 320]) {
  test(`OWNER Mi actividad clínica reutiliza DENTIST ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); const calls = await fixture(page);
    await page.goto('/?scope=mine&dentistId=8'); await ready(page);
    const next = page.getByRole('region', { name: 'Próxima cita propia' }), agenda = page.getByRole('region', { name: 'Mi agenda de hoy' });
    await expect(next).toContainText('Paula Herrera'); await expect(next).toContainText('12:30');
    await expect(agenda.getByRole('article')).toHaveCount(5);
    for (const state of ['Programada', 'Completada', 'Cancelada', 'No asistió']) await expect(agenda.getByText(state).first()).toBeVisible();
    await expect(page.getByText(/AJENO|NO PUBLICABLE/)).toHaveCount(0);
    const a = (await next.boundingBox())!, b = (await agenda.boundingBox())!;
    if (width === 1440) { expect(a.x).toBeLessThan(b.x); expect(a.y).toBe(b.y); expect(b.width / a.width).toBeGreaterThan(1); expect(a.height).toBeLessThan(b.height); }
    else expect(a.y + a.height).toBeLessThan(b.y);
    const notices = page.getByRole('region', { name: 'Tus notificaciones' });
    await expect(notices.getByRole('listitem')).toHaveCount(5);
    await expect(notices.getByText('Prioridad alta')).toBeVisible();
    await expect(notices.getByText('Leída', { exact: true })).toBeVisible();
    expect((await notices.boundingBox())!.y).toBeGreaterThan(b.y + b.height);
    expect(calls.filter(c => c.path === '/api/appointments')).toHaveLength(3);
    expect(calls.filter(c => c.path === '/api/appointments').every(c => c.params.get('dentistId') === '7')).toBe(true);
    expect(calls.some(c => /financial|clinical|\/users|\/clinic$/.test(c.path))).toBe(false);
    const action = page.getByRole('link', { name: 'Consultar mi agenda', exact: true });
    await action.focus(); await expect(action).toHaveCSS('outline-width', '2px');
    const bounds = await page.locator('.owner-workspace .dentist-home a, .owner-workspace .dentist-home button').evaluateAll(els => els.map(el => { const box = el.getBoundingClientRect(); return { height: box.height, left: box.left, right: box.right }; }));
    for (const box of bounds) { expect(box.height).toBeGreaterThanOrEqual(44); expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(width); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await contrast(page);
    await page.screenshot({ path: test.info().outputPath(`owner-personal-home-${width}.png`), fullPage: true });
    await agenda.getByRole('button', { name: 'Siguiente', exact: true }).click();
    await expect(agenda.getByRole('navigation', { name: 'Páginas de mi agenda' }).getByRole('status')).toContainText('Página 2 de 2');
    await expect(agenda.getByText('Paula Herrera')).toBeVisible();
    await agenda.getByRole('button', { name: 'Anterior', exact: true }).click();
    await expect(agenda.getByText('Alicia Ríos')).toBeVisible();
    expect(calls.filter(c => c.path === '/api/appointments').every(c => c.params.get('dentistId') === '7' && c.method === 'GET')).toBe(true);
    expect(calls.some(c => /\/notifications\/\d+\/read/.test(c.path))).toBe(false);
  });
}

test('OWNER acciones clínicas mantienen cita, expediente y retorno personal autorizados', async ({ page }) => {
  const calls = await fixture(page); await page.goto('/?scope=mine'); await ready(page);
  const next = page.getByRole('region', { name: 'Próxima cita propia' });
  const href = await next.getByRole('link', { name: 'Abrir cita' }).getAttribute('href');
  expect(decodeURIComponent(href!)).toContain('/appointments/20?clinical=1&returnTo=/appointments?view=day&date=2026-10-26&dentistId=7&scope=mine');
  await next.getByRole('link', { name: 'Abrir cita' }).click();
  await expect(page.getByRole('button', { name: 'Finalizar atención', exact: true })).toBeVisible();
  await page.goto('/?scope=mine'); await ready(page);
  await page.getByRole('region', { name: 'Próxima cita propia' }).getByRole('link', { name: 'Abrir expediente' }).click();
  await expect(page).toHaveURL(/\/patients\/4\?appointmentId=20&occurrenceVersion=1/);
  await expect(page.locator('h1')).toContainText('Paula');
  expect(calls.some(c => c.path === '/api/patients/4')).toBe(true);
});

for (const mode of ['empty', 'error', 'loading', 'foreign', 'missing', 'zone']) {
  test(`OWNER Mi actividad estado ${mode} conserva barreras y acciones`, async ({ page }) => {
    const calls = await fixture(page, 'OWNER', mode); await page.goto('/?scope=mine&dentistId=8');
    if (mode !== 'loading') await ready(page);
    if (mode === 'empty') {
      await expect(page.getByText('No tienes citas para hoy')).toBeVisible();
      await expect(page.getByText('No tienes notificaciones todavía.')).toBeVisible();
      await expect(page.getByText('No tienes próximas citas programadas. Las citas cuya hora ya pasó siguen en tu agenda del día.')).toBeVisible();
    } else if (mode === 'error' || mode === 'foreign') {
      await expect(page.getByRole('region', { name: 'Próxima cita propia' }).getByRole('alert')).toBeVisible();
      await expect(page.getByRole('region', { name: 'Mi agenda de hoy' }).getByRole('article')).toHaveCount(0);
      await expect(page.getByText(/AJENO/)).toHaveCount(0);
      await page.getByRole('region', { name: 'Próxima cita propia' }).getByRole('button', { name: /Reintentar/ }).click();
      await expect.poll(() => calls.filter(c => c.path === '/api/appointments').length).toBe(4);
    } else if (mode === 'loading') {
      await expect(page.getByRole('status', { name: 'Cargando próximas citas' })).toBeVisible();
      await expect(page.getByRole('status', { name: 'Cargando agenda de hoy' })).toBeVisible();
      await expect(page.getByText('Cambio en tu agenda')).toBeVisible();
    } else {
      await expect(page.getByRole('region', { name: mode === 'missing' ? 'Perfil vinculado' : 'Zona horaria' })).toBeVisible();
      expect(calls.filter(c => c.path === '/api/appointments')).toHaveLength(0);
    }
    expect(calls.filter(c => c.path === '/api/appointments').every(c => c.params.get('dentistId') === '7')).toBe(true);
    expect(calls.some(c => /financial|\/users|\/clinic$/.test(c.path))).toBe(false);
  });
}

if (process.env.DC_OWNER_PERSONAL_BASELINE) for (const width of [1440, 390]) {
  test(`Otros módulos OWNER y otros roles conservan presentación ${width}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const presentation = (page: Page) => page.locator('body *').evaluateAll(elements => elements.map(el => {
      const css = getComputedStyle(el);
      return { tag: el.tagName, text: el.textContent, box: el.getBoundingClientRect().toJSON(),
        css: Object.fromEntries(Array.from(css).filter(name => !name.startsWith('--')).map(name => [name, css.getPropertyValue(name)])) };
    }));
    for (const role of ['OWNER', 'DENTIST', 'PATIENT', 'RECEPTIONIST']) {
      const before = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
      const after = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
      const oldCalls = await fixture(before, role), newCalls = await fixture(after, role);
      const paths = role === 'OWNER' ? ['/patients', '/scheduling?scope=mine'] : ['/', '/appointments?view=week&date=2026-10-26'];
      try {
        for (const [i, path] of paths.entries()) {
          await before.goto(`http://127.0.0.1:5295${path}`); await ready(before);
          await after.goto(`http://127.0.0.1:5296${path}`); await ready(after);
          expect(await presentation(after), `${role} ${path}`).toEqual(await presentation(before));
          await before.screenshot({ path: test.info().outputPath(`${role}-${i}-before.png`), fullPage: true, caret: 'initial' });
          await after.screenshot({ path: test.info().outputPath(`${role}-${i}-after.png`), fullPage: true, caret: 'initial' });
        }
        const appointments = (calls: typeof oldCalls) => calls.filter(c => c.path === '/api/appointments').map(c => Object.fromEntries(c.params));
        expect(appointments(newCalls)).toEqual(appointments(oldCalls));
      } finally { await before.close(); await after.close(); }
    }
  });
}
