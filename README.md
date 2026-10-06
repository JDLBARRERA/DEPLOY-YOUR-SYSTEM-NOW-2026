# Deploy your system 2026

Control plane local para desplegar repositorios públicos de GitHub. Clona el repo, lo construye con Nixpacks, lo corre en Docker y lo publica con Caddy. Postgres guarda usuarios, proyectos y bases de datos. Redis guarda la cola y los logs en vivo.

El código de este estado todavía no está en un commit posterior al motor inicial. El remoto es `https://github.com/JDLBARRERA/DEPLOY-YOUR-SYSTEM-NOW-2026.git`, rama `main`.

## Cómo está armado

```text
.
├── src/                         API Fastify
│   ├── index.ts                 Arranque, CORS y rutas
│   ├── routes/                  /deploy, /deployments, /databases, /webhooks/github
│   ├── services/                Motor, Caddy, bases, webhooks, logs
│   ├── workers/deployWorker.ts  Consumidor de la cola
│   ├── queues/                  Cola BullMQ "deploys"
│   └── generated/prisma/        Cliente Prisma (no se versiona)
├── apps/dashboard/              Next.js, puerto 3001
│   └── src/app/                 Login, registro y panel
├── prisma/                      Esquema y migraciones compartidos
├── infra/                       Caddy y PgBouncer
└── docker-compose.yml           Postgres, PgBouncer, Redis y Caddy
```

La API no vive en `apps/api`. Fastify está en la raíz, en `src/`. El dashboard y la API importan el mismo cliente Prisma generado desde `prisma/schema.prisma`.

```text
Navegador
   │
   ├─ Panel :3001 ── Auth.js ── Postgres (usuarios, proyectos, despliegues, bases)
   │                 │
   │                 └── POST /deploy y /databases
   │
   └─ API :3000 ── Redis (cola BullMQ + logs SSE)
                   │
                   ├── Worker ── git clone ── nixpacks ── Docker
                   ├── Caddy ── {nombre}.localhost
                   └── Postgres del cluster ── PgBouncer :6543
```

## Qué ya funciona

| Área | Estado |
| --- | --- |
| Clonar un repo público, construir con Nixpacks y levantar el contenedor | Hecho |
| Cola BullMQ y logs en vivo por SSE | Hecho |
| Caddy en `{proyecto}.localhost` | Hecho |
| Panel con logo propio, formulario de deploy y consola | Hecho |
| Postgres 16, Prisma y migraciones | Hecho |
| Login por email y contraseña. GitHub OAuth preparado | Hecho |
| Primer usuario como admin, con equipo personal | Hecho |
| Base por proyecto: usuario aislado, pool y URL directa | Hecho |
| Branch de base con `CREATE DATABASE ... TEMPLATE` | Hecho |
| Webhook de GitHub firmado, producción y preview | Hecho |
| Lista de despliegues por proyecto, con autor, rama y URL | Hecho |

### API

- `POST /deploy` encola `{ repoUrl, projectName, deploymentId? }`.
- `GET /deployments` lista contenedores. `GET /deployments/:id/logs` abre el SSE.
- `POST /databases` crea una base. `POST /databases/:dbName/branch` la clona. `POST /databases/:id/link` inyecta `DATABASE_URL` y `DIRECT_URL` en el proyecto.
- `POST /webhooks/github` valida `x-hub-signature-256`. Push a `main` o `master` es producción. Otra rama o un pull request es preview en `http://{rama}-{proyecto}.localhost`. Si el proyecto tiene base, el preview recibe un clon.

### Panel

- `/login` y `/register`.
- Pestaña **Despliegues**: formulario, contenedores, consola y, dentro de cada proyecto, **Deployments** (Building, Ready, Failed, main o preview).
- Pestaña **Databases**: crear base, copiar las dos URLs, crear branch y vincular a un proyecto.

### Datos

Postgres del control plane guarda `User`, `Team`, `Project`, `Deployment`, `DatabaseInstance` y `ApiKey`, más las tablas de Auth.js. La contraseña de cada base de proyecto se guarda cifrada. Redis no es la base durable: solo cola y logs.

## Cómo levantarlo

Hace falta Docker Desktop, Nixpacks en el `PATH` y Node.js.

```powershell
copy .env.example .env
docker compose up -d
npm install
npx prisma migrate dev
npm run dev
npm run worker
```

En otra terminal:

```powershell
cd apps/dashboard
npm install
npm run dev -- --port 3001
```

El dashboard lee `apps/dashboard/.env.local`: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_URL=http://localhost:3001`, `NEXT_PUBLIC_API_URL=http://localhost:3000` y, si se usa, `AUTH_GITHUB_ID` y `AUTH_GITHUB_SECRET`.

| Servicio | Dirección |
| --- | --- |
| Panel | http://localhost:3001 |
| API | http://localhost:3000 |
| Postgres | 127.0.0.1:5432 |
| PgBouncer | 127.0.0.1:6543 |
| Redis | 127.0.0.1:6379 |
| Caddy | http://80 y admin en 127.0.0.1:2019 |

Un sitio desplegado responde en `http://{nombre}.localhost`.

## Qué sigue

1. **Webhook alcanzable desde GitHub.** La ruta existe, pero GitHub no puede llamar a `localhost`. Falta un túnel o un dominio público hacia el puerto 3000, y registrar el webhook con el mismo `GITHUB_WEBHOOK_SECRET`.
2. **Cerrar previews.** Al cerrar el pull request no se apaga el contenedor ni se borra el clon de la base.
3. **Proteger la API.** `/deploy` y `/databases` aceptan peticiones locales sin sesión. El modelo `ApiKey` está creado y no tiene pantalla ni middleware.
4. **GitHub OAuth.** El botón está. Falta llenar `AUTH_GITHUB_ID` y `AUTH_GITHUB_SECRET`.
5. **Borrar y rotar bases.** Se pueden crear, clonar y vincular. No hay borrado ni rotación de contraseña en el panel.
6. **Variables de entorno generales.** Solo se inyectan `DATABASE_URL` y `DIRECT_URL`. No hay editor para el resto.
7. **Repos privados.** El motor solo acepta HTTPS público de GitHub.
8. **Dominio real y TLS.** Caddy publica `*.localhost`. No hay dominios propios ni certificados.
9. **Límites de recursos.** Cada rol de base tiene límite de conexiones y `statement_timeout`. No hay CPU ni memoria por contenedor.
10. **Pruebas y CI.** No hay suite automatizada ni workflow de GitHub Actions.
11. **Varios servidores.** Todo corre en esta máquina. No hay despliegue a un nodo remoto.

## Fuera de este alcance

No está previsto sustituir Redis por Postgres en la cola, ni recrear la app de Next.js. El cliente de Prisma en `src/generated` se regenera con `npx prisma generate` y no se sube a git.
