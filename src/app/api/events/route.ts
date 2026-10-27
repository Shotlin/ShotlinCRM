import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import Redis from 'ioredis';
import { getAuthContext } from '@/server/auth/config';
import { getEnv } from '@/server/env';
import { workspaceEventChannel } from '@/server/realtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const encoder = new TextEncoder();
  let subscriber: Redis | null = null;
  let heartbeat: NodeJS.Timeout | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      subscriber = new Redis(getEnv().REDIS_URL);
      await subscriber.subscribe(workspaceEventChannel(context.workspaceId));
      send('ready', { at: new Date().toISOString() });
      subscriber.on('message', (_channel, message) => {
        controller.enqueue(encoder.encode(`data: ${message}\n\n`));
      });
      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(': heartbeat\n\n'));
      }, 20_000);

      request.signal.addEventListener('abort', () => {
        if (heartbeat) clearInterval(heartbeat);
        void subscriber?.quit();
        try {
          controller.close();
        } catch {
          // The stream may already be closed by the runtime.
        }
      });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      void subscriber?.quit();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
