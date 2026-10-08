import { AeroWindow } from "@/components/aero-window";

export default function SettingsPage() {
  const apiUrl = process.env.API_URL?.trim() || "(standalone local)";
  const databaseUrl = process.env.DATABASE_URL?.trim() || "file:./dev.db";

  return (
    <AeroWindow title="Settings">
      <h1 className="text-lg font-semibold">Conexión</h1>
      <p className="mt-1 text-sm text-slate-600">
        El navegador llama a /backend. El panel intenta el motor remoto y, si no
        responde, usa el store local sin Docker Desktop.
      </p>
      <dl className="mt-4 flex flex-col gap-3 text-sm">
        <div>
          <dt className="text-slate-600">Ruta del cliente</dt>
          <dd className="font-mono">/backend → /api/backend</dd>
        </div>
        <div>
          <dt className="text-slate-600">API_URL</dt>
          <dd className="font-mono">{apiUrl}</dd>
        </div>
        <div>
          <dt className="text-slate-600">DATABASE_URL (local)</dt>
          <dd className="font-mono">{databaseUrl}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Auth</dt>
          <dd>
            Login valida <code className="font-mono">ADMIN_PASSWORD</code> (cookie{" "}
            <code className="font-mono">dn_session</code>) o header{" "}
            <code className="font-mono">x-api-key</code>.
          </dd>
        </div>
        <div>
          <dt className="text-slate-600">Repos privados</dt>
          <dd>
            <code className="font-mono">GITHUB_PAT</code> debe estar en el{" "}
            <code className="font-mono">.env</code> del motor (API/worker), no solo en el
            dashboard.
          </dd>
        </div>
      </dl>
    </AeroWindow>
  );
}
