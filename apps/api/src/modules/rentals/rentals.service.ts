import { PaymentMethodType, RentalStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { orderCode, pickupCode } from '../../lib/codes';
import { percentOfMinor } from '../../lib/money';
import { takePayment, refundPayment } from '../payments/payment.service';
import { recordTrackingEvent } from '../tracking/tracking.service';

export type RentalAddOn = { key: string; name: string; priceMinorPerDay: number };

export const RENTAL_ADD_ONS: RentalAddOn[] = [
  { key: 'basic_protection', name: 'Basic protection', priceMinorPerDay: 120000 },
  { key: 'full_protection', name: 'Full protection', priceMinorPerDay: 200000 },
  { key: 'child_seat', name: 'Child seat', priceMinorPerDay: 50000 },
  { key: 'extra_driver', name: 'Extra driver', priceMinorPerDay: 80000 },
];

const RENTAL_SERVICE_FEE_MINOR = 30000; // JMD 300.00

function rentalDays(pickupAt: Date, returnAt: Date): number {
  const ms = returnAt.getTime() - pickupAt.getTime();
  return Math.max(1, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

export const rentalsService = {
  quote(input: { dailyRateMinor: number; depositMinor: number; pickupAt: Date; returnAt: Date; addOnKeys: string[] }) {
    const days = rentalDays(input.pickupAt, input.returnAt);
    const addOns = RENTAL_ADD_ONS.filter((a) => input.addOnKeys.includes(a.key));
    const rentalFeeMinor = input.dailyRateMinor * days;
    const protectionMinor = addOns.reduce((sum, a) => sum + a.priceMinorPerDay * days, 0);
    const totalMinor = rentalFeeMinor + protectionMinor + RENTAL_SERVICE_FEE_MINOR;
    return {
      days,
      rentalFeeMinor,
      protectionMinor,
      serviceFeeMinor: RENTAL_SERVICE_FEE_MINOR,
      totalMinor,
      depositMinor: input.depositMinor,
      addOns,
    };
  },

  /** Overlap-safe reservation: checks conflicts inside the transaction. */
  async reserve(input: {
    customerId: string;
    vehicleId: string;
    pickupAt: Date;
    returnAt: Date;
    addOnKeys: string[];
    driverName: string;
    paymentMethodType: PaymentMethodType;
    idempotencyKey: string;
  }) {
    if (input.returnAt <= input.pickupAt) {
      throw AppError.badRequest('Return time must be after pickup time.');
    }

    const vehicle = await prisma.rentalVehicle.findUnique({
      where: { id: input.vehicleId },
      include: { provider: true },
    });
    if (!vehicle || !vehicle.isActive) throw AppError.notFound('Vehicle not available');
    // Discovery hides unverified providers; this backstops direct-ID reservations.
    if (vehicle.provider.status !== 'ACTIVE' || vehicle.provider.categories.includes('SUPPLIER')) {
      throw AppError.badRequest('This operator is not accepting reservations right now.', 'PROVIDER_UNAVAILABLE');
    }

    const quote = this.quote({
      dailyRateMinor: vehicle.dailyRateMinor,
      depositMinor: vehicle.depositMinor,
      pickupAt: input.pickupAt,
      returnAt: input.returnAt,
      addOnKeys: input.addOnKeys,
    });

    const reservation = await prisma.$transaction(async (tx) => {
      const conflict = await tx.rentalReservation.findFirst({
        where: {
          vehicleId: vehicle.id,
          status: { in: [RentalStatus.CONFIRMED, RentalStatus.ACTIVE, RentalStatus.EXTENDED] },
          pickupAt: { lt: input.returnAt },
          returnAt: { gt: input.pickupAt },
        },
      });
      if (conflict) {
        throw AppError.conflict('This vehicle is already reserved for those dates.', 'DATES_UNAVAILABLE');
      }

      return tx.rentalReservation.create({
        data: {
          code: `VC-R${pickupCode()}`,
          customerId: input.customerId,
          vehicleId: vehicle.id,
          providerId: vehicle.providerId,
          status: RentalStatus.PENDING_PAYMENT,
          pickupAt: input.pickupAt,
          returnAt: input.returnAt,
          pickupLocation: vehicle.pickupBranchName ?? 'Provider location',
          returnLocation: vehicle.pickupBranchName ?? 'Provider location',
          pickupCode: pickupCode(),
          addOns: quote.addOns as never,
          driverName: input.driverName,
          licenseVerified: true,
          rentalFeeMinor: quote.rentalFeeMinor,
          protectionMinor: quote.protectionMinor,
          serviceFeeMinor: quote.serviceFeeMinor,
          totalMinor: quote.totalMinor,
          depositMinor: quote.depositMinor,
          depositStatus: 'held',
        },
      });
    });

    const payment = await takePayment({
      userId: input.customerId,
      methodType: input.paymentMethodType,
      amountMinor: quote.totalMinor,
      referenceType: 'rental',
      referenceId: reservation.id,
      description: `Rental ${reservation.code} • ${vehicle.make} ${vehicle.model}`,
      counterpartyName: vehicle.provider.name,
      idempotencyKey: input.idempotencyKey,
    });

    const confirmed = await prisma.rentalReservation.update({
      where: { id: reservation.id },
      data: { status: RentalStatus.CONFIRMED, paymentId: payment.id },
      include: {
        vehicle: true,
        provider: { select: { id: true, name: true, logoUrl: true, isVerified: true } },
      },
    });

    await recordTrackingEvent({
      subjectType: 'RENTAL',
      subjectId: reservation.id,
      status: RentalStatus.CONFIRMED,
      label: 'Reservation confirmed',
    });

    return { reservation: confirmed, payment };
  },

  async activate(reservationId: string, customerId: string) {
    const reservation = await prisma.rentalReservation.findFirst({
      where: { id: reservationId, customerId },
    });
    if (!reservation) throw AppError.notFound('Reservation not found');
    if (reservation.status !== RentalStatus.CONFIRMED) {
      throw AppError.badRequest('This reservation cannot be activated.');
    }
    const active = await prisma.rentalReservation.update({
      where: { id: reservation.id },
      data: { status: RentalStatus.ACTIVE },
    });
    await recordTrackingEvent({
      subjectType: 'RENTAL',
      subjectId: reservation.id,
      status: RentalStatus.ACTIVE,
      label: 'Rental started',
    });
    return active;
  },

  async extend(reservationId: string, customerId: string, newReturnAt: Date, idempotencyKey: string) {
    const reservation = await prisma.rentalReservation.findFirst({
      where: { id: reservationId, customerId },
      include: { vehicle: true, provider: true },
    });
    if (!reservation) throw AppError.notFound('Reservation not found');
    if (![RentalStatus.ACTIVE, RentalStatus.CONFIRMED, RentalStatus.EXTENDED].includes(reservation.status as never)) {
      throw AppError.badRequest('This rental cannot be extended.');
    }
    if (newReturnAt <= reservation.returnAt) {
      throw AppError.badRequest('New return time must be after the current return time.');
    }

    const extraDays = rentalDays(reservation.returnAt, newReturnAt);
    const extraMinor = reservation.vehicle.dailyRateMinor * extraDays;

    await takePayment({
      userId: customerId,
      methodType: PaymentMethodType.VORYN_WALLET,
      amountMinor: extraMinor,
      referenceType: 'rental',
      referenceId: reservation.id,
      description: `Rental extension ${reservation.code} (+${extraDays} day${extraDays > 1 ? 's' : ''})`,
      counterpartyName: reservation.provider.name,
      idempotencyKey,
    });

    const extended = await prisma.rentalReservation.update({
      where: { id: reservation.id },
      data: {
        status: RentalStatus.EXTENDED,
        returnAt: newReturnAt,
        rentalFeeMinor: reservation.rentalFeeMinor + extraMinor,
        totalMinor: reservation.totalMinor + extraMinor,
      },
    });
    await recordTrackingEvent({
      subjectType: 'RENTAL',
      subjectId: reservation.id,
      status: RentalStatus.EXTENDED,
      label: 'Rental extended',
    });
    return extended;
  },

  async complete(reservationId: string, customerId: string) {
    const reservation = await prisma.rentalReservation.findFirst({
      where: { id: reservationId, customerId },
    });
    if (!reservation) throw AppError.notFound('Reservation not found');
    if (![RentalStatus.ACTIVE, RentalStatus.EXTENDED, RentalStatus.RETURN_PENDING].includes(reservation.status as never)) {
      throw AppError.badRequest('This rental cannot be completed.');
    }
    const completed = await prisma.rentalReservation.update({
      where: { id: reservation.id },
      data: { status: RentalStatus.COMPLETED, depositStatus: 'released' },
    });
    await recordTrackingEvent({
      subjectType: 'RENTAL',
      subjectId: reservation.id,
      status: RentalStatus.COMPLETED,
      label: 'Vehicle returned successfully',
    });
    return completed;
  },

  async cancel(reservationId: string, customerId: string, reason: string) {
    const reservation = await prisma.rentalReservation.findFirst({
      where: { id: reservationId, customerId },
    });
    if (!reservation) throw AppError.notFound('Reservation not found');
    if (![RentalStatus.PENDING_PAYMENT, RentalStatus.CONFIRMED].includes(reservation.status as never)) {
      throw AppError.badRequest('This reservation can no longer be cancelled.', 'NOT_CANCELLABLE');
    }
    const cancelled = await prisma.rentalReservation.update({
      where: { id: reservation.id },
      data: { status: RentalStatus.CANCELLED, cancelReason: reason, depositStatus: 'released' },
    });
    if (reservation.paymentId) {
      await refundPayment(reservation.paymentId, `Rental ${reservation.code} cancelled`);
    }
    await recordTrackingEvent({
      subjectType: 'RENTAL',
      subjectId: reservation.id,
      status: RentalStatus.CANCELLED,
      label: 'Reservation cancelled',
    });
    return cancelled;
  },
};
