import { OrderStatus, BookingStatus, Prisma, type Provider } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';

/**
 * Partner dashboard mapping layer.
 *
 * The website dashboard displays JMD in MAJOR units, while the API stores
 * integer minor units. Every value crossing this boundary is converted here
 * (toMajor on read, toMinor on write) so neither side changes conventions.
 */
export const toMajor = (minor: number | null | undefined): number => Math.round(Number(minor ?? 0)) / 100;
export const toMinor = (major: number): number => Math.round(major * 100);

// ── Storefront (dashboard concept) ⇄ Provider (API concept) ──

const SERVICE_TYPE_BY_CATEGORY: Record<string, string> = {
  RESTAURANT: 'Restaurant / Food Delivery',
  GROCERY: 'Grocery',
  PHARMACY: 'Pharmacy',
  CONVENIENCE: 'Product Supplier',
  DRINKS: 'Liquor & Beverages',
  RIDES: 'Ride / Mobility',
  VEHICLE_RENTAL: 'Vehicle Rental',
  AUTO_CARE: 'Car Repair',
  TECHNICIAN: 'Phone & Computer Repair',
  HOME_SERVICES: 'Home Services',
  SUPPLIER: 'Supplier',
};

export function serviceTypeFor(provider: Provider): string {
  const primary = provider.categories[0];
  return (primary && SERVICE_TYPE_BY_CATEGORY[primary]) || 'Partner';
}

/** Dashboard "storefront" view of a Provider. */
export function storefrontView(provider: Provider) {
  return {
    id: provider.id,
    partnerOrgId: provider.id,
    slug: provider.slug,
    displayName: provider.name,
    description: provider.description ?? '',
    logoUrl: provider.logoUrl ?? '',
    bannerUrl: provider.coverUrl ?? '',
    isOpen: provider.isOpen,
    status: provider.status === 'ACTIVE' ? 'ACTIVE' : provider.status,
    estimatedTimeMin: 20,
    estimatedTimeMax: 45,
    draftData: { serviceType: serviceTypeFor(provider) },
    publishedData: provider.status === 'ACTIVE' ? { serviceType: serviceTypeFor(provider) } : null,
  };
}

export async function partnerView(provider: Provider) {
  const branches = await prisma.providerBranch.findMany({
    where: { providerId: provider.id },
    include: { serviceAreas: true },
  });
  const serviceAreas = branches.flatMap((b) => b.serviceAreas.map((a) => ({ areaName: a.name, city: b.city })));
  return {
    id: provider.id,
    tradingName: provider.name,
    businessType: serviceTypeFor(provider),
    contactEmail: provider.email ?? '',
    contactPhone: provider.phone ?? '',
    websiteUrl: '',
    serviceAreas,
    storefronts: [storefrontView(provider)],
  };
}

// ── Orders ───────────────────────────────────────────────────

/** Dashboard status vocabulary → OrderStatus. */
const ORDER_STATUS_IN: Record<string, OrderStatus> = {
  ACCEPTED: OrderStatus.CONFIRMED,
  CONFIRMED: OrderStatus.CONFIRMED,
  PREPARING: OrderStatus.PREPARING,
  READY: OrderStatus.READY_FOR_PICKUP,
  READY_FOR_PICKUP: OrderStatus.READY_FOR_PICKUP,
  OUT_FOR_DELIVERY: OrderStatus.ON_THE_WAY,
  COMPLETED: OrderStatus.COMPLETED,
  REJECTED: OrderStatus.CANCELLED_BY_MERCHANT,
};

/** Provider-driven transitions the backend accepts, per current status. */
const ORDER_TRANSITIONS: Partial<Record<OrderStatus, OrderStatus[]>> = {
  [OrderStatus.PLACED]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED_BY_MERCHANT],
  [OrderStatus.CONFIRMED]: [OrderStatus.PREPARING, OrderStatus.CANCELLED_BY_MERCHANT],
  [OrderStatus.PREPARING]: [OrderStatus.READY_FOR_PICKUP],
  [OrderStatus.READY_FOR_PICKUP]: [OrderStatus.ON_THE_WAY, OrderStatus.COMPLETED],
  [OrderStatus.COURIER_ASSIGNED]: [OrderStatus.ON_THE_WAY],
  [OrderStatus.ON_THE_WAY]: [OrderStatus.DELIVERED, OrderStatus.COMPLETED],
  [OrderStatus.DELIVERED]: [OrderStatus.COMPLETED],
};

export function resolveOrderTransition(current: OrderStatus, requested: string): OrderStatus {
  const target = ORDER_STATUS_IN[requested.toUpperCase()];
  if (!target) throw AppError.badRequest(`Unknown order status "${requested}".`, 'INVALID_STATUS');
  const allowed = ORDER_TRANSITIONS[current] ?? [];
  if (!allowed.includes(target)) {
    throw AppError.badRequest(
      `An order in status ${current} cannot move to ${target}.`,
      'INVALID_TRANSITION',
    );
  }
  return target;
}

export const ORDER_TRANSITION_LABELS: Record<string, string> = {
  [OrderStatus.CONFIRMED]: 'Order accepted by the provider',
  [OrderStatus.PREPARING]: 'Order is being prepared',
  [OrderStatus.READY_FOR_PICKUP]: 'Order ready',
  [OrderStatus.ON_THE_WAY]: 'Order on the way',
  [OrderStatus.DELIVERED]: 'Order delivered',
  [OrderStatus.COMPLETED]: 'Order completed',
  [OrderStatus.CANCELLED_BY_MERCHANT]: 'Order rejected by the provider',
};

type OrderWithRelations = Prisma.OrderGetPayload<{
  include: { items: true; customer: { select: { fullName: true } }; payment: true };
}>;

/** Dashboard order shape (money in major units). */
export function orderView(order: OrderWithRelations) {
  return {
    id: order.id,
    orderNumber: order.code,
    status: order.status,
    orderType: order.type === 'DELIVERY' ? 'Delivery' : 'Pickup',
    total: toMajor(order.totalMinor),
    paymentStatus: order.payment?.status ?? 'PENDING',
    payments: order.payment
      ? [{ id: order.payment.id, methodType: order.payment.methodType, status: order.payment.status, providerReference: order.payment.id }]
      : [],
    customerNotes: order.deliveryInstructions ?? '',
    deliveryAddress: order.deliveryAddressName
      ? { line1: order.deliveryAddressName, city: 'Portmore', parish: 'St. Catherine' }
      : null,
    placedAt: order.placedAt ?? order.createdAt,
    createdAt: order.createdAt,
    customer: { displayName: order.customer.fullName },
    items: order.items.map((i) => ({
      id: i.id,
      name: i.name,
      quantity: i.quantity,
      unitPrice: toMajor(i.unitPriceMinor),
      total: toMajor(i.unitPriceMinor * i.quantity),
    })),
  };
}

// ── Bookings ─────────────────────────────────────────────────

const BOOKING_STATUS_IN: Record<string, BookingStatus> = {
  ACCEPTED: BookingStatus.ACCEPTED,
  CONFIRMED: BookingStatus.ACCEPTED,
  SCHEDULED: BookingStatus.ACCEPTED,
  EN_ROUTE: BookingStatus.ON_THE_WAY,
  OUT_FOR_DELIVERY: BookingStatus.ON_THE_WAY,
  IN_PROGRESS: BookingStatus.IN_SERVICE,
  COMPLETED: BookingStatus.COMPLETED,
  REJECTED: BookingStatus.CANCELLED_BY_PROVIDER,
};

const BOOKING_TRANSITIONS: Partial<Record<BookingStatus, BookingStatus[]>> = {
  [BookingStatus.BOOKED]: [BookingStatus.ACCEPTED, BookingStatus.CANCELLED_BY_PROVIDER],
  [BookingStatus.ACCEPTED]: [BookingStatus.ON_THE_WAY, BookingStatus.IN_SERVICE, BookingStatus.CANCELLED_BY_PROVIDER],
  [BookingStatus.ON_THE_WAY]: [BookingStatus.IN_SERVICE],
  [BookingStatus.IN_SERVICE]: [BookingStatus.COMPLETED],
};

export function resolveBookingTransition(current: BookingStatus, requested: string): BookingStatus {
  const target = BOOKING_STATUS_IN[requested.toUpperCase()];
  if (!target) throw AppError.badRequest(`Unknown booking status "${requested}".`, 'INVALID_STATUS');
  const allowed = BOOKING_TRANSITIONS[current] ?? [];
  if (!allowed.includes(target)) {
    throw AppError.badRequest(
      `A booking in status ${current} cannot move to ${target}.`,
      'INVALID_TRANSITION',
    );
  }
  return target;
}

export const BOOKING_TRANSITION_LABELS: Record<string, string> = {
  [BookingStatus.ACCEPTED]: 'Booking accepted by the provider',
  [BookingStatus.ON_THE_WAY]: 'Provider on the way',
  [BookingStatus.IN_SERVICE]: 'Service in progress',
  [BookingStatus.COMPLETED]: 'Service completed',
  [BookingStatus.CANCELLED_BY_PROVIDER]: 'Booking declined by the provider',
};

type BookingWithRelations = Prisma.ServiceBookingGetPayload<{
  include: { customer: { select: { fullName: true } }; payment: true; appointment: true };
}>;

export function bookingView(booking: BookingWithRelations) {
  return {
    id: booking.id,
    bookingNumber: booking.code,
    status: booking.status,
    bookingType: booking.vertical,
    estimatedTotal: toMajor(booking.totalMinor),
    finalTotal: toMajor(booking.totalMinor),
    paymentStatus: booking.payment?.status ?? 'PENDING',
    payments: booking.payment
      ? [{ id: booking.payment.id, methodType: booking.payment.methodType, status: booking.payment.status, providerReference: booking.payment.id }]
      : [],
    customerNotes: booking.issueDescription ?? booking.providerNote ?? '',
    serviceAddress: booking.addressName ? { line1: booking.addressName, city: 'Portmore', parish: 'St. Catherine' } : null,
    scheduledStart: booking.appointment?.scheduledAt ?? booking.createdAt,
    createdAt: booking.createdAt,
    customer: { displayName: booking.customer.fullName },
    partnerService: { name: booking.packageName },
    servicePackage: { name: booking.packageName },
  };
}
