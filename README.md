# Deploy your system 2026

Motor PaaS propio. Clona un repositorio de GitHub, lo construye con Docker, lo corre en un contenedor y lo publica detrás de Nginx y Caddy. Postgres guarda proyectos, despliegues, variables y bases. Redis guarda la cola y los logs en vivo.

El remoto es `https://github.com/JDLBARRERA/DEPLOY-YOUR-SYSTEM-NOW-2026.git`, rama `main`.

Lo que está corriendo en el Droplet está en [SETUP.md](SETUP.md).

## Cómo está armado

```text
.
├── src/                         API Fastify
│   ├── index.ts                 Arranque, CORS y rutas
│   ├── auth/requireAdmin.ts     Cookie de sesión o x-api-key
│   ├── routes/                  deploy, deployments, databases, projects, webhooks
│   ├── services/                Motor, Caddy, add-ons, webhooks, límites, dominio
│   ├── workers/deployWorker.ts  Consumidor de la cola
│   └── queues/                  Cola BullMQ "deploys"
├── mi-paas-dashboard/           Panel Next.js
├── prisma/                      Esquema y migraciones (Prisma 6.19.3)
├── infra/                       Compose y Caddy
└── docker-compose.yml           Postgres, PgBouncer, Redis y Caddy
```

```text
Internet
   │
   Nginx :80 y :443          (certificado de deplowe-now.com y www)
   │
   ├─ deplowe-now.com
   │     /              → panel Next.js  127.0.0.1:3000
   │     /webhooks/     → API Fastify    127.0.0.1:3001
   │
   ├─ *.deplowe-now.com :443
   │     → Caddy 127.0.0.1:8080
   │
   └─ cualquier otro host :80
         → Caddy 127.0.0.1:8080
           (dominio propio, pensado para Cloudflare en modo Flexible)

Caddy solo escucha en el loopback
   127.0.0.1:8080  HTTP de las apps
   127.0.0.1:2019  API de administración

API (PM2 paas-api, puerto 3001)
   cola Redis → worker → git clone → docker build → contenedor
   Caddy enruta {proyecto}.deplowe-now.com y, si existe, customDomain

Postgres, PgBouncer y Redis siguen en Docker, en 127.0.0.1
```

En esta máquina el panel puede usar el puerto 3000 y la API otro, o al revés. En el Droplet el panel ocupa el 3000 y la API el 3001.

## Qué ya funciona

- Clonar, construir y levantar el contenedor. La cola es BullMQ. Los logs salen por SSE.
- Deploy con `branch`, `commitHash` y `clearCache`. Redeploy desde el panel.
- Push a la rama del proyecto es producción. Otra rama o un pull request es preview.
- Al cerrar un pull request se apaga el contenedor preview y se borra el clon de la base.
- Variables `ALL`, `PRODUCTION` y `PREVIEW`.
- `/deploy` y `/databases` exigen cookie de administrador o header `x-api-key`.
- Repositorio privado con un token por proyecto. Si el proyecto no tiene token, se usa `GITHUB_PAT`. El token no se escribe en los logs.
- RAM y CPU por proyecto. Si no se cambia nada, el tope es 256 MB y 0.5 CPU.
- Dominio propio (`customDomain`). Caddy manda ese host y el subdominio por defecto al mismo contenedor.
- Add-on Postgres 15 o Redis 7 por proyecto, cada uno con su volumen de Docker.
- El panel en `https://deplowe-now.com` y el motor en el mismo Droplet.

### API

La sesión es la cookie `dn_session`. La clave es `ADMIN_API_KEY` o, si no existe, `ADMIN_PASSWORD`, en `x-api-key` o `Authorization: Bearer`.

- `POST /deploy` encola `{ repoUrl, projectName, branch?, commitHash?, clearCache?, deploymentId? }` y responde `202`.
- `POST /deployments/:id/redeploy` vuelve a encolar esa versión.
- `GET /deployments` lista despliegues. Estados: `queued`, `building`, `running`, `failed`.
- `GET /deployments/:projectId/logs` y `GET /deployments/:projectId/stats` abren SSE.
- `GET /projects` y `PATCH /projects/:id` leen y guardan límites, dominio y token. La respuesta dice `hasGithubToken` y no devuelve el token.
- `GET|POST /projects/:id/addons` y `DELETE /projects/:id/addons/:addonId` crean y destruyen Postgres o Redis.
- `GET /databases`, `POST /databases`, `POST /databases/:dbName/branch` y `POST /databases/:id/link` siguen siendo las bases lógicas del Postgres de la plataforma.
- `POST /webhooks/github` valida `x-hub-signature-256`. No usa la cookie de sesión.

El host por defecto es `{nombre}.{APP_DOMAIN}`. Sin `APP_DOMAIN` es `{nombre}.localhost`.

### Panel

El navegador llama a `/backend/*`. Next lo reenvía a `API_URL` y agrega `x-api-key` en deploy, databases y projects.

- Overview: despliegues, cuántos están `running` y cuántas bases hay.
- Deployments: logs y redeploy.
- Databases: bases lógicas y contenedores anteriores, no los add-ons por proyecto.
- Settings: por cada proyecto, RAM, CPU, token de GitHub, dominio personalizado y la sección Bases de datos.

### Datos

Postgres guarda `User`, `Team`, `Project`, `Deployment`, `EnvVar`, `DatabaseInstance`, `DatabaseAddon` y `ApiKey`.

En `Project`: `memoryLimit` (`256m`), `cpuLimit` (`0.5`), `githubToken` opcional y `customDomain` opcional y único.

`DatabaseAddon` es el contenedor propio del proyecto (`postgres` o `redis`), con `containerName` y `connectionString`. `DatabaseInstance` es otra cosa: una base lógica dentro del Postgres de la plataforma.

La API local usa PgBouncer:

`DATABASE_URL="postgresql://paas:paas@localhost:6543/paas?schema=public"`

## Cómo levantarlo en esta máquina

Hace falta Docker, Nixpacks en el `PATH` y Node.js. Prisma del proyecto es 6.19.3. Un `npx prisma` suelto puede instalar Prisma 7, que no acepta el `url` de este esquema.

```powershell
copy .env.example .env
docker compose up -d
npm install
npx prisma@6.19.3 migrate dev
npx prisma@6.19.3 generate
npm run dev
npm run worker
```

Panel, en otra terminal:

```powershell
cd mi-paas-dashboard
npm install
npm run dev -- --port 3010
```

`mi-paas-dashboard/.env.local` lleva `API_URL`. Ese archivo no se sube a git.

| Servicio | Dirección |
| --- | --- |
| Panel local | http://localhost:3010 |
| API local | http://localhost:3000 |
| Panel del Droplet | https://deplowe-now.com |
| API del Droplet | 127.0.0.1:3001, no publicada |
| Postgres | 127.0.0.1:5432 |
| PgBouncer | 127.0.0.1:6543 |
| Redis | 127.0.0.1:6379 |
| Caddy local | admin en 127.0.0.1:2019 |

`npm run build` de la API compila con `tsc` y copia `src/generated` a `dist/generated`. Sin esa copia el proceso no ve los campos nuevos de Prisma.

## Qué sigue

1. Apuntar en GitHub el webhook a `https://deplowe-now.com/webhooks/github`, con el mismo `GITHUB_WEBHOOK_SECRET`. Nginx ya entrega esa ruta a la API.
2. Crear en el registrador el registro DNS `*` hacia `46.101.84.190`, si todavía no está.
3. Certificado comodín de `*.deplowe-now.com`. Hoy el 443 de los subdominios presenta el certificado del apex, así que el navegador avisa el nombre.
4. Un dominio externo necesita la nube naranja de Cloudflare y SSL Flexible, para que el origen reciba el tráfico por el puerto 80.
5. Rotar la contraseña de una base desde el panel. Borrar un add-on ya está.
6. Pruebas automatizadas. El workflow de GitHub Actions solo reconstruye el panel, no la API ni las migraciones.
