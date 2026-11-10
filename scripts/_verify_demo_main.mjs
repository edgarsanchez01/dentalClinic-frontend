/**
 * UX05A_DEMO_MAIN_20261021 - Verificación funcional (solo texto, SIN capturas).
 * Login real por UI contra el backend de desarrollo en 127.0.0.1:8080 (base dentalclinic:5434).
 */
import { chromium } from 'playwright';

const web = 'http://127.0.0.1:5173';
const email = 'dentista.demo@demo.test';
const password = process.env.DEMO_LOGIN_PASSWORD;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const apiCalls = [];
page.on('response', r => {
  const u = new URL(r.url());
  if (u.pathname.startsWith('/api/')) apiCalls.push(`${r.status()} ${u.pathname}${u.search}`);
});

await page.goto(web + '/login');
await page.getByLabel('Correo electrónico').fill(email);
await page.getByLabel('Contraseña', { exact: true }).fill(password);
await page.getByRole('button', { name: 'Entrar', exact: true }).click();
await page.getByRole('heading', { name: 'Mi jornada clínica' }).waitFor({ timeout: 20000 });
await page.waitForTimeout(1500);

const main = await page.locator('main').innerText();
console.log('=== TEXTO RENDERIZADO DEL INICIO ===');
console.log(main);
console.log('\n=== ENLACES ===');
console.log(JSON.stringify(await page.locator('main a').evaluateAll(as => as.map(a => ({ t: a.textContent?.trim(), h: a.getAttribute('href') }))), null, 1));
console.log('\n=== LLAMADAS API ===');
console.log(apiCalls.join('\n'));

const api = 'http://127.0.0.1:8080';
const token = await (await fetch(api + '/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
})).json();
const nextPage = await (await fetch(`${api}/api/appointments?dentistId=5&status=SCHEDULED&from=${new Date().toISOString()}&page=0&size=1`, {
  headers: { Authorization: `Bearer ${token.accessToken}` },
})).json();
const nextStart = new Date(nextPage.content[0].startAt);
const localHour = nextStart.toLocaleString('en-GB', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit' });

const checks = {
  'encabezado Mi jornada clínica': main.includes('Mi jornada clínica'),
  'destacado Siguiente paciente': main.includes('SIGUIENTE PACIENTE') || main.includes('Siguiente paciente'),
  [`siguiente cita real (${localHour}) visible en el destacado`]: main.includes(localHour),
  'la siguiente cita de la API es futura': nextStart.getTime() > Date.now(),
  'sección Mi agenda de hoy': main.includes('Mi agenda de hoy'),
  'contador de programadas': /\d+\s*\n?\s*citas que siguen programadas hoy/.test(main),
  'estado Completada': main.includes('Completada'),
  'estado Programada': main.includes('Programada'),
  'estado No asistió': main.includes('No asistió'),
  'estado Cancelada': main.includes('Cancelada'),
  'paciente Lucía Ramírez Demo': main.includes('Lucía Ramírez Demo'),
  'paciente Valeria Ortiz Demo': main.includes('Valeria Ortiz Demo'),
  'servicio Resina simple': main.includes('Resina simple'),
  'bloque de notificaciones': main.includes('Tus notificaciones'),
  'aviso Agenda del día': main.includes('Agenda del día'),
  'sin datos clínicos sensibles en notificaciones': !/diagnóstico|odontograma|endodoncia|conducto|receta|medicamento|caries/i.test(main.split('Tus notificaciones')[1] ?? ''),
  'enlace Abrir cita': main.includes('Abrir cita'),
  'enlace Abrir expediente': main.includes('Abrir expediente'),
  'sin overflow horizontal': await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
};
console.log('\n=== COMPROBACIONES ===');
let fails = 0;
for (const [k, v] of Object.entries(checks)) { console.log(`${v ? '✅' : '❌'} ${k}`); if (!v) fails++; }

// Enlace "Abrir cita" del destacado
const link = page.locator('main a[href^="/appointments/"]').first();
if (await link.count()) {
  const href = await link.getAttribute('href');
  await link.click();
  await page.waitForURL(/\/appointments\/\d+/, { timeout: 10000 });
  const denied = await page.getByText(/No tienes permiso|Acceso denegado|403/i).count();
  console.log(`\n${denied === 0 ? '✅' : '❌'} detalle de cita ${href} accesible sin denegación`);
  if (denied !== 0) fails++;
}
console.log(`\n=== TOTAL FALLOS: ${fails} ===`);
await browser.close();
process.exitCode = fails ? 1 : 0;
