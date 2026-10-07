import { AeroWindow } from "@/components/aero-window";

export default function SettingsPage() {
  const apiUrl = process.env.API_URL ?? "sin configurar";

  return (
    <AeroWindow title="Settings">
      <h1 className="text-lg font-semibold">Conexión</h1>
      <p className="mt-1 text-sm text-slate-600">
        El navegador llama a /backend. Next reescribe esa ruta hacia el motor.
      </p>
      <dl className="mt-4 flex flex-col gap-3 text-sm">
        <div>
          <dt className="text-slate-600">Ruta del cliente</dt>
          <dd className="font-mono">/backend</dd>
        </div>
        <div>
          <dt className="text-slate-600">API_URL</dt>
          <dd className="font-mono">{apiUrl}</dd>
        </div>
      </dl>
    </AeroWindow>
  );
}
