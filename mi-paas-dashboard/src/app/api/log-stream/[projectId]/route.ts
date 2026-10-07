import { connection } from "next/server";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  await connection();
  const { projectId } = await context.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    return Response.json({ error: "Deployment not found" }, { status: 404 });
  }

  const apiUrl = process.env.API_URL;
  if (!apiUrl) {
    return Response.json({ error: "API_URL no está configurado" }, { status: 500 });
  }

  const upstream = await fetch(`${apiUrl}/deployments/${projectId}/logs`, {
    headers: {
      Accept: "text/event-stream",
      "Accept-Encoding": "identity",
    },
    cache: "no-store",
    signal: request.signal,
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      },
    });
  }

  const reader = upstream.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    cancel() {
      void reader.cancel();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Logs-Proxy": "1",
    },
  });
}
