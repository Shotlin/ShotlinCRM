import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/server/auth/config';
import { db } from '@/server/db/client';
import { messageMedia } from '@/server/db/schema';
import { rateLimit } from '@/server/http/rate-limit';
import { verifySameOrigin } from '@/server/http/security';
import { sendManualMessage } from '@/server/services/messages/send';
import { mediaKindFor, putPrivateMedia } from '@/server/storage';

const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'audio/ogg',
  'audio/mpeg',
  'application/pdf',
]);

export async function POST(request: NextRequest) {
  if (!verifySameOrigin(request)) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const context = await getAuthContext();
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!(await rateLimit(`media-send:${context.workspaceId}`, 10, 60))) {
    return NextResponse.json({ error: 'Too many uploads. Wait a moment.' }, { status: 429 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid upload' }, { status: 400 });
  }
  const file = form.get('file');
  const leadId = String(form.get('leadId') ?? '');
  const body = String(form.get('body') ?? '');
  const templateId = String(form.get('templateId') ?? '') || undefined;
  const clientIdempotencyKey = String(form.get('clientIdempotencyKey') ?? '');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Choose a file' }, { status: 400 });
  if (!allowedMimeTypes.has(file.type)) {
    return NextResponse.json({ error: 'Unsupported media type' }, { status: 415 });
  }
  if (!leadId || !clientIdempotencyKey) {
    return NextResponse.json({ error: 'Missing message context' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const stored = await putPrivateMedia({
    workspaceId: context.workspaceId,
    buffer,
    mimeType: file.type,
    filename: file.name,
    optimize: 'outgoing',
  });
  const mediaId = crypto.randomUUID();
  await db.insert(messageMedia).values({
    id: mediaId,
    workspaceId: context.workspaceId,
    objectKey: stored.objectKey,
    mimeType: stored.mimeType,
    mediaKind: mediaKindFor(stored.mimeType),
    filename: file.name.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-100),
    sizeBytes: stored.sizeBytes,
    checksum: stored.checksum,
  });

  try {
    const result = await sendManualMessage({
      workspaceId: context.workspaceId,
      leadId,
      body,
      templateId,
      mediaId,
      clientIdempotencyKey,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Media message could not be sent' },
      { status: 409 },
    );
  }
}
