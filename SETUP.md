# Droplet

Lo que está corriendo en `46.101.84.190`. La forma del código está en [README.md](README.md).

El dominio del panel es `https://deplowe-now.com`. El certificado de Let's Encrypt cubre el apex y `www`, y vive en `/etc/letsencrypt/live/deplowe-now.com-0001/`. No cubre `*.deplowe-now.com`.

## Quién escucha qué

Nginx es la puerta pública. Caddy no publica 80 ni 443.

| Entrada | A dónde va |
| --- | --- |
| `deplowe-now.com` y `www` en el 443 | Panel Next.js, `127.0.0.1:3000` |
| `/webhooks/` en ese mismo servidor | API Fastify, `127.0.0.1:3001` |
| `*.deplowe-now.com` en el 443 | Caddy, `127.0.0.1:8080` |
| `deplowe-now.com`, `www` y `*.deplowe-now.com` en el 80 | Redirección a HTTPS |
| Cualquier otro host en el 80 | Caddy, `127.0.0.1:8080` |

El archivo es `/etc/nginx/sites-available/paas-dashboard`. No está en el repositorio.

Caddy sale de `/root/mi-paas/docker-compose.yml`. Publica solo `127.0.0.1:8080:80` y `127.0.0.1:2019:2019`. La API de administración es la que usa el motor para crear rutas. Postgres, PgBouncer y Redis quedan en `127.0.0.1:5432`, `6543` y `6379`.

## Procesos

Hay dos copias del mismo repositorio.

| Qué | Dónde | Proceso |
| --- | --- | --- |
| API y worker | `/root/mi-paas` | PM2 `paas-api`, `node dist/index.js`, puerto 3001 |
| Panel | `/root/DEPLOY-YOUR-SYSTEM-NOW-2026/mi-paas-dashboard` | PM2 `paas-dashboard`, puerto 3000 |

El `.env` de producción está en `/root/mi-paas/.env`. El build del panel copia ese archivo a su carpeta. No se commitea.

Prisma es 6.19.3. Hay que invocarlo con la versión fija. El cliente generado no está en git: `npm run build` lo copia de `src/generated` a `dist/generated`.

## Actualizar el Droplet

En las dos copias:

```bash
git pull --ff-only origin main
```

En `/root/mi-paas`:

```bash
npx prisma@6.19.3 migrate deploy
npx prisma@6.19.3 generate
npm run build
```

En el panel:

```bash
cd /root/DEPLOY-YOUR-SYSTEM-NOW-2026/mi-paas-dashboard
cp /root/mi-paas/.env .env
NODE_OPTIONS=--max-old-space-size=1536 npm run build
```

Y al final:

```bash
pm2 restart all
```

Un push a `main` dispara `.github/workflows/deploy.yml`, que solo reconstruye el panel. No migra la base ni recompila la API.

## Apps, dominios y bases

Cada despliegue de producción queda en `{proyecto}.deplowe-now.com`. Si el proyecto tiene `customDomain`, Caddy añade ese host a la misma ruta. El contenedor de la app no publica puertos en el host: Caddy lo alcanza por la red de Docker. Lleva la RAM y la CPU del proyecto, `--pids-limit=100` y `--restart=always`. Si el contenedor nuevo no queda en marcha, esa ruta no cambia.

Un dominio que no es de `deplowe-now.com` entra por el puerto 80. Para el candado, Cloudflare con la nube naranja y SSL Flexible. En Full o Full (strict) Cloudflare habla por el 443 y el certificado del Droplet no incluye ese nombre.

Un add-on Postgres es `postgres:15-alpine` con volumen en `/var/lib/postgresql/data`. Redis es `redis:7-alpine` con volumen en `/data`. El nombre del contenedor es el host de la cadena de conexión. Borrar el add-on borra el contenedor y el volumen. Una base creada desde Databases es `paas-db-<id>`, en la misma red, sin volumen.

El Postgres de la plataforma sigue en el volumen `mi-paas_postgres_data`. El proceso de la API, una vez al día, limpia imágenes colgantes, caché de build vieja y contenedores de app detenidos. No borra estos volúmenes ni los contenedores de bases.

## Comprobar

```bash
nginx -t
docker ps
pm2 pid paas-api
pm2 pid paas-dashboard
```

`POST https://deplowe-now.com/webhooks/github` con un cuerpo vacío debe responder 401 de la API (`Invalid GitHub signature`), no una redirección al login.
