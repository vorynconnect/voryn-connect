/**
 * Voryn Connect design tokens — the single source of truth for the visual
 * system extracted from the approved mockups. Screens must consume these
 * tokens; never hardcode ad-hoc colors or spacing on individual screens.
 */

export const colors = {
  // Brand
  navy: '#16305D', // headings, "VORYN" wordmark
  blue: '#1F7CF6', // primary actions, links, active states
  blueDark: '#1257D8', // gradient start
  cyan: '#31C4F3', // gradient end, "CONNECT" wordmark
  skyTint: '#EAF3FE', // icon chip backgrounds, soft fills

  // Surfaces
  background: '#F5F8FE', // app background (very light blue-grey)
  surface: '#FFFFFF', // cards
  surfaceMuted: '#F7FAFF', // inset cards, input fills

  // Text
  textPrimary: '#16305D',
  textSecondary: '#5A6C8C',
  textMuted: '#93A3BE',
  textOnBrand: '#FFFFFF',

  // Borders
  border: '#E4ECF7',
  borderStrong: '#CBD9EE',

  // Status
  success: '#16A34A',
  successTint: '#E8F7EE',
  warning: '#F59E0B',
  warningTint: '#FEF4E2',
  danger: '#E23A3A',
  dangerTint: '#FDECEC',
  info: '#1F7CF6',
  infoTint: '#EAF3FE',

  // Ratings
  star: '#1F7CF6',
  gold: '#F5B301',
} as const;

/** Primary CTA gradient (left → right), as on Log In / Create Account buttons. */
export const gradients = {
  primary: ['#1257D8', '#31C4F3'] as const,
  walletCard: ['#1E6DE8', '#31A8F3'] as const,
  banner: ['#0F2C66', '#153A80'] as const,
} as const;

export const font = {
  // System font stack matches the mockups' rounded humanist look closely.
  regular: 'System',
  medium: 'System',
  semibold: 'System',
  bold: 'System',
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  base: 15,
  md: 17,
  lg: 20,
  xl: 24,
  '2xl': 28,
  '3xl': 34,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} as const;

/** 4pt spacing scale. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  '2xl': 32,
  '3xl': 40,
  '4xl': 56,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  pill: 999,
} as const;

export const shadow = {
  card: {
    shadowColor: '#16305D',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  raised: {
    shadowColor: '#16305D',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  cta: {
    shadowColor: '#1F7CF6',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
} as const;

export const layout = {
  screenPadding: spacing.lg,
  tabBarHeight: 72,
} as const;
