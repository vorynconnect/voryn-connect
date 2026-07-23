import { BookingStatus, PaymentMethodType, ServiceLocationType, ServiceVertical } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { orderCode } from '../../lib/codes';
import { percentOfMinor } from '../../lib/money';
import { takePayment, refundPayment } from '../payments/payment.service';
import { recordTrackingEvent } from '../tracking/tracking.service';
import { notifyProviderStaff } from '../../lib/notify';
import { settlementService } from '../settlement/settlement.service';

// Provider-funded commission model: no customer-facing convenience fee.
const CONVENIENCE_FEE_MINOR = 0;
const GCT_PERCENT = 15;

const PREFIX: Record<ServiceVertical, string> = {
  AUTO_CARE: 'AC',
  TECHNICIAN: 'TS',
  HOME_SERVICES: 'HS',
};

export const bookingsService = {
  async createBooking(input: {
    customerId: string;
    packageId: string;
    locationType: ServiceLocationType;
    scheduledAt: Date;
    paymentMethodType: PaymentMethodType;
    addressId?: string;
    customerVehicleId?: string;
    deviceDescription?: string;
    issueDescription?: string;
    providerNote?: string;
    idempotencyKey: string;
  }) {
    const pkg = await prisma.servicePackage.findUnique({
      where: { id: input.packageId },
      include: { listing: { include: { provider: true, category: true } } },
    });
    if (!pkg || !pkg.isActive || !pkg.listing.isActive) {
      throw AppError.notFound('This service package is no longer available.');
    }
    const listing = pkg.listing;
    // Discovery hides unverified providers; this backstops direct-ID bookings.
    if (listing.provider.status !== 'ACTIVE' || listing.provider.categories.includes('SUPPLIER')) {
      throw AppError.badRequest('This provider is not accepting bookings right now.', 'PROVIDER_UNAVAILABLE');
    }

    if (input.locationType === 'MOBILE' && !listing.supportsMobile) {
      throw AppError.badRequest('This provider does not offer mobile service for this package.');
    }
    if (input.locationType === 'AT_PROVIDER' && !listing.supportsAtShop) {
      throw AppError.badRequest('This provider does not offer in-shop service for this package.');
    }

    let addressName: string | undefined;
    let latitude: number | undefined;
    let longitude: number | undefined;
    if (input.locationType === 'MOBILE') {
      if (!input.addressId) throw AppError.badRequest('Choose a service address.');
      const address = await prisma.address.findFirst({
        where: { id: input.addressId, userId: input.customerId },
      });
      if (!address) throw AppError.notFound('Address not found');
      addressName = `${address.name} • ${address.line1}`;
      latitude = address.latitude;
      longitude = address.longitude;
    }

    const mobileFeeMinor = input.locationType === 'MOBILE' ? listing.mobileFeeMinor : 0;
    const serviceFeeMinor = pkg.priceMinor;
    const taxMinor = percentOfMinor(serviceFeeMinor + CONVENIENCE_FEE_MINOR + mobileFeeMinor, GCT_PERCENT);
    const totalMinor = serviceFeeMinor + CONVENIENCE_FEE_MINOR + mobileFeeMinor + taxMinor;

    const booking = await prisma.serviceBooking.create({
      data: {
        code: orderCode(PREFIX[listing.category.vertical]),
        customerId: input.customerId,
        providerId: listing.providerId,
        vertical: listing.category.vertical,
        listingId: listing.id,
        packageId: pkg.id,
        packageName: pkg.name,
        status: BookingStatus.PENDING_PAYMENT,
        locationType: input.locationType,
        addressName,
        latitude,
        longitude,
        customerVehicleId: input.customerVehicleId,
        deviceDescription: input.deviceDescription,
        issueDescription: input.issueDescription,
        providerNote: input.providerNote,
        serviceFeeMinor,
        convenienceFeeMinor: CONVENIENCE_FEE_MINOR,
        mobileFeeMinor,
        taxMinor,
        totalMinor,
        appointment: {
          create: { scheduledAt: input.scheduledAt, durationMinutes: listing.durationMinutes },
        },
      },
    });

    const payment = await takePayment({
      userId: input.customerId,
      methodType: input.paymentMethodType,
      amountMinor: totalMinor,
      referenceType: 'booking',
      referenceId: booking.id,
      description: `${pkg.name} • ${listing.provider.name}`,
      counterpartyName: listing.provider.name,
      idempotencyKey: input.idempotencyKey,
    });

    const booked = await prisma.serviceBooking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.BOOKED, paymentId: payment.id },
      include: {
        provider: { select: { id: true, name: true, logoUrl: true, ratingAvg: true } },
        appointment: true,
      },
    });

    await recordTrackingEvent({
      subjectType: 'BOOKING',
      subjectId: booking.id,
      status: BookingStatus.BOOKED,
      label: 'Booked',
    });
    await notifyProviderStaff(
      booked.providerId,
      'BOOKING_UPDATE',
      `New booking ${booked.code}`,
      `${booked.packageName} — review and accept it in the dashboard.`,
    );

    return { booking: booked, payment };
  },

  async transition(bookingId: string, status: BookingStatus, label: string) {
    const booking = await prisma.serviceBooking.update({
      where: { id: bookingId },
      data: { status },
    });
    await recordTrackingEvent({ subjectType: 'BOOKING', subjectId: bookingId, status, label });
    if (status === BookingStatus.COMPLETED) {
      await settlementService.settleBooking(bookingId);
    }
    return booking;
  },

  async complete(bookingId: string) {
    const booking = await prisma.serviceBooking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.COMPLETED },
    });
    if (booking.technicianId) {
      await prisma.technicianProfile.update({
        where: { id: booking.technicianId },
        data: { jobsCompleted: { increment: 1 } },
      });
    }
    await recordTrackingEvent({
      subjectType: 'BOOKING',
      subjectId: bookingId,
      status: BookingStatus.COMPLETED,
      label: 'Service completed',
    });
    await settlementService.settleBooking(bookingId);
    return booking;
  },

  async cancel(bookingId: string, customerId: string, reason: string) {
    const booking = await prisma.serviceBooking.findFirst({
      where: { id: bookingId, customerId },
    });
    if (!booking) throw AppError.notFound('Booking not found');
    const cancellable: BookingStatus[] = [
      BookingStatus.PENDING_PAYMENT,
      BookingStatus.BOOKED,
      BookingStatus.ACCEPTED,
    ];
    if (!cancellable.includes(booking.status)) {
      throw AppError.badRequest('This booking can no longer be cancelled.', 'NOT_CANCELLABLE');
    }
    const updated = await prisma.serviceBooking.update({
      where: { id: booking.id },
      data: { status: BookingStatus.CANCELLED_BY_CUSTOMER, cancelReason: reason },
    });
    if (booking.paymentId) await refundPayment(booking.paymentId, `Booking ${booking.code} cancelled`);
    await recordTrackingEvent({
      subjectType: 'BOOKING',
      subjectId: booking.id,
      status: BookingStatus.CANCELLED_BY_CUSTOMER,
      label: 'Booking cancelled',
    });
    return updated;
  },
};
