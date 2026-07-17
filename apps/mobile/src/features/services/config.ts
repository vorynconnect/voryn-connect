import type { Ionicons } from '@expo/vector-icons';

export type Vertical = 'AUTO_CARE' | 'TECHNICIAN' | 'HOME_SERVICES';

type IconName = keyof typeof Ionicons.glyphMap;

export type VerticalConfig = {
  vertical: Vertical;
  title: string;
  subtitle: string;
  bannerTitle: string;
  bannerBody: string;
  bannerCta: string;
  categories: Array<{ label: string; slug: string; icon: IconName }>;
  resultsNoun: string; // e.g. "providers", "technicians"
  trackingNoun: string; // e.g. "auto care provider"
};

/**
 * Per-vertical content extracted from the approved mockups. The three
 * service verticals share one screen implementation driven by this config.
 */
export const VERTICALS: Record<Vertical, VerticalConfig> = {
  AUTO_CARE: {
    vertical: 'AUTO_CARE',
    title: 'Auto Care',
    subtitle: 'Book trusted third-party vehicle care providers near you.',
    bannerTitle: 'Keep your vehicle road-ready',
    bannerBody: 'Trusted providers, fair prices, convenient booking.',
    bannerCta: 'Explore Auto Care',
    categories: [
      { label: 'Car Wash', slug: 'car-wash', icon: 'car-outline' },
      { label: 'Oil Change', slug: 'oil-change', icon: 'water-outline' },
      { label: 'Tire Service', slug: 'tire-service', icon: 'disc-outline' },
      { label: 'Battery', slug: 'battery', icon: 'battery-charging-outline' },
      { label: 'Detailing', slug: 'detailing', icon: 'sparkles-outline' },
      { label: 'Brake Service', slug: 'brake-service', icon: 'speedometer-outline' },
    ],
    resultsNoun: 'providers',
    trackingNoun: 'auto care provider',
  },
  TECHNICIAN: {
    vertical: 'TECHNICIAN',
    title: 'Technicians',
    subtitle: 'Book trusted third-party technicians for device setup, repairs, and diagnostics near you.',
    bannerTitle: 'Expert help for your tech',
    bannerBody: 'Fast, reliable, and trusted third-party technicians for all your devices.',
    bannerCta: 'Explore technicians',
    categories: [
      { label: 'Phone Repair', slug: 'phone-repair', icon: 'phone-portrait-outline' },
      { label: 'Laptop Repair', slug: 'laptop-repair', icon: 'laptop-outline' },
      { label: 'Appliance Repair', slug: 'tech-appliance-repair', icon: 'cube-outline' },
      { label: 'Smart TV', slug: 'smart-tv', icon: 'tv-outline' },
      { label: 'CCTV & Wi-Fi', slug: 'cctv-wifi', icon: 'wifi-outline' },
      { label: 'Console Repair', slug: 'console-repair', icon: 'game-controller-outline' },
    ],
    resultsNoun: 'technicians',
    trackingNoun: 'technician',
  },
  HOME_SERVICES: {
    vertical: 'HOME_SERVICES',
    title: 'Home Services',
    subtitle: 'Book trusted third-party home service providers near you.',
    bannerTitle: 'Trusted help for your home',
    bannerBody: 'Reliable third-party providers for repairs, maintenance, and setup.',
    bannerCta: 'Explore home services',
    categories: [
      { label: 'Plumber', slug: 'plumber', icon: 'water-outline' },
      { label: 'Electrician', slug: 'electrician', icon: 'flash-outline' },
      { label: 'AC Service', slug: 'ac-service', icon: 'snow-outline' },
      { label: 'Appliance Repair', slug: 'home-appliance-repair', icon: 'cog-outline' },
      { label: 'Handyman', slug: 'handyman', icon: 'construct-outline' },
      { label: 'Painting', slug: 'painting', icon: 'color-palette-outline' },
    ],
    resultsNoun: 'providers',
    trackingNoun: 'home service provider',
  },
};
