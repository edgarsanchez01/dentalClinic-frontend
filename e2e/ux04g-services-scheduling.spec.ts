import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const NOW = '2026-10-20T12:00:00Z';
const timezone = 'Europe/Madrid';
const days = Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i + 1, open: i < 5,
  startTime: i < 5 ? '09:00:00' : null, endTime: i < 5 ? '18:00:00' : null,
  breaks: i === 0 ? [{ startTime: '13:00:00', endTime: '14:00:00' }, { startTime: '16:00:00', endTime: '16:15:00' }] : [] }));
const services = [
  { id: 1, name: 'Consulta de valoración', description: 'Revisión inicial y orientación sobre las opciones de atención.', referencePrice: '450.1234', durationMinutes: 45, active: true, createdAt: NOW, updatedAt: null },
  { id: 2, name: 'Limpieza dental', description: 'Servicio preventivo del catálogo de la clínica.', referencePrice: '700.00', durationMinutes: 60, active: true, createdAt: NOW, updatedAt: null },
  { id: 3, name: 'Revisión de seguimiento', description: null, referencePrice: '0.0000', durationMinutes: 20, active: false, createdAt: NOW, updatedAt: null },
  { id: 4, name: 'Consulta de orientación para tratamientos de larga duración', description: 'Información de referencia del servicio.\nEl catálogo no constituye un cargo ni un tratamiento registrado.', referencePrice: '999999999999999.1234', durationMinutes: 90, active: true, createdAt: NOW, updatedAt: null },
];

export async function ux04gFixture(page: Page, role = 'RECEPTIONIST') {
  const state = { catalog: 'many', availability: 'results', fail: '', directoryEmpty: false, scheduleEmpty: false };
  const calls: { path: string; method: string; search: string }[] = [];
  await page.clock.setFixedTime(new Date(NOW));
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    calls.push({ path, method: route.request().method(), search: url.search });
    if (state.fail === path || (path === '/api/availability' && state.availability === 'error')) {
      await route.fulfill({ status: 503, json: { message: 'Consulta temporalmente no disponible.' } }); return;
    }
    let body: unknown;
    if (path === '/api/auth/refresh') body = { accessToken: 'ux04g-synthetic' };
    else if (path === '/api/auth/me') body = { id: 1, email: 'synthetic@example.test', role, active: true, dentistId: role === 'DENTIST' ? 8 : 7, createdAt: NOW };
    else if (path === '/api/onboarding/status') body = { status: 'COMPLETED', clinicConfigured: true };
    else if (path === '/api/availability/policy') body = { timezone, maxAdvanceDays: 73, minBookingLeadTimeHours: 3, cancellationLeadTimeHours: 16 };
    else if (path === '/api/public/schedule') body = { timezone, days, exceptions: [], dentists: state.directoryEmpty ? [] : [
      { dentistId: 7, firstName: 'Ana', lastName: 'Prueba', days: [] }, { dentistId: 8, firstName: 'Luis', lastName: 'Sintético', days: [] },
    ] };
    else if (path === '/api/schedules/clinic') body = { timezone, days: state.scheduleEmpty ? [] : days };
    else if (path === '/api/schedules/clinic/exceptions') body = [{ date: '2026-11-02', closed: true, reason: 'Cierre de prueba' }, { date: '2026-11-03', closed: false, startTime: '10:00:00', endTime: '14:00:00', reason: 'Apertura especial de prueba' }];
    else if (/\/dentist\/\d+\/exceptions$/.test(path)) body = [{ date: '2026-11-04', closed: true, reason: 'Excepción del profesional' }];
    else if (/\/dentist\/\d+\/time-off$/.test(path)) body = [{ id: 1, startDate: '2026-11-05', endDate: '2026-11-06', allDay: true, reason: 'Ausencia sintética' }, { id: 2, startDate: '2026-11-09', endDate: '2026-11-09', allDay: false, startTime: '11:00:00', endTime: '12:30:00', reason: 'Bloqueo parcial de prueba' }];
    else if (/\/api\/schedules\/dentist\/\d+$/.test(path)) body = { dentistId: Number(path.split('/').at(-1)), timezone,
      days: state.scheduleEmpty ? [] : days.map((day) => ({ ...day, startTime: day.open ? path.endsWith('/8') ? '11:00:00' : '10:00:00' : null, endTime: day.open ? '17:00:00' : null })) };
    else if (path === '/api/services') {
      const items = state.catalog === 'empty' ? [] : state.catalog === 'one' ? services.slice(0, 1) : services;
      body = items.filter((item) => !url.searchParams.has('active') || String(item.active) === url.searchParams.get('active'));
    } else if (path === '/api/availability') {
      const date = url.searchParams.get('from')!;
      const duration = Number(url.searchParams.get('duration'));
      body = { dentistId: Number(url.searchParams.get('dentistId')), durationMinutes: duration, timezone,
        slots: state.availability === 'empty' ? [] : [15, 9, 10, 11, 12, 14, 16].map((hour) => {
          const start = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);
          const end = new Date(start.getTime() + duration * 60_000);
          return { startDate: date, startTime: start.toISOString().slice(11, 19), endTime: end.toISOString().slice(11, 19), start: start.toISOString(), end: end.toISOString() };
        }) };
    } else if (path === '/api/notifications/unread-count') body = { unread: 0 };
    else { await route.fulfill({ status: 404, json: {} }); return; }
    await route.fulfill({ json: body });
  });
  return { state, calls };
}

async function chooseDentist(page: Page, name: string) {
  const toggle = page.getByRole('button', { name: 'Cambiar dentista', exact: true });
  const input = page.getByRole('combobox', { name: 'Buscar dentista' });
  await expect.poll(async () => await toggle.isVisible() || await input.isVisible()).toBe(true);
  if (!await input.isVisible()) await toggle.click();
  await input.fill('');
  await page.getByRole('option', { name, exact: true }).click();
}

test('UX04G41 evidencia de estados del selector abierto', async ({ page }) => {
  const stage = process.env.UX04G41_CAPTURE_STAGE;
  test.skip(!stage, 'Capturas G.4.1 opt-in, independientes del calendario aprobado.');
  await ux04gFixture(page);
  const folder = `/tmp/opencode/ux04g4-1/${stage}`;
  await mkdir(folder, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/scheduling');
  const toggle = page.getByRole('button', { name: 'Cambiar dentista', exact: true });
  const input = page.getByRole('combobox', { name: 'Buscar dentista' });
  const directory = page.locator('.rs-directory');
  async function capture(name: string) {
    await page.evaluate(() => document.fonts.ready);
    await directory.screenshot({ path: `${folder}/${name}.png` });
  }
  await toggle.click();
  await page.getByRole('heading', { name: 'Horarios', exact: true }).hover();
  await capture('normal-1440');
  await page.getByRole('option', { name: 'Luis Sintético', exact: true }).hover();
  await capture('hover-1440');
  await input.focus();
  await input.press('ArrowUp'); // Pointer-active Luis → selected Ana; DOM focus stays in search.
  await capture('focus-visible-seleccionado-1440');
  await input.press('ArrowDown');
  await capture('focus-visible-1440');
  await page.getByRole('option', { name: 'Luis Sintético', exact: true }).click();
  await expect(page.locator('.rs-selected-name')).toHaveText('Luis Sintético');
  await toggle.click();
  await page.getByRole('heading', { name: 'Horarios', exact: true }).hover();
  await capture('seleccionado-1440');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/scheduling');
  await toggle.click();
  await capture('movil390');
  await input.press('ArrowDown');
  await capture('movil390-focus-visible');
  await page.screenshot({ path: `${folder}/movil390-viewport.png` });
});

test('UX04G41 hover, selección y foco redondeado coexisten sin perder contraste ni reflujo', async ({ page }) => {
  await ux04gFixture(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/scheduling');
    await page.getByRole('button', { name: 'Cambiar dentista' }).click();
    await page.getByRole('heading', { name: 'Horarios', exact: true }).hover();
    const input = page.getByRole('combobox', { name: 'Buscar dentista' });
    const selected = page.getByRole('listbox').getByRole('option', { selected: true });
    const other = page.getByRole('listbox').getByRole('option', { name: 'Luis Sintético', exact: true });
    const styles = async (option: typeof selected) => option.evaluate((el) => {
      const css = getComputedStyle(el);
      const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
      const context = canvas.getContext('2d')!;
      const rgb = (color: string) => {
        context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data);
      };
      const luminance = (color: string) => rgb(color).slice(0, 3).map((v) => v / 255)
        .map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0);
      const contrast = (a: string, b: string) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
      let surface: Element = el;
      while (rgb(getComputedStyle(surface).backgroundColor)[3] === 0 && surface.parentElement) surface = surface.parentElement;
      const bg = getComputedStyle(surface).backgroundColor;
      return { background: rgb(bg), color: css.color, radius: css.borderRadius, outline: css.outlineStyle,
        outlineWidth: css.outlineWidth, outlineOffset: css.outlineOffset,
        textContrast: contrast(css.color, bg), focusContrast: contrast(css.outlineColor, bg),
        animation: css.animationName, transition: css.transitionDuration };
    });
    await expect(input).toBeFocused();
    await expect(input).toHaveCSS('border-radius', '12px');
    await expect(input).toHaveCSS('outline-style', 'solid');
    const originalSelected = await styles(selected);
    const normal = await styles(other);
    expect(originalSelected.background).toEqual([185, 214, 201, 255]);
    expect(normal.radius).toBe('12px'); expect(normal.outline).toBe('none');
    await other.hover();
    await expect.poll(async () => (await styles(other)).background).not.toEqual(normal.background);
    const hovered = await styles(other);
    expect(hovered.background).not.toEqual(normal.background);
    expect(hovered.background).not.toEqual(originalSelected.background);
    expect(hovered.outline).toBe('none'); expect(hovered.textContrast).toBeGreaterThanOrEqual(4.5);
    await selected.hover();
    expect((await styles(selected)).background).toEqual(originalSelected.background);
    await input.press('ArrowDown');
    await expect(input).toHaveAttribute('aria-activedescendant', 'rs-professional-8');
    await expect(other).toHaveCSS('outline-width', '2px');
    expect((await styles(selected)).background).toEqual(originalSelected.background);
    let focused = await styles(other);
    expect(focused.outline).toBe('solid'); expect(focused.outlineWidth).toBe('2px');
    expect(focused.outlineOffset).toBe('-3px'); expect(focused.radius).toBe('12px');
    expect(focused.focusContrast).toBeGreaterThanOrEqual(3);
    await input.press('ArrowUp'); // Selection + pointer hover + virtual keyboard focus on the same option.
    await expect(selected).toHaveCSS('outline-width', '2px');
    focused = await styles(selected);
    expect(focused.background).toEqual(originalSelected.background);
    expect(focused.outline).toBe('solid'); expect(focused.radius).toBe('12px');
    expect(focused.textContrast).toBeGreaterThanOrEqual(4.5); expect(focused.focusContrast).toBeGreaterThanOrEqual(3);
    expect(focused.animation).toBe('none');
    // The existing shared reduced-motion rule computes to 0.01ms; do not override global CSS.
    expect(parseFloat(focused.transition)).toBeLessThanOrEqual(.00001);
    await input.press('Shift+Tab');
    await expect(page.getByRole('button', { name: 'Cambiar dentista' })).toBeFocused();
    await expect(selected).toHaveCSS('outline-style', 'none');
    expect((await styles(selected)).outline).toBe('none');
    await input.focus(); await input.press('ArrowDown');
    await expect(other).toHaveClass(/is-keyboard-active/);
    await input.click();
    await expect(other).not.toHaveClass(/is-keyboard-active/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await other.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await input.press('Escape');
    await expect(page.getByRole('button', { name: 'Cambiar dentista' })).toBeFocused();
  }
});

test('UX04G41 foco virtual visible al atravesar páginas de 180 profesionales', async ({ page }) => {
  await ux04gFixture(page);
  await page.route('**/api/public/schedule', (route) => route.fulfill({ json: { timezone, days, exceptions: [],
    dentists: Array.from({ length: 180 }, (_, index) => ({ dentistId: index + 7, firstName: 'Profesional', lastName: String(index + 1), days: [] })),
  } }));
  await page.goto('/scheduling');
  await page.getByRole('button', { name: 'Cambiar dentista' }).click();
  const input = page.getByRole('combobox', { name: 'Buscar dentista' });
  for (let index = 0; index < 21; index++) await input.press('ArrowDown');
  await expect(page.getByRole('option')).toHaveCount(20);
  const option = page.getByRole('option', { name: 'Profesional 21', exact: true });
  await expect(input).toHaveAttribute('aria-activedescendant', await option.getAttribute('id'));
  await expect(option).toHaveClass(/is-keyboard-active/);
  await expect(option).toHaveCSS('outline-style', 'solid');
  const bounds = (await option.boundingBox())!, list = (await page.getByRole('listbox').boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(list.y); expect(bounds.y + bounds.height).toBeLessThanOrEqual(list.y + list.height);
  await input.press('Enter');
  await expect(page.locator('.rs-selected-name')).toHaveText('Profesional 21');
  await page.getByRole('button', { name: 'Cambiar dentista' }).click();
  await input.fill('Profesional 180'); await input.press('ArrowDown');
  await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option')).toHaveClass(/is-keyboard-active/);
  await input.press('Enter');
  await expect(page.locator('.rs-selected-name')).toHaveText('Profesional 180');
});

const evidence = process.env.UX04G_CAPTURE_STAGE;
test('UX04G capturas comparables de Servicios y Horarios', async ({ page }) => {
  test.skip(!evidence, 'Captura opt-in antes/después con la misma fixture.');
  const { state } = await ux04gFixture(page);
  const folder = `/tmp/opencode/ux04g/${evidence}`;
  await mkdir(folder, { recursive: true });
  for (const width of [1440, 768, 390, 320, 720]) {
    await page.setViewportSize({ width, height: width === 720 ? 500 : 1000 });
    async function capture(name: string) {
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name).toBe(true);
      await page.screenshot({ path: `${folder}/${name}-${width}.png`, fullPage: true });
    }
    for (const variant of ['one', 'many', 'empty']) {
      state.catalog = variant;
      await page.goto('/services');
      if (variant === 'empty') await expect(page.getByText('El catálogo está vacío')).toBeVisible();
      else await expect(page.getByRole('article', { name: 'Servicio Consulta de valoración', exact: true })).toBeVisible();
      await capture(`servicios-${variant}`);
    }
    state.catalog = 'one';
    await page.goto('/services');
    await page.getByLabel('Estado', { exact: true }).selectOption('inactive');
    await expect(page.getByText('No hay servicios con este estado')).toBeVisible();
    await capture('servicios-sin-resultados');
    state.availability = 'results';
    await page.goto('/scheduling');
    await expect(page.getByText('10:00–17:00').first()).toBeVisible();
    await capture('horarios-inicial');
    await page.getByLabel('Fecha', { exact: true }).fill('2026-10-22');
    await page.getByRole('button', { name: 'Buscar disponibilidad', exact: true }).click();
    await expect(page.getByText('09:00–09:30', { exact: true })).toBeVisible();
    await capture('disponibilidad-resultados');
    state.availability = 'empty';
    await page.getByLabel('Fecha', { exact: true }).fill('2026-10-23');
    await page.getByRole('button', { name: 'Buscar disponibilidad', exact: true }).click();
    await expect(page.getByText('No hay huecos para los criterios indicados.')).toBeVisible();
    await capture('disponibilidad-vacia');
    if (evidence === 'after') {
      await chooseDentist(page, 'Luis Sintético');
      await expect(page.locator('section[aria-labelledby="rs-dentist-week"]')).toContainText('11:00–17:00');
      await capture('horarios-dentista-luis');
      await page.locator('.rs-exceptions').screenshot({ path: `${folder}/excepciones-${width}.png` });
      await page.locator('section[aria-labelledby="rs-policy"]').screenshot({ path: `${folder}/politicas-${width}.png` });
    }
  }
});

test('UX04G3 semana primero, contexto único y disponibilidad informativa cronológica', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { calls } = await ux04gFixture(page);
  await page.goto('/scheduling');
  const main = page.getByRole('main');
  await expect(main.getByRole('button', { name: 'Cambiar dentista', exact: true })).toHaveCount(1);
  await expect(page.locator('.rs-availability').getByRole('combobox')).toHaveCount(0);
  const search = main.getByRole('button', { name: 'Buscar disponibilidad', exact: true });
  expect((await page.locator('[aria-labelledby="rs-dentist-week"] .rs-day').last().boundingBox())!.y).toBeLessThan(800);
  expect(await main.getByRole('heading', { level: 2 }).allTextContents()).toEqual([
    'Horario semanal', 'Excepciones del dentista', 'Ausencias del dentista', 'Consultar disponibilidad', 'Información de la clínica', 'Horario de la clínica', 'Excepciones de la clínica', 'Política de reservas',
  ]);
  await page.getByLabel('Fecha', { exact: true }).fill('2026-10-22');
  await search.click();
  const slots = page.getByRole('list', { name: /Intervalos disponibles/ });
  await expect(slots.getByRole('listitem')).toHaveCount(7);
  await expect(slots.getByRole('listitem').first()).toHaveText('09:00–09:30');
  expect(await slots.getByRole('listitem').allTextContents()).toEqual(['09:00–09:30', '10:00–10:30', '11:00–11:30', '12:00–12:30', '14:00–14:30', '15:00–15:30', '16:00–16:30']);
  await expect(page.locator('.rs-result-context')).toContainText('Ana Prueba · 22 de octubre de 2026');
  await expect(slots.getByRole('button')).toHaveCount(0);
  await expect(slots.locator('[tabindex], a, input')).toHaveCount(0);
  await expect(main.getByRole('button', { name: /Guardar|Crear|Editar|Eliminar|Añadir|Reservar/ })).toHaveCount(0);
  expect(calls.filter((call) => !call.path.startsWith('/api/auth/') && call.method !== 'GET')).toEqual([]);
  expect(calls.find((call) => call.path === '/api/availability')?.search).toBe('?dentistId=7&from=2026-10-22&duration=30');
});

test('UX04G cambio de dentista, fecha y duración limpia resultados y consulta los criterios nuevos', async ({ page }) => {
  const { calls } = await ux04gFixture(page);
  await page.goto('/scheduling');
  await page.getByLabel('Fecha', { exact: true }).fill('2026-10-22');
  await page.getByRole('button', { name: 'Buscar disponibilidad', exact: true }).click();
  await expect(page.locator('.rs-slots li')).toHaveCount(7);
  await chooseDentist(page, 'Luis Sintético');
  await expect(page.locator('.rs-slots')).toHaveCount(0);
  await expect(page.locator('section[aria-labelledby="rs-dentist-week"]')).toContainText('Luis Sintético');
  await expect(page.locator('section[aria-labelledby="rs-dentist-week"]')).toContainText('11:00–17:00');
  await expect(page.locator('section[aria-labelledby="rs-dentist-exceptions"]')).toContainText('Luis Sintético');
  await page.getByLabel('Fecha', { exact: true }).fill('2026-10-23');
  await page.getByLabel('Duración (min)', { exact: true }).fill('60');
  await page.getByRole('button', { name: 'Buscar disponibilidad', exact: true }).click();
  await expect(page.locator('.rs-slots li').first()).toHaveText('09:00–10:00');
  await expect(page.locator('.rs-result-context')).toContainText('Luis Sintético · 23 de octubre de 2026');
  expect(calls.filter((call) => call.path === '/api/availability').map((call) => call.search)).toEqual([
    '?dentistId=7&from=2026-10-22&duration=30', '?dentistId=8&from=2026-10-23&duration=60',
  ]);
  await page.getByLabel('Duración (min)', { exact: true }).fill('45');
  await expect(page.locator('.rs-slots')).toHaveCount(0);
  await page.getByRole('button', { name: 'Buscar disponibilidad', exact: true }).click();
  await expect(page.locator('.rs-slots li').first()).toHaveText('09:00–09:45');
  await page.getByLabel('Fecha', { exact: true }).fill('2026-10-24');
  await expect(page.locator('.rs-slots')).toHaveCount(0);
  expect(calls.filter((call) => call.path === '/api/availability')).toHaveLength(3);
});

test('UX04G carga, cero resultados y error con recuperación; búsqueda repetida reconsulta', async ({ page }) => {
  const { state, calls } = await ux04gFixture(page);
  let release!: () => void;
  await page.route('**/api/availability?**', async (route) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fallback();
  }, { times: 1 });
  await page.goto('/scheduling');
  await page.getByLabel('Fecha', { exact: true }).fill('2026-10-22');
  await page.getByRole('button', { name: 'Buscar disponibilidad', exact: true }).click();
  await expect(page.getByRole('status', { name: '' }).filter({ hasText: 'Calculando disponibilidad' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buscar disponibilidad', exact: true })).toBeDisabled();
  state.availability = 'empty'; release();
  await expect(page.getByText('No hay huecos para los criterios indicados.')).toBeVisible();
  state.availability = 'error';
  await page.getByRole('button', { name: 'Buscar disponibilidad', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Consulta temporalmente no disponible.');
  await expect(page.getByText('No hay huecos para los criterios indicados.')).toHaveCount(0);
  state.availability = 'results';
  await page.getByRole('button', { name: 'Reintentar la disponibilidad' }).click();
  await expect(page.locator('.rs-slots li')).toHaveCount(7);
  expect(calls.filter((call) => call.path === '/api/availability').length).toBeGreaterThanOrEqual(3);
});

test('UX04G respuesta tardía nunca repone intervalos del dentista anterior', async ({ page }) => {
  await ux04gFixture(page);
  let release!: () => void;
  await page.route('**/api/availability?dentistId=7&**', async (route) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fallback();
  });
  await page.goto('/scheduling');
  await page.getByRole('button', { name: 'Buscar disponibilidad', exact: true }).click();
  await expect(page.getByText('Calculando disponibilidad…')).toBeVisible();
  await chooseDentist(page, 'Luis Sintético');
  await page.getByRole('button', { name: 'Buscar disponibilidad', exact: true }).click();
  await expect(page.locator('.rs-slots li')).toHaveCount(7);
  release();
  await expect(page.locator('.rs-result-context')).toContainText('Luis Sintético');
  await expect(page.locator('.rs-result-context')).not.toContainText('Ana Prueba');
});

test('UX04G horarios, descansos múltiples, excepciones y política mantienen valores exactos', async ({ page }) => {
  await ux04gFixture(page);
  await page.goto('/scheduling');
  await expect(page.locator('.rs-policy')).toContainText('73 días');
  await expect(page.locator('.rs-policy')).toContainText('3 h');
  await expect(page.locator('.rs-policy')).toContainText('16 h');
  await expect(page.locator('.rs-policy')).toContainText('Europe/Madrid');
  const clinic = page.locator('section[aria-labelledby="rs-clinic-week"]');
  await expect(clinic.locator('.rs-day')).toHaveCount(7);
  await expect(clinic.getByText('Cerrado', { exact: true })).toHaveCount(2);
  await expect(clinic.locator('.rs-breaks li')).toHaveCount(2);
  await expect(clinic).toContainText('13:00–14:00');
  await expect(clinic).toContainText('16:00–16:15');
  await expect(page.locator('.rs-clinic')).toContainText('Cierre de prueba');
  await expect(page.locator('.rs-clinic')).toContainText('Apertura especial · 10:00–14:00');
  await expect(page.locator('.rs-exceptions')).toContainText('2026-11-05 → 2026-11-06 (todo el día)');
  await expect(page.locator('.rs-exceptions')).toContainText('2026-11-09 · 11:00–12:30');
});

test('UX04G vacíos reales y errores de bloques sin bloquear disponibilidad', async ({ page }) => {
  const { state } = await ux04gFixture(page);
  state.scheduleEmpty = true;
  state.fail = '/api/availability/policy';
  await page.goto('/scheduling');
  await expect(page.getByText('No hay horario semanal registrado.')).toHaveCount(2);
  await expect(page.locator('section[aria-labelledby="rs-policy"]').getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buscar disponibilidad', exact: true })).toBeEnabled();
  state.fail = ''; state.directoryEmpty = true;
  await page.reload();
  await expect(page.getByText('Todavía no hay dentistas registrados.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buscar disponibilidad', exact: true })).toHaveCount(0);
  state.directoryEmpty = false; state.fail = '/api/public/schedule';
  await page.reload();
  await expect(page.getByRole('button', { name: 'Reintentar el directorio de dentistas' })).toBeVisible();
});

test('UX04G Servicios filtra por API, distingue vacíos, conserva decimales y no escribe', async ({ page }) => {
  const { state, calls } = await ux04gFixture(page);
  await page.goto('/services');
  await expect(page.getByRole('article')).toHaveCount(4);
  await expect(page.getByText('999 999 999 999 999,1234', { exact: true })).toBeVisible();
  await expect(page.getByRole('main')).not.toContainText(/MXN|EUR|USD|IVA|\$/);
  await page.getByLabel('Estado', { exact: true }).selectOption('inactive');
  await expect(page.getByRole('article')).toHaveCount(1);
  await expect(page.getByText('Inactivo', { exact: true })).toBeVisible();
  expect(calls.some((call) => call.path === '/api/services' && call.search === '?active=false')).toBe(true);
  state.catalog = 'empty';
  await page.getByLabel('Estado', { exact: true }).selectOption('active');
  await expect(page.getByText('No hay servicios con este estado')).toBeVisible();
  await page.getByRole('button', { name: 'Ver todos los servicios' }).click();
  await expect(page.getByText('El catálogo está vacío')).toBeVisible();
  expect(calls.filter((call) => call.path.startsWith('/api/services') && call.method !== 'GET')).toEqual([]);
  await expect(page.getByRole('main').getByRole('button', { name: /Nuevo|Editar|Eliminar|Reactivar|Desactivar/ })).toHaveCount(0);
});

for (const role of ['OWNER', 'DENTIST']) {
  test(`UX04G ${role} conserva edición de horarios autorizada y composición anterior`, async ({ page }) => {
    const { calls } = await ux04gFixture(page, role);
    await page.goto('/scheduling');
    await expect(page.locator('.reception-scheduling')).toHaveCount(role === 'DENTIST' ? 1 : 0);
    const panel = page.locator('section', { has: page.getByRole('heading', { name: 'Horario de dentistas', exact: true }) });
    await expect(panel.getByRole('button', { name: 'Guardar horario' })).toBeEnabled();
    if (role === 'DENTIST') {
      await expect(panel.getByRole('combobox', { name: /Dentista/ })).toHaveValue('8');
      await expect(panel.getByRole('option', { name: 'Ana Prueba' })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Guardar política' })).toHaveCount(0);
    } else await expect(page.getByRole('button', { name: 'Guardar política' })).toBeVisible();
    await panel.getByRole('button', { name: 'Guardar horario' }).click();
    await expect(panel.getByText('Horario del dentista guardado.')).toBeVisible();
    expect(calls).toContainEqual({ path: `/api/schedules/dentist/${role === 'DENTIST' ? 8 : 7}`, method: 'PUT', search: '' });
    await page.goto('/services');
    await expect(page.locator('.reception-services')).toHaveCount(role === 'DENTIST' ? 1 : 0);
    await expect(page.getByRole('button', { name: 'Nuevo servicio' })).toHaveCount(role === 'OWNER' ? 1 : 0);
  });
}

test('UX04G responsive, teclado, foco, reflujo 200% y almacenamiento solo en memoria', async ({ page }) => {
  await ux04gFixture(page);
  for (const width of [1440, 768, 390, 320, 720]) {
    await page.setViewportSize({ width, height: width === 720 ? 500 : 1000 });
    for (const path of ['/services', '/scheduling']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const controls = page.getByRole('main').locator('input, select, button');
      for (const control of await controls.all()) {
        const box = await control.boundingBox();
        if (box) { expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width); expect(box.height).toBeGreaterThanOrEqual(44); }
      }
    }
  }
  const dentist = page.getByRole('button', { name: 'Cambiar dentista', exact: true });
  await dentist.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Día de la semana', { exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Día siguiente', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Fecha', { exact: true })).toBeFocused();
  expect(await page.getByLabel('Fecha', { exact: true }).evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await page.getByLabel('Fecha', { exact: true }).fill('2026-10-22');
  const duration = page.getByLabel('Duración (min)', { exact: true });
  await duration.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Buscar disponibilidad', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.rs-slots li')).toHaveCount(7);
  expect(await page.evaluate(async () => ({ local: localStorage.length, session: sessionStorage.length, search: location.search, databases: (await indexedDB.databases()).length }))).toEqual({ local: 0, session: 0, search: '', databases: 0 });
});

test('UX04G catálogo con carga y error recuperable, sin confundirlos con vacío', async ({ page }) => {
  const { state } = await ux04gFixture(page);
  let release!: () => void;
  await page.route('**/api/services', async (route) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fallback();
  }, { times: 1 });
  await page.goto('/services');
  await expect(page.getByRole('status', { name: 'Cargando servicios' })).toBeVisible();
  await expect(page.getByText('El catálogo está vacío')).toHaveCount(0);
  state.fail = '/api/services'; release();
  await expect(page.getByRole('alert')).toContainText('Consulta temporalmente no disponible.');
  state.fail = '';
  await page.getByRole('button', { name: 'Reintentar servicios' }).click();
  await expect(page.getByRole('article')).toHaveCount(4);
});

test('UX04G contraste representativo AA y controles de consulta delimitados', async ({ page }) => {
  await ux04gFixture(page);
  for (const path of ['/services', '/scheduling']) {
    await page.goto(path);
    if (path === '/scheduling') await page.getByRole('button', { name: 'Cambiar dentista' }).click();
    await expect(page.getByRole('main').getByRole('combobox').first()).toBeVisible();
    const contrasts = await page.getByRole('main').evaluate((main) => {
      // Resolve CSS Color 4 (including color-mix output) as well as rgb()/rgba().
      const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
      const context = canvas.getContext('2d')!;
      function rgb(value: string) {
        context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1);
        const pixel = context.getImageData(0, 0, 1, 1).data;
        return [pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]! / 255];
      }
      function luminance(value: string) { return rgb(value).slice(0, 3).map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0); }
      const selectors = 'h1,h2,.rc-note,.rc-state,.rc-facts dt,.rc-facts dd,.rs-note,.rs-time,.rs-field label,.reception-button,.rs-tool-scope,.rs-day-state,.rs-date-month,.rs-policy dt,.rs-policy dd,.rs-selected-name,.rs-context-status,.rs-picker-list li,.rs-picker-current,.rs-calendar-block-kind,.rs-calendar-block-time,.rs-calendar-legend,.rs-calendar-axis-body > span';
      return Array.from(main.querySelectorAll<HTMLElement>(selectors)).map((el) => {
        let surface: Element | null = el;
        while (surface && rgb(getComputedStyle(surface).backgroundColor)[3] === 0) surface = surface.parentElement;
        const css = getComputedStyle(el);
        const l1 = luminance(css.color), l2 = luminance(surface ? getComputedStyle(surface).backgroundColor : 'rgb(255, 255, 255)');
        return { text: el.textContent?.slice(0, 70), ratio: (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05), large: parseFloat(css.fontSize) >= 24 };
      });
    });
    for (const item of contrasts) expect(item.ratio, `${path}: ${item.text}`).toBeGreaterThanOrEqual(item.large ? 3 : 4.5);
  }
});

test('UX04G fecha inicial en zona clínica y errores de horario con reintento independiente', async ({ page }) => {
  const { state, calls } = await ux04gFixture(page);
  await page.clock.setFixedTime(new Date('2026-10-20T23:30:00Z'));
  state.fail = '/api/schedules/dentist/7';
  await page.goto('/scheduling');
  await expect(page.getByLabel('Fecha', { exact: true })).toHaveValue('2026-10-21');
  await expect(page.locator('section[aria-labelledby="rs-dentist-week"]').getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buscar disponibilidad', exact: true })).toBeEnabled();
  state.fail = '';
  await page.getByRole('button', { name: 'Reintentar el horario del dentista' }).click();
  await expect(page.locator('section[aria-labelledby="rs-dentist-week"]')).toContainText('10:00–17:00');
  await page.getByLabel('Duración (min)', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Buscar disponibilidad', exact: true }).click();
  expect(calls.filter((call) => call.path === '/api/availability')).toHaveLength(0);
  await expect(page.getByLabel('Duración (min)', { exact: true })).toBeFocused();
});

test('UX04G1 capturas de composición de Horarios y estados', async ({ page }) => {
  const stage = process.env.UX04G1_CAPTURE_STAGE;
  test.skip(!stage, 'Capturas UX-04G.1 opt-in, sin sobrescribir evidencia UX-04G.');
  const { state } = await ux04gFixture(page);
  let eventsEmpty = false;
  await page.route(/\/api\/schedules\/.*(?:exceptions|time-off)$/, async (route) => {
    if (eventsEmpty) await route.fulfill({ json: [] });
    else await route.fallback();
  });
  const folder = `/tmp/opencode/ux04g1/${stage}`;
  await mkdir(folder, { recursive: true });
  for (const width of [1440, 768, 390, 720, 320]) {
    await page.setViewportSize({ width, height: width === 720 ? 500 : 1000 });
    state.availability = 'results'; state.scheduleEmpty = false; eventsEmpty = false;
    await page.goto('/scheduling');
    await expect(page.getByText('10:00–17:00').first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    async function capture(name: string) {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name).toBe(true);
      await page.screenshot({ path: `${folder}/${name}-${width}.png`, fullPage: true });
    }
    await capture('horarios-completa');
    await page.locator('.rs-detail').screenshot({ path: `${folder}/comparacion-semanal-${width}.png` });
    await page.locator('.rs-exceptions').screenshot({ path: `${folder}/excepciones-ausencias-${width}.png` });
    const policyRegion = page.locator('section[aria-labelledby="rs-policy"]');
    await policyRegion.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const quickNavigation = page.getByRole('navigation', { name: 'Navegación rápida' });
    if (await quickNavigation.isVisible()) {
      const zone = (await policyRegion.locator('.rs-timezone').boundingBox())!;
      expect(zone.y + zone.height).toBeLessThan((await quickNavigation.boundingBox())!.y);
    }
    await policyRegion.screenshot({ path: `${folder}/politica-${width}.png` });
    await page.getByLabel('Fecha', { exact: true }).fill('2026-10-22');
    let release: (() => void) | undefined;
    if (stage === 'after') await page.route('**/api/availability?**', async (route) => {
      await new Promise<void>((resolve) => { release = resolve; });
      await route.fallback();
    }, { times: 1 });
    await page.getByRole('button', { name: 'Buscar disponibilidad', exact: true }).click();
    if (stage === 'after') {
      await expect(page.getByText('Calculando disponibilidad…')).toBeVisible();
      await capture('disponibilidad-cargando'); release!();
    }
    await expect(page.getByText('09:00–09:30', { exact: true })).toBeVisible();
    await capture('disponibilidad-resultados');
    state.availability = 'empty';
    await page.getByLabel('Fecha', { exact: true }).fill('2026-10-23');
    await page.getByRole('button', { name: 'Buscar disponibilidad', exact: true }).click();
    await expect(page.getByText('No hay huecos para los criterios indicados.')).toBeVisible();
    await capture('disponibilidad-vacia');
    state.availability = 'error';
    await page.getByRole('button', { name: 'Buscar disponibilidad', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Consulta temporalmente no disponible.');
    await capture('disponibilidad-error');
    state.scheduleEmpty = true; eventsEmpty = true;
    await page.reload();
    await expect(page.getByText('No hay horario semanal registrado.')).toHaveCount(2);
    await expect(page.getByText('Sin ausencias registradas.')).toBeVisible();
    await capture('horarios-vacios');
  }
});

test('UX04G3 semana protagonista, directorio lateral y registros conservados', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { calls } = await ux04gFixture(page);
  await page.goto('/scheduling');
  const tool = page.getByRole('region', { name: 'Consultar disponibilidad', exact: true });
  await expect(tool.getByRole('combobox')).toHaveCount(0);
  const directory = page.getByRole('region', { name: 'Profesional en consulta', exact: true });
  await expect(directory.getByRole('button', { name: 'Cambiar dentista' })).toBeVisible();
  const formControls = tool.locator('.rs-search input,.rs-search select,.rs-search button');
  const bottoms = await Promise.all((await formControls.all()).map(async (el) => { const box = (await el.boundingBox())!; return box.y + box.height; }));
  expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThan(2);
  const clinic = page.getByRole('region', { name: 'Horario de la clínica', exact: true });
  const dentist = page.getByRole('region', { name: 'Horario semanal', exact: true });
  const c = (await clinic.boundingBox())!, d = (await dentist.boundingBox())!;
  const master = (await directory.boundingBox())!;
  expect(master.y + master.height).toBeLessThan(d.y);
  await expect(dentist.locator('.rs-calendar-day')).toHaveCount(7);
  const columns = await dentist.locator('.rs-calendar-day').evaluateAll((items) => items.map((item) => item.getBoundingClientRect().y));
  expect(Math.max(...columns) - Math.min(...columns)).toBeLessThan(1);
  expect(d.y + d.height).toBeLessThan((await tool.boundingBox())!.y);
  expect(c.y).toBeGreaterThan((await tool.boundingBox())!.y);
  expect(c.height).toBeLessThan(550);
  await expect(page.locator('.rs-exceptions > section')).toHaveCount(2);
  const timeOff = page.getByRole('region', { name: 'Ausencias del dentista', exact: true });
  await expect(timeOff).toContainText('Ana Prueba');
  await expect(timeOff.getByText('Días completos', { exact: true })).toBeVisible();
  await expect(timeOff.getByText('Franja parcial', { exact: true })).toBeVisible();
  await expect(timeOff).toContainText('2026-11-05 → 2026-11-06 (todo el día)');
  await expect(timeOff).toContainText('2026-11-09 · 11:00–12:30');
  await expect(timeOff).toContainText('Ausencia sintética');
  await expect(timeOff).toContainText('Bloqueo parcial de prueba');
  for (const closed of await clinic.locator('[data-state="closed"]').all()) await expect(closed).toContainText('Cerrado');
  expect(calls.filter((call) => call.path.startsWith('/api/schedules') && call.method !== 'GET')).toEqual([]);
});

async function captureG2(page: Page, name: string) {
  if (process.env.UX04G2_CAPTURE !== '1') return;
  const folder = '/tmp/opencode/ux04g2/after';
  await mkdir(folder, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${folder}/${name}.png`, fullPage: true });
  if (name.startsWith('selector-abierto-') || name.startsWith('profesional-b-')) {
    const context = page.locator('.rs-detail');
    await context.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await context.screenshot({ path: `${folder}/contexto-${name}.png` });
  }
  if (name.startsWith('disponibilidad-b-')) {
    const results = page.locator('.rs-results');
    await results.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const navigation = page.getByRole('navigation', { name: 'Navegación rápida' });
    if (await navigation.isVisible()) {
      const box = (await results.boundingBox())!;
      expect(box.y + box.height).toBeLessThan((await navigation.boundingBox())!.y);
    }
    await results.screenshot({ path: `${folder}/resultados-${name}.png` });
  }
}

for (const identical of [false, true]) {
  test(`UX04G2 identidad y contexto sincronizado con horarios ${identical ? 'idénticos' : 'diferentes'}`, async ({ page }) => {
    const { calls } = await ux04gFixture(page);
    if (identical) await page.route('**/api/schedules/dentist/8', (route) => route.fulfill({ json: {
      dentistId: 8, timezone, days: days.map((day) => ({ ...day, startTime: day.open ? '10:00:00' : null, endTime: day.open ? '17:00:00' : null })),
    } }));
    for (const width of [1440, 768, 390, 720, 320]) {
      await page.setViewportSize({ width, height: width === 720 ? 500 : 1000 });
      await page.goto('/scheduling');
      const context = page.locator('.reception-scheduling');
      const week = page.locator('[aria-labelledby="rs-dentist-week"]');
      await expect(week).toContainText('10:00–17:00');
      await expect(context.locator('.rs-selected-name')).toHaveText('Ana Prueba');
      await expect(context.locator('.rs-context-status')).toHaveText('Horario de Ana Prueba cargado.');
      const contextBox = (await week.boundingBox())!;
      expect(contextBox.y).toBeGreaterThan((await page.getByRole('heading', { level: 1 }).boundingBox())!.y);
      expect(contextBox.y + contextBox.height).toBeLessThan((await page.locator('.rs-availability').boundingBox())!.y);
      const prefix = `${identical ? 'identicos' : 'diferentes'}-${width}`;
      await captureG2(page, `inicial-${prefix}`);
      await captureG2(page, `profesional-a-${prefix}`);
      const previousWeek = await week.locator('.rs-week').innerText();
      await page.getByLabel('Fecha', { exact: true }).fill('2026-10-22');
      await page.getByLabel('Duración (min)', { exact: true }).fill('45');
      await page.getByRole('button', { name: 'Buscar disponibilidad', exact: true }).click();
      await expect(page.locator('.rs-slots li')).toHaveCount(7);
      const toggle = page.getByRole('button', { name: 'Cambiar dentista' });
      if (await toggle.isVisible()) await toggle.click();
      else await page.getByRole('combobox', { name: 'Buscar dentista' }).focus();
      await expect(page.getByRole('combobox', { name: 'Buscar dentista' })).toBeFocused();
      await captureG2(page, `selector-abierto-${prefix}`);
      // Keyboard selection: an editable search does not itself switch the professional.
      const input = page.getByRole('combobox', { name: 'Buscar dentista' });
      await input.fill('sintetico');
      await expect(context.locator('.rs-selected-name')).toHaveText('Ana Prueba');
      await input.press('ArrowDown');
      await expect(input).toHaveAttribute('aria-activedescendant', 'rs-professional-8');
      await input.press('Enter');
      await expect(context.locator('.rs-selected-name')).toHaveText('Luis Sintético');
      await expect(await toggle.isVisible() ? toggle : input).toBeFocused();
      await expect(page.locator('.rs-slots')).toHaveCount(0);
      await expect(page.getByLabel('Fecha', { exact: true })).toHaveValue('2026-10-22');
      await expect(page.getByLabel('Duración (min)', { exact: true })).toHaveValue('45');
      await expect(week.getByRole('heading', { level: 2 })).toHaveText('Horario semanal');
      await expect(week).toContainText(identical ? '10:00–17:00' : '11:00–17:00');
      await expect(context.locator('.rs-context-status')).toHaveText('Horario de Luis Sintético cargado.');
      if (identical) expect(await week.locator('.rs-week').innerText()).toBe(previousWeek);
      for (const id of ['rs-dentist-exceptions', 'rs-dentist-timeoff']) await expect(page.locator(`[aria-labelledby="${id}"]`)).toContainText('Luis Sintético');
      await expect(page.locator('[aria-labelledby="rs-policy"]')).not.toContainText(/Ana Prueba|Luis Sintético/);
      await captureG2(page, `profesional-b-${prefix}`);
      await page.getByRole('button', { name: 'Buscar disponibilidad', exact: true }).click();
      await expect(page.locator('.rs-slots li').first()).toHaveText('09:00–09:45');
      await expect(page.locator('.rs-result-context')).toContainText('Luis Sintético · 22 de octubre de 2026');
      await captureG2(page, `disponibilidad-b-${prefix}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(calls.filter((call) => call.path === '/api/availability').at(-1)?.search).toBe('?dentistId=8&from=2026-10-22&duration=45');
    }
    expect(calls.filter((call) => !call.path.startsWith('/api/auth/') && call.method !== 'GET')).toEqual([]);
  });
}

test('UX04G2 único profesional y búsqueda escalable sin perder identidad', async ({ page }) => {
  await ux04gFixture(page);
  let count = 1;
  await page.route('**/api/public/schedule', (route) => route.fulfill({ json: { timezone, days, exceptions: [],
    dentists: Array.from({ length: count }, (_, index) => ({ dentistId: index + 7, firstName: index === 0 ? 'Ana' : `Profesional ${index}`, lastName: index === 0 ? 'Prueba' : 'Sintético', days: [] })),
  } }));
  await page.goto('/scheduling');
  const context = page.locator('.reception-scheduling');
  await expect(page.locator('.rs-directory')).toContainText('Único dentista disponible');
  await expect(page.getByRole('button', { name: 'Cambiar dentista' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Buscar disponibilidad', exact: true })).toBeEnabled();
  await captureG2(page, 'unico-dentista');
  count = 180;
  await page.reload();
  await page.getByRole('button', { name: 'Cambiar dentista' }).click();
  const input = page.getByRole('combobox', { name: 'Buscar dentista' });
  await expect(page.getByRole('option')).toHaveCount(20);
  expect((await page.getByRole('listbox').boundingBox())!.height).toBeLessThanOrEqual(310);
  await input.fill('ninguno');
  await expect(page.getByRole('status').filter({ hasText: 'No hay dentistas que coincidan' })).toBeVisible();
  await expect(context.locator('.rs-selected-name')).toHaveText('Ana Prueba');
  await input.press('Escape');
  await expect(page.getByRole('button', { name: 'Cambiar dentista' })).toBeFocused();
  await page.getByRole('button', { name: 'Cambiar dentista' }).click();
  await input.fill('Profesional 179');
  await expect(page.getByRole('option')).toHaveCount(1);
  await input.press('ArrowDown'); await input.press('Enter');
  await expect(context.locator('.rs-selected-name')).toHaveText('Profesional 179 Sintético');
  await captureG2(page, 'directorio-numeroso');
});

test('UX04G2 cambios rápidos no mezclan semana, descansos, excepciones, ausencias ni disponibilidad tardíos', async ({ page }) => {
  await ux04gFixture(page);
  const releases = new Map<string, () => void>();
  await page.route(/\/api\/schedules\/dentist\/(7|8)(\/(exceptions|time-off))?$/, async (route) => {
    const path = new URL(route.request().url()).pathname;
    await new Promise<void>((resolve) => releases.set(path, resolve));
    const id = path.includes('/7') ? 7 : 8;
    const who = id === 7 ? 'A anterior' : 'B actual';
    await route.fulfill({ json: path.endsWith('exceptions') ? [{ date: '2026-11-04', closed: true, reason: `Excepción ${who}` }]
      : path.endsWith('time-off') ? [{ id, startDate: '2026-11-05', endDate: '2026-11-05', allDay: true, reason: `Ausencia ${who}` }]
        : { dentistId: id, timezone, days: [{ ...days[0], startTime: id === 7 ? '08:00:00' : '11:00:00', breaks: [{ startTime: id === 7 ? '09:15:00' : '12:15:00', endTime: id === 7 ? '09:45:00' : '12:45:00' }] }] } });
  });
  let releaseAvailability!: () => void;
  await page.route('**/api/availability?dentistId=7&**', async (route) => {
    await new Promise<void>((resolve) => { releaseAvailability = resolve; });
    await route.fallback();
  });
  await page.goto('/scheduling');
  const context = page.locator('.reception-scheduling');
  await expect(context.locator('.rs-context-status')).toContainText('Consultando la información de Ana Prueba');
  await page.getByLabel('Fecha', { exact: true }).fill('2026-10-22');
  await page.getByRole('button', { name: 'Buscar disponibilidad', exact: true }).click();
  await expect(page.getByText('Calculando disponibilidad…')).toBeVisible();
  await chooseDentist(page, 'Luis Sintético');
  await expect(context.locator('.rs-context-status')).toContainText('Consultando la información de Luis Sintético');
  await expect(page.locator('[aria-labelledby="rs-dentist-week"] .rs-day')).toHaveCount(0);
  await chooseDentist(page, 'Ana Prueba');
  await chooseDentist(page, 'Luis Sintético');
  await expect(context.locator('.rs-selected-name')).toHaveText('Luis Sintético');
  await expect(page.locator('.rs-slots')).toHaveCount(0);
  await captureG2(page, 'cambio-pendiente');
  async function releaseDentist(id: number) {
    const paths = ['', '/exceptions', '/time-off'].map((suffix) => `/api/schedules/dentist/${id}${suffix}`);
    await expect.poll(() => paths.every((path) => releases.has(path))).toBe(true);
    const responses = paths.map((path) => page.waitForResponse((response) => new URL(response.url()).pathname === path));
    paths.forEach((path) => releases.get(path)!());
    await Promise.all(responses);
  }
  await releaseDentist(8);
  await expect(context.locator('.rs-context-status')).toHaveText('Horario de Luis Sintético cargado.');
  await expect(page.locator('[aria-labelledby="rs-dentist-week"]')).toContainText('12:15–12:45');
  await expect(page.locator('[aria-labelledby="rs-dentist-exceptions"]')).toContainText('Excepción B actual');
  await expect(page.locator('[aria-labelledby="rs-dentist-timeoff"]')).toContainText('Ausencia B actual');
  await page.getByRole('button', { name: 'Buscar disponibilidad', exact: true }).click();
  await expect(page.locator('.rs-slots li')).toHaveCount(7);
  await releaseDentist(7);
  const lateAvailability = page.waitForResponse((response) => response.url().includes('/api/availability?dentistId=7'));
  releaseAvailability(); await lateAvailability;
  await expect(page.locator('.rs-result-context')).toContainText('Luis Sintético');
  await expect(page.locator('.rs-selected-name')).toHaveText('Luis Sintético');
  await expect(page.locator('.reception-scheduling')).not.toContainText(/A anterior|09:15–09:45/);
  await expect(page.locator('[aria-labelledby="rs-dentist-exceptions"]')).toContainText('Excepción B actual');
  await captureG2(page, 'respuestas-tardias-aisladas');
});

test('UX04G2 al pasar de A cargado a B pendiente desaparecen los datos anteriores', async ({ page }) => {
  await ux04gFixture(page);
  const releases: (() => void)[] = [];
  await page.route(/\/api\/schedules\/dentist\/8(\/(exceptions|time-off))?$/, async (route) => {
    await new Promise<void>((resolve) => releases.push(resolve)); await route.fallback();
  });
  await page.goto('/scheduling');
  const week = page.locator('[aria-labelledby="rs-dentist-week"]');
  const exceptions = page.locator('[aria-labelledby="rs-dentist-exceptions"]');
  const timeOff = page.locator('[aria-labelledby="rs-dentist-timeoff"]');
  await expect(week).toContainText('10:00–17:00');
  await expect(exceptions).toContainText('Excepción del profesional');
  await expect(timeOff).toContainText('Ausencia sintética');
  await chooseDentist(page, 'Luis Sintético');
  await expect(page.locator('.rs-selected-name')).toHaveText('Luis Sintético');
  await expect(week).not.toContainText('10:00–17:00');
  await expect(week.locator('.rs-breaks')).toHaveCount(0);
  await expect(exceptions).not.toContainText('Excepción del profesional');
  await expect(timeOff).not.toContainText('Ausencia sintética');
  for (const block of [week, exceptions, timeOff]) await expect(block.getByRole('status')).toBeVisible();
  await captureG2(page, 'b-pendiente-sin-datos-de-a');
  await expect.poll(() => releases.length).toBe(3);
  releases.forEach((release) => release());
  await expect(week).toContainText('11:00–17:00');
  await expect(exceptions).toContainText('Excepción del profesional');
  await expect(timeOff).toContainText('Ausencia sintética');
});

test('UX04G2 carga y error de directorio, error parcial y profesional sin horario', async ({ page }) => {
  const { state } = await ux04gFixture(page);
  let release!: () => void;
  await page.route('**/api/public/schedule', async (route) => {
    await new Promise<void>((resolve) => { release = resolve; }); await route.fallback();
  }, { times: 1 });
  await page.goto('/scheduling');
  const context = page.locator('.rs-directory');
  await expect(context.getByRole('status', { name: 'Cargando el directorio de dentistas' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buscar disponibilidad', exact: true })).toHaveCount(0);
  await captureG2(page, 'directorio-cargando');
  state.fail = '/api/public/schedule'; release();
  await expect(context.getByRole('alert')).toBeVisible();
  await captureG2(page, 'directorio-error');
  state.fail = '/api/schedules/dentist/7/exceptions';
  await context.getByRole('button', { name: 'Reintentar el directorio de dentistas' }).click();
  await expect(page.locator('.rs-context-status')).toContainText('No se pudo cargar toda su información');
  await expect(page.locator('[aria-labelledby="rs-dentist-exceptions"]').getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buscar disponibilidad', exact: true })).toBeEnabled();
  await captureG2(page, 'profesional-error-parcial');
  state.fail = ''; state.scheduleEmpty = true;
  await chooseDentist(page, 'Luis Sintético');
  await expect(page.locator('[aria-labelledby="rs-dentist-week"]')).toContainText('No hay horario semanal registrado.');
  await expect(page.locator('.rs-selected-name')).toHaveText('Luis Sintético');
  await expect(page.locator('[aria-labelledby="rs-dentist-timeoff"]')).toContainText('Ausencia sintética');
  await captureG2(page, 'profesional-sin-horario');
});

test('UX04G3 evidencia comparable maestro-detalle', async ({ page }) => {
  test.setTimeout(120_000);
  const stage = process.env.UX04G3_CAPTURE_STAGE;
  test.skip(!stage, 'Capturas UX-04G.3 opt-in.');
  const { state } = await ux04gFixture(page);
  let identical = false;
  await page.route('**/api/schedules/dentist/8', async (route) => {
    if (identical) await route.fulfill({ json: { dentistId: 8, timezone, days: days.map((day) => ({ ...day, startTime: day.open ? '10:00:00' : null, endTime: day.open ? '17:00:00' : null })) } });
    else await route.fallback();
  });
  const folder = `/tmp/opencode/ux04g3/${stage}`;
  await mkdir(folder, { recursive: true });
  for (const width of [1440, 768, 390, 720, 320]) {
    await page.setViewportSize({ width, height: width === 720 ? 500 : 1000 });
    state.scheduleEmpty = false; state.availability = 'results'; state.fail = ''; identical = false;
    await page.goto('/scheduling');
    await expect(page.locator('[aria-labelledby="rs-dentist-week"]')).toContainText('10:00–17:00');
    async function capture(name: string) {
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `${folder}/${name}-${width}.png`, fullPage: true });
    }
    await capture('inicial-profesional-a');
    await chooseDentist(page, 'Luis Sintético');
    await expect(page.locator('[aria-labelledby="rs-dentist-week"]')).toContainText('11:00–17:00');
    await capture('profesional-b');
    await page.getByLabel('Fecha', { exact: true }).fill('2026-10-22');
    await page.getByRole('button', { name: 'Buscar disponibilidad', exact: true }).click();
    await expect(page.locator('.rs-slots li')).toHaveCount(7);
    await capture('disponibilidad');
    identical = true; await page.reload();
    await chooseDentist(page, 'Luis Sintético');
    await expect(page.locator('[aria-labelledby="rs-dentist-week"]')).toContainText('10:00–17:00');
    await capture('identicos-profesional-b');
    state.scheduleEmpty = true; await page.reload();
    await expect(page.getByText('No hay horario semanal registrado.')).toHaveCount(2);
    await capture('sin-horario');
    state.fail = '/api/public/schedule'; await page.reload();
    await expect(page.getByRole('button', { name: 'Reintentar el directorio de dentistas' })).toBeVisible();
    await capture('error-directorio');
  }
});

async function captureG3(page: Page, name: string, selector?: string) {
  if (process.env.UX04G3_CAPTURE_STAGE !== 'after') return;
  const folder = '/tmp/opencode/ux04g3/after'; await mkdir(folder, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (selector) {
    const region = page.locator(selector);
    await region.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await region.screenshot({ path: `${folder}/${name}.png` });
  } else await page.screenshot({ path: `${folder}/${name}.png`, fullPage: true });
}

test('UX04G3 directorios de1,5,20 y180 con DOM acotado, paginación y búsqueda', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { calls } = await ux04gFixture(page);
  let count = 1;
  await page.route('**/api/public/schedule', (route) => route.fulfill({ json: { timezone, days, exceptions: [],
    dentists: Array.from({ length: count }, (_, index) => ({ dentistId: index + 7,
      firstName: index === 0 ? 'Ana' : index === 1 ? 'Luis' : `Profesional ${index}`,
      lastName: index === 0 ? 'Prueba' : 'Sintético', days: [] })),
  } }));
  const input = page.getByRole('combobox', { name: 'Buscar dentista' });
  for (const size of [1, 5, 20, 180]) {
    count = size; await page.goto('/scheduling');
    if (size === 1) {
      await expect(page.locator('.rs-selected-name')).toHaveText('Ana Prueba');
      await expect(page.getByRole('button', { name: 'Cambiar dentista' })).toHaveCount(0);
      continue;
    }
    await page.getByRole('button', { name: 'Cambiar dentista' }).click();
    await expect(page.getByRole('option')).toHaveCount(Math.min(20, size));
    await expect(page.getByRole('option', { selected: true })).toContainText('Ana Prueba');
    await expect(page.locator('.rs-selected-name')).toHaveText('Ana Prueba');
    if (size >= 20) expect(await page.getByRole('listbox').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    expect((await page.getByRole('listbox').boundingBox())!.height).toBeLessThanOrEqual(310);
    await captureG3(page, `directorio-${size}-1440`);
  }
  await page.getByRole('button', { name: 'Siguientes', exact: true }).click();
  await expect(page.getByRole('option').first()).toHaveAttribute('aria-posinset', '21');
  await expect(page.getByRole('option').first()).toHaveAttribute('aria-setsize', '180');
  await page.getByRole('button', { name: 'Anteriores', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Anteriores', exact: true })).toBeDisabled();
  await input.fill('Profesional 179'); await input.press('ArrowDown'); await input.press('Enter');
  await expect(page.locator('.rs-selected-name')).toHaveText('Profesional 179 Sintético');
  await page.getByRole('button', { name: 'Cambiar dentista' }).click();
  await expect(page.getByRole('option', { selected: true })).toHaveText('Profesional 179 Sintético Seleccionado');
  await expect(page.getByRole('button', { name: 'Siguientes', exact: true })).toBeDisabled();
  await input.fill('zzzz');
  await expect(page.getByRole('option')).toHaveCount(0);
  await expect(page.locator('.rs-directory').getByRole('status')).toContainText('No hay dentistas que coincidan');
  await expect(page.locator('.rs-selected-name')).toHaveText('Profesional 179 Sintético');
  await captureG3(page, 'directorio-busqueda-vacia');
  expect(calls.filter((call) => !call.path.startsWith('/api/auth/') && call.method !== 'GET')).toEqual([]);
});

test('UX04G3 escala real, varios descansos, estados y recuperación contextual', async ({ page }) => {
  const { state } = await ux04gFixture(page);
  let release!: () => void;
  await page.route('**/api/schedules/dentist/7', async (route) => {
    await new Promise<void>((resolve) => { release = resolve; }); await route.fallback();
  }, { times: 1 });
  await page.goto('/scheduling');
  const week = page.locator('[aria-labelledby="rs-dentist-week"]');
  await expect(week.getByRole('status')).toBeVisible(); await captureG3(page, 'semana-cargando');
  state.fail = '/api/schedules/dentist/7'; release();
  await expect(week.getByRole('alert')).toBeVisible(); await captureG3(page, 'semana-error');
  state.fail = '';
  await week.getByRole('button', { name: 'Reintentar el horario del dentista' }).click();
  await expect(week.locator('.rs-day')).toHaveCount(7);
  const monday = week.locator('.rs-day').first();
  await expect(monday).toContainText('10:00–17:00');
  await expect(monday.locator('.rs-breaks li')).toHaveCount(2);
  await expect(monday.locator('.rs-calendar-break')).toHaveCount(2);
  const positions = await monday.evaluate((row) => {
    const work = row.querySelector<HTMLElement>('.rs-calendar-work')!;
    const breaks = [...row.querySelectorAll<HTMLElement>('.rs-calendar-break')];
    return { start: parseFloat(work.style.top), height: parseFloat(work.style.height), breaks: breaks.map((item) => ({ start: parseFloat(item.style.top), height: parseFloat(item.style.height) })) };
  });
  expect(positions.start).toBeCloseTo(40); expect(positions.height).toBeCloseTo(120);
  expect(positions.breaks[0]!.start).toBeCloseTo(160);
  expect(positions.breaks[1]!.height).toBeCloseTo(10);
  await expect(week.locator('[data-state="closed"]')).toHaveCount(2);
  await captureG3(page, 'semana-varios-intervalos-descansos', '[aria-labelledby="rs-dentist-week"]');
  await captureG3(page, 'excepciones-ausencias', '.rs-exceptions');
  await page.getByRole('button', { name: 'Buscar disponibilidad', exact: true }).click();
  await expect(page.locator('.rs-slots li')).toHaveCount(7);
  await captureG3(page, 'disponibilidad-resultados', '.rs-availability');
  await chooseDentist(page, 'Luis Sintético');
  await expect(page.locator('.rs-results')).toContainText('El profesional cambió. Pulsa Buscar');
  await expect(page.locator('.rs-slots')).toHaveCount(0);
  await page.route(/\/api\/schedules\/dentist\/8\/(exceptions|time-off)$/, (route) => route.fulfill({ json: [] }));
  await page.reload(); await chooseDentist(page, 'Luis Sintético');
  await expect(page.locator('.rs-exceptions')).toContainText('Sin excepciones registradas.');
  await expect(page.locator('.rs-exceptions')).toContainText('Sin ausencias registradas.');
  expect((await page.locator('.rs-exceptions').boundingBox())!.height).toBeLessThan(120);
  await captureG3(page, 'excepciones-ausencias-vacias');
  state.directoryEmpty = true; await page.reload();
  await expect(page.getByText('Todavía no hay dentistas registrados.')).toBeVisible();
  await captureG3(page, 'directorio-vacio');
});

test('UX04G3 móvil390 cambia de ficha desde disponibilidad y muestra la nueva semana', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await ux04gFixture(page); await page.goto('/scheduling');
  const week = page.locator('[aria-labelledby="rs-dentist-week"]');
  await expect(week.locator('.rs-day')).toHaveCount(1);
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page.locator('.rs-selected-name')).toHaveText('Ana Prueba');
  await captureG3(page, 'movil390-inicial');
  await captureG3(page, 'movil390-semana-a', '[aria-labelledby="rs-dentist-week"]');
  await page.getByRole('button', { name: 'Buscar disponibilidad', exact: true }).click();
  await expect(page.locator('.rs-slots li')).toHaveCount(7);
  await page.locator('.rs-results').evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const toggle = page.getByRole('button', { name: 'Cambiar dentista' });
  await expect(toggle).toBeVisible(); expect((await toggle.boundingBox())!.y).toBeLessThan(100);
  await toggle.click();
  await expect(page.getByRole('combobox', { name: 'Buscar dentista' })).toBeFocused();
  await captureG3(page, 'movil390-selector', '.rs-directory');
  const input = page.getByRole('combobox', { name: 'Buscar dentista' });
  await input.fill('sintetico'); await input.press('ArrowDown'); await input.press('Enter');
  await expect(toggle).toBeFocused();
  await expect(week).toContainText('11:00–17:00');
  await expect(page.locator('.rs-selected-name')).toHaveText('Luis Sintético');
  const name = (await week.getByRole('heading', { level: 2 }).boundingBox())!;
  expect(name.y).toBeGreaterThan((await page.locator('.rs-directory').boundingBox())!.y + (await page.locator('.rs-directory').boundingBox())!.height);
  expect(name.y).toBeLessThan(300);
  await expect(page.locator('.rs-slots')).toHaveCount(0);
  await captureG3(page, 'movil390-profesional-b');
  if (process.env.UX04G3_CAPTURE_STAGE === 'after') await page.screenshot({ path: '/tmp/opencode/ux04g3/after/movil390-cambio-viewport.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('UX04G4 capturas comparables de calendario semanal', async ({ page }) => {
  test.setTimeout(120_000);
  const stage = process.env.UX04G4_CAPTURE_STAGE;
  test.skip(!stage, 'Evidencia G.4 opt-in, sin sobrescribir iteraciones anteriores.');
  const { state } = await ux04gFixture(page);
  let variant = 'divided';
  await page.route('**/api/schedules/dentist/7', (route) => route.fulfill({ json: {
    dentistId: 7, timezone, days: variant === 'empty' ? [] : days.map((day, index) => ({ ...day,
      startTime: day.open ? index === 1 ? '14:00:00' : '09:00:00' : null,
      endTime: day.open ? index === 1 ? '16:00:00' : '18:00:00' : null,
      breaks: variant === 'continuous' ? [] : day.breaks,
    })),
  } }));
  const folder = `/tmp/opencode/ux04g4/${stage}`; await mkdir(folder, { recursive: true });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    variant = 'divided'; state.availability = 'results';
    await page.goto('/scheduling');
    const week = page.locator('[aria-labelledby="rs-dentist-week"]');
    await expect(week).toContainText('09:00–18:00');
    async function capture(name: string, selector?: string) {
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (selector) {
        const region = page.locator(selector); await region.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await region.screenshot({ path: `${folder}/${name}-${width}.png` });
      } else await page.screenshot({ path: `${folder}/${name}-${width}.png`, fullPage: true });
    }
    await capture('calendario-completo');
    await capture('jornada-dividida', '[aria-labelledby="rs-dentist-week"]');
    await capture('excepciones-ausencias', '.rs-exceptions');
    await page.getByLabel('Fecha', { exact: true }).fill('2026-10-22');
    await page.locator('.rs-search button[type="submit"]').click();
    await expect(page.locator('.rs-slots li')).toHaveCount(7);
    await capture('disponibilidad-resultados', '.rs-availability');
    state.availability = 'empty';
    await page.getByLabel('Fecha', { exact: true }).fill('2026-10-23');
    await page.locator('.rs-search button[type="submit"]').click();
    await expect(page.getByText('No hay huecos para los criterios indicados.')).toBeVisible();
    await capture('disponibilidad-vacia', '.rs-availability');
    await chooseDentist(page, 'Luis Sintético');
    await expect(week).toContainText('11:00–17:00');
    await capture('cambio-profesional-b');
    variant = 'continuous'; await page.reload();
    await expect(week).toContainText('09:00–18:00');
    await capture('jornada-continua');
    variant = 'empty'; await page.reload();
    await expect(week).toContainText('No hay horario semanal registrado.');
    await capture('sin-jornada');
  }
});

async function captureG4(page: Page, name: string, selector?: string) {
  if (process.env.UX04G4_CAPTURE_STAGE !== 'after') return;
  const folder = '/tmp/opencode/ux04g4/after'; await mkdir(folder, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (selector) {
    const region = page.locator(selector); await region.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await region.screenshot({ path: `${folder}/${name}.png` });
  } else await page.screenshot({ path: `${folder}/${name}.png`, fullPage: true });
}

test('UX04G4 proporción vertical real, alineación, descansos y ninguna fecha ni reserva', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { calls } = await ux04gFixture(page);
  await page.route('**/api/schedules/dentist/7', (route) => route.fulfill({ json: { dentistId: 7, timezone,
    days: days.map((day, index) => ({ ...day, startTime: day.open ? '09:00:00' : null,
      endTime: day.open ? index === 0 ? '17:00:00' : index === 1 ? '11:00:00' : '18:00:00' : null,
      breaks: index === 2 ? [{ startTime: '12:00:00', endTime: '13:00:00' }, { startTime: '15:00:00', endTime: '15:15:00' }] : [],
    })),
  } }));
  await page.goto('/scheduling');
  const calendar = page.locator('.rs-calendar');
  const columns = calendar.locator('.rs-calendar-day');
  await expect(columns).toHaveCount(7);
  expect(await columns.locator('h3').allTextContents()).toEqual(['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']);
  const a = (await columns.nth(0).locator('.rs-calendar-work').boundingBox())!;
  const b = (await columns.nth(1).locator('.rs-calendar-work').boundingBox())!;
  expect(a.height / b.height).toBeCloseTo(4); expect(a.y).toBeCloseTo(b.y);
  expect(a.height).toBeCloseTo(320); expect(b.height).toBeCloseTo(80);
  await expect(columns.nth(0).locator('.rs-calendar-break')).toHaveCount(0);
  await expect(columns.nth(2).locator('.rs-calendar-break')).toHaveCount(2);
  await expect(columns.nth(2).locator('.rs-calendar-work')).toHaveCount(3);
  for (const column of await columns.all()) {
    const plot = (await column.locator('.rs-calendar-plot').boundingBox())!;
    const blocks = await column.locator('.rs-calendar-block').all();
    let end = plot.y;
    for (const block of blocks) {
      const box = (await block.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(end - .1);
      expect(box.y + box.height).toBeLessThanOrEqual(plot.y + plot.height + .1);
      end = box.y + box.height;
    }
    await expect(column.locator('.rs-calendar-plot button,.rs-calendar-plot [tabindex],.rs-calendar-plot a')).toHaveCount(0);
  }
  // The dated exception must not close the habitual Wednesday or alter the calendar.
  await expect(page.locator('[aria-labelledby="rs-dentist-exceptions"]')).toContainText('2026-11-04');
  await expect(columns.nth(2)).toHaveAttribute('data-state', 'open');
  await expect(calendar.locator('time')).toHaveCount(0);
  expect(calls.filter((call) => call.path === '/api/availability')).toHaveLength(0);
  expect(calls.filter((call) => !call.path.startsWith('/api/auth/') && call.method !== 'GET')).toEqual([]);
  await captureG4(page, 'proporcion-dos-ocho-horas-1440', '[aria-labelledby="rs-dentist-week"]');
});

test('UX04G4 madrugada y final del día no se recortan ni pierden precisión', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ux04gFixture(page);
  await page.route('**/api/schedules/dentist/7', (route) => route.fulfill({ json: { dentistId: 7, timezone, days: [
    { dayOfWeek: 1, open: true, startTime: '00:15:00', endTime: '02:15:00', breaks: [] },
    { dayOfWeek: 2, open: true, startTime: '21:59:59.5', endTime: '23:59:59.5', breaks: [] },
  ] } }));
  await page.goto('/scheduling');
  const calendar = page.locator('.rs-calendar');
  await expect(calendar.locator('.rs-calendar-axis')).toContainText('00:00');
  await expect(calendar.locator('.rs-calendar-axis')).toContainText('24:00');
  await expect(calendar.locator('.rs-calendar-day-heading').nth(2)).toContainText('21:59:59.5–23:59:59.5');
  const blocks = await calendar.locator('.rs-calendar-work').all();
  expect(blocks).toHaveLength(2);
  for (const block of blocks) {
    const box = (await block.boundingBox())!, plot = (await block.locator('..').boundingBox())!;
    expect(box.height).toBeCloseTo(80);
    expect(box.y).toBeGreaterThanOrEqual(plot.y);
    expect(box.y + box.height).toBeLessThanOrEqual(plot.y + plot.height);
  }
  await captureG4(page, 'madrugada-final-del-dia');
});

test('UX04G4 navegación diaria accesible en móvil y tablet, sin siete columnas comprimidas', async ({ page }) => {
  await ux04gFixture(page);
  for (const width of [768, 390, 320, 720]) {
    await page.setViewportSize({ width, height: width === 720 ? 500 : 1000 });
    await page.goto('/scheduling');
    const calendar = page.locator('.rs-calendar');
    await expect(calendar.locator('.rs-calendar-day')).toHaveCount(1);
    await expect(page.locator('.rs-selected-name')).toHaveText('Ana Prueba');
    const select = page.getByLabel('Día de la semana');
    await expect(select.getByRole('option')).toHaveCount(7);
    await select.selectOption('1');
    await expect(calendar.getByRole('heading', { name: 'Martes', exact: true })).toBeVisible();
    await select.focus(); await select.press('ArrowDown');
    await expect(calendar.getByRole('heading', { name: 'Miércoles', exact: true })).toBeVisible();
    await select.selectOption('5');
    await expect(calendar.locator('.rs-calendar-day')).toContainText('Cerrado');
    await expect(calendar.locator('.rs-calendar-work')).toHaveCount(0);
    await page.getByRole('button', { name: 'Día siguiente', exact: true }).click();
    await expect(calendar.getByRole('heading', { name: 'Domingo', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Día siguiente', exact: true })).toBeDisabled();
    await chooseDentist(page, 'Luis Sintético');
    await expect(select).toHaveValue('0');
    await expect(calendar.getByRole('heading', { name: 'Lunes', exact: true })).toBeVisible();
    await expect(calendar).toContainText('11:00–17:00');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390) {
      await captureG4(page, 'movil390-cambio-profesional');
      if (process.env.UX04G4_CAPTURE_STAGE === 'after') await page.screenshot({ path: '/tmp/opencode/ux04g4/after/movil390-viewport.png' });
    }
  }
});

test('UX04G4 carga, error y recuperación de calendario sin perder el contexto', async ({ page }) => {
  const { state } = await ux04gFixture(page);
  let release!: () => void;
  await page.route('**/api/schedules/dentist/7', async (route) => {
    await new Promise<void>((resolve) => { release = resolve; }); await route.fallback();
  }, { times: 1 });
  await page.goto('/scheduling');
  const week = page.locator('[aria-labelledby="rs-dentist-week"]');
  await expect(week.getByRole('status')).toBeVisible();
  await expect(page.locator('.rs-selected-name')).toHaveText('Ana Prueba');
  await expect(week.locator('.rs-calendar-block')).toHaveCount(0);
  await captureG4(page, 'calendario-cargando');
  state.fail = '/api/schedules/dentist/7'; release();
  await expect(week.getByRole('alert')).toBeVisible();
  await expect(week.locator('.rs-calendar-block')).toHaveCount(0);
  await captureG4(page, 'calendario-error');
  state.fail = '';
  await week.getByRole('button', { name: 'Reintentar el horario del dentista' }).click();
  await expect(week.locator('.rs-calendar-day')).toHaveCount(7);
  await expect(week.locator('.rs-calendar-work')).not.toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await chooseDentist(page, 'Luis Sintético');
  await expect(week).toContainText('11:00–17:00');
  await expect(page.locator('.rs-context-status')).toHaveText('Horario de Luis Sintético cargado.');
});
