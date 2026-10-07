"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DnOrb } from "@/components/dn-orb";
import { WinButton } from "@/components/aero-window";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState(
    params.get("error") === "missing-secret"
      ? "Configura ADMIN_PASSWORD en mi-paas-dashboard/.env.local"
      : "",
  );
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "Credencial inválida");
        return;
      }
      const next = params.get("next") || "/";
      router.replace(next);
      router.refresh();
    } catch {
      setError("No se pudo iniciar sesión");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border border-white/40 bg-white/20 shadow-2xl backdrop-blur-lg">
      <header className="flex h-9 items-center gap-2 bg-gradient-to-b from-white/70 via-sky-300/80 to-sky-700/90 px-3 text-sm text-white">
        <span className="font-semibold drop-shadow">deplowe-now.com · Login</span>
      </header>
      <div className="m-2 rounded-lg border border-white/40 bg-white/75 p-5 text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
        <div className="mb-4 flex items-center gap-3">
          <DnOrb size="md" />
          <div>
            <h1 className="text-lg font-semibold">Control Plane</h1>
            <p className="text-sm text-slate-600">
              Contraseña de administrador o header <code>x-api-key</code>.
            </p>
          </div>
        </div>
        <form className="flex flex-col gap-3" onSubmit={onSubmit}>
          <label className="flex flex-col gap-1 text-sm">
            Contraseña
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded-md border border-white/70 bg-white/80 px-2 py-1.5 text-slate-900 shadow-[inset_0_1px_3px_rgba(0,0,0,0.15)] outline-none"
              placeholder="ADMIN_PASSWORD"
            />
          </label>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          <div className="flex justify-end">
            <WinButton type="submit" disabled={pending}>
              {pending ? "Entrando..." : "Entrar"}
            </WinButton>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-[#041428] px-4 text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,#b8ffd9_0%,transparent_42%),radial-gradient(ellipse_at_70%_20%,#3ee0ff_0%,transparent_36%),radial-gradient(ellipse_at_90%_90%,#06204a_0%,#020814_70%)]" />
      <Suspense fallback={<p className="relative z-10 text-sm">Cargando...</p>}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
