/** Backend actual sin editar Java + PostgreSQL Testcontainers propios. Nunca usa bases existentes. */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdtempSync, readFileSync } from 'node:fs';
import { once } from 'node:events';
import { delimiter, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const frontend = resolve(fileURLToPath(new URL('..', import.meta.url)));
const backendDirectory = resolve(frontend, '../backend');
const output = mkdtempSync('/tmp/opencode/dentalclinic-financial-f4a-real-');
const classpathFile = resolve(output, 'classpath.txt');
const compile = spawnSync('mvn', ['-o', 'test-compile', 'dependency:build-classpath', '-Dmdep.includeScope=test', `-Dmdep.outputFile=${classpathFile}`],
  { cwd: backendDirectory, stdio: 'inherit' });
if (compile.status !== 0) process.exit(compile.status ?? 1);

const migrations = [
  'V001__baseline.sql', 'V002__identity_access.sql', 'V003__clinic_onboarding.sql', 'V004__patients_clinical.sql',
  'V005__scheduling.sql', 'V006__appointments.sql', 'V007__service_catalog.sql', 'V008__appointment_service_snapshot.sql',
  'V009__treatments.sql', 'V010__odontogram.sql', 'V011__odontogram_surfaces.sql', 'V012__treatment_evolution.sql',
  'V013__clinical_appointment_context.sql', 'V014__clinical_corrections.sql', 'V015__odontogram_history_context.sql', 'V016__financial_module.sql', 'V017__patient_feedback.sql',
];
const args = ['-cp', [resolve(backendDirectory, 'target/test-classes'), resolve(backendDirectory, 'target/classes'), readFileSync(classpathFile, 'utf8').trim()].join(delimiter),
  'com.dentalclinic.DentalClinicApplication', '--spring.profiles.active=test', '--server.port=0', '--server.address=127.0.0.1',
  '--spring.datasource.url=jdbc:tc:postgresql:16:///dentalclinic_financial_f4a_browser',
  '--spring.datasource.driver-class-name=org.testcontainers.jdbc.ContainerDatabaseDriver',
  '--spring.jpa.hibernate.ddl-auto=validate', '--spring.sql.init.mode=always',
  `--spring.sql.init.schema-locations=${migrations.map((name) => `file:../db/schema/${name}`).join(',')}`,
  '--dentalclinic.security.cors.allowed-origins=http://localhost:5195', '--dentalclinic.fixtures.enabled=false',
  '--dentalclinic.communication.email.enabled=false', '--dentalclinic.communication.dispatch.enabled=false',
  '--dentalclinic.appointment.reminder.enabled=false', '--dentalclinic.appointment.reminder.email-delivery-enabled=false'];

const log = createWriteStream(resolve(output, 'backend.log'));
const backend = spawn('java', args, { cwd: backendDirectory, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
for (const stream of [backend.stdout, backend.stderr]) stream.on('data', (chunk) => { logs += chunk.toString(); log.write(chunk); });
const PASSWORD = 'Synthetic-Financial4A-2026!';
const emails = { owner: 'owner-fin4a@isolated.test', dentist: 'dentist-fin4a@isolated.test',
  reception: 'reception-fin4a@isolated.test', patient: 'patient-fin4a@isolated.test' };

try {
  let port;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (backend.exitCode !== null) throw new Error(`El backend efimero no arranco. Evidencia: ${output}/backend.log`);
    const match = logs.match(/Tomcat started on port (\d+)/);
    if (match) { port = Number(match[1]); break; }
    await new Promise((done) => setTimeout(done, 200));
  }
  if (!port) throw new Error(`No se obtuvo puerto efimero. Evidencia: ${output}/backend.log`);
  const containerId = logs.match(/Container postgres:16 is starting: ([a-f0-9]{64})/)?.[1];
  if (!containerId) throw new Error('No se pudo identificar el PostgreSQL creado por ESTE proceso.');
  const inspected = spawnSync('docker', ['inspect', containerId], { encoding: 'utf8' });
  if (inspected.status !== 0) throw new Error('No se pudo verificar el contenedor temporal.');
  const container = JSON.parse(inspected.stdout)[0];
  if (container.Config.Labels['org.testcontainers'] !== 'true' || container.Config.Image !== 'postgres:16'
      || container.Name.includes('dentalclinic-postgres') || container.Mounts.some((mount) => mount.Name === 'dentalclinic_pgdata')
      || container.NetworkSettings.Ports['5432/tcp'].some((binding) => binding.HostPort === '5434')) {
    throw new Error('El aislamiento del destino no es verificable. Se aborta antes de escribir fixtures.');
  }
  const base = `http://127.0.0.1:${port}`;
  const onboard = await fetch(base + '/api/onboarding', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner: { email: emails.owner, password: PASSWORD }, dentist: { firstName: 'Propietario', lastName: 'Sintetico', phone: '600001001' }, clinic: { name: 'Clinica sintetica F4A', timezone: 'America/Mexico_City' } }) });
  if (!onboard.ok) throw new Error(`Onboarding sintetico devolvio ${onboard.status}.`);
  // Unicamente el contenedor observado/validado arriba; no puertos ni credenciales de desarrollo.
  const sql = `
WITH du AS (INSERT INTO users(email,password_hash,role,active,created_at)
 SELECT '${emails.dentist}',password_hash,'DENTIST',TRUE,now() FROM users WHERE email='${emails.owner}' RETURNING id),
 od AS (INSERT INTO users(email,password_hash,role,active,created_at)
 SELECT 'other-fin4a@isolated.test',password_hash,'DENTIST',TRUE,now() FROM users WHERE email='${emails.owner}' RETURNING id),
 ru AS (INSERT INTO users(email,password_hash,role,active,created_at)
 SELECT '${emails.reception}',password_hash,'RECEPTIONIST',TRUE,now() FROM users WHERE email='${emails.owner}' RETURNING id),
 pu AS (INSERT INTO users(email,password_hash,role,active,created_at)
 SELECT '${emails.patient}',password_hash,'PATIENT',TRUE,now() FROM users WHERE email='${emails.owner}' RETURNING id),
 dp AS (INSERT INTO dentist(user_id,first_name,last_name,phone) SELECT id,'Dentista','Sintetico','600001002' FROM du RETURNING id),
 op AS (INSERT INTO dentist(user_id,first_name,last_name,phone) SELECT id,'Otro','Sintetico','600001003' FROM od RETURNING id),
 p AS (INSERT INTO patient(user_id,first_name,last_name,phone) SELECT id,'Ada','Finanzas','600001004' FROM pu RETURNING id),
 a AS (INSERT INTO appointment(patient_id,dentist_id,created_by_user_id,start_at,end_at,duration_minutes,status,completed_at)
 SELECT p.id,dp.id,u.id,'2026-10-14T00:00:00Z','2026-10-14T01:00:00Z',60,'COMPLETED','2026-10-14T01:00:00Z'
 FROM p,dp,users u WHERE u.email='${emails.owner}' RETURNING id),
 b AS (INSERT INTO appointment(patient_id,dentist_id,created_by_user_id,start_at,end_at,duration_minutes,status,completed_at)
 SELECT p.id,op.id,u.id,'2026-10-14T02:00:00Z','2026-10-14T03:00:00Z',60,'COMPLETED','2026-10-14T03:00:00Z'
 FROM p,op,users u WHERE u.email='${emails.owner}' RETURNING id)
SELECT json_build_object('patientId',(SELECT id FROM p),'dentistId',(SELECT id FROM dp),'otherDentistId',(SELECT id FROM op),
 'appointmentId',(SELECT id FROM a),'otherAppointmentId',(SELECT id FROM b));`;
  const seeded = spawnSync('docker', ['exec', '-i', containerId, 'psql', '-U', 'test', '-d', 'test', '-v', 'ON_ERROR_STOP=1', '-tA'], { input: sql, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`Fallo de fixtures sinteticas: ${seeded.stderr}`);
  const fixture = JSON.parse(seeded.stdout.trim());
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: emails.owner, password: PASSWORD }) });
  if (!login.ok) throw new Error('No se pudo autenticar el propietario sintetico.');
  const { accessToken } = await login.json();
  async function createSeed(appointmentId, items) {
    const response = await fetch(base + '/api/charges', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ patientId: fixture.patientId, appointmentId, items, notes: 'Fixture sintetica F4A' }) });
    if (!response.ok) throw new Error(`El cargo sintetico fue rechazado: ${response.status}.`);
    return (await response.json()).id;
  }
  const item = (dentistId, description) => ({ treatingDentistId: dentistId, description, quantity: 1, unitPrice: 50 });
  fixture.ownChargeId = await createSeed(fixture.appointmentId, [item(fixture.dentistId, 'Cargo propio semilla')]);
  fixture.foreignChargeId = await createSeed(fixture.otherAppointmentId, [item(fixture.otherDentistId, 'Cargo ajeno semilla')]);
  fixture.mixedChargeId = await createSeed(fixture.appointmentId, [item(fixture.dentistId, 'Concepto propio'), item(fixture.otherDentistId, 'Concepto ajeno')]);
  fixture.unlinkedChargeId = await createSeed(null, [item(null, 'Cargo sin cita semilla')]);
  console.log(`Aislamiento verificado: PostgreSQL Testcontainers ${containerId.slice(0, 12)}, backend ${base}. Evidencia: ${output}`);
  const browser = spawn('npm', ['run', 'test:e2e', '--', '--config', 'playwright.financial.config.ts', ...process.argv.slice(2)], { cwd: frontend, stdio: 'inherit', env: {
    ...process.env, DENTALCLINIC_FINANCIAL_API_URL: base, DENTALCLINIC_FINANCIAL_OUTPUT: resolve(output, 'browser'),
    DENTALCLINIC_FINANCIAL_FIXTURE: JSON.stringify({ ...fixture, emails }), DENTALCLINIC_FINANCIAL_PASSWORD: PASSWORD,
  } });
  const [code] = await once(browser, 'exit');
  process.exitCode = code ?? 1;
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
} finally {
  if (backend.exitCode === null && backend.signalCode === null) {
    backend.kill('SIGTERM');
    await Promise.race([once(backend, 'exit'), new Promise((done) => setTimeout(done, 10_000))]);
    if (backend.exitCode === null && backend.signalCode === null) backend.kill('SIGKILL');
  }
  log.end();
}
