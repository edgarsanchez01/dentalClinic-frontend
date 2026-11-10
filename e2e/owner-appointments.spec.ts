import { expect, test, type Page } from '@playwright/test';
import { ownerUiFixture } from './ownerUiFixture';

const DATE = '2026-10-26';
const days = Array.from({ length: 7 }, (_, i) => ({ dayOfWeek: i + 1, open: true, startTime: '09:00:00', endTime: '17:00:00', breaks: [{ startTime: '13:00:00', endTime: '13:30:00' }] }));
const dentists = ['Ana Propietaria', 'Diego Molina', 'Elena Rodríguez', 'Gabriel Mendoza', 'Inés Romero', 'Julián Acosta'].map((name, i) => ({ dentistId: i + 7, firstName: name.split(' ')[0], lastName: name.split(' ')[1], days }));
async function fixture(page: Page, role = 'OWNER', mode = 'normal') {
  const calls = await ownerUiFixture(page, role);
  const names = ['Paula Herrera', 'Daniela Montes', 'Elena Salas', 'Gabriel Pérez', 'Inés Romero', 'Julián Acosta', 'Lucía Soto', 'Mateo Silva', 'Nora Reyes', 'Óscar Vidal', 'Raúl Núñez', 'Sara Campos'];
  const visits = Array.from({ length: 21 }, (_, i) => {
    const personal = i < 12, date = i < 18 ? DATE : i === 20 ? '2026-10-02' : '2026-10-27';
    const minute = personal ? i < 3 ? 540 : 540 + (i - 2) * 30 : 600 + (i % 6) * 30;
    const startAt = `${date}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00Z`;
    const dentist = dentists[personal || i > 17 ? 0 : 1 + i % 5]!;
    const durationMinutes = i === 2 ? 5 : 30, name = names[i % names.length]!;
    return { id: 20 + i, patientId: i === 0 ? 4 : i + 10, patientUserId: 10, patientFirstName: name.split(' ')[0], patientLastName: name.split(' ')[1],
      dentistId: dentist.dentistId, dentistFirstName: dentist.firstName, dentistLastName: dentist.lastName, startAt,
      endAt: new Date(Date.parse(startAt) + durationMinutes * 60_000).toISOString(), durationMinutes,
      status: ['SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'][i % 4], occurrenceVersion: 1, createdByUserId: 1, createdAt: '2026-10-25T09:00:00Z',
      service: { id: 1, name: ['Valoración integral', 'Limpieza dental', 'Revisión de tratamiento prolongado'][i % 3], durationMinutes, referencePrice: '100.00', active: true } };
  });
  if (mode === 'overlap') visits.push({ ...visits[0]!, id: 80, patientFirstName: 'Paciente con nombre largo', patientLastName: 'De la Fuente Rodríguez', startAt: `${DATE}T09:15:00Z`, endAt: `${DATE}T09:45:00Z`, service: { ...visits[0]!.service, name: 'Seguimiento de tratamiento odontológico y revisión integral' } });
  await page.route(url => ['/api/appointments', '/api/appointments/20', '/api/public/schedule', '/api/schedules/clinic'].includes(url.pathname), async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    calls.push({ path, params: url.searchParams, method: request.method(), body: null });
    if (path === '/api/public/schedule') { await route.fulfill({ json: { timezone: 'UTC', days, exceptions: [], dentists } }); return; }
    if (path === '/api/schedules/clinic') { await route.fulfill({ json: { timezone: 'UTC', days } }); return; }
    if (path === '/api/appointments/20') { await route.fulfill({ json: visits[0] }); return; }
    if (mode === 'error') { await route.fulfill({ status: 503, json: { message: 'Agenda no disponible' } }); return; }
    if (mode === 'loading') { await new Promise(() => {}); return; }
    const from = Date.parse(url.searchParams.get('from') ?? '1970-01-01'), to = Date.parse(url.searchParams.get('to') ?? '2099-01-01');
    const size = Number(url.searchParams.get('size') ?? 100), current = Number(url.searchParams.get('page') ?? 0);
    const entries = mode === 'empty' ? [] : visits.filter(a => Date.parse(a.startAt) >= from && Date.parse(a.startAt) < to
      && (!url.searchParams.has('dentistId') || String(a.dentistId) === url.searchParams.get('dentistId'))
      && (!url.searchParams.has('status') || a.status === url.searchParams.get('status'))
      && (role !== 'PATIENT' || a.patientId === 4));
    await route.fulfill({ json: { content: entries.slice(current * size, (current + 1) * size), size, page: current, totalElements: entries.length, totalPages: Math.ceil(entries.length / size) } });
  });
  return calls;
}

async function ready(page: Page) {
  await expect(page.getByRole('heading', { name: 'Citas', exact: true })).toBeVisible();
  await expect(page.getByText('Cargando citas…', { exact: true })).toHaveCount(0);
  await page.waitForLoadState('networkidle'); await page.evaluate(() => document.fonts.ready);
}
const pathFor = (personal: boolean, view: string) => `/appointments?${personal ? 'scope=mine&' : ''}view=${view}&date=${DATE}`;
const requests = (calls: Awaited<ReturnType<typeof fixture>>) => calls.filter(c => c.path.startsWith('/api/') && !c.path.startsWith('/api/auth/')).map(c => `${c.method} ${c.path}?${[...c.params].sort().map(([key, value]) => `${key}=${value}`).join('&')}`).sort();
const headerPresentation = (page: Page) => page.locator('.owner-agenda-heading, .owner-agenda-tools').evaluateAll(elements => elements.map(el => {
  const css = getComputedStyle(el), box = el.getBoundingClientRect();
  return { text: el.textContent, box: { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height }, css: Object.fromEntries(Array.from(css).filter(name => !name.startsWith('--')).map(name => [name, css.getPropertyValue(name)])) };
}));
const documentPresentation = (page: Page) => page.locator('body *').evaluateAll(elements => elements.map(el => {
  const css = getComputedStyle(el), box = el.getBoundingClientRect();
  return { tag: el.tagName, text: el.textContent, box: { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height }, css: Object.fromEntries(Array.from(css).filter(name => !name.startsWith('--')).map(name => [name, css.getPropertyValue(name)])) };
}));

async function capture(page: Page, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
}

async function checkContrast(page: Page) {
  const readings = await page.locator('.owner-shared-appointments h1, .owner-shared-appointments h2, .owner-shared-appointments .reception-visit-status, .owner-shared-appointments .reception-operation-caption, .owner-shared-appointments .reception-calendar-event, .owner-shared-appointments [aria-label="Vista"] button, .owner-shared-appointments label').evaluateAll(elements => {
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

for (const width of [1440, 768, 390, 320]) for (const personal of [false, true]) for (const view of ['day', 'week', 'month']) {
  test(`OWNER ${personal ? 'personal' : 'clínica'} ${view} ${width}`, async ({ page, browser }) => {
    await page.setViewportSize({ width, height: 1000 }); const calls = await fixture(page);
    const path = pathFor(personal, view); await page.goto(path); await ready(page);
    // Opening another browser page can legitimately refetch stale schedule context
    // on focus. Compare both applications' initial reads, before those interactions.
    const initialRequests = requests(calls);
    await expect(page.getByRole('group', { name: 'Vista', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: view === 'day' ? 'Día' : view === 'week' ? 'Semana' : 'Mes', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const listCall = calls.find(c => c.path === '/api/appointments')!;
    expect(listCall.params.get('from')).toBe(`${view === 'month' ? '2026-10-01' : DATE}T00:00:00.000Z`);
    expect(listCall.params.get('to')).toBe(`${view === 'day' ? '2026-10-27' : view === 'week' ? '2026-11-02' : '2026-11-01'}T00:00:00.000Z`);
    expect(listCall.params.get('dentistId')).toBe(personal ? '7' : null);
    if (personal) await expect(page.getByLabel('Filtrar por dentista')).toBeHidden();
    if (view === 'week') {
      await expect(page.getByRole('region', { name: 'Agenda semanal', exact: true })).toBeVisible();
      expect(await page.locator('.owner-week-preview').count()).toBe(1);
      await expect(page.getByRole('navigation', { name: 'Días de esta semana' }).getByRole('button')).toHaveCount(7);
      await expect(page.locator('.owner-week-preview .reception-visit')).toHaveCount(4);
      await expect(page.getByRole('button', { name: /^Ver agenda completa/ })).toBeVisible();
      const reads = calls.filter(c => c.path === '/api/appointments').length;
      await page.getByRole('navigation', { name: 'Días de esta semana' }).getByRole('button', { name: /^Ver 2 citas del martes, 27/ }).click();
      await expect(page.getByLabel('Fecha', { exact: true })).toHaveValue('2026-10-27');
      await expect(page.locator('.owner-week-preview .reception-visit')).toHaveCount(2);
      await expect(page.locator('.owner-week-preview')).toContainText('Lucía Soto');
      expect(new URL(page.url()).searchParams.get('view')).toBe('week');
      expect(calls.filter(c => c.path === '/api/appointments').length).toBe(reads);
      await page.getByRole('navigation', { name: 'Días de esta semana' }).getByRole('button', { name: new RegExp(`^Ver ${personal ? 12 : 18} citas del lunes, 26`) }).click();
      await expect(page.getByLabel('Fecha', { exact: true })).toHaveValue(DATE);
      await expect(page.locator('.owner-week-preview')).toHaveCount(1);
    } else if (view === 'month') {
      await expect(page.getByRole('region', { name: 'Agenda mensual', exact: true })).toBeVisible();
      const sizes = await page.locator('.owner-month-cell').evaluateAll(els => els.map(el => el.getBoundingClientRect().height));
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThan(1);
      expect(Math.max(...sizes)).toBe(width >= 768 ? 76 : 64);
      await expect(page.locator('.owner-month-cell .reception-calendar-event, .owner-month-cell .reception-visit')).toHaveCount(0);
      await expect(page.locator('.owner-month-cell')).toHaveCount(31);
      await expect(page.locator('.owner-month .owner-volume')).toHaveCount(0);
      const monthDay = page.locator(`[data-date="${DATE}"]`);
      await expect(monthDay.locator('.owner-month-entry, .owner-month-more, time')).toHaveCount(0);
      await expect(monthDay).not.toContainText('Paula');
      await expect(monthDay.locator('.owner-month-count')).toContainText(`${personal ? 12 : 18}`);
      const columns = await page.locator('.owner-month-week').first().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      expect(columns).toBe(7);
      const weeksBefore = await page.locator('.owner-month-week').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; }));
      const calendarBox = (await page.locator('.owner-month-overview').boundingBox())!;
      expect(calendarBox.height).toBeLessThanOrEqual(500);
      const countBeforeSelection = calls.filter(c => c.path === '/api/appointments').length;
      const selected = page.getByRole('button', { name: new RegExp(`^Ver ${personal ? 12 : 18} citas del lunes, 26`) });
      await selected.focus(); await expect(selected).toHaveCSS('outline-width', '2px');
      await selected.press('Enter');
      const detail = page.getByRole('region', { name: 'Citas del día seleccionado' });
      await expect(detail).toBeVisible();
      await expect(detail).toHaveCSS('position', 'static');
      await expect(detail).not.toHaveAttribute('popover');
      await expect(selected).toBeFocused();
      await expect(detail.getByRole('button', { name: 'Cerrar panel' })).toHaveCount(0);
      await expect(detail.getByRole('button', { name: /^Abrir cita de/ })).toHaveCount(personal ? 12 : 18);
      await expect(detail.getByRole('button', { name: /^Ver agenda completa/ })).toBeVisible();
      const detailBox = (await detail.boundingBox())!;
      expect(detailBox.x).toBeGreaterThanOrEqual(0); expect(detailBox.x + detailBox.width).toBeLessThanOrEqual(width);
      // Re-read after keyboard focus can scroll the page; both remain in document flow.
      const currentCalendar = (await page.locator('.owner-month-overview').boundingBox())!;
      if (width >= 1100) { expect(detailBox.x).toBeGreaterThanOrEqual(currentCalendar.x + currentCalendar.width + 20); expect(Math.abs(detailBox.y - currentCalendar.y)).toBeLessThan(1); }
      else expect(detailBox.y).toBeGreaterThanOrEqual(currentCalendar.y + currentCalendar.height + 16);
      expect(await page.locator('.owner-month-week').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; }))).toEqual(weeksBefore);
      const list = await detail.locator('.owner-month-agenda-list').evaluate(el => ({ overflow: getComputedStyle(el).overflowY, height: el.clientHeight, scroll: el.scrollHeight }));
      if (width >= 1100) { expect(list.overflow).toBe('auto'); expect(list.scroll).toBeGreaterThan(list.height); }
      else { expect(list.overflow).toBe('visible'); expect(list.scroll).toBeLessThanOrEqual(list.height + 1); }
      const times = await detail.locator('.owner-preview-time').allTextContents(); expect(times).toEqual([...times].sort());
      await expect(detail.getByRole('button', { name: /^Abrir cita de Paula Herrera a las 09:00/ })).toContainText('Valoración integral');
      for (const status of ['Programada', 'Completada', 'Cancelada', 'No asistió']) await expect(detail.getByText(status, { exact: true }).first()).toBeVisible();
      await detail.getByRole('button', { name: /^Abrir cita de/ }).last().focus();
      const focused = (await detail.getByRole('button', { name: /^Abrir cita de/ }).last().boundingBox())!;
      const scroller = (await detail.locator('.owner-month-agenda-list').boundingBox())!;
      expect(focused.y).toBeGreaterThanOrEqual(scroller.y); expect(focused.y + focused.height).toBeLessThanOrEqual(scroller.y + scroller.height + 1);
      await detail.locator('.owner-month-agenda-list').evaluate(el => { el.scrollTop = 0; });
      expect(calls.filter(c => c.path === '/api/appointments').length).toBe(countBeforeSelection);
      await page.locator('[data-date="2026-10-28"]').click();
      await expect(detail).toContainText('No hay citas para esta fecha');
      await capture(page, `owner-month-empty-${personal ? 'personal' : 'clinic'}-${width}`);
      await page.locator('[data-date="2026-10-27"]').click();
      await expect(detail.getByRole('button', { name: /^Abrir cita de/ })).toHaveCount(2);
      await capture(page, `owner-month-few-${personal ? 'personal' : 'clinic'}-${width}`);
      await selected.click(); await page.keyboard.press('Escape'); await expect(detail).toBeVisible();
      expect(new URL(page.url()).searchParams.get('view')).toBe('month');
      await page.evaluate(() => scrollTo(0, 0));
    } else if (personal) {
      await expect(page.getByRole('region', { name: 'Agenda del día', exact: true })).toBeVisible();
      await expect(page.getByText('Horario y pausas de la jornada')).toBeVisible();
      await expect(page.locator('.owner-start-groups .owner-start-visit')).toHaveCount(12);
    } else {
      const agenda = page.getByRole('region', { name: 'Agenda del día', exact: true });
      await expect(agenda).toBeVisible();
      await expect(agenda.getByRole('button', { name: /^Abrir cita de/ })).toHaveCount(18);
      await expect(agenda.getByText(/Hasta 09:05 · 5 min/)).toBeVisible();
      const compare = page.getByText('Comparar dentistas en columnas', { exact: true });
      await expect(page.getByRole('region', { name: 'Cuadrícula temporal por dentista' })).toBeHidden();
      await compare.click();
      const grid = page.getByRole('region', { name: 'Cuadrícula temporal por dentista' }); await expect(grid).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const horizontal = await grid.evaluate(el => ({ viewport: el.clientWidth, content: el.scrollWidth }));
      expect(horizontal.content).toBeGreaterThan(horizontal.viewport);
      const scroll = await grid.evaluate(el => ({ height: el.clientHeight, content: el.scrollHeight, overflow: getComputedStyle(el).overflowY }));
      expect(scroll.overflow).toBe('hidden'); expect(scroll.content).toBeLessThanOrEqual(scroll.height + 1);
      expect(await grid.locator('[aria-label^="Agenda de "]').count()).toBe(6);
      const positions = await grid.locator('[aria-label="Agenda de Ana Propietaria"] .reception-calendar-event').evaluateAll(els => els.slice(0, 3).map(el => { const box = el.getBoundingClientRect(); return { x: box.x, y: box.y, width: box.width, height: box.height, top: (el.parentElement as HTMLElement).style.top }; }));
      expect(positions[0]!.y).toBe(positions[1]!.y); expect(positions[0]!.x + positions[0]!.width).toBeLessThan(positions[1]!.x);
      expect(positions[0]!.height).toBe(60); expect(positions[2]!.height).toBe(24);
      expect(positions.every(p => p.top === '0px')).toBe(true);
      if (width === 1440) await capture(page, 'owner-clinic-columns-1440');
      await compare.click();
    }
    await checkContrast(page);
    const cards = page.locator(view === 'day' ? '.owner-start-groups .owner-start-visit' : view === 'week' ? '.owner-preview > li' : '.owner-month-cell');
    const surfaces = await cards.evaluateAll(elements => elements.map(el => { const css = getComputedStyle(el); return { border: css.borderTopWidth, background: css.backgroundColor, radius: css.borderTopLeftRadius }; }));
    if (view !== 'month') for (const surface of surfaces) { expect(surface.border).toBe('1px'); expect(surface.background).toBe('rgb(255, 255, 255)'); expect(surface.radius).toBe('12px'); }
    await capture(page, `owner-${personal ? 'personal' : 'clinic'}-${view}-${width}`);
    if (process.env.DC_OWNER_APPOINTMENTS_BASELINE && (width === 1440 || view !== 'month')) {
      const before = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
      try { const oldCalls = await fixture(before); await before.goto(`http://127.0.0.1:5295${path}`); await ready(before); expect(initialRequests).toEqual(requests(oldCalls));
        // Compare the same resting state, not a color-transition frame after hover.
        // These test-only overrides are added after the real application captures.
        for (const target of [page, before]) { await target.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' }); await target.mouse.move(0, 0); await target.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); scrollTo(0, 0); }); }
        expect(await headerPresentation(page)).toEqual(await headerPresentation(before));
        if (view !== 'month') expect(await documentPresentation(page)).toEqual(await documentPresentation(before));
      }
      finally { await before.close(); }
    }
    expect(calls.every(c => c.method === 'GET' || c.path === '/api/auth/refresh')).toBe(true);
  });
}

for (const width of [1440, 768, 390, 320]) for (const personal of [false, true]) test(`Día por bloques: jerarquía, solapamientos y teclado ${personal ? 'personal' : 'clínica'} ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await fixture(page, 'OWNER', 'overlap'); await page.goto(pathFor(personal, 'day')); await ready(page);
  const agenda = page.getByRole('region', { name: 'Agenda del día', exact: true });
  const nine = agenda.getByRole('region', { name: 'Citas con inicio a las 09:00', exact: true });
  await expect(nine.locator('h3 time')).toHaveCount(1);
  await expect(nine.locator('.owner-start-visit')).toHaveCount(3);
  await expect(nine).toContainText('3 citas · Mismo inicio');
  await expect(nine.locator('.reception-visit-time')).toHaveCount(0);
  const layout = await nine.locator('.owner-start-visits').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(layout).toBe(width >= 1100 ? 2 : 1);
  const rows = await nine.locator('.owner-start-visit').evaluateAll(els => els.map(el => {
    const person = el.querySelector('.reception-visit-person')!, name = person.querySelector('strong')!, service = person.querySelector('.owner-visit-service')!, meta = person.querySelector('.owner-start-meta')!;
    return { height: el.getBoundingClientRect().height, name: name.getBoundingClientRect().toJSON(), service: service.getBoundingClientRect().toJSON(), meta: meta.getBoundingClientRect().toJSON(), status: el.querySelector('.reception-visit-status')!.getBoundingClientRect().toJSON() };
  }));
  for (const row of rows) {
    expect(row.height).toBeGreaterThanOrEqual(44);
    expect(row.service.y).toBeGreaterThanOrEqual(row.name.y + row.name.height);
    expect(row.service.x).toBe(row.name.x);
    expect(row.meta.y).toBeGreaterThanOrEqual(row.service.y);
    expect(Math.abs(row.status.y - row.name.y)).toBeLessThanOrEqual(4);
  }
  const overlap = agenda.getByRole('region', { name: 'Citas con inicio a las 09:15', exact: true });
  await expect(overlap).toContainText('no indica un conflicto ni disponibilidad');
  await expect(overlap.getByRole('button')).toContainText('Seguimiento de tratamiento odontológico y revisión integral');
  if (!personal) {
    await expect(agenda.getByRole('button', { name: /^Abrir cita de/ })).toHaveCount(19);
    await expect(agenda.locator('.owner-start-more')).toHaveCount(0);
  }
  const first = nine.getByRole('button', { name: /^Abrir cita de Paula/ });
  await first.focus(); await expect(first).toHaveCSS('outline-width', '2px');
  await page.keyboard.press('Tab'); await expect(nine.getByRole('button', { name: /^Abrir cita de Daniela/ })).toBeFocused();
  await page.evaluate(() => scrollTo(0, 0));
  await capture(page, `owner-day-blocks-${personal ? 'personal' : 'clinic'}-${width}`);
  await nine.screenshot({ path: test.info().outputPath(`owner-day-first-block-${personal ? 'personal' : 'clinic'}-${width}.png`) });
  await first.press('Enter'); await expect(page).toHaveURL(/\/appointments\/20\?/);
  const back = new URL(new URL(page.url()).searchParams.get('returnTo')!, 'http://calendar.test');
  expect(back.searchParams.get('view')).toBe('day'); expect(back.searchParams.get('date')).toBe(DATE);
  expect(new URL(page.url()).searchParams.get('clinical')).toBe(personal ? '1' : null);
  await page.goBack(); await ready(page); await expect(page.locator('.owner-start-groups')).toBeVisible();
});

for (const personal of [false, true]) test(`filtros, navegación y retorno ${personal ? 'personal' : 'clínica'}`, async ({ page }) => {
  await fixture(page); await page.goto(`${pathFor(personal, 'month')}&${personal ? 'dentistId=12' : 'dentistId=8'}&status=COMPLETED`); await ready(page);
  const select = page.getByLabel('Filtrar por estado'); await select.selectOption('SCHEDULED');
  await expect(page).toHaveURL(/status=SCHEDULED/); await ready(page);
   await page.locator(`[data-date="${DATE}"]`).click();
   const detail = page.getByRole('region', { name: 'Citas del día seleccionado' });
   await detail.getByRole('button', { name: /^Ver agenda completa/ }).click();
  await expect(page).toHaveURL(/view=day/); expect(new URL(page.url()).searchParams.get('scope')).toBe(personal ? 'mine' : null);
  expect(new URL(page.url()).searchParams.get('status')).toBe('SCHEDULED');
  await ready(page);
  if (!personal) { await page.getByLabel('Filtrar por dentista').selectOption('7'); await ready(page); }
  const appointment = page.getByRole('button', { name: /^(Cita con Paula Herrera|Abrir cita de Paula Herrera)/ }).first(); await appointment.click();
  await expect(page).toHaveURL(/\/appointments\/20\?/);
  const params = new URL(page.url()).searchParams;
  expect(params.get('clinical')).toBe(personal ? '1' : null);
  const returnTo = params.get('returnTo')!; expect(returnTo).toContain('date=2026-10-26'); expect(returnTo).toContain('status=SCHEDULED');
  if (personal) expect(returnTo).toContain('scope=mine');
});

for (const personal of [false, true]) for (const mode of ['empty', 'error']) for (const view of ['week', 'month']) test(`estados ${mode} ${personal ? 'personal' : 'clínica'} ${view}`, async ({ page }) => {
  const calls = await fixture(page, 'OWNER', mode); await page.goto(pathFor(personal, view)); await ready(page);
  if (mode === 'empty') {
    if (view === 'week') { await expect(page.getByText(/^Sin citas registradas\./)).toHaveCount(1); await expect(page.getByRole('navigation', { name: 'Días de esta semana' }).getByRole('button')).toHaveCount(7); }
    else { await expect(page.getByRole('button', { name: /^Ver 0 citas del/ })).toHaveCount(31); await expect(page.getByText('No hay citas para esta fecha')).toBeVisible(); }
  }
  else { await expect(page.getByRole('alert')).toBeVisible(); await page.getByRole('button', { name: 'Reintentar', exact: true }).click(); await expect.poll(() => calls.filter(c => c.path === '/api/appointments').length).toBeGreaterThan(1); }
});

for (const personal of [false, true]) test(`carga mensual independiente ${personal ? 'personal' : 'clínica'} conserva controles`, async ({ page }) => {
  await fixture(page, 'OWNER', 'loading'); await page.goto(pathFor(personal, 'month'));
  await expect(page.getByText('Cargando citas…')).toBeVisible(); await expect(page.getByRole('group', { name: 'Vista' })).toBeVisible();
  await expect(page.getByText('No hay citas en este período.')).toHaveCount(0);
});

for (const personal of [false, true]) test(`mes explorable, filtros y retorno ${personal ? 'personal' : 'clínica'}`, async ({ page }) => {
  const calls = await fixture(page); await page.goto(pathFor(personal, 'month')); await ready(page);
  const readCount = calls.filter(c => c.path === '/api/appointments').length;
  const empty = page.getByRole('button', { name: /^Ver 0 citas del miércoles, 28/ });
  await empty.click();
  await expect(empty).toHaveAttribute('aria-pressed', 'true');
  expect(new URL(page.url()).searchParams.get('preview')).toBeNull();
  const detail = page.getByRole('region', { name: 'Citas del día seleccionado' });
  await expect(empty).toBeFocused();
  await expect(detail).toContainText('No hay citas para esta fecha');
  expect(new URL(page.url()).searchParams.get('view')).toBe('month');
  expect(calls.filter(c => c.path === '/api/appointments').length).toBe(readCount);
  await page.getByRole('button', { name: new RegExp(`^Ver ${personal ? 12 : 18} citas del lunes, 26`) }).click();
  expect(new URL(page.url()).searchParams.get('preview')).toBeNull();
  await expect(detail.getByRole('button', { name: /^Abrir cita de/ })).toHaveCount(personal ? 12 : 18);
  await page.getByRole('group', { name: 'Navegación', exact: true }).getByRole('button', { name: 'Siguiente' }).click();
  await ready(page); await expect(page).toHaveURL(/date=2026-11-/);
  await expect(page.getByLabel('Fecha', { exact: true })).toHaveValue('2026-11-01');
  await page.getByRole('group', { name: 'Navegación', exact: true }).getByRole('button', { name: 'Anterior' }).click(); await ready(page);
  await expect(page).toHaveURL(/date=2026-10-01/);
  await expect(page.getByLabel('Fecha', { exact: true })).toHaveValue('2026-10-01');
  await page.getByLabel('Filtrar por estado').selectOption('SCHEDULED'); await ready(page);
  const filteredDay = page.getByRole('button', { name: /^Ver \d+ citas? del lunes, 26/ });
  await expect(filteredDay).toContainText(`${personal ? 3 : 5} citas`);
  await filteredDay.click(); await expect(filteredDay).toHaveAttribute('aria-pressed', 'true');
  await expect(detail.locator('summary')).toHaveCount(0);
  await detail.getByRole('button', { name: /^Abrir cita de Paula Herrera/ }).first().click();
  await expect(page).toHaveURL(/\/appointments\/20\?/);
  await expect(page.getByRole('heading', { level: 1, name: personal ? 'Paula Herrera' : 'Cita #20', exact: true })).toBeVisible();
  const params = new URL(page.url()).searchParams;
  expect(params.get('clinical')).toBe(personal ? '1' : null);
  expect(params.get('returnTo')).toContain('view=month'); expect(params.get('returnTo')).toContain('status=SCHEDULED');
  if (personal) expect(params.get('returnTo')).toContain('scope=mine');
  await page.goBack(); await ready(page);
  await expect(page.getByLabel('Fecha', { exact: true })).toHaveValue(DATE);
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: /^Ver agenda completa/ }).click(); await ready(page);
  await expect(page.getByRole('button', { name: 'Día', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Fecha', { exact: true })).toHaveValue(DATE);
  expect(new URL(page.url()).searchParams.get('status')).toBe('SCHEDULED');
  await page.goBack(); await ready(page);
  await expect(filteredDay).toHaveAttribute('aria-pressed', 'true');
  await expect(detail.getByRole('button', { name: /^Abrir cita de/ })).toHaveCount(personal ? 3 : 5);
  // Integrated content remains visible when focus leaves it; nothing is trapped.
  await page.getByRole('button', { name: 'Semana', exact: true }).focus();
  await expect(detail).toBeVisible();
});

for (const personal of [false, true]) test(`semana seleccionada conserva filtros y retorno ${personal ? 'personal' : 'clínica'}`, async ({ page }) => {
  const calls = await fixture(page); await page.goto(`${pathFor(personal, 'week')}&dentistId=7&status=CANCELLED`); await ready(page);
  await page.getByRole('group', { name: 'Navegación', exact: true }).getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByLabel('Fecha', { exact: true })).toHaveValue('2026-11-02'); await ready(page);
  await expect(page.locator('.owner-week-preview')).toHaveCount(1);
  await page.getByRole('group', { name: 'Navegación', exact: true }).getByRole('button', { name: 'Anterior' }).click();
  await expect(page.getByLabel('Fecha', { exact: true })).toHaveValue(DATE); await ready(page);
  const reads = calls.filter(c => c.path === '/api/appointments').length;
  await page.getByRole('navigation', { name: 'Días de esta semana' }).getByRole('button', { name: /^Ver 1 cita del martes, 27/ }).click();
  await expect(page.getByLabel('Fecha', { exact: true })).toHaveValue('2026-10-27');
  await expect(page.locator('.owner-week-preview .reception-visit')).toHaveCount(1);
  expect(calls.filter(c => c.path === '/api/appointments').length).toBe(reads);
  const visit = page.locator('.owner-week-preview .reception-visit');
  await expect(visit).toContainText('Lucía Soto'); await expect(visit).toContainText('30 min');
  await visit.click(); await expect(page).toHaveURL(/\/appointments\/38\?/);
  const params = new URL(page.url()).searchParams;
  const back = new URL(params.get('returnTo')!, 'http://calendar.test');
  expect(back.searchParams.get('view')).toBe('week'); expect(back.searchParams.get('date')).toBe('2026-10-27');
  expect(back.searchParams.get('status')).toBe('CANCELLED'); expect(back.searchParams.get('dentistId')).toBe('7');
  expect(params.get('clinical')).toBe(personal ? '1' : null);
  if (personal) expect(back.searchParams.get('scope')).toBe('mine');
  await page.goBack(); await ready(page);
  await expect(page.getByRole('navigation', { name: 'Días de esta semana' }).getByRole('button', { name: /^Ver 1 cita del martes, 27/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^Ver agenda completa/ }).click(); await ready(page);
  await expect(page.getByRole('button', { name: 'Día', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const dayParams = new URL(page.url()).searchParams;
  expect(dayParams.get('date')).toBe('2026-10-27'); expect(dayParams.get('status')).toBe('CANCELLED');
  expect(dayParams.get('dentistId')).toBe('7'); expect(dayParams.get('scope')).toBe(personal ? 'mine' : null);
});

if (process.env.DC_OWNER_APPOINTMENTS_BASELINE) for (const width of [1440, 390]) test(`Otros módulos OWNER y otros roles intactos ${width}`, async ({ browser }) => {
  test.setTimeout(120_000);
  const presentation = (page: Page) => page.locator('body *').evaluateAll(elements => elements.map(el => {
    const css = getComputedStyle(el);
    return { tag: el.tagName, text: el.textContent, box: el.getBoundingClientRect().toJSON(), css: Object.fromEntries(Array.from(css).filter(name => !name.startsWith('--')).map(name => [name, css.getPropertyValue(name)])) };
  }));
  for (const role of ['OWNER', 'DENTIST', 'PATIENT', 'RECEPTIONIST']) {
    const before = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    const after = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    await fixture(before, role); await fixture(after, role);
    const paths = role === 'OWNER' ? ['/', '/?scope=mine', '/patients', '/scheduling?scope=mine'] : ['/', ...['day', 'week', 'month'].map(view => pathFor(false, view))];
    try {
      for (const [i, path] of paths.entries()) {
        await before.goto(`http://127.0.0.1:5295${path}`); await after.goto(`http://127.0.0.1:5296${path}`);
        for (const target of [before, after]) { await expect(target.locator('h1')).toHaveCount(1); await target.waitForLoadState('networkidle'); await target.evaluate(() => document.fonts.ready); await expect(target.getByRole('status', { name: /^Cargando / })).toHaveCount(0); }
        expect(await presentation(after), `${role} ${path}`).toEqual(await presentation(before));
        await before.screenshot({ path: test.info().outputPath(`${role}-${i}-before.png`), fullPage: true, caret: 'initial' });
        await after.screenshot({ path: test.info().outputPath(`${role}-${i}-after.png`), fullPage: true, caret: 'initial' });
      }
    } finally { await before.close(); await after.close(); }
  }
});
