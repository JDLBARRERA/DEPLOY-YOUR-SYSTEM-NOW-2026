import { connection } from "next/server";
import { getLogs } from "@/lib/local-store";
import { tryUpstream } from "@/lib/upstream";

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  await connection();
  const { projectId } = await context.params;
  if (!/^[a-zA-Z0-9_-]+$/.test(projectId)) {
    return Response.json({ error: "Deployment not found" }, { status: 404 });
  }

  const upstream = await tryUpstream(`deployments/${projectId}/logs`, {
    headers: {
      Accept: "text/event-stream",
      "Accept-Encoding": "identity",
    },
  }, 4000);

  if (upstream?.ok && upstream.body) {
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Logs-Proxy": "upstream",
      },
    });
  }

  const lines = getLogs(projectId);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(line)}\n\n`),
        );
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Logs-Proxy": "local",
    },
  });
}
