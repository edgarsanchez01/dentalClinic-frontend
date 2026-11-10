/**
 * UX-05A.1 — Entorno de DEMOSTRACIÓN aislado del Inicio DENTIST.
 *
 * Arranca un escenario clínico realista (backend real + frontend real) sobre una base de
 * datos PostgreSQL NUEVA, EFÍMERA y AISLADA, y ejecuta las capturas/verificación de
 * `e2e/ux05a-dentist-home.real.spec.ts`.
 *
 * Garantías de aislamiento (verificadas antes de cualquier escritura):
 *   - Contenedor docker NUEVO con nombre aleatorio y etiqueta `dentalclinic.phase=ux05a-demo`,
 *     creado con `--tmpfs` (sin volumen persistente) y puerto host ALEATORIO en 127.0.0.1.
 *   - Base de datos, usuario y contraseña propios; el seed aborta si el nombre de base no
 *     contiene `demo`/`9d6a`/`ux05a`.
 *   - Se rechaza explícitamente el puerto 5434, el contenedor `dentalclinic-postgres`,
 *     el volumen `dentalclinic_pgdata` y cualquier nombre del proyecto `consultorio`.
 *   - NO ejecuta `docker compose down -v`, TRUNCATE, DELETE, DROP ni migraciones contra la
 *     base persistente. Solo se detiene el contenedor temporal creado por ESTA ejecución.
 *
 * Nunca lee `.env`, `owner-e2e.env` ni ninguna credencial real. No activa SMTP, recordatorios
 * ni enlaces de identidad.
 *
 * Uso:  node scripts/run-ux05a-demo.mjs [args de Playwright]
 * Salida: directorio temporal con el fixture, logs y las capturas.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { delimiter, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const frontend = resolve(fileURLToPath(new URL('..', import.meta.url)));
const backendDirectory = resolve(frontend, '../backend');
const output = mkdtempSync('/tmp/opencode/dentalclinic-ux05a-demo-');
const name = `dc-ux05a-demo-${randomUUID()}`;
const database = 'dentalclinic_ux05a_demo';
const username = 'ux05a_demo';
const dbPassword = randomUUID();
const web = 'http://127.0.0.1:15197';
const timezone = 'America/Mexico_City';
// Contraseña aleatoria de la cuenta demo. Solo se publica en el fixture temporal (0600) y en consola.
const password = `Demo-${randomUUID().slice(0, 18)}!`;
const ownerEmail = 'owner@ux05a-demo.test';
const dentistEmail = 'dentista.demo@ux05a-demo.test';
const emptyDentistEmail = 'dentista.vacio@ux05a-demo.test';
let containerId, backend;
const log = createWriteStream(resolve(output, 'backend.log'));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`${command} falló (${result.status}): ${result.stderr ?? ''}`);
  return result.stdout?.trim();
}
const pause = ms => new Promise(done => setTimeout(done, ms));

try {
  const cp = resolve(output, 'classpath.txt');
  run('mvn', ['-o', '-q', 'test-compile', 'dependency:build-classpath', '-Dmdep.includeScope=test', `-Dmdep.outputFile=${cp}`],
      { cwd: backendDirectory });

  // Contenedor temporal: sin volumen, tmpfs, puerto host aleatorio, etiqueta de fase.
  containerId = run('docker', ['run', '-d', '--rm', '--name', name, '--label', 'dentalclinic.phase=ux05a-demo',
    '--tmpfs', '/var/lib/postgresql/data:rw', '-p', '127.0.0.1::5432',
    '-e', `POSTGRES_DB=${database}`, '-e', `POSTGRES_USER=${username}`, '-e', `POSTGRES_PASSWORD=${dbPassword}`, 'postgres:16']);

  // Verificación de aislamiento ANTES de cualquier escritura.
  const container = JSON.parse(run('docker', ['inspect', containerId]))[0];
  const bindings = container.NetworkSettings.Ports['5432/tcp'];
  const forbidden = ['dentalclinic-postgres', 'consultorio'];
  if (container.Name !== `/${name}` || container.Config.Image !== 'postgres:16'
      || container.Mounts.some(m => m.Type !== 'tmpfs' || String(m.Name).includes('pgdata'))
      || bindings.length !== 1 || bindings[0].HostIp !== '127.0.0.1'
      || ['5434', '5436'].includes(bindings[0].HostPort)
      || forbidden.some(f => name.includes(f))) {
    throw new Error('Aislamiento no verificable: se aborta antes de escribir nada.');
  }
  console.log(`Aislamiento verificado: contenedor ${name} (tmpfs, sin volumen), PostgreSQL 127.0.0.1:${bindings[0].HostPort}, base ${database}.`);

  const pgHostPort = bindings[0].HostPort;
  const deadline = Date.now() + 60_000;
  while (spawnSync('docker', ['exec', containerId, 'pg_isready', '-h', '127.0.0.1', '-U', username, '-d', database], { stdio: 'ignore' }).status !== 0) {
    if (Date.now() > deadline) throw new Error('PostgreSQL temporal no disponible');
    await pause(200);
  }

  const psql = query => run('docker', ['exec', '-i', containerId, 'psql', '-X', '-qAt', '-U', username, '-d', database, '-v', 'ON_ERROR_STOP=1'], { input: query });
  if (psql('SELECT current_database()') !== database) throw new Error('Base temporal incorrecta');

  // Esquema V001–V019 desde la fuente única de verdad (idéntico a run-registration-real.mjs).
  const schema = resolve(frontend, '../db/schema');
  const scripts = readdirSync(schema).filter(file => /^V\d{3}__.*\.sql$/.test(file)).sort();
  if (scripts.length !== 19 || !scripts.at(-1).startsWith('V019__')) throw new Error('Se espera exactamente V001–V019, sin migraciones nuevas');
  psql(`BEGIN;\n${scripts.map(file => readFileSync(resolve(schema, file), 'utf8')).join('\n')}\nCOMMIT;`);

  // Backend real (perfil test) apuntando EXCLUSIVAMENTE a la base temporal.
  const args = ['-cp', [resolve(backendDirectory, 'target/test-classes'), resolve(backendDirectory, 'target/classes'), readFileSync(cp, 'utf8').trim()].join(delimiter),
    'com.dentalclinic.DentalClinicApplication', '--spring.profiles.active=test', '--server.port=0', '--server.address=127.0.0.1',
    `--spring.datasource.url=jdbc:postgresql://127.0.0.1:${pgHostPort}/${database}`,
    '--spring.datasource.driver-class-name=org.postgresql.Driver', `--spring.datasource.username=${username}`, `--spring.datasource.password=${dbPassword}`,
    '--spring.jpa.hibernate.ddl-auto=validate', '--spring.sql.init.mode=never', '--dentalclinic.fixtures.enabled=false',
    `--dentalclinic.security.cors.allowed-origins=${web}`, '--dentalclinic.identity.links-enabled=false',
    '--dentalclinic.identity.email.dispatch-enabled=false', '--dentalclinic.communication.email.enabled=false', '--dentalclinic.communication.dispatch.enabled=false',
    '--dentalclinic.appointment.reminder.enabled=false', '--dentalclinic.appointment.reminder.email-delivery-enabled=false'];
  backend = spawn('java', args, { cwd: backendDirectory, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  for (const stream of [backend.stdout, backend.stderr]) stream.on('data', chunk => { logs += chunk; log.write(chunk); });
  let port;
  const startupDeadline = Date.now() + 120_000;
  while (Date.now() < startupDeadline) {
    if (backend.exitCode !== null) throw new Error(`Backend temporal terminó. Ver ${output}/backend.log`);
    port = logs.match(/Tomcat started on port (\d+)/)?.[1];
    if (port) break;
    await pause(200);
  }
  if (!port) throw new Error('Backend temporal no arrancó');
  const api = `http://127.0.0.1:${port}`;

  // 1) Onboarding: crea clínica (zona America/Mexico_City) + OWNER + perfil Dentist del propietario.
  const onboard = await fetch(api + '/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    owner: { email: ownerEmail, password },
    dentist: { firstName: 'Propietario', lastName: 'Demo', phone: '555-0100' },
    clinic: { name: 'Clínica Demo UX-05A', timezone },
  }) });
  if (!onboard.ok) throw new Error(`Onboarding demo: ${onboard.status} ${await onboard.text()}`);

  // 2) Usuario DENTIST dedicado (reutiliza el hash de la contraseña demo del propietario).
  psql(`INSERT INTO users (email, password_hash, role, active, created_at)
        SELECT '${dentistEmail}', password_hash, 'DENTIST', TRUE, now() FROM users WHERE email = '${ownerEmail}';
        INSERT INTO users (email, password_hash, role, active, created_at)
        SELECT '${emptyDentistEmail}', password_hash, 'DENTIST', TRUE, now() FROM users WHERE email = '${ownerEmail}';`);

  // 3) Seed sintético (servicios, perfiles, horarios, pacientes, citas y notificaciones).
  const seed = readFileSync(resolve(frontend, 'scripts/ux05a-demo-seed.sql'), 'utf8');
  const seedOut = run('docker', ['exec', '-i', containerId, 'psql', '-X', '-qAt', '-U', username, '-d', database,
    '-v', 'ON_ERROR_STOP=1', '-v', `dentist_email=${dentistEmail}`, '-v', `empty_dentist_email=${emptyDentistEmail}`, '-v', `timezone=${timezone}`], { input: seed });
  const summary = JSON.parse(seedOut.trim().split('\n').filter(Boolean).at(-1));

  // 4) Fixture efímero (0600). Contiene la contraseña demo: no se versiona ni se imprime en capturas.
  const fixturePath = resolve(output, 'fixture.json');
  writeFileSync(fixturePath, JSON.stringify({ ...summary, api, web, database, timezone, password, ownerEmail, dentistEmail, emptyDentistEmail }), { mode: 0o600 });

  console.log(`Entorno demo listo: ${name}, PostgreSQL 127.0.0.1:${pgHostPort} (tmpfs), backend ${api}.`);
  console.log(`Escenario: día clínico ${summary.today} (${timezone}); ${summary.patients} pacientes, ${summary.services} servicios, ${summary.appointments} citas, ${summary.notifications} notificaciones.`);
  console.log(`Siguiente cita programada: ${summary.nextAppointmentAt}.`);
  console.log(`Evidencia (logs, fixture 0600 y capturas): ${output}`);

  const browser = spawn('npm', ['run', 'test:e2e', '--', '--config', 'playwright.dentist-real.config.ts', ...process.argv.slice(2)],
    { cwd: frontend, stdio: 'inherit', env: { ...process.env, DENTALCLINIC_DENTIST_REAL: '1', DENTALCLINIC_DENTIST_FIXTURE: fixturePath } });
  const [code] = await once(browser, 'exit');
  process.exitCode = code ?? 1;
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
} finally {
  if (backend && backend.exitCode === null && backend.signalCode === null) {
    backend.kill('SIGTERM');
    await Promise.race([once(backend, 'exit'), pause(10_000)]);
    if (backend.exitCode === null && backend.signalCode === null) backend.kill('SIGKILL');
  }
  // Solo el ID obtenido del `docker run` de ESTA ejecución; nunca nombres/volúmenes preexistentes.
  if (containerId) run('docker', ['stop', containerId]);
  log.end();
}
