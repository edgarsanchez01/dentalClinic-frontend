/** 9D.6A: entorno NUEVO, sintético y efímero; nunca reutiliza una demo ni lee .env. */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { delimiter, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const frontend = resolve(fileURLToPath(new URL('..', import.meta.url)));
const backendDirectory = resolve(frontend, '../backend');
const output = mkdtempSync('/tmp/opencode/dentalclinic-9d6a-real-');
const name = `dc-9d6a-${randomUUID()}`;
const database = 'dentalclinic_9d6a', username = 'verify_9d6a', dbPassword = randomUUID();
const web = 'http://127.0.0.1:15196';
const password = 'Synthetic-Registration-2026!';
const ownerEmail = 'owner@9d6a.test', dentistEmail = 'dentist@9d6a.test';
const receptionEmail = 'reception@9d6a.test', exemptEmail = 'exempt@9d6a.test';
let containerId, backend;
const log = createWriteStream(resolve(output, 'backend.log'));
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`${command} falló (${result.status}): ${result.stderr ?? ''}`);
  return result.stdout?.trim();
}
const pause = ms => new Promise(done => setTimeout(done, ms));
function sql(query) {
  return run('docker', ['exec', '-i', containerId, 'psql', '-X', '-qAt', '-U', username, '-d', database, '-v', 'ON_ERROR_STOP=1'], { input: query });
}
try {
  const cp = resolve(output, 'classpath.txt');
  run('mvn', ['-o', '-q', 'test-compile', 'dependency:build-classpath', '-Dmdep.includeScope=test', `-Dmdep.outputFile=${cp}`], { cwd: backendDirectory });
  containerId = run('docker', ['run', '-d', '--rm', '--name', name, '--label', 'dentalclinic.phase=9d6a-test',
    '--tmpfs', '/var/lib/postgresql/data:rw', '-p', '127.0.0.1::5432',
    '-e', `POSTGRES_DB=${database}`, '-e', `POSTGRES_USER=${username}`, '-e', `POSTGRES_PASSWORD=${dbPassword}`, 'postgres:16']);
  const container = JSON.parse(run('docker', ['inspect', containerId]))[0];
  const bindings = container.NetworkSettings.Ports['5432/tcp'];
  if (container.Name !== `/${name}` || container.Config.Image !== 'postgres:16'
      || container.Mounts.some(m => m.Type !== 'tmpfs') || bindings.length !== 1
      || bindings[0].HostIp !== '127.0.0.1' || bindings[0].HostPort === '5434') throw new Error('Aislamiento no verificable');
  const deadline = Date.now() + 60_000;
  while (spawnSync('docker', ['exec', containerId, 'pg_isready', '-h', '127.0.0.1', '-U', username, '-d', database], { stdio: 'ignore' }).status !== 0) {
    if (Date.now() > deadline) throw new Error('PostgreSQL temporal no disponible');
    await pause(200);
  }
  if (sql('SELECT current_database()') !== database) throw new Error('Base temporal incorrecta');
  const schema = resolve(frontend, '../db/schema');
  const scripts = readdirSync(schema).filter(file => /^V\d{3}__.*\.sql$/.test(file)).sort();
  if (scripts.length !== 19 || !scripts.at(-1).startsWith('V019__')) throw new Error('Se espera exactamente V001–V019, sin migraciones nuevas');
  sql(`BEGIN;\n${scripts.map(file => readFileSync(resolve(schema, file), 'utf8')).join('\n')}\nCOMMIT;`);
  const args = ['-cp', [resolve(backendDirectory, 'target/test-classes'), resolve(backendDirectory, 'target/classes'), readFileSync(cp, 'utf8').trim()].join(delimiter),
    'com.dentalclinic.DentalClinicApplication', '--spring.profiles.active=test', '--server.port=0', '--server.address=127.0.0.1',
    `--spring.datasource.url=jdbc:postgresql://127.0.0.1:${bindings[0].HostPort}/${database}`,
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
  const onboard = await fetch(api + '/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    owner: { email: ownerEmail, password }, dentist: { firstName: 'Propietario', lastName: 'Sintetico', phone: '5550101' },
    clinic: { name: 'Clinica sintetica 9D6A', timezone: 'UTC' },
  }) });
  if (!onboard.ok) throw new Error(`Onboarding sintético: ${onboard.status}`);
  const fixture = JSON.parse(sql(`BEGIN;
    INSERT INTO users(email,password_hash,role,active,created_at)
      SELECT '${dentistEmail}',password_hash,'DENTIST',TRUE,now() FROM users WHERE email='${ownerEmail}';
    INSERT INTO users(email,password_hash,role,active,created_at)
      SELECT '${receptionEmail}',password_hash,'RECEPTIONIST',TRUE,now() FROM users WHERE email='${ownerEmail}';
    INSERT INTO users(email,password_hash,role,active,created_at)
      SELECT '${exemptEmail}',password_hash,'PATIENT',TRUE,now() FROM users WHERE email='${ownerEmail}';
    INSERT INTO patient(user_id,first_name,last_name) SELECT id,'Historico','Sintetico' FROM users WHERE email='${exemptEmail}';
    INSERT INTO dentist(user_id,first_name,last_name,phone) SELECT id,'Dentista','Sintetico','5550102' FROM users WHERE email='${dentistEmail}';
    INSERT INTO clinic_schedule(clinic_id,day_of_week,start_time,end_time) SELECT id,day,'09:00','18:00' FROM clinic CROSS JOIN generate_series(1,7) day;
    INSERT INTO dentist_schedule(dentist_id,day_of_week,start_time,end_time) SELECT id,day,'09:00','18:00' FROM dentist CROSS JOIN generate_series(1,7) day;
    INSERT INTO service_catalog_item(name,reference_price,duration_minutes) VALUES ('Servicio sintetico',0,30);
    SELECT json_build_object('dentistId',(SELECT id FROM dentist WHERE user_id=(SELECT id FROM users WHERE email='${dentistEmail}')),
      'serviceId',(SELECT id FROM service_catalog_item),'date',((now() AT TIME ZONE 'UTC')::date+2)::text);
    COMMIT;`));
  const fixturePath = resolve(output, 'fixture.json');
  writeFileSync(fixturePath, JSON.stringify({ ...fixture, api, web, database, password, ownerEmail, dentistEmail, receptionEmail, exemptEmail }), { mode: 0o600 });
  console.log(`Entorno NUEVO verificado: ${name}, PostgreSQL tmpfs :${bindings[0].HostPort}, backend ${api}. Evidencia: ${output}`);
  const browser = spawn('npm', ['run', 'test:e2e', '--', '--config', 'playwright.intake-real.config.ts', ...process.argv.slice(2)], { cwd: frontend, stdio: 'inherit', env: {
    ...process.env, DENTALCLINIC_INTAKE_REAL: '1', DENTALCLINIC_INTAKE_FIXTURE: fixturePath, DENTALCLINIC_INTAKE_PG_CONTAINER: name,
  } });
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
  // Solo el ID obtenido del docker run de ESTA ejecución, nunca nombres/volúmenes preexistentes.
  if (containerId) run('docker', ['stop', containerId]);
  log.end();
}
