import { BookingStatus, OrderStatus, RentalStatus, RideStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { ordersService } from '../orders/orders.service';
import { recordLiveLocation, recordTrackingEvent } from '../tracking/tracking.service';

/**
 * DEVELOPMENT-ONLY fulfillment simulator.
 *
 * In production these transitions come from real actors: merchants accept
 * orders in the provider dashboard, couriers/drivers stream GPS from their
 * apps. In development this module plays those roles by calling the exact
 * same domain services on timers, so the customer app experiences real
 * backend-driven status changes and live tracking over sockets.
 *
 * Enabled only when OTP_DEV_MODE=true (a proxy for "dev sandbox" mode).
 */

const step = (ms: number) => new Promise((r) => setTimeout(r, ms));

function interpolate(a: { lat: number; lng: number }, b: { lat: number; lng: number }, t: number) {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

export function simulationEnabled(): boolean {
  return env.OTP_DEV_MODE && env.SIMULATE_FULFILLMENT && env.NODE_ENV !== 'test';
}

/** Order: confirmed → preparing → courier assigned → picked up → on the way (with GPS) → delivered. */
export async function simulateOrderFulfillment(orderId: string): Promise<void> {
  if (!simulationEnabled()) return;
  void (async () => {
    try {
      await step(4000);
      await ordersService.transition(orderId, OrderStatus.CONFIRMED, 'Order confirmed');
      await step(6000);
      await ordersService.transition(orderId, OrderStatus.PREPARING, 'Preparing your order');

      const courier = await prisma.courierProfile.findFirst({ where: { isOnline: true } });
      await step(8000);
      if (courier) await ordersService.assignCourier(orderId, courier.id);

      await step(6000);
      await ordersService.transition(orderId, OrderStatus.PICKED_UP, 'Courier picked up your order');
      await ordersService.transition(orderId, OrderStatus.ON_THE_WAY, 'Your order is on the way');

      const order = await prisma.order.findUnique({ where: { id: orderId } });
      if (!order) return;
      const from = { lat: 17.9712, lng: -76.8898 }; // merchant area (Portmore)
      const to = { lat: order.deliveryLat ?? 17.9583, lng: order.deliveryLng ?? -76.8822 };
      for (let i = 1; i <= 10; i += 1) {
        const cancelled = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
        if (!cancelled || cancelled.status.startsWith('CANCELLED')) return;
        const p = interpolate(from, to, i / 10);
        await recordLiveLocation({
          subjectType: 'ORDER',
          subjectId: orderId,
          latitude: p.lat,
          longitude: p.lng,
        });
        await step(3000);
      }
      await ordersService.transition(orderId, OrderStatus.DELIVERED, 'Delivered — enjoy!');
    } catch (err) {
      logger.warn({ err, orderId }, 'order simulation stopped');
    }
  })();
}

/** Ride: driver assigned → arriving (GPS to pickup) → in progress (GPS to dropoff) → completed. */
export async function simulateRideProgress(tripId: string): Promise<void> {
  if (!simulationEnabled()) return;
  void (async () => {
    try {
      const trip = await prisma.rideTrip.findUnique({
        where: { id: tripId },
        include: { request: true },
      });
      if (!trip) return;
      const pickup = { lat: trip.request.pickupLat, lng: trip.request.pickupLng };
      const dropoff = { lat: trip.request.dropoffLat, lng: trip.request.dropoffLng };
      const driverStart = { lat: pickup.lat - 0.015, lng: pickup.lng - 0.012 };

      await prisma.rideTrip.update({ where: { id: tripId }, data: { status: RideStatus.DRIVER_ARRIVING } });
      await recordTrackingEvent({
        subjectType: 'RIDE',
        subjectId: tripId,
        status: RideStatus.DRIVER_ARRIVING,
        label: 'Driver is on the way',
      });
      for (let i = 1; i <= 8; i += 1) {
        const current = await prisma.rideTrip.findUnique({ where: { id: tripId }, select: { status: true } });
        if (!current || current.status.startsWith('CANCELLED')) return;
        const p = interpolate(driverStart, pickup, i / 8);
        await recordLiveLocation({ subjectType: 'RIDE', subjectId: tripId, latitude: p.lat, longitude: p.lng });
        await step(2500);
      }

      await prisma.rideTrip.update({
        where: { id: tripId },
        data: { status: RideStatus.IN_PROGRESS, startedAt: new Date() },
      });
      await recordTrackingEvent({
        subjectType: 'RIDE',
        subjectId: tripId,
        status: RideStatus.IN_PROGRESS,
        label: 'Trip underway',
      });
      for (let i = 1; i <= 10; i += 1) {
        const current = await prisma.rideTrip.findUnique({ where: { id: tripId }, select: { status: true } });
        if (!current || current.status.startsWith('CANCELLED')) return;
        const p = interpolate(pickup, dropoff, i / 10);
        await recordLiveLocation({ subjectType: 'RIDE', subjectId: tripId, latitude: p.lat, longitude: p.lng });
        await step(3000);
      }

      const { ridesService } = await import('../rides/rides.service');
      await ridesService.completeTrip(tripId);
    } catch (err) {
      logger.warn({ err, tripId }, 'ride simulation stopped');
    }
  })();
}

/** Booking: accepted → on the way (GPS) → in service → completed. */
export async function simulateBookingProgress(bookingId: string): Promise<void> {
  if (!simulationEnabled()) return;
  void (async () => {
    try {
      await step(5000);
      const { bookingsService } = await import('../bookings/bookings.service');
      await bookingsService.transition(bookingId, BookingStatus.ACCEPTED, 'Provider accepted');
      await step(6000);
      await bookingsService.transition(bookingId, BookingStatus.ON_THE_WAY, 'Provider is on the way');

      const booking = await prisma.serviceBooking.findUnique({ where: { id: bookingId } });
      if (!booking) return;
      const from = { lat: 17.9905, lng: -76.9547 };
      const to = { lat: booking.latitude ?? 17.9583, lng: booking.longitude ?? -76.8822 };
      for (let i = 1; i <= 8; i += 1) {
        const current = await prisma.serviceBooking.findUnique({
          where: { id: bookingId },
          select: { status: true },
        });
        if (!current || current.status.startsWith('CANCELLED')) return;
        const p = interpolate(from, to, i / 8);
        await recordLiveLocation({ subjectType: 'BOOKING', subjectId: bookingId, latitude: p.lat, longitude: p.lng });
        await step(3000);
      }

      await bookingsService.transition(bookingId, BookingStatus.IN_SERVICE, 'Service in progress');
      await step(12000);
      await bookingsService.complete(bookingId);
    } catch (err) {
      logger.warn({ err, bookingId }, 'booking simulation stopped');
    }
  })();
}

/** Rental: confirm shortly after payment. */
export async function simulateRentalConfirmation(reservationId: string): Promise<void> {
  if (!simulationEnabled()) return;
  void (async () => {
    try {
      await step(2000);
      const reservation = await prisma.rentalReservation.findUnique({ where: { id: reservationId } });
      if (!reservation || reservation.status !== RentalStatus.PENDING_PAYMENT) return;
    } catch (err) {
      logger.warn({ err, reservationId }, 'rental simulation stopped');
    }
  })();
}
