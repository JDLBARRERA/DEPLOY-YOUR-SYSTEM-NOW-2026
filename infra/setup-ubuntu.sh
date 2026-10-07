#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Ejecuta este script como root."
  exit 1
fi

mem_kb="$(awk '/MemTotal/ {print $2}' /proc/meminfo)"
if (( mem_kb < 4 * 1024 * 1024 )); then
  echo "Aviso: hay menos de 4 GB de RAM. Docker y Nixpacks pueden quedarse sin memoria."
fi

apt-get update
apt-get install -y ca-certificates curl git ufw
curl -fsSL https://get.docker.com | sh

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

if [[ -f infra/docker-compose.prod.yml ]]; then
  root="$(pwd)"
else
  : "${REPO_URL:?Define REPO_URL con la URL del repositorio}"
  root="${INSTALL_DIR:-/root/mi-paas}"
  if [[ ! -d "${root}/.git" ]]; then
    git clone "${REPO_URL}" "${root}"
  fi
fi

cd "${root}"

if [[ ! -f infra/.env.prod ]]; then
  echo "Crea infra/.env.prod a partir de infra/.env.prod.example"
  exit 1
fi

docker compose --env-file infra/.env.prod -f infra/docker-compose.prod.yml up -d --build

echo "Listo. En el firewall de DigitalOcean abre 22, 80 y 443 hacia esta IP."
