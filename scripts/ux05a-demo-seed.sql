-- =============================================================================
-- UX-05A.1 · Seed sintético del entorno de demostración del Inicio DENTIST.
--
-- SOLO DESARROLLO/DEMO. Se ejecuta EXCLUSIVAMENTE contra la base de demostración
-- aislada creada por `scripts/run-ux05a-demo.mjs` (contenedor efímero, tmpfs,
-- puerto aleatorio, base/credenciales propias) o por `scripts/ux05a-demo-updown.sh`
-- (contenedor `dentalclinic-demo-pg`, puerto 5436, volumen `dentalclinic_demo_pgdata`).
--
-- NUNCA contra `dentalclinic-postgres` / `dentalclinic` / `dentalclinic_pgdata`
-- ni contra ninguna base o volumen del proyecto `consultorio`.
--
-- No crea tablas, columnas ni relaciones: respeta el esquema V001–V019 y todas
-- sus CHECK/FK/UNIQUE y el EXCLUDE de solapamiento de citas programadas.
--
-- Parámetros obligatorios (psql -v):
--   dentist_email         correo del usuario DENTIST ya creado por el onboarding
--   empty_dentist_email   correo de un segundo DENTIST sin citas (estado vacío real)
--   timezone              zona IANA de la clínica (p. ej. America/Mexico_City)
--
-- Fechas relativas al día clínico del entorno demo (hoy en `timezone`), para que
-- el escenario no quede obsoleto mañana.
-- =============================================================================

\set ON_ERROR_STOP on

-- Guarda dura: aborta si la base conectada no es explícitamente la de demo.
DO $$
BEGIN
  IF current_database() NOT LIKE '%demo%' AND current_database() NOT LIKE '%9d6a%'
     AND current_database() NOT LIKE '%ux05a%' THEN
    RAISE EXCEPTION 'Este seed solo puede ejecutarse contra una base de DEMO (nombre con demo/9d6a/ux05a). Base actual: %', current_database();
  END IF;
END $$;

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Servicios de ejemplo (uno o varios). Se respetan nombre no vacío,
--    precio >= 0 y duración > 0 del catálogo real.
-- ---------------------------------------------------------------------------
INSERT INTO service_catalog_item (name, description, reference_price, duration_minutes, active)
SELECT * FROM (VALUES
  ('Limpieza dental (profilaxis)', 'Higiene dental de rutina y revisión.', 650.0000::numeric, 30, TRUE),
  ('Resina simple', 'Obturación estética de una superficie.', 900.0000::numeric, 45, TRUE),
  ('Endodoncia unirradicular', 'Tratamiento de conducto en una raíz.', 3200.0000::numeric, 90, TRUE),
  ('Consulta de valoración', 'Valoración inicial y plan de tratamiento.', 400.0000::numeric, 30, TRUE)
) AS v(name, description, reference_price, duration_minutes, active)
WHERE NOT EXISTS (SELECT 1 FROM service_catalog_item s WHERE s.name = v.name);

-- ---------------------------------------------------------------------------
-- 2) Perfil profesional del dentista demo (1:1 con users). Reutiliza el hash de
--    la contraseña del propietario creado por el onboarding (misma credencial demo).
-- ---------------------------------------------------------------------------
INSERT INTO dentist (user_id, first_name, last_name, phone, specialty, license_number, public_info)
SELECT u.id, 'Dermatr', 'Demostración', '555-0140', 'Odontología general', 'DEMO-0001',
       'Perfil sintético del entorno de demostración UX-05A.'
FROM users u WHERE u.email = :'dentist_email'
ON CONFLICT (user_id) DO NOTHING;

-- Segundo profesional, sin citas: sirve para capturar el estado vacío REAL del Inicio
-- (respuesta legítima del backend, sin mocks), conservando la misma identidad visual.
INSERT INTO dentist (user_id, first_name, last_name, phone, specialty, license_number, public_info)
SELECT u.id, 'Dermatr', 'Sin agenda', '555-0141', 'Odontología general', 'DEMO-0002',
       'Perfil sintético sin citas del entorno de demostración UX-05A.'
FROM users u WHERE u.email = :'empty_dentist_email'
ON CONFLICT (user_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3) Horarios de clínica y dentista: lunes a viernes 09:00–18:00, sábado
--    09:00–13:00. Ausencia de fila = cerrado; respeta CHECK start < end.
-- ---------------------------------------------------------------------------
INSERT INTO clinic_schedule (clinic_id, day_of_week, start_time, end_time)
SELECT c.id, d, '09:00'::time, CASE WHEN d = 6 THEN '13:00'::time ELSE '18:00'::time END
FROM clinic c CROSS JOIN generate_series(1, 6) AS d
WHERE NOT EXISTS (SELECT 1 FROM clinic_schedule cs WHERE cs.clinic_id = c.id AND cs.day_of_week = d);

INSERT INTO dentist_schedule (dentist_id, day_of_week, start_time, end_time)
SELECT dt.id, d, '09:00'::time, CASE WHEN d = 6 THEN '13:00'::time ELSE '18:00'::time END
FROM dentist dt CROSS JOIN generate_series(1, 6) AS d
WHERE dt.user_id = (SELECT id FROM users WHERE email = :'dentist_email')
  AND NOT EXISTS (SELECT 1 FROM dentist_schedule ds WHERE ds.dentist_id = dt.id AND ds.day_of_week = d);

INSERT INTO dentist_schedule (dentist_id, day_of_week, start_time, end_time)
SELECT dt.id, d, '09:00'::time, CASE WHEN d = 6 THEN '13:00'::time ELSE '18:00'::time END
FROM dentist dt CROSS JOIN generate_series(1, 6) AS d
WHERE dt.user_id = (SELECT id FROM users WHERE email = :'empty_dentist_email')
  AND NOT EXISTS (SELECT 1 FROM dentist_schedule ds WHERE ds.dentist_id = dt.id AND ds.day_of_week = d);

-- ---------------------------------------------------------------------------
-- 4) Pacientes ficticios (6), sin cuenta de usuario vinculada. Nombres y
--    contactos claramente sintéticos; sin datos clínicos reales.
-- ---------------------------------------------------------------------------
INSERT INTO patient (first_name, last_name, email, phone, birth_date, active)
SELECT * FROM (VALUES
  ('Lucía',  'Ramírez Demo',   'lucia.ramirez@demo.test',   '555-1001', DATE '1990-03-14', TRUE),
  ('Mateo',  'Hernández Demo', 'mateo.hernandez@demo.test', '555-1002', DATE '1984-07-22', TRUE),
  ('Sofía',  'Castro Demo',    'sofia.castro@demo.test',    '555-1003', DATE '2001-11-05', TRUE),
  ('Diego',  'Navarro Demo',   'diego.navarro@demo.test',   '555-1004', DATE '1978-01-30', TRUE),
  ('Valeria','Ortiz Demo',     'valeria.ortiz@demo.test',   '555-1005', DATE '1995-09-18', TRUE),
  ('Emilio', 'Vargas Demo',    'emilio.vargas@demo.test',   '555-1006', DATE '1969-05-09', TRUE)
) AS v(first_name, last_name, email, phone, birth_date, active)
WHERE NOT EXISTS (SELECT 1 FROM patient p WHERE p.email = v.email);

-- ---------------------------------------------------------------------------
-- 5) Citas del día clínico y fechas próximas, con estados válidos del dominio:
--    SCHEDULED, COMPLETED, CANCELLED, NO_SHOW.
--
--    Reglas respetadas:
--      * duration_minutes > 0 y end_at > start_at.
--      * (status='COMPLETED') = (completed_at IS NOT NULL).
--      * snapshot de servicio: las 4 columnas service_* presentes y
--        duration_minutes = service_duration_minutes (V008).
--      * EXCLUDE de solapamiento solo aplica a SCHEDULED: las citas programadas
--        del dentista no se solapan entre sí.
--      * Fechas relativas a "hoy" en la zona de la clínica.
--
--    Se insertan con una CTE que resuelve los ids reales y valida la coherencia.
-- ---------------------------------------------------------------------------
WITH ctx AS (
  SELECT
    (SELECT id FROM dentist WHERE user_id = (SELECT id FROM users WHERE email = :'dentist_email')) AS dentist_id,
    (SELECT id FROM users   WHERE email = :'dentist_email') AS dentist_user_id,
    (date_trunc('day', (now() AT TIME ZONE :'timezone')) AT TIME ZONE :'timezone') AS day_start
),
svc AS (
  SELECT name, id, duration_minutes, reference_price FROM service_catalog_item
),
p AS (
  SELECT first_name, id FROM patient
),
plan(label, patient_first, service_name, day_offset, start_hhmm, status) AS (
  VALUES
    -- Jornada de hoy
    ('hoy-1', 'Lucía',   'Limpieza dental (profilaxis)',  0, '09:00'::text, 'COMPLETED'::text),
    ('hoy-2', 'Mateo',   'Resina simple',                 0, '10:00'::text, 'COMPLETED'::text),
    ('hoy-3', 'Sofía',   'Consulta de valoración',        0, '11:00'::text, 'NO_SHOW'::text),
    ('hoy-4', 'Diego',   'Endodoncia unirradicular',      0, '12:00'::text, 'CANCELLED'::text),
    ('hoy-5', 'Valeria', 'Limpieza dental (profilaxis)',  0, '16:00'::text, 'SCHEDULED'::text),
    ('hoy-6', 'Emilio',  'Consulta de valoración',        0, '17:00'::text, 'SCHEDULED'::text),
    -- Próximas fechas (la primera SCHEDULED de mañana es "la siguiente cita")
    ('prox-1','Lucía',   'Resina simple',                 1, '09:30'::text, 'SCHEDULED'::text),
    ('prox-2','Mateo',   'Limpieza dental (profilaxis)',  2, '10:00'::text, 'SCHEDULED'::text),
    ('prox-3','Sofía',   'Endodoncia unirradicular',      4, '11:00'::text, 'SCHEDULED'::text)
),
rows AS (
  SELECT
    pp.id AS patient_id,
    cx.dentist_id,
    cx.dentist_user_id,
    (cx.day_start + make_interval(days => plan.day_offset, hours => split_part(plan.start_hhmm, ':', 1)::int, mins => split_part(plan.start_hhmm, ':', 2)::int)) AS start_at,
    s.id AS service_id, s.name AS service_name, s.duration_minutes, s.reference_price,
    plan.status
  FROM plan
  JOIN ctx cx ON TRUE
  JOIN p pp ON pp.first_name = plan.patient_first
  JOIN svc s ON s.name = plan.service_name
)
INSERT INTO appointment (
  patient_id, dentist_id, created_by_user_id,
  start_at, end_at, duration_minutes, status, occurrence_version,
  reason, notes, completed_at, created_at, updated_at,
  service_id, service_name, service_description, service_reference_price, service_duration_minutes
)
SELECT
  r.patient_id, r.dentist_id, r.dentist_user_id,
  r.start_at,
  r.start_at + make_interval(mins => r.duration_minutes),
  r.duration_minutes,
  r.status, 1,
  NULL, NULL,
  CASE WHEN r.status = 'COMPLETED' THEN r.start_at + make_interval(mins => r.duration_minutes) ELSE NULL END,
  now(), now(),
  r.service_id, r.service_name, NULL, r.reference_price, r.duration_minutes
FROM rows r
WHERE NOT EXISTS (
  SELECT 1 FROM appointment a
  WHERE a.patient_id = r.patient_id AND a.start_at = r.start_at AND a.dentist_id = r.dentist_id
);

-- ---------------------------------------------------------------------------
-- 6) Notificaciones ficticias propias del dentista, sin datos clínicos sensibles.
--    Buzón = cuenta del dentista; sin appointment_id para no inventar el vínculo.
-- ---------------------------------------------------------------------------
INSERT INTO notification (user_id, title, body, priority, related_type, created_at)
SELECT u.id, v.title, v.body, v.priority, 'DEMO', now() - make_interval(hours => v.hours_ago)
FROM (VALUES
  ('Recordatorio de agenda', 'Tienes citas programadas en tu jornada clínica de hoy.', 'NORMAL', 1),
  ('Recordatorio de agenda', 'Tu próxima cita confirmada está agendada en el calendario.', 'NORMAL', 3),
  ('Aviso del sistema', 'Entorno de demostración: los datos mostrados son sintéticos.', 'NORMAL', 6),
  ('Revisión pendiente', 'Hay una cita marcada con ausencia en tu agenda de hoy.', 'HIGH', 9)
) AS v(title, body, priority, hours_ago)
CROSS JOIN users u
WHERE u.email = :'dentist_email'
  AND NOT EXISTS (SELECT 1 FROM notification n WHERE n.user_id = u.id AND n.related_type = 'DEMO');

COMMIT;

-- ---------------------------------------------------------------------------
-- Resumen (para la consola del launcher).
-- ---------------------------------------------------------------------------
SELECT json_build_object(
  'dentistId', (SELECT id FROM dentist WHERE user_id = (SELECT id FROM users WHERE email = :'dentist_email')),
  'dentistUserId', (SELECT id FROM users WHERE email = :'dentist_email'),
  'emptyDentistId', (SELECT id FROM dentist WHERE user_id = (SELECT id FROM users WHERE email = :'empty_dentist_email')),
  'emptyDentistUserId', (SELECT id FROM users WHERE email = :'empty_dentist_email'),
  'clinicTimezone', (SELECT timezone FROM clinic LIMIT 1),
  'today', (date_trunc('day', (now() AT TIME ZONE :'timezone')))::date::text,
  'patients', (SELECT count(*) FROM patient WHERE email LIKE '%@demo.test'),
  'services', (SELECT count(*) FROM service_catalog_item),
  'appointments', (SELECT count(*) FROM appointment WHERE dentist_id = (SELECT id FROM dentist WHERE user_id = (SELECT id FROM users WHERE email = :'dentist_email'))),
  'notifications', (SELECT count(*) FROM notification WHERE user_id = (SELECT id FROM users WHERE email = :'dentist_email')),
  'nextAppointmentAt', (SELECT min(start_at)::text FROM appointment
      WHERE dentist_id = (SELECT id FROM dentist WHERE user_id = (SELECT id FROM users WHERE email = :'dentist_email'))
        AND status = 'SCHEDULED' AND start_at >= now())
)::text;
