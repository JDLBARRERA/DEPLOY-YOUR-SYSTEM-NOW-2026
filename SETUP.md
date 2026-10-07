# 🚀 Guía de Despliegue e Infraestructura: Motor PaaS Custom (`mi-paas`)

Este documento contiene el resumen técnico de la infraestructura, los requisitos de servidor, el stack de software instalado y los pasos exactos realizados para desplegar con éxito el motor PaaS en un VPS de DigitalOcean.

La arquitectura del repositorio está en [README.md](README.md). El Droplet que responde hoy es `46.101.84.190`. El panel `mi-paas-dashboard` (puerto 3000 en esta máquina) llama a `/backend` y Next reescribe esa ruta hacia `http://46.101.84.190`.

---

## 📋 1. Requisitos Previos (Lo que se necesita)

* **Servidor VPS**: DigitalOcean Droplet (mínimo recomendado: 1 vCPU, 2 GB RAM, Ubuntu).
* **Dirección IP Pública / Dominio**: IP estática o dominio configurado (se utilizó `nip.io` para resolución automática de IP en DNS).
* **Accesos**: Usuario `root` o privilegios `sudo` vía SSH / Consola.
* **Puertos Abiertos en Red**:
  * `80` (HTTP - Caddy Reverse Proxy)
  * `443` (HTTPS - Caddy TLS/SSL)
  * `2019` (API Interna de Caddy Admin)
  * `3000` (Puerto interno del backend Fastify)
  * `5432` / `6543` (PostgreSQL / PgBouncer)
  * `6379` (Redis)

---

## 🛠️ 2. Stack Tecnológico e Instalado

### **A. Entorno de Ejecución (Host / VPS)**

* **Node.js**: `v20.20.2` (Actualizado desde v18 para corregir *Segmentation Faults* y habilitar lectura nativa de `--env-file`).
* **NPM**: Manejador de paquetes de Node.
* **Docker & Docker Compose**: Para orquestación de contenedores de infraestructura.

### **B. Servicios en Contenedores Docker (`docker-compose`)**

1. **PostgreSQL 16** (`postgres:16-alpine`): Base de datos relacional principal.
2. **PgBouncer** (`edoburu/pgbouncer:v1.24.1-p1`): Connection pooler para optimizar conexiones a Postgres.
3. **Redis 7** (`redis:7-alpine`): Servidor en memoria para colas de tareas (`BullMQ`) y caché.
4. **Caddy 2** (`caddy:2`): Reverse proxy y servidor web dinámico para gestionar dominios y SSL.

### **C. Aplicación Backend (`mi-paas`)**

* **Framework Web**: Fastify.
* **ORM**: Prisma (v6.19.3).
* **Gestión de Procesos**: `nohup` (ejecución persistente en segundo plano).

---

## ⚙️ 3. Resumen de Pasos Realizados

### **Paso 1: Solución de Dependencias y Node.js**

* Se actualizó Node.js a la versión **20.20.2**.
* Se ejecutó la instalación limpia de librerías y la generación de binarios de Prisma:

```bash
npm install
npx prisma generate
```

### **Paso 2: Variables de Entorno (`.env`)**

Se configuró el archivo `.env` en la raíz del proyecto apuntando a la base de datos PostgreSQL/PgBouncer:

```env
DATABASE_URL="postgresql://paas:paas@127.0.0.1:5432/paas?schema=public"
```

### **Paso 3: Sincronización del Esquema de Base de Datos**

Se ejecutó la creación y alineación automática de las tablas del esquema de Prisma hacia PostgreSQL:

```bash
npx prisma db push
```

### **Paso 4: Configuración de Caddy (`infra/caddy.json`)**

Se estableció la estructura JSON para que Caddy escuche en el puerto 80 y redirija el tráfico hacia el puerto 3000 del backend Fastify en la interfaz de red interna:

```json
{
  "admin": {
    "listen": "0.0.0.0:2019",
    "enforce_origin": false
  },
  "apps": {
    "http": {
      "servers": {
        "paas": {
          "listen": [":80"],
          "routes": [
            {
              "handle": [
                {
                  "handler": "reverse_proxy",
                  "upstreams": [
                    { "dial": "172.18.0.1:3000" }
                  ]
                }
              ]
            }
          ]
        }
      }
    }
  }
}
```

### **Paso 5: Inicio de la Aplicación en Segundo Plano**

Se inició la aplicación Node usando la carga de entorno nativa y guardando registros de ejecución:

```bash
nohup node --env-file=.env dist/index.js > app.log 2>&1 &
```

---

## 💾 4. Persistencia de Datos

Las bases de datos gestionadas no se pierden al reiniciar o detener contenedores gracias al volumen persistente mapeado en el sistema operativo:

* **Nombre del Volumen Docker**: `mi-paas_postgres_data`
* **Ruta Física en el VPS**: `/var/lib/docker/volumes/mi-paas_postgres_data/_data`

---

## 🔍 5. Endpoints de Verificación

Una vez iniciados todos los servicios, los siguientes endpoints devuelven respuestas activas en el navegador/API:

| Endpoint | Descripción | Estado Esperado |
| --- | --- | --- |
| `http://<IP_O_DOMINIO>/` | Ruta raíz del backend Fastify | `404 Not Found` (Correcto, indica proxy funcional) |
| `http://<IP_O_DOMINIO>/deployments` | Listado de despliegues en base de datos | `[]` (Arreglo JSON vacío) |
| `http://<IP_O_DOMINIO>/databases` | Listado de instancias de BD creadas | `[]` (Arreglo JSON vacío) |

---

## 🛠️ Comandos de Mantenimiento Útiles

Ver estado de los contenedores:

```bash
docker ps
```

Ver registros de Caddy:

```bash
docker logs mi-paas-caddy-1 --tail 50
```

Ver registros de la App Node:

```bash
cat app.log
```

Reiniciar el servidor web (Caddy):

```bash
docker compose restart caddy
```
