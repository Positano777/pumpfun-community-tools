/**
 * Server-sent events for streamed answers: one `meta` event, then `delta`
 * events carrying text, then `done`. The body is a TransformStream pumped by
 * an explicit writer outside the stream's start hook, which is the pattern
 * the Workers runtime streams reliably.
 */
export function sseResponse(meta: unknown, stream: ReadableStream<string>, transform: (t: string) => string = (t) => t): Response {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = (event: string, data: unknown) => writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
  void (async () => {
    try {
      await send('meta', meta);
      const reader = stream.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) await send('delta', { t: transform(value) });
        }
        await send('done', {});
      } catch {
        await send('error', { message: 'The hawk lost the thread. Ask again.' }).catch(() => undefined);
      }
    } finally {
      await writer.close().catch(() => undefined);
    }
  })();
  return new Response(readable, {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  });
}
