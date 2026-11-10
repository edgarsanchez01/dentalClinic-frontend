import { expect, test, type Page } from '@playwright/test';
import { ownerUiFixture } from './ownerUiFixture';

// Synthetic browser data only; the production dashboard never embeds these values.
async function fixture(page: Page, role = 'OWNER', mode = 'normal') {
  await ownerUiFixture(page, role);
  await page.clock.setFixedTime(new Date('2026-10-26T13:45:00Z'));
  const names = ['Alicia Ríos', 'Daniela Montes', 'Elena Salas', 'Gabriel Pérez', 'Inés Romero', 'Julián Acosta', 'Lucía Soto', 'Mateo Silva', 'Nora Reyes', 'Óscar Vidal', 'Paula Herrera', 'Raúl Núñez', 'Sara Campos', 'Tomás León', 'Valeria Díaz'];
  const statuses = ['COMPLETED', 'NO_SHOW', 'COMPLETED', 'COMPLETED', 'CANCELLED', 'CANCELLED', 'SCHEDULED', 'SCHEDULED', 'SCHEDULED', 'SCHEDULED', 'SCHEDULED', 'SCHEDULED'];
  const visits = names.map((name, i) => {
    const date = i < 12 ? '2026-10-26' : '2026-10-27';
    const hour = i < 12 ? 9 + Math.floor(i / 2) : 9 + i - 12;
    const startAt = `${date}T${String(hour).padStart(2, '0')}:${i < 12 && i % 2 ? '30' : '00'}:00Z`;
    return { id: i + 20, patientId: i + 4, patientFirstName: name.split(' ')[0], patientLastName: name.split(' ').slice(1).join(' '), patientUserId: 10,
      dentistId: i % 2 ? 8 : 7, dentistFirstName: i % 2 ? 'Diego' : 'Ana', dentistLastName: i % 2 ? 'Molina' : 'Propietaria',
      startAt, endAt: new Date(Date.parse(startAt) + 30 * 60_000).toISOString(), durationMinutes: 30,
      status: i < 12 ? statuses[i] : 'SCHEDULED', occurrenceVersion: 1, createdByUserId: 1, createdAt: '2026-10-25T09:00:00Z',
      service: { id: 1, name: ['Valoración integral', 'Limpieza dental', 'Revisión de tratamiento'][i % 3], durationMinutes: 30, referencePrice: '100.00', active: true } };
  });
  const calls: { path: string; method: string; params: URLSearchParams }[] = [];
  await page.route(url => ['/api/appointments', '/api/feedback', '/api/users', '/api/notifications', '/api/clinic'].includes(url.pathname), async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    calls.push({ path, method: route.request().method(), params: url.searchParams });
    if (path === '/api/clinic') { await route.fulfill({ json: { name: 'Clínica dental de prueba', timezone: mode === 'zone' ? 'invalid/zone' : 'UTC' } }); return; }
    if (path === '/api/users') { await route.fulfill({ json: [{ id: 2, role: 'DENTIST', status: 'PENDING' }, { id: 3, role: 'RECEPTIONIST', status: 'PENDING' }, { id: 4, role: 'DENTIST', status: 'INACTIVE' }] }); return; }
    if (path === '/api/feedback') { await route.fulfill({ json: { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0, average: 4.32, count: 45 } }); return; }
    if (path === '/api/notifications') { await route.fulfill({ json: { content: [1, 2, 3, 4, 5].map(i => ({ id: i, title: `Aviso de cita ${i}`, body: 'Se actualizó una cita. Consulta el detalle en tu bandeja de notificaciones.', read: i === 2, createdAt: '2026-10-26T12:30:00Z' })), page: 0, size: 5, totalElements: 5, totalPages: 1 } }); return; }
    if (mode === 'error') { await route.fulfill({ status: 503, json: { message: 'No disponible' } }); return; }
    const size = Number(url.searchParams.get('size') ?? 20), current = Number(url.searchParams.get('page') ?? 0);
    const from = Date.parse(url.searchParams.get('from') ?? '1970-01-01'), to = url.searchParams.has('to') ? Date.parse(url.searchParams.get('to')!) : Infinity;
    const entries = mode === 'empty' ? [] : visits.filter(a => Date.parse(a.startAt) >= from && Date.parse(a.startAt) < to
      && (!url.searchParams.has('status') || a.status === url.searchParams.get('status'))
      && (!url.searchParams.has('dentistId') || String(a.dentistId) === url.searchParams.get('dentistId'))
      && (role !== 'PATIENT' || a.patientId === 4));
    await route.fulfill({ json: { content: entries.slice(current * size, (current + 1) * size), page: current, size, totalElements: entries.length, totalPages: Math.ceil(entries.length / size) } });
  });
  return calls;
}

async function ready(page: Page) {
  await expect(page.locator('h1')).toHaveCount(1);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
}

async function contrast(page: Page) {
  const values = await page.locator('.owner-workspace .reception-desk h1, .owner-workspace .reception-desk h2, .owner-workspace .reception-desk h3, .owner-workspace .reception-operation-caption, .owner-workspace .dentist-status, .owner-workspace .reception-button, .owner-workspace .reception-link').evaluateAll(elements => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const luminance = (value: string) => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1);
      const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; });
      return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
    };
    return elements.filter(el => el.getBoundingClientRect().width > 0).map(el => {
      let ancestor: Element | null = el, background = 'rgb(255, 255, 255)';
      while (ancestor) { const c = getComputedStyle(ancestor).backgroundColor; if (c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') { background = c; break; } ancestor = ancestor.parentElement; }
      const a = luminance(getComputedStyle(el).color), b = luminance(background);
      return { text: el.textContent, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
  });
  for (const value of values) expect(value.ratio, value.text ?? '').toBeGreaterThanOrEqual(4.5);
}

async function unchangedRendering(before: Page, after: Page, a: Buffer, b: Buffer, label: string) {
  if (a.equals(b)) return;
  // Chromium occasionally rounds coverage differently at rounded borders: the
  // observed difference was 38 pixels, one RGB level each. Never mask a layout,
  // content or computed-style change, and bound both the amplitude and count.
  const presentation = (target: Page) => target.locator('body *').evaluateAll(elements => elements.map(el => {
    const css = getComputedStyle(el);
    return { tag: el.tagName, text: el.textContent, box: el.getBoundingClientRect().toJSON(),
      css: Object.fromEntries(Array.from(css).filter(name => !name.startsWith('--')).map(name => [name, css.getPropertyValue(name)])) };
  }));
  expect(await presentation(after), `${label}: content, geometry and computed styles`).toEqual(await presentation(before));
  const diff = await after.evaluate(async ({ oldImage, newImage }) => {
    const decode = async (base64: string) => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0);
      return { width: image.width, height: image.height, pixels: context.getImageData(0, 0, image.width, image.height).data };
    };
    const [old, current] = await Promise.all([decode(oldImage), decode(newImage)]);
    if (old.width !== current.width || old.height !== current.height) return { changedPixels: Infinity, maximumChannelDelta: Infinity };
    let changedPixels = 0, maximumChannelDelta = 0;
    for (let i = 0; i < old.pixels.length; i += 4) {
      let changed = false;
      for (let channel = 0; channel < 4; channel++) {
        const delta = Math.abs(old.pixels[i + channel] - current.pixels[i + channel]);
        maximumChannelDelta = Math.max(maximumChannelDelta, delta); changed ||= delta > 0;
      }
      if (changed) changedPixels++;
    }
    return { changedPixels, maximumChannelDelta };
  }, { oldImage: a.toString('base64'), newImage: b.toString('base64') });
  expect(diff.maximumChannelDelta, `${label}: raster rounding only`).toBeLessThanOrEqual(1);
  expect(diff.changedPixels, `${label}: bounded rounded-border raster noise`).toBeLessThanOrEqual(64);
}

for (const width of [1440, 768, 390, 320]) {
  test(`OWNER Inicio reutiliza composición de Recepción ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); const calls = await fixture(page);
    await page.goto('/'); await ready(page);
    const cards = await Promise.all(['Citas de hoy', 'Cartera pendiente', 'Cobrado este mes', 'Evaluación global'].map(name => page.getByRole('region', { name, exact: true })));
    expect(cards).toHaveLength(4);
    const boxes = await Promise.all(cards.map(card => card.boundingBox()));
    if (width >= 640) expect(boxes[0]!.y).toBe(boxes[1]!.y);
    else expect(boxes[1]!.y).toBeGreaterThan(boxes[0]!.y);
    if (width === 1440) {
      expect(boxes[0]!.y).toBe(boxes[3]!.y);
      const agenda = (await page.getByRole('region', { name: 'Agenda de hoy' }).boundingBox())!;
      const next = (await page.getByRole('region', { name: 'Siguiente paciente' }).boundingBox())!;
      expect(agenda.x).toBeLessThan(next.x); expect(agenda.width / next.width).toBeCloseTo(1.7, 1);
      expect(Math.abs(agenda.y - next.y)).toBeLessThan(9);
    } else {
      expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y);
      const order = await page.locator('.reception-journal-grid > section').evaluateAll(els => els.map(el => el.getAttribute('aria-label')));
      expect(order).toEqual(['Agenda de hoy', 'Siguiente paciente']);
    }
    await expect(page.getByRole('region', { name: 'Citas de hoy' })).toContainText('12');
    await expect(page.getByRole('region', { name: 'Agenda de hoy' }).getByRole('listitem')).toHaveCount(6);
    await expect(page.getByRole('region', { name: 'Siguiente paciente' })).toContainText('Paula Herrera');
    await expect(page.getByRole('region', { name: 'Próximas citas' })).not.toContainText('Alicia Ríos');
    await expect(page.getByRole('region', { name: 'Notificaciones personales' }).getByRole('listitem')).toHaveCount(3);
    await expect(page.getByRole('region', { name: 'Personal pendiente de activación' })).toContainText('2 cuentas de personal');
    const create = page.getByRole('link', { name: 'Crear cita', exact: true });
    expect((await create.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await create.focus(); await expect(create).toHaveCSS('outline-width', '2px');
    await contrast(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`owner-home-${width}.png`), fullPage: true });
    expect(calls.every(c => c.method === 'GET')).toBe(true);
    expect(calls.filter(c => c.path === '/api/appointments')).toHaveLength(3);
    expect(calls.find(c => c.path === '/api/appointments' && c.params.get('size') === '3')?.params.get('from')).toBe('2026-10-27T00:00:00.000Z');
    await create.click(); await expect(page.getByRole('heading', { name: 'Nueva cita', exact: true })).toBeVisible();
  });
}

for (const mode of ['empty', 'error', 'zone']) {
  test(`OWNER Inicio estado ${mode} sin datos inventados`, async ({ page }) => {
    const calls = await fixture(page, 'OWNER', mode); await page.goto('/'); await ready(page);
    if (mode === 'empty') {
      await expect(page.getByRole('heading', { name: 'No hay citas para hoy' })).toBeVisible();
      await expect(page.getByText('No hay próximas citas programadas. Puedes crear una desde la agenda.')).toBeVisible();
    } else if (mode === 'error') {
      await expect(page.getByRole('region', { name: 'Agenda de hoy' }).getByRole('alert')).toBeVisible();
      await expect(page.getByRole('region', { name: 'Citas de hoy' })).not.toContainText('0');
    } else {
      expect(calls.filter(c => c.path === '/api/appointments')).toHaveLength(0);
      await expect(page.getByRole('region', { name: 'Zona horaria' })).toContainText('no se calcularán con otra zona');
    }
    await expect(page.getByRole('region', { name: 'Cartera pendiente' })).toContainText('$2,450.50 MXN');
  });
}

if (process.env.DC_OWNER_UI_BASELINE) {
  for (const width of [390, 1440]) test(`regresión visual fuera de Inicio y Citas OWNER ${width}`, async ({ page, browser }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 1000 });
    for (const role of ['OWNER', 'PATIENT', 'DENTIST', 'RECEPTIONIST']) {
      const after = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
      const before = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
      await fixture(after, role); await fixture(before, role);
      const paths = role === 'OWNER' ? ['/patients', '/scheduling?scope=mine']
        : ['/', '/appointments?view=week&date=2026-10-26'];
      try {
        for (const [i, path] of paths.entries()) {
          await before.goto(`http://127.0.0.1:5295${path}`); await ready(before);
          await after.goto(`http://127.0.0.1:5296${path}`); await ready(after);
          // No input is focused. Avoid Playwright's temporary caret-hiding CSS
          // so a post-capture style comparison sees only application styles.
          const a = await before.screenshot({ path: test.info().outputPath(`${role}-${i}-before.png`), fullPage: true, caret: 'initial' });
          const b = await after.screenshot({ path: test.info().outputPath(`${role}-${i}-after.png`), fullPage: true, caret: 'initial' });
          await unchangedRendering(before, after, a, b, `${role} ${path}`);
        }
      } finally { await before.close(); await after.close(); }
    }
  });
}
