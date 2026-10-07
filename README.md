# Deploy your system 2026

Motor PaaS propio. Clona un repositorio público de GitHub, lo construye con Nixpacks, lo corre en Docker y lo publica con Caddy. Postgres guarda usuarios, proyectos, despliegues y bases. Redis guarda la cola y los logs en vivo.

El remoto es `https://github.com/JDLBARRERA/DEPLOY-YOUR-SYSTEM-NOW-2026.git`, rama `main`. El motor que ya está en GitHub incluye el panel local, los webhooks y los archivos de producción. El panel remoto `mi-paas-dashboard` está en esta carpeta y todavía no forma parte de un commit.

La guía de lo que quedó corriendo en el Droplet está en [SETUP.md](SETUP.md).

## Cómo está armado

```text
.
├── src/                         API Fastify (no hay apps/api)
│   ├── index.ts                 Arranque, CORS y rutas
│   ├── routes/                  /deploy, /deployments, /databases, /webhooks/github
│   ├── services/                Motor, Caddy, bases, webhooks, logs, dominio
│   ├── workers/deployWorker.ts  Consumidor de la cola
│   └── queues/                  Cola BullMQ "deploys"
├── apps/dashboard/              Panel local con Auth.js, puerto 3001
├── mi-paas-dashboard/           Panel remoto, puerto 3000, sin login
├── prisma/                      Esquema y migraciones compartidos
├── infra/                       Compose local, compose de producción, Caddy, PgBouncer
└── docker-compose.yml           Postgres, PgBouncer, Redis y Caddy en local
```

El panel local y la API usan el cliente Prisma generado desde `prisma/schema.prisma`. Ese cliente no se sube a git.

```text
Esta máquina
   │
   ├─ apps/dashboard :3001
   │     Auth.js, equipos, variables por ámbito, métricas
   │     habla con la API local :3000
   │
   ├─ mi-paas-dashboard :3000
   │     Overview, Deployments, Databases, Settings
   │     el navegador llama a /backend
   │     Next reescribe /backend hacia el Droplet
   │
   └─ API local :3000
         Redis (cola + logs SSE)
         Worker → git clone → nixpacks → Docker
         Caddy → {nombre}.localhost
         Postgres :5432 y PgBouncer :6543

Droplet 46.101.84.190
   Caddy :80 → Fastify :3000
   Postgres, PgBouncer y Redis en Docker
   El detalle de ese arranque está en SETUP.md
```

Hay dos paneles a propósito. `apps/dashboard` es el control plane de esta máquina, con sesión. `mi-paas-dashboard` opera el motor que ya responde en el Droplet y no pide login, porque esos endpoints públicos tampoco la piden.

## Qué ya funciona

| Área | Estado |
| --- | --- |
| Clonar un repo público, construir con Nixpacks y levantar el contenedor | Hecho |
| Cola BullMQ, logs en vivo y CPU/RAM por SSE | Hecho |
| Caddy en `{proyecto}.localhost` en local | Hecho |
| Panel local con login, registro y GitHub OAuth | Hecho |
| Primer usuario admin, con equipo personal. Sesión de 30 días | Hecho |
| Producción si el push es la rama del proyecto; el resto y los PR son preview | Hecho |
| Variables `ALL`, `PRODUCTION` y `PREVIEW` | Hecho |
| Base por proyecto, pool, URL directa y branch con `TEMPLATE` | Hecho |
| Compose de producción, Caddy con TLS y `infra/setup-ubuntu.sh` | Escrito en el repo |
| Motor alcanzable en `http://46.101.84.190` | Hecho |
| Panel remoto contra ese motor | Hecho |

### API

- `POST /deploy` encola `{ repoUrl, projectName, deploymentId? }` y responde `202`.
- `GET /deployments` devuelve `{ projectId, projectName, repoUrl, image, port, status, host, url, createdAt }`. Estados: `queued`, `building`, `running`, `failed`.
- `GET /deployments/:projectId/logs` y `GET /deployments/:projectId/stats` abren SSE.
- `GET /databases` devuelve `{ id, name, dbName, pooledUrl, directUrl, host, port, projectId, createdAt }`.
- `POST /databases` crea una base. `POST /databases/:dbName/branch` la clona. `POST /databases/:id/link` escribe `DATABASE_URL` y `DIRECT_URL` en el proyecto.
- `POST /webhooks/github` valida `x-hub-signature-256`. Si la rama del push es `Project.branch` (por defecto `main`), el despliegue es producción. Otra rama o un pull request es preview.

En local el host es `{nombre}.localhost` y la URL es `http`. Con `APP_DOMAIN` distinto de `localhost`, la URL pasa a `https://{nombre}.{APP_DOMAIN}`.

### Panel local (`apps/dashboard`)

- `/login` y `/register`. Quien ya tiene sesión vuelve a `/`.
- Un invitado que entra a `/`, `/dashboard`, `/projects`, `/databases` o `/deployments` va a `/login`.
- Despliegues con badge Production/Preview, autor y medidores de CPU y RAM.
- Bases: crear, copiar las dos URLs, crear branch y vincular a un proyecto.
- Variables de entorno por ámbito en cada proyecto.

### Panel remoto (`mi-paas-dashboard`)

Corre en `http://localhost:3000`. El navegador no llama a la IP. `next.config.mjs` reescribe `/backend/*` hacia `API_URL` (`http://46.101.84.190` en `.env.local`).

- Overview: total de despliegues, cuántos están `running`, total de bases y si el API respondió.
- Deployments: tabla y diálogo con `repoUrl` y `projectName`.
- Databases: tarjetas y copia de `pooledUrl`. El diálogo pide `name` y un `projectId` opcional.
- Settings: muestra `/backend` y el valor de `API_URL`.

### Datos

Postgres del control plane guarda `User`, `Team`, `Project`, `Deployment`, `EnvVar`, `DatabaseInstance` y `ApiKey`, más las tablas de Auth.js. La contraseña de cada base de proyecto se guarda cifrada. Redis solo guarda la cola y los logs.

La API local usa PgBouncer:

`DATABASE_URL="postgresql://paas:paas@localhost:6543/paas?schema=public"`

## Cómo levantarlo en esta máquina

Hace falta Docker Desktop, Nixpacks en el `PATH` y Node.js.

```powershell
copy .env.example .env
docker compose up -d
npm install
npx prisma migrate dev
npm run dev
npm run worker
```

Panel local, en otra terminal:

```powershell
cd apps/dashboard
npm install
npm run dev -- --port 3001
```

Panel remoto, en otra terminal:

```powershell
cd mi-paas-dashboard
npm install
npm run dev -- --port 3000
```

`apps/dashboard/.env.local` lleva `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL=http://localhost:3001`, `NEXT_PUBLIC_API_URL=http://localhost:3000` y las claves `AUTH_GITHUB_ID` y `AUTH_GITHUB_SECRET`. `mi-paas-dashboard/.env.local` solo lleva `API_URL`. Ninguno de esos archivos se sube a git.

| Servicio | Dirección |
| --- | --- |
| Panel remoto | http://localhost:3000 |
| Panel local | http://localhost:3001 |
| API local | http://localhost:3000 |
| API del Droplet | http://46.101.84.190 |
| Postgres | 127.0.0.1:5432 |
| PgBouncer | 127.0.0.1:6543 |
| Redis | 127.0.0.1:6379 |
| Caddy local | http://80 y admin en 127.0.0.1:2019 |

Un sitio desplegado en local responde en `http://{nombre}.localhost`.

Si el panel remoto y la API local se arrancan a la vez, los dos quieren el puerto 3000. Para usar los dos, el panel remoto puede ir en otro puerto: `npm run dev -- --port 3010`. El rewrite sigue saliendo hacia el Droplet.

## Qué sigue

1. Registrar en GitHub el webhook hacia el motor público, con el mismo `GITHUB_WEBHOOK_SECRET`.
2. Al cerrar un pull request, apagar el contenedor preview y borrar el clon de la base.
3. Exigir sesión o `ApiKey` en `/deploy` y `/databases`. Hoy aceptan la petición si el CORS lo permite.
4. Borrar una base y rotar su contraseña desde el panel.
5. Aceptar repositorios privados.
6. Límites de CPU y memoria al crear el contenedor. El panel ya muestra el consumo.
7. Pruebas automatizadas y un workflow de GitHub Actions.
8. Dejar el Droplet sirviendo el compose de `infra/docker-compose.prod.yml`. El arranque que ya responde está descrito en [SETUP.md](SETUP.md).
