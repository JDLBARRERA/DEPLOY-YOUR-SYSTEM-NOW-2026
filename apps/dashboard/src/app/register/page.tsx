"use client";

import { useActionState } from "react";
import Image from "next/image";
import Link from "next/link";
import { registerUser } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function RegisterPage() {
  const [state, action, pending] = useActionState(registerUser, { error: "" });

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
          <CardTitle>Crear cuenta</CardTitle>
          <CardDescription>
            La primera cuenta queda como admin y recibe un equipo personal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={action} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              Nombre
              <Input name="name" autoComplete="name" />
            </label>
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
                minLength={8}
                autoComplete="new-password"
              />
            </label>
            {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
            <Button type="submit" disabled={pending}>
              {pending ? "Creando..." : "Crear cuenta"}
            </Button>
          </form>
          <p className="mt-4 text-sm text-muted-foreground">
            ¿Ya tienes cuenta?{" "}
            <Link href="/login" className="underline">
              Entrar
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
