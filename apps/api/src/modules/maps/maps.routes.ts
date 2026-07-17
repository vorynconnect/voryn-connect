import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { rateLimit } from '../../middleware/rate-limit';
import { assertValidCoordinate } from './maps.provider';
import { mapsService } from './maps.service';

/**
 * Map endpoints for the mobile apps and dashboards. Clients never talk to a
 * map vendor directly — everything proxies through here so provider keys stay
 * server-side and caching/limits apply platform-wide.
 */
export const mapsRouter = Router();
mapsRouter.use(requireAuth);
// Typing in a search box fires these often — allow bursts but stop runaways.
mapsRouter.use(rateLimit('rl:maps', 120, 60));

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

mapsRouter.get(
  '/suggestions',
  validate({
    query: z.object({
      q: z.string().min(2).max(120),
      lat: z.coerce.number().min(-90).max(90).optional(),
      lng: z.coerce.number().min(-180).max(180).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const { q, lat, lng } = req.query as unknown as { q: string; lat?: number; lng?: number };
      const bias = lat != null && lng != null ? { latitude: lat, longitude: lng } : undefined;
      res.json({ suggestions: await mapsService.getPlaceSuggestions(q, bias) });
    } catch (err) {
      next(err);
    }
  },
);

mapsRouter.post(
  '/reverse-geocode',
  validate({ body: z.object({ latitude, longitude }) }),
  async (req, res, next) => {
    try {
      assertValidCoordinate(req.body.latitude, req.body.longitude);
      res.json({ address: await mapsService.reverseGeocode(req.body.latitude, req.body.longitude) });
    } catch (err) {
      next(err);
    }
  },
);

mapsRouter.post(
  '/route',
  validate({
    body: z.object({
      from: z.object({ latitude, longitude }),
      to: z.object({ latitude, longitude }),
    }),
  }),
  async (req, res, next) => {
    try {
      assertValidCoordinate(req.body.from.latitude, req.body.from.longitude);
      assertValidCoordinate(req.body.to.latitude, req.body.to.longitude);
      res.json({ route: await mapsService.calculateRoute(req.body.from, req.body.to) });
    } catch (err) {
      next(err);
    }
  },
);
