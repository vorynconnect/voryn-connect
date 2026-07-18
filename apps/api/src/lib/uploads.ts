import fs from 'node:fs';
import path from 'node:path';
import type { Request } from 'express';
import multer, { type StorageEngine } from 'multer';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env';
import { AppError } from './errors';

/**
 * Media storage. Two backends, chosen by env.MEDIA_STORAGE:
 *   - 'local' — multer disk storage under MEDIA_UPLOAD_DIR, served by /uploads.
 *               Fine on a single host with a persistent volume.
 *   - 's3'    — any S3-compatible object store (AWS S3, Cloudflare R2,
 *               Backblaze B2, DigitalOcean Spaces, MinIO). Required for hosts
 *               with ephemeral disks, where local files vanish on redeploy.
 *
 * Both backends set `req.file.filename` to the stored object's key/name, so
 * route handlers stay identical; publicUploadUrl() resolves the right URL.
 */

const isS3 = env.MEDIA_STORAGE === 's3';

export const uploadDir = path.resolve(process.cwd(), env.MEDIA_UPLOAD_DIR);
// Only create the local directory when we actually use disk storage.
if (!isS3) fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

// Verification documents can also be PDFs (registration certificates, IDs).
const ALLOWED_DOCUMENT_TYPES: Record<string, string> = {
  ...ALLOWED_IMAGE_TYPES,
  'application/pdf': '.pdf',
};

let s3Client: S3Client | null = null;
function getS3(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: env.S3_REGION,
      // Endpoint is set for non-AWS providers (R2/B2/Spaces/MinIO); omitted for AWS.
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
    });
  }
  return s3Client;
}

/**
 * Custom multer engine that streams the uploaded image into an S3-compatible
 * bucket. Images are small (<= MEDIA_MAX_SIZE_MB), so the body is buffered in
 * memory; busboy's fileSize limit still applies and truncated uploads are
 * rejected instead of stored.
 */
function createS3Storage(prefix: (req: Request) => string, allowedTypes: Record<string, string>): StorageEngine {
  return {
    _handleFile(req, file, cb) {
      const chunks: Buffer[] = [];
      let oversized = false;
      file.stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      file.stream.on('limit', () => {
        oversized = true;
      });
      file.stream.on('error', cb);
      file.stream.on('end', () => {
        if (oversized) {
          cb(AppError.badRequest(`Image exceeds the ${env.MEDIA_MAX_SIZE_MB}MB limit.`, 'FILE_TOO_LARGE'));
          return;
        }
        const body = Buffer.concat(chunks);
        const ext = allowedTypes[file.mimetype] ?? '.bin';
        const key = `${prefix(req)}-${Date.now()}${ext}`;
        getS3()
          .send(
            new PutObjectCommand({
              Bucket: env.S3_BUCKET,
              Key: key,
              Body: body,
              ContentType: file.mimetype,
              CacheControl: 'public, max-age=31536000, immutable',
            }),
          )
          .then(() => cb(null, { filename: key, size: body.length }))
          .catch(cb);
      });
    },
    _removeFile(_req, file, cb) {
      const key = (file as Express.Multer.File & { filename?: string }).filename;
      if (!key) {
        cb(null);
        return;
      }
      getS3()
        .send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))
        .then(() => cb(null))
        .catch(cb);
    },
  };
}

function createDiskStorage(prefix: (req: Request) => string, allowedTypes: Record<string, string>): StorageEngine {
  return multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
      const ext = allowedTypes[file.mimetype] ?? '.bin';
      cb(null, `${prefix(req)}-${Date.now()}${ext}`);
    },
  });
}

function createUpload(
  prefix: (req: Request) => string,
  allowedTypes: Record<string, string>,
  typeError: string,
) {
  return multer({
    storage: isS3 ? createS3Storage(prefix, allowedTypes) : createDiskStorage(prefix, allowedTypes),
    limits: { fileSize: env.MEDIA_MAX_SIZE_MB * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      if (!allowedTypes[file.mimetype]) {
        cb(AppError.badRequest(typeError, 'INVALID_FILE_TYPE'));
        return;
      }
      cb(null, true);
    },
  });
}

/** Multer instance that accepts a single validated image; object keys start with `prefix(req)`. */
export function createImageUpload(prefix: (req: Request) => string) {
  return createUpload(prefix, ALLOWED_IMAGE_TYPES, 'Only JPEG, PNG, or WebP images are allowed.');
}

/** Multer instance for verification documents — images plus PDFs. */
export function createDocumentUpload(prefix: (req: Request) => string) {
  return createUpload(prefix, ALLOWED_DOCUMENT_TYPES, 'Only PDF, JPEG, PNG, or WebP files are allowed.');
}

/**
 * Public URL for a stored upload.
 *  - S3: MEDIA_PUBLIC_BASE_URL (bucket public URL or CDN) + key.
 *  - local: this host's /uploads/ path (served by app.ts).
 */
export function publicUploadUrl(req: Request, filename: string): string {
  if (isS3) {
    return `${env.MEDIA_PUBLIC_BASE_URL.replace(/\/$/, '')}/${filename}`;
  }
  return `${req.protocol}://${req.get('host')}/uploads/${filename}`;
}

/** True when media is served from object storage rather than local disk. */
export const usingObjectStorage = isS3;
