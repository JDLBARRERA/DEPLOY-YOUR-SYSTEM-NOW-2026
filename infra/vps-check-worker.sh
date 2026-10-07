#!/usr/bin/env bash
# Run on the Droplet from the PaaS app directory (e.g. /root/mi-paas).
set -euo pipefail

echo "HEAD: $(git rev-parse --short HEAD)"
echo "Expected: 080a1c2 or newer (with Dockerfile generation + absolute docker build)"

if [[ ! -f dist/workers/deployWorker.js ]]; then
  echo "ERROR: dist/workers/deployWorker.js missing — run: npm run build"
  exit 1
fi

if grep -q "Directorio del repo" dist/workers/deployWorker.js; then
  echo "OK: compiled worker contains 'Directorio del repo'"
else
  echo "ERROR: compiled worker is stale — run: git pull && npm run build && pm2 restart mi-paas"
  exit 1
fi

if grep -q 'docker build -f' dist/workers/deployWorker.js; then
  echo "OK: compiled worker uses docker build -f (absolute Dockerfile)"
else
  echo "WARN: absolute -f build not in dist yet — pull latest, rebuild, restart"
fi

echo "Restarting PM2 app mi-paas..."
pm2 restart mi-paas
echo "Done. Trigger a deploy and check: pm2 logs mi-paas --lines 80"
