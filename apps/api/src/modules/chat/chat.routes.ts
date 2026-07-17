import { Router } from 'express';
import { z } from 'zod';
import { ConversationContext } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';

export const chatRouter = Router();
chatRouter.use(requireAuth);

const CHAT_CONTEXTS = [ConversationContext.RIDE, ConversationContext.ORDER] as const;

/**
 * Trip chat is a two-party thread: the customer and the assigned driver/courier.
 * The reference must exist and have a partner assigned before a thread opens.
 */
async function resolveParticipants(
  context: ConversationContext,
  referenceId: string,
): Promise<{ customerId: string; partnerUserId: string } | null> {
  if (context === ConversationContext.RIDE) {
    const trip = await prisma.rideTrip.findUnique({
      where: { id: referenceId },
      select: { request: { select: { customerId: true } }, driver: { select: { userId: true } } },
    });
    if (!trip) return null;
    return { customerId: trip.request.customerId, partnerUserId: trip.driver.userId };
  }
  const order = await prisma.order.findUnique({
    where: { id: referenceId },
    select: { customerId: true, courier: { select: { userId: true } } },
  });
  if (!order?.courier) return null;
  return { customerId: order.customerId, partnerUserId: order.courier.userId };
}

async function requireParticipant(userId: string, context: ConversationContext, referenceId: string) {
  const participants = await resolveParticipants(context, referenceId);
  if (!participants || (participants.customerId !== userId && participants.partnerUserId !== userId)) {
    throw AppError.notFound('Conversation not found');
  }
  return participants;
}

const userCard = { select: { id: true, fullName: true, customerProfile: { select: { avatarUrl: true } } } } as const;

function cardView(u: { id: string; fullName: string; customerProfile: { avatarUrl: string | null } | null }) {
  return { id: u.id, fullName: u.fullName, avatarUrl: u.customerProfile?.avatarUrl ?? null };
}

/** Open (or reopen) the conversation for a trip; returns it with the counterpart's card. */
chatRouter.post(
  '/conversations',
  validate({ body: z.object({ context: z.enum(['RIDE', 'ORDER']), referenceId: z.string().min(1) }) }),
  async (req, res, next) => {
    try {
      const me = req.auth!.sub;
      const context = req.body.context as (typeof CHAT_CONTEXTS)[number];
      const { referenceId } = req.body;
      const participants = await requireParticipant(me, context, referenceId);

      let conversation = await prisma.conversation.findFirst({ where: { context, referenceId } });
      if (!conversation) {
        conversation = await prisma.conversation.create({
          data: { context, referenceId, customerId: participants.customerId },
        });
      }

      const counterpartId = me === participants.customerId ? participants.partnerUserId : participants.customerId;
      const counterpart = await prisma.user.findUniqueOrThrow({ where: { id: counterpartId }, ...userCard });
      res.json({ conversation, counterpart: cardView(counterpart) });
    } catch (err) {
      next(err);
    }
  },
);

/** Messages, oldest first. Reading marks the other side's messages as read. */
chatRouter.get('/conversations/:id/messages', async (req, res, next) => {
  try {
    const me = req.auth!.sub;
    const conversation = await prisma.conversation.findUnique({ where: { id: req.params.id } });
    if (!conversation || !conversation.referenceId) throw AppError.notFound('Conversation not found');
    await requireParticipant(me, conversation.context, conversation.referenceId);

    const [messages] = await prisma.$transaction([
      prisma.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'asc' },
        take: 200,
      }),
      prisma.message.updateMany({
        where: { conversationId: conversation.id, senderId: { not: me }, readAt: null },
        data: { readAt: new Date() },
      }),
    ]);
    res.json({ messages });
  } catch (err) {
    next(err);
  }
});

chatRouter.post(
  '/conversations/:id/messages',
  validate({ body: z.object({ body: z.string().trim().min(1).max(1000) }) }),
  async (req, res, next) => {
    try {
      const me = req.auth!.sub;
      const conversation = await prisma.conversation.findUnique({ where: { id: req.params.id } });
      if (!conversation || !conversation.referenceId) throw AppError.notFound('Conversation not found');
      await requireParticipant(me, conversation.context, conversation.referenceId);

      const [message] = await prisma.$transaction([
        prisma.message.create({
          data: { conversationId: conversation.id, senderId: me, body: req.body.body },
        }),
        prisma.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } }),
      ]);
      res.status(201).json({ message });
    } catch (err) {
      next(err);
    }
  },
);
