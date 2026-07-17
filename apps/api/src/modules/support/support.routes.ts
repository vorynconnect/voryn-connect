import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { rateLimit } from '../../middleware/rate-limit';

/**
 * Customer support tickets. Partners have their own list under /v1/partner —
 * both write to the same SupportTicket table, scoped by userId.
 */
export const supportRouter = Router();

// Website "Contact us" — the one support route that works without an account.
// Registered before requireAuth so anonymous visitors can reach it.
supportRouter.post(
  '/contact',
  rateLimit('rl:support-contact', 3, 900),
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(100),
      email: z.string().trim().email().max(200),
      phone: z.string().trim().max(32).optional(),
      topic: z.string().trim().max(60).optional(),
      message: z.string().trim().min(10).max(3000),
    }),
  }),
  async (req, res, next) => {
    try {
      const saved = await prisma.contactMessage.create({
        data: {
          name: req.body.name,
          email: req.body.email,
          phone: req.body.phone,
          topic: req.body.topic,
          message: req.body.message,
        },
      });
      res.status(201).json({ received: true, id: saved.id });
    } catch (err) {
      next(err);
    }
  },
);

supportRouter.use(requireAuth);

const REFERENCE_TYPES = ['GENERAL', 'ORDER', 'RIDE', 'BOOKING', 'RENTAL', 'WALLET', 'ACCOUNT'] as const;

function ticketView(t: {
  id: string;
  subject: string;
  description: string;
  status: string;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: t.id,
    subject: t.subject,
    description: t.description,
    status: t.status,
    referenceType: t.referenceType,
    referenceId: t.referenceId,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

supportRouter.get('/tickets', async (req, res, next) => {
  try {
    const tickets = await prisma.supportTicket.findMany({
      where: { userId: req.auth!.sub },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({ tickets: tickets.map(ticketView) });
  } catch (err) {
    next(err);
  }
});

supportRouter.get('/tickets/:id', async (req, res, next) => {
  try {
    const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
    if (!ticket || ticket.userId !== req.auth!.sub) throw AppError.notFound('Ticket not found');
    res.json({ ticket: ticketView(ticket) });
  } catch (err) {
    next(err);
  }
});

supportRouter.post(
  '/tickets',
  rateLimit('rl:support-create', 5, 3600),
  validate({
    body: z.object({
      subject: z.string().trim().min(3).max(150),
      description: z.string().trim().min(10).max(2000),
      referenceType: z.enum(REFERENCE_TYPES).optional(),
      referenceId: z.string().max(64).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const ticket = await prisma.supportTicket.create({
        data: {
          userId: req.auth!.sub,
          subject: req.body.subject,
          description: req.body.description,
          referenceType: req.body.referenceType ?? 'GENERAL',
          referenceId: req.body.referenceId,
        },
      });
      res.status(201).json({ ticket: ticketView(ticket) });
    } catch (err) {
      next(err);
    }
  },
);
