import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { conversations } from '../../db/schema';
import { publishChange } from '../../realtime';

export async function markConversationRead(
  workspaceId: string,
  leadId: string,
  readAt = new Date(),
) {
  await db
    .update(conversations)
    .set({ lastReadAt: readAt, unreadCount: 0, updatedAt: readAt })
    .where(
      and(eq(conversations.workspaceId, workspaceId), eq(conversations.leadId, leadId)),
    );
  await publishChange(workspaceId, 'conversation.read', leadId);
}
