"use client";

import { useActionState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  signInWithCredentials,
  signInWithGitHub,
} from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const empty = { error: "" };

export default function LoginPage() {
  const [credentialsState, credentialsAction, credentialsPending] = useActionState(
    signInWithCredentials,
    empty,
  );
  const [githubState, githubAction, githubPending] = useActionState(
    signInWithGitHub,
    empty,
  );

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-12">
      <div className="flex items-center gap-3">
        <Image
          src="/logo.jpg"
          alt="Deploy your system"
          width={56}
          height={56}
          priority
          className="size-14 rounded-2xl"
        />
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Deploy your system
        </h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Entrar</CardTitle>
          <CardDescription>
            Usa tu email o GitHub para abrir el control plane.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form action={credentialsAction} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              Email
              <Input name="email" type="email" required autoComplete="email" />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              Contraseña
              <Input
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </label>
            {credentialsState.error ? (
              <p className="text-sm text-destructive">{credentialsState.error}</p>
            ) : null}
            <Button type="submit" disabled={credentialsPending}>
              {credentialsPending ? "Entrando..." : "Entrar"}
            </Button>
          </form>
          <form action={githubAction}>
            {githubState.error ? (
              <p className="mb-3 text-sm text-destructive">{githubState.error}</p>
            ) : null}
            <Button type="submit" variant="outline" disabled={githubPending} className="w-full">
              Continuar con GitHub
            </Button>
          </form>
          <p className="text-sm text-muted-foreground">
            ¿No tienes cuenta?{" "}
            <Link href="/register" className="underline">
              Crear una
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
