#!/usr/bin/env bash
# =============================================================================
# UX-05A.1 · Demo PERSISTENTE del Inicio DENTIST (entorno aislado, puerto 5436).
#
# SOLO DESARROLLO/DEMO. No toca la instalación persistente del proyecto
# (`dentalclinic-postgres`, puerto 5434, base `dentalclinic`, volumen `dentalclinic_pgdata`)
# ni nada del proyecto `consultorio`.
#
#   up    -> crea/levanta la base demo aislada (V001–V019) + onboarding + seed sintético.
#   reset -> destruye y recrea SOLO el volumen demo y vuelve a sembrar.
#   down  -> detiene SOLO el contenedor demo.
#   nuke  -> `down -v` SOLO del demo (elimina el volumen demo). Pide confirmación.
#   sql   -> abre psql contra la base demo.
#   info  -> muestra rutas de datos y credenciales del demo (no de producción).
#
# El backend y el frontend se arrancan por separado (ver salida de `info`), apuntando
# EXCLUSIVAMENTE a esta base demo.
#
# Nunca lee `.env` ni `owner-e2e.env`. No activa SMTP, recordatorios ni enlaces.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE=(docker compose -f "${ROOT}/docker-compose.demo.yml")
CONTAINER="dentalclinic-demo-pg"
DEMO_DB="dentalclinic_ux05a_demo"
DEMO_USER="ux05a_demo"
DEMO_TZ="America/Mexico_City"
OWNER_EMAIL="owner@ux05a-demo.test"
DENTIST_EMAIL="dentista.demo@ux05a-demo.test"
EMPTY_DENTIST_EMAIL="dentista.vacio@ux05a-demo.test"
API="http://127.0.0.1:8086"

log() { printf '\033[36m%s\033[0m\n' "$*"; }
die() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

guard_isolation() {
  # Rechaza explícitamente cualquier objetivo que no sea el entorno demo.
  if docker ps --format '{{.Names}}' | grep -qx 'dentalclinic-postgres'; then :; fi
  if [[ "${DEMO_DB}" != *demo* ]]; then die "Nombre de base sin 'demo': ${DEMO_DB}"; fi
  local port
  port="$(docker port "${CONTAINER}" 2>/dev/null || true)"
  if [[ "${port}" == *":5434"* ]]; then die "La base demo NO debe publicarse en 5434."; fi
  if docker volume inspect dentalclinic_pgdata >/dev/null 2>&1; then
    # Solo comprobación de presencia; nunca se opera sobre él.
    :
  fi
}

wait_db() {
  local deadline=$((SECONDS + 60))
  until docker exec "${CONTAINER}" pg_isready -h 127.0.0.1 -U "${DEMO_USER}" -d "${DEMO_DB}" >/dev/null 2>&1; do
    (( SECONDS < deadline )) || die "PostgreSQL demo no disponible."
    sleep 1
  done
}

psql_demo() { docker exec -i "${CONTAINER}" psql -X -qAt -U "${DEMO_USER}" -d "${DEMO_DB}" -v ON_ERROR_STOP=1 "$@"; }

seed() {
  log "Onboarding + seed sintético contra la base demo ${DEMO_DB}…"
  local onboard
  onboard="$(curl -fsS -X POST "${API}/api/onboarding" -H 'Content-Type: application/json' -d "$(cat <<JSON
{"owner":{"email":"${OWNER_EMAIL}","password":"${DEMO_PASSWORD}"},
 "dentist":{"firstName":"Propietario","lastName":"Demo","phone":"555-0100"},
 "clinic":{"name":"Clínica Demo UX-05A","timezone":"${DEMO_TZ}"}}
JSON
)")" || die "Onboarding falló (¿está el backend demo en ${API}?)."
  log "Onboarding: ${onboard}"

  psql_demo -c "INSERT INTO users(email,password_hash,role,active,created_at)
                SELECT '${DENTIST_EMAIL}',password_hash,'DENTIST',TRUE,now() FROM users WHERE email='${OWNER_EMAIL}'
                ON CONFLICT (email) DO NOTHING;
                INSERT INTO users(email,password_hash,role,active,created_at)
                SELECT '${EMPTY_DENTIST_EMAIL}',password_hash,'DENTIST',TRUE,now() FROM users WHERE email='${OWNER_EMAIL}'
                ON CONFLICT (email) DO NOTHING;"

  psql_demo -v "dentist_email=${DENTIST_EMAIL}" -v "empty_dentist_email=${EMPTY_DENTIST_EMAIL}" -v "timezone=${DEMO_TZ}" \
    < "${ROOT}/frontend/scripts/ux05a-demo-seed.sql" | tail -1
}

cmd_up() {
  [[ -n "${DEMO_PASSWORD:-}" ]] || die "Exporta DEMO_PASSWORD (contraseña demo) antes de 'up': DEMO_PASSWORD='...' $0 up"
  log "Levantando base demo aislada (${CONTAINER}, puerto 5436)…"
  "${COMPOSE[@]}" up -d
  wait_db
  guard_isolation
  log "Base demo lista. Backend y frontend deben apuntar SOLO a esta base (ver '$0 info')."
}

cmd_info() {
  cat <<EOF

Entorno DEMO aislado (no es la instalación persistente):
  contenedor        : ${CONTAINER}
  puerto host       : 127.0.0.1:5436   (la persistente del proyecto usa 5434)
  base de datos     : ${DEMO_DB}
  usuario/clave     : ${DEMO_USER} / ux05a_demo_password   (solo demo)
  volumen           : dentalclinic_demo_pgdata
  cuenta DENTIST    : ${DENTIST_EMAIL}   (contraseña: la que exportaste en DEMO_PASSWORD)
  cuenta DENTIST vacío (estado vacío real): ${EMPTY_DENTIST_EMAIL}
  cuenta OWNER      : ${OWNER_EMAIL}
  zona de la clínica: ${DEMO_TZ}

Arranca el backend demo (terminal 1), apuntando SOLO a la base demo:
  cd ${ROOT}/backend
  DB_URL='jdbc:postgresql://localhost:5436/${DEMO_DB}' DB_USERNAME=${DEMO_USER} DB_PASSWORD=ux05a_demo_password \\
  SERVER_PORT=8086 SPRING_PROFILES_ACTIVE=dev mvn spring-boot:run

Luego siembra (terminal 2), solo si aún no lo hiciste:
  DEMO_PASSWORD='<tu-clave-demo>' API=http://127.0.0.1:8086 $0 seed

Frontend (terminal 2), apuntando al backend demo:
  cd ${ROOT}/frontend
  VITE_API_PROXY_TARGET='http://127.0.0.1:8086' npm run dev

Abre http://localhost:5173/login e inicia sesión con ${DENTIST_EMAIL}.
EOF
}

cmd_seed() {
  [[ -n "${DEMO_PASSWORD:-}" ]] || die "Exporta DEMO_PASSWORD antes de 'seed'."
  API="${API}" seed
}

cmd_sql()    { docker exec -it "${CONTAINER}" psql -U "${DEMO_USER}" -d "${DEMO_DB}" "$@"; }
cmd_down()   { log "Deteniendo SOLO el contenedor demo…"; "${COMPOSE[@]}" down; }
cmd_reset()  { cmd_nuke_volume; cmd_up; }
cmd_nuke_volume() {
  log "Eliminando SOLO el volumen demo ${CONTAINER}…"
  "${COMPOSE[@]}" down -v
}
cmd_nuke() {
  read -r -p "¿Eliminar el volumen DEMO 'dentalclinic_demo_pgdata'? (escribe 'demo') " answer
  [[ "${answer}" == "demo" ]] || die "Cancelado."
  cmd_nuke_volume; log "Volumen demo eliminado."
}

case "${1:-}" in
  up)    cmd_up ;;
  seed)  cmd_seed ;;
  info)  cmd_info ;;
  sql)   shift; cmd_sql "$@" ;;
  down)  cmd_down ;;
  reset) cmd_reset ;;
  nuke)  cmd_nuke ;;
  *)     grep '^#' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' | head -32; exit 1 ;;
esac
