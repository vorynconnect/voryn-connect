import { PaymentMethodType, RideCategory, RideStatus, WalletEntryType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import { orderCode, pickupCode } from '../../lib/codes';
import { haversineKm } from '../../lib/pricing';
import { takePayment, refundPayment } from '../payments/payment.service';
import { recordTrackingEvent } from '../tracking/tracking.service';
import { walletService } from '../wallet/wallet.service';
import { settlementService } from '../settlement/settlement.service';
import { rideDriverEarningsMinor } from '../../lib/commission';
import { assertValidCoordinate, type Coordinates } from '../maps/maps.provider';
import { mapsService } from '../maps/maps.service';
import { eligibleDrivers, maxSearchRadiusKm, pickupEtaByCategory } from './dispatch.service';

/**
 * Fare model (JMD minor units) per ride category. The quoted fare IS the
 * charged fare — no fee is added at completion. Voryn's revenue is the
 * driver-side commission (RIDE_COMMISSION_BPS), never a customer surcharge.
 * Old per-category service fees were folded into the base so quotes did not
 * drop below what riders were actually paying before.
 */
const FARES: Record<RideCategory, { baseMinor: number; perKmMinor: number }> = {
  ECONOMY: { baseMinor: 67000, perKmMinor: 3500 },
  COMFORT: { baseMinor: 94000, perKmMinor: 5000 },
  XL: { baseMinor: 132000, perKmMinor: 7500 },
  MOTO: { baseMinor: 50000, perKmMinor: 2500 },
};

export function estimateFareMinor(category: RideCategory, distanceKm: number): number {
  const fare = FARES[category];
  return fare.baseMinor + Math.round(fare.perKmMinor * distanceKm);
}

export const ridesService = {
  /**
   * Fare estimates for all categories over a route. When the client resolved
   * real road geometry it passes the driving distance/duration; we clamp it
   * against the straight-line distance so a bad client can't skew fares.
   * Without it, straight-line × 1.3 approximates real road winding.
   */
  estimate(
    pickup: { lat: number; lng: number },
    dropoff: { lat: number; lng: number },
    road?: { distanceKm?: number; minutes?: number },
    pickupEtas?: Partial<Record<RideCategory, number | null>>,
  ) {
    const directKm = Math.max(0.5, haversineKm(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng));
    const distanceKm =
      road?.distanceKm != null
        ? Math.min(Math.max(road.distanceKm, directKm), Math.max(directKm * 4, directKm + 2))
        : directKm * 1.3;
    // ~27 km/h average city speed when the router didn't supply a duration.
    const tripMinutes = Math.max(2, Math.round(road?.minutes ?? distanceKm / 0.45));
    const categories = (Object.keys(FARES) as RideCategory[]).map((category) => ({
      category,
      estimateMinor: estimateFareMinor(category, distanceKm),
      // Pickup ETA comes from real nearby-driver positions; null = no eligible
      // driver of this category nearby, and the UI must say so honestly.
      etaMinutes: pickupEtas?.[category] ?? null,
    }));
    return { distanceKm: Math.round(distanceKm * 10) / 10, tripMinutes, categories };
  },

  /**
   * Server-authoritative quote: the backend resolves the road route itself
   * (via the map-provider service), prices every category and stores the
   * result. Booking then references the quote id — the client can no longer
   * influence distance or fare.
   */
  async createQuote(input: {
    customerId: string;
    pickup: { name?: string; lat: number; lng: number };
    dropoff: { name?: string; lat: number; lng: number };
  }) {
    assertValidCoordinate(input.pickup.lat, input.pickup.lng);
    assertValidCoordinate(input.dropoff.lat, input.dropoff.lng);

    const from: Coordinates = { latitude: input.pickup.lat, longitude: input.pickup.lng };
    const to: Coordinates = { latitude: input.dropoff.lat, longitude: input.dropoff.lng };
    const [road, pickupEtas] = await Promise.all([
      mapsService.calculateRoute(from, to),
      pickupEtaByCategory({ lat: input.pickup.lat, lng: input.pickup.lng }),
    ]);

    const priced = this.estimate(
      { lat: input.pickup.lat, lng: input.pickup.lng },
      { lat: input.dropoff.lat, lng: input.dropoff.lng },
      road ? { distanceKm: road.distanceKm, minutes: road.durationMinutes } : undefined,
      pickupEtas,
    );

    const fares = Object.fromEntries(priced.categories.map((c) => [c.category, c.estimateMinor]));
    const quote = await prisma.rideQuote.create({
      data: {
        customerId: input.customerId,
        pickupName: input.pickup.name ?? 'Pickup',
        pickupLat: input.pickup.lat,
        pickupLng: input.pickup.lng,
        dropoffName: input.dropoff.name ?? 'Destination',
        dropoffLat: input.dropoff.lat,
        dropoffLng: input.dropoff.lng,
        distanceKm: priced.distanceKm,
        durationMinutes: priced.tripMinutes,
        fares,
        expiresAt: new Date(Date.now() + env.RIDE_QUOTE_TTL_MINUTES * 60_000),
      },
    });

    return {
      quoteId: quote.id,
      expiresAt: quote.expiresAt,
      distanceKm: priced.distanceKm,
      tripMinutes: priced.tripMinutes,
      categories: priced.categories,
      // Road geometry so the app draws the real route without its own router call.
      route: road?.coordinates ?? [from, to],
    };
  },

  async requestRide(input: {
    customerId: string;
    category: RideCategory;
    pickup: { name: string; lat: number; lng: number };
    dropoff: { name: string; lat: number; lng: number };
    paymentMethodType: PaymentMethodType;
    scheduledFor?: Date;
    roadDistanceKm?: number;
    quoteId?: string;
  }) {
    let pickup = input.pickup;
    let dropoff = input.dropoff;
    let distanceKm: number;
    let estimateMinor: number;

    if (input.quoteId) {
      // Booking against a quote: coordinates, distance and fare all come from
      // the stored quote. Expired, foreign or already-used quotes are rejected.
      const quote = await prisma.rideQuote.findFirst({
        where: { id: input.quoteId, customerId: input.customerId },
      });
      if (!quote) throw AppError.notFound('Quote not found', 'QUOTE_NOT_FOUND');
      if (quote.usedAt) throw AppError.conflict('This quote was already used.', 'QUOTE_USED');
      if (quote.expiresAt < new Date()) {
        throw AppError.badRequest('This fare quote has expired. Please refresh the price.', 'QUOTE_EXPIRED');
      }
      const fares = quote.fares as Record<string, number>;
      const fare = fares[input.category];
      if (typeof fare !== 'number') {
        throw AppError.badRequest('This quote does not cover the selected ride type.', 'QUOTE_CATEGORY_MISMATCH');
      }
      pickup = { name: input.pickup.name || quote.pickupName, lat: quote.pickupLat, lng: quote.pickupLng };
      dropoff = { name: input.dropoff.name || quote.dropoffName, lat: quote.dropoffLat, lng: quote.dropoffLng };
      distanceKm = quote.distanceKm;
      estimateMinor = fare;
      await prisma.rideQuote.update({ where: { id: quote.id }, data: { usedAt: new Date() } });
    } else {
      // Legacy path (no quote): clamp any client-supplied road distance.
      assertValidCoordinate(input.pickup.lat, input.pickup.lng);
      assertValidCoordinate(input.dropoff.lat, input.dropoff.lng);
      const priced = this.estimate(
        { lat: input.pickup.lat, lng: input.pickup.lng },
        { lat: input.dropoff.lat, lng: input.dropoff.lng },
        { distanceKm: input.roadDistanceKm },
      );
      distanceKm = priced.distanceKm;
      estimateMinor = estimateFareMinor(input.category, distanceKm);
    }

    const request = await prisma.rideRequest.create({
      data: {
        customerId: input.customerId,
        category: input.category,
        status: RideStatus.SEARCHING,
        pickupName: pickup.name,
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        dropoffName: dropoff.name,
        dropoffLat: dropoff.lat,
        dropoffLng: dropoff.lng,
        distanceKm,
        estimateMinor,
        quoteId: input.quoteId,
        paymentMethodType: input.paymentMethodType,
        scheduledFor: input.scheduledFor,
      },
    });

    await recordTrackingEvent({
      subjectType: 'RIDE',
      subjectId: request.id,
      status: RideStatus.SEARCHING,
      label: 'Searching nearby drivers',
    });

    return request;
  },

  /** Dispatch: match the nearest online driver of the category and create the trip. */
  async assignDriver(requestId: string) {
    const request = await prisma.rideRequest.findUnique({ where: { id: requestId } });
    if (!request) throw AppError.notFound('Ride request not found');
    if (request.status !== RideStatus.SEARCHING) {
      throw AppError.badRequest('This ride request is not searching.', 'NOT_SEARCHING');
    }

    // Nearest eligible driver by real presence (fresh location, right
    // category, not already on a trip, inside the widest search radius).
    const candidates = await eligibleDrivers({
      lat: request.pickupLat,
      lng: request.pickupLng,
      radiusKm: maxSearchRadiusKm(),
      category: request.category,
    });
    const best = candidates[0];
    const driver = best
      ? await prisma.driverProfile.findUniqueOrThrow({
          where: { id: best.driverId },
          include: { user: { select: { fullName: true } } },
        })
      : null;

    if (!driver) {
      await prisma.rideRequest.update({
        where: { id: requestId },
        data: { status: RideStatus.NO_DRIVER_AVAILABLE },
      });
      await recordTrackingEvent({
        subjectType: 'RIDE',
        subjectId: requestId,
        status: RideStatus.NO_DRIVER_AVAILABLE,
        label: 'No drivers available right now',
      });
      return null;
    }

    const trip = await prisma.$transaction(async (tx) => {
      const created = await tx.rideTrip.create({
        data: {
          code: orderCode('VC'),
          requestId,
          driverId: driver.id,
          status: RideStatus.DRIVER_ASSIGNED,
          pickupCode: pickupCode(),
        },
      });
      await tx.rideRequest.update({
        where: { id: requestId },
        data: { status: RideStatus.DRIVER_ASSIGNED },
      });
      return created;
    });

    await recordTrackingEvent({
      subjectType: 'RIDE',
      subjectId: trip.id,
      status: RideStatus.DRIVER_ASSIGNED,
      label: `${driver.user.fullName} is your driver`,
    });

    return { trip, driver };
  },

  /** Completes the trip, charges the fare, records the payment. */
  async completeTrip(tripId: string, tipMinor = 0) {
    const trip = await prisma.rideTrip.findUnique({
      where: { id: tripId },
      include: { request: true, driver: { include: { user: true } } },
    });
    if (!trip) throw AppError.notFound('Trip not found');
    if (trip.status === RideStatus.COMPLETED) return trip;

    const fare = FARES[trip.request.category];
    const distanceFareMinor = Math.round(
      fare.perKmMinor * (trip.request.distanceKm ?? 1),
    );
    const fareMinor = fare.baseMinor + distanceFareMinor;
    const totalMinor = fareMinor + tipMinor;

    const payment = await takePayment({
      userId: trip.request.customerId,
      methodType: trip.request.paymentMethodType,
      amountMinor: totalMinor,
      referenceType: 'ride',
      referenceId: trip.id,
      description: `Ride ${trip.code} with ${trip.driver.user.fullName}`,
      counterpartyName: trip.driver.user.fullName,
      idempotencyKey: `ride-complete:${trip.id}`,
    });

    const completed = await prisma.rideTrip.update({
      where: { id: trip.id },
      data: {
        status: RideStatus.COMPLETED,
        completedAt: new Date(),
        baseFareMinor: fare.baseMinor,
        distanceFareMinor,
        serviceFeeMinor: 0,
        tipMinor,
        totalMinor,
        paymentId: payment.id,
      },
    });

    // Driver payout: fare minus Voryn's commission, tips passed through whole.
    const payoutMinor = rideDriverEarningsMinor(fareMinor) + tipMinor;
    await prisma.wallet.upsert({
      where: { userId: trip.driver.user.id },
      create: { userId: trip.driver.user.id },
      update: {},
    });
    await walletService.credit({
      userId: trip.driver.user.id,
      amountMinor: payoutMinor,
      type: WalletEntryType.PAYOUT,
      description: `Trip payout • ${trip.code}`,
      referenceType: 'ride',
      referenceId: trip.id,
      idempotencyKey: `driver-payout:ride:${trip.id}`,
    });
    await settlementService.settleRide({
      tripId: trip.id,
      code: trip.code,
      fareMinor,
      tipMinor,
    });
    await prisma.rideRequest.update({
      where: { id: trip.requestId },
      data: { status: RideStatus.COMPLETED },
    });
    await prisma.driverProfile.update({
      where: { id: trip.driverId },
      data: { tripsCount: { increment: 1 } },
    });
    await recordTrackingEvent({
      subjectType: 'RIDE',
      subjectId: trip.id,
      status: RideStatus.COMPLETED,
      label: 'Ride complete',
    });
    return completed;
  },

  /**
   * Post-trip tip: charges the customer and pays the driver in full. The
   * fare payout already ran at completion, so the tip is credited separately.
   */
  async addTip(tripId: string, customerId: string, tipMinor: number) {
    const trip = await prisma.rideTrip.findFirst({
      where: { id: tripId, request: { customerId } },
      include: { request: true, driver: { include: { user: { select: { id: true, fullName: true } } } } },
    });
    if (!trip) throw AppError.notFound('Trip not found');
    if (trip.status !== RideStatus.COMPLETED) {
      throw AppError.badRequest('You can tip once your trip is complete.', 'NOT_COMPLETED');
    }
    if (trip.tipMinor > 0) {
      throw AppError.conflict('A tip has already been added to this trip.', 'ALREADY_TIPPED');
    }

    await takePayment({
      userId: customerId,
      methodType: trip.request.paymentMethodType,
      amountMinor: tipMinor,
      referenceType: 'ride',
      referenceId: trip.id,
      description: `Tip for ${trip.driver.user.fullName} • ${trip.code}`,
      counterpartyName: trip.driver.user.fullName,
      idempotencyKey: `ride-tip:${trip.id}`,
    });

    const updated = await prisma.rideTrip.update({
      where: { id: trip.id },
      data: { tipMinor, totalMinor: { increment: tipMinor } },
    });

    await walletService.credit({
      userId: trip.driver.user.id,
      amountMinor: tipMinor,
      type: WalletEntryType.PAYOUT,
      description: `Tip • ${trip.code}`,
      referenceType: 'ride',
      referenceId: trip.id,
      idempotencyKey: `driver-tip:ride:${trip.id}`,
    });
    await prisma.notification.create({
      data: {
        userId: trip.driver.user.id,
        type: 'RIDE_UPDATE',
        title: 'You received a tip!',
        body: `Your rider tipped you on trip ${trip.code}. It has been added to your wallet.`,
      },
    });

    return updated;
  },

  async cancel(requestOrTripId: string, customerId: string, reason: string) {
    // Accept either a request id (still searching) or a trip id (assigned).
    const request = await prisma.rideRequest.findFirst({
      where: { id: requestOrTripId, customerId },
    });
    if (request) {
      if (![RideStatus.REQUESTED, RideStatus.SEARCHING].includes(request.status as never)) {
        throw AppError.badRequest('This ride can no longer be cancelled here.');
      }
      const updated = await prisma.rideRequest.update({
        where: { id: request.id },
        data: { status: RideStatus.CANCELLED_BY_CUSTOMER, cancelReason: reason },
      });
      await recordTrackingEvent({
        subjectType: 'RIDE',
        subjectId: request.id,
        status: RideStatus.CANCELLED_BY_CUSTOMER,
        label: 'Ride request cancelled',
      });
      return updated;
    }

    const trip = await prisma.rideTrip.findFirst({
      where: { id: requestOrTripId, request: { customerId } },
      include: { request: true, driver: { select: { userId: true } } },
    });
    if (!trip) throw AppError.notFound('Ride not found');
    const cancellable: RideStatus[] = [
      RideStatus.DRIVER_ASSIGNED,
      RideStatus.DRIVER_ARRIVING,
      RideStatus.ARRIVED,
    ];
    if (!cancellable.includes(trip.status)) {
      throw AppError.badRequest('This trip can no longer be cancelled.');
    }
    await prisma.$transaction([
      prisma.rideTrip.update({
        where: { id: trip.id },
        data: { status: RideStatus.CANCELLED_BY_CUSTOMER },
      }),
      prisma.rideRequest.update({
        where: { id: trip.requestId },
        data: { status: RideStatus.CANCELLED_BY_CUSTOMER, cancelReason: reason },
      }),
    ]);
    if (trip.paymentId) await refundPayment(trip.paymentId, 'Ride cancelled');
    await recordTrackingEvent({
      subjectType: 'RIDE',
      subjectId: trip.id,
      status: RideStatus.CANCELLED_BY_CUSTOMER,
      label: 'Ride cancelled',
    });
    // The driver is mid-drive to the pickup — tell them immediately.
    await prisma.notification.create({
      data: {
        userId: trip.driver.userId,
        type: 'RIDE_UPDATE',
        title: 'Ride cancelled',
        body: `The rider cancelled trip ${trip.code}. No need to continue to the pickup.`,
      },
    });
    return trip;
  },
};
