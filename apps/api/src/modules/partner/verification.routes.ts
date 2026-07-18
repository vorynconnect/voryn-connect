import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { createDocumentUpload, publicUploadUrl } from '../../lib/uploads';
import { validate } from '../../middleware/validate';
import { sendData } from './partner.middleware';

/**
 * Partner onboarding verification. New partners sign up as
 * PENDING_VERIFICATION, fill in their business information, upload supporting
 * documents, then submit for review. The Voryn team approves or rejects from
 * the admin console (modules/admin); approval flips the provider to ACTIVE,
 * which is what customer discovery filters on — until then the store never
 * appears in the app.
 */
export const verificationRouter = Router();

export const DOCUMENT_TYPES = [
  'business_registration',
  'owner_id',
  'proof_of_address',
  'permit_license',
  'insurance',
  'other',
] as const;

/** Documents every application must include before it can be submitted. */
export const REQUIRED_DOCUMENT_TYPES = ['business_registration', 'owner_id'] as const;

const documentUpload = createDocumentUpload((req) => `verification-${req.partner!.providerId}`);

type OverallStatus = 'incomplete' | 'in_review' | 'rejected' | 'approved';

export async function verificationView(providerId: string) {
  const provider = await prisma.provider.findUniqueOrThrow({
    where: { id: providerId },
    include: {
      branches: { where: { isPrimary: true }, take: 1 },
      documents: { orderBy: { createdAt: 'desc' } },
      verifications: { orderBy: { createdAt: 'desc' } },
    },
  });

  const latest = provider.verifications[0] ?? null;
  let status: OverallStatus = 'incomplete';
  if (provider.status === 'ACTIVE') status = 'approved';
  else if (latest?.status === 'PENDING' || latest?.status === 'IN_REVIEW') status = 'in_review';
  else if (latest?.status === 'REJECTED') status = 'rejected';
  else if (latest?.status === 'APPROVED') status = 'approved';

  const missingInfo: string[] = [];
  if (!provider.legalName) missingInfo.push('legalName');
  if (!provider.trn) missingInfo.push('trn');
  if (!provider.ownerFullName) missingInfo.push('ownerFullName');
  if (!provider.ownerIdType) missingInfo.push('ownerIdType');
  if (!provider.ownerIdNumber) missingInfo.push('ownerIdNumber');

  const uploadedTypes = new Set(provider.documents.map((d) => d.type));
  const missingDocuments = REQUIRED_DOCUMENT_TYPES.filter((t) => !uploadedTypes.has(t));

  const branch = provider.branches[0] ?? null;
  return {
    status,
    providerStatus: provider.status,
    isVerified: provider.isVerified,
    submittedAt: provider.applicationSubmittedAt,
    review: latest
      ? { status: latest.status, notes: latest.notes, reviewedAt: latest.reviewedAt }
      : null,
    business: {
      tradingName: provider.name,
      legalName: provider.legalName ?? '',
      businessRegNo: provider.businessRegNo ?? '',
      trn: provider.trn ?? '',
      ownerFullName: provider.ownerFullName ?? '',
      ownerIdType: provider.ownerIdType ?? '',
      ownerIdNumber: provider.ownerIdNumber ?? '',
      description: provider.description ?? '',
      phone: provider.phone ?? '',
      email: provider.email ?? '',
      address: branch
        ? { line1: branch.line1, city: branch.city, parish: branch.parish }
        : null,
    },
    documents: provider.documents.map((d) => ({
      id: d.id,
      type: d.type,
      fileUrl: d.fileUrl,
      fileName: d.fileName,
      status: d.status,
      createdAt: d.createdAt,
    })),
    requirements: {
      requiredDocuments: REQUIRED_DOCUMENT_TYPES,
      missingInfo,
      missingDocuments,
    },
    canSubmit:
      (status === 'incomplete' || status === 'rejected') &&
      missingInfo.length === 0 &&
      missingDocuments.length === 0,
  };
}

verificationRouter.get('/', async (req, res, next) => {
  try {
    sendData(res, await verificationView(req.partner!.providerId));
  } catch (err) {
    next(err);
  }
});

const businessInfoSchema = z.object({
  legalName: z.string().min(2).max(120),
  businessRegNo: z.string().min(2).max(40).optional().or(z.literal('')),
  trn: z.string().regex(/^[0-9-]{9,15}$/, 'TRN should be a 9-digit Tax Registration Number.'),
  ownerFullName: z.string().min(2).max(80),
  ownerIdType: z.enum(['national_id', 'passport', 'drivers_licence']),
  ownerIdNumber: z.string().min(4).max(40),
  description: z.string().max(500).optional().or(z.literal('')),
  phone: z.string().min(7).max(20).optional().or(z.literal('')),
  address: z
    .object({
      line1: z.string().min(3).max(120),
      city: z.string().min(2).max(60),
      parish: z.string().min(2).max(60),
    })
    .optional(),
});

verificationRouter.put(
  '/business-info',
  validate({ body: businessInfoSchema }),
  async (req, res, next) => {
    try {
      const providerId = req.partner!.providerId;
      const body = req.body as z.infer<typeof businessInfoSchema>;
      await prisma.provider.update({
        where: { id: providerId },
        data: {
          legalName: body.legalName,
          businessRegNo: body.businessRegNo || null,
          trn: body.trn,
          ownerFullName: body.ownerFullName,
          ownerIdType: body.ownerIdType,
          ownerIdNumber: body.ownerIdNumber,
          ...(body.description !== undefined ? { description: body.description || null } : {}),
          ...(body.phone ? { phone: body.phone } : {}),
        },
      });
      if (body.address) {
        const primary = await prisma.providerBranch.findFirst({
          where: { providerId, isPrimary: true },
        });
        if (primary) {
          await prisma.providerBranch.update({
            where: { id: primary.id },
            data: { line1: body.address.line1, city: body.address.city, parish: body.address.parish },
          });
        }
      }
      sendData(res, await verificationView(providerId));
    } catch (err) {
      next(err);
    }
  },
);

verificationRouter.post('/documents', documentUpload.single('file'), async (req, res, next) => {
  try {
    const type = String(req.body?.type ?? '');
    if (!DOCUMENT_TYPES.includes(type as (typeof DOCUMENT_TYPES)[number])) {
      throw AppError.badRequest('Unknown document type.', 'INVALID_DOCUMENT_TYPE');
    }
    if (!req.file) throw AppError.badRequest('Attach a file in the "file" field.', 'FILE_REQUIRED');
    await prisma.providerDocument.create({
      data: {
        providerId: req.partner!.providerId,
        type,
        fileUrl: publicUploadUrl(req, req.file.filename),
        fileName: req.file.originalname?.slice(0, 200) ?? null,
        mimeType: req.file.mimetype ?? null,
      },
    });
    sendData(res, await verificationView(req.partner!.providerId), 201);
  } catch (err) {
    next(err);
  }
});

verificationRouter.delete('/documents/:id', async (req, res, next) => {
  try {
    const providerId = req.partner!.providerId;
    if (req.partner!.provider.status === 'ACTIVE') {
      throw AppError.forbidden(
        'Your business is already verified — contact support to change verified documents.',
        'ALREADY_VERIFIED',
      );
    }
    const doc = await prisma.providerDocument.findFirst({
      where: { id: req.params.id!, providerId },
    });
    if (!doc) throw AppError.notFound('Document not found');
    await prisma.providerDocument.delete({ where: { id: doc.id } });
    sendData(res, await verificationView(providerId));
  } catch (err) {
    next(err);
  }
});

verificationRouter.post('/submit', async (req, res, next) => {
  try {
    const providerId = req.partner!.providerId;
    const view = await verificationView(providerId);
    if (view.status === 'approved') {
      throw AppError.conflict('Your business is already verified.', 'ALREADY_VERIFIED');
    }
    if (view.status === 'in_review') {
      throw AppError.conflict('Your application is already under review.', 'ALREADY_SUBMITTED');
    }
    if (!view.canSubmit) {
      throw AppError.badRequest(
        'Complete your business information and upload the required documents before submitting.',
        'APPLICATION_INCOMPLETE',
      );
    }
    await prisma.$transaction([
      prisma.providerVerification.create({ data: { providerId, status: 'PENDING' } }),
      prisma.provider.update({
        where: { id: providerId },
        data: { applicationSubmittedAt: new Date(), status: 'PENDING_VERIFICATION' },
      }),
    ]);
    sendData(res, await verificationView(providerId), 201);
  } catch (err) {
    next(err);
  }
});
