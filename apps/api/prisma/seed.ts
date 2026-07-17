/**
 * Voryn Connect development seed — realistic third-party marketplace data for
 * Portmore, Jamaica. Every row created here is DEVELOPMENT DATA, marked with
 * isSeedData: true on providers so it can be removed cleanly:
 *
 *   DELETE FROM "Provider" WHERE "isSeedData" = true;  (cascades)
 *
 * Run with: npm run prisma:seed
 */
import { PrismaClient, ProviderCategory, ServiceVertical, UserRole, VehicleCategory, RideCategory } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

const img = (seed: string, w = 640, h = 420) => `https://picsum.photos/seed/${seed}/${w}/${h}`;
const J = (major: number) => Math.round(major * 100); // JMD major → minor units

// Portmore-area coordinates
const LOC = {
  townCentre: { lat: 17.9583, lng: -76.8822 },
  braeton: { lat: 17.9411, lng: -76.8581 },
  naggoHead: { lat: 17.9639, lng: -76.8703 },
  gregoryPark: { lat: 17.9789, lng: -76.8994 },
  waterford: { lat: 17.9744, lng: -76.8639 },
  hellshire: { lat: 17.8961, lng: -76.9036 },
};

async function main() {
  // Hard stop: this seed creates accounts with publicly-known dev passwords
  // (SeedUser1!, PartnerDev1!) and wipes existing seed rows. It must NEVER run
  // against a production database. Override only for a deliberate demo build.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_SEED !== 'true') {
    throw new Error(
      'Refusing to run the development seed with NODE_ENV=production. ' +
        'It creates accounts with known passwords. Set ALLOW_PROD_SEED=true only if you truly intend a demo seed.',
    );
  }

  console.log('Seeding Voryn Connect development data (Portmore, Jamaica)…');

  // ── Clean previous seed data ─────────────────────────────
  await prisma.provider.deleteMany({ where: { isSeedData: true } });
  await prisma.serviceCategory.deleteMany();
  await prisma.promotion.deleteMany();
  await prisma.promoCode.deleteMany({ where: { code: { in: ['WELCOME10', 'FREEDEL', 'VORYN250'] } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: '@seed.voryn.dev' } } });
  // Partner dashboard dev logins (owner@*.dev) are recreated below.
  await prisma.user.deleteMany({ where: { role: 'PROVIDER_OWNER', email: { endsWith: '.dev' } } });

  // ── Service categories ───────────────────────────────────
  const categoryDefs: Array<{ vertical: ServiceVertical; name: string; slug: string; iconKey: string }> = [
    { vertical: 'AUTO_CARE', name: 'Car Wash', slug: 'car-wash', iconKey: 'car-wash' },
    { vertical: 'AUTO_CARE', name: 'Oil Change', slug: 'oil-change', iconKey: 'oil' },
    { vertical: 'AUTO_CARE', name: 'Tire Service', slug: 'tire-service', iconKey: 'tire' },
    { vertical: 'AUTO_CARE', name: 'Battery', slug: 'battery', iconKey: 'battery' },
    { vertical: 'AUTO_CARE', name: 'Detailing', slug: 'detailing', iconKey: 'spray' },
    { vertical: 'AUTO_CARE', name: 'Brake Service', slug: 'brake-service', iconKey: 'brake' },
    { vertical: 'TECHNICIAN', name: 'Phone Repair', slug: 'phone-repair', iconKey: 'phone' },
    { vertical: 'TECHNICIAN', name: 'Laptop Repair', slug: 'laptop-repair', iconKey: 'laptop' },
    { vertical: 'TECHNICIAN', name: 'Appliance Repair', slug: 'tech-appliance-repair', iconKey: 'appliance' },
    { vertical: 'TECHNICIAN', name: 'Smart TV', slug: 'smart-tv', iconKey: 'tv' },
    { vertical: 'TECHNICIAN', name: 'CCTV & Wi-Fi', slug: 'cctv-wifi', iconKey: 'wifi' },
    { vertical: 'TECHNICIAN', name: 'Console Repair', slug: 'console-repair', iconKey: 'console' },
    { vertical: 'HOME_SERVICES', name: 'Plumber', slug: 'plumber', iconKey: 'faucet' },
    { vertical: 'HOME_SERVICES', name: 'Electrician', slug: 'electrician', iconKey: 'bolt' },
    { vertical: 'HOME_SERVICES', name: 'AC Service', slug: 'ac-service', iconKey: 'ac' },
    { vertical: 'HOME_SERVICES', name: 'Appliance Repair', slug: 'home-appliance-repair', iconKey: 'appliance' },
    { vertical: 'HOME_SERVICES', name: 'Handyman', slug: 'handyman', iconKey: 'tools' },
    { vertical: 'HOME_SERVICES', name: 'Painting', slug: 'painting', iconKey: 'roller' },
  ];
  const categories: Record<string, string> = {};
  for (const [i, def] of categoryDefs.entries()) {
    const cat = await prisma.serviceCategory.create({ data: { ...def, sortOrder: i } });
    categories[def.slug] = cat.id;
  }

  // ── Provider factory ─────────────────────────────────────
  async function provider(input: {
    slug: string;
    name: string;
    categories: ProviderCategory[];
    description: string;
    rating: number;
    ratingCount: number;
    loc: { lat: number; lng: number };
    line1: string;
  }) {
    return prisma.provider.create({
      data: {
        slug: input.slug,
        name: input.name,
        categories: input.categories,
        description: input.description,
        status: 'ACTIVE',
        isVerified: true,
        isSeedData: true,
        // Deterministic dev contact number per provider (876 = Jamaica)
        phone: `+1876555${(1000 + ((input.slug.charCodeAt(0) * 97 + input.slug.length * 13) % 9000)).toString()}`,
        ratingAvg: input.rating,
        ratingCount: input.ratingCount,
        logoUrl: img(`${input.slug}-logo`, 200, 200),
        coverUrl: img(`${input.slug}-cover`, 900, 500),
        branches: {
          create: {
            name: `${input.name} — Portmore`,
            line1: input.line1,
            latitude: input.loc.lat,
            longitude: input.loc.lng,
            isPrimary: true,
            operatingHours: {
              create: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
                dayOfWeek: day,
                opensAt: '08:00',
                closesAt: day === 0 ? '15:00' : '18:00',
                isClosed: false,
              })),
            },
            serviceAreas: {
              create: { name: 'Portmore', centerLat: LOC.townCentre.lat, centerLng: LOC.townCentre.lng, radiusKm: 15 },
            },
          },
        },
      },
    });
  }

  async function seedUser(input: { fullName: string; email: string; role: UserRole }) {
    const passwordHash = await argon2.hash('SeedUser1!');
    return prisma.user.create({
      data: {
        fullName: input.fullName,
        email: input.email,
        passwordHash,
        role: input.role,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
      },
    });
  }

  // ── Restaurants ──────────────────────────────────────────
  const islandBites = await provider({
    slug: 'island-bites',
    name: 'Island Bites',
    categories: ['RESTAURANT'],
    description: 'Bold Caribbean flavours made fresh daily.',
    rating: 4.8,
    ratingCount: 128,
    loc: LOC.townCentre,
    line1: '12 Port Henderson Rd',
  });
  const jerkPitStop = await provider({
    slug: 'jerk-pit-stop',
    name: 'Jerk Pit Stop',
    categories: ['RESTAURANT'],
    description: 'Authentic Jamaican jerk — real jerk, real flavour, real fast.',
    rating: 4.8,
    ratingCount: 312,
    loc: LOC.naggoHead,
    line1: '4 Naggo Head Dr',
  });
  const burgerGrill = await provider({
    slug: 'burger-grill-house',
    name: 'Burger Grill House',
    categories: ['RESTAURANT'],
    description: 'Flame-grilled favourites, fast.',
    rating: 4.7,
    ratingCount: 245,
    loc: LOC.braeton,
    line1: '31 Braeton Pkwy',
  });
  const pizzaCorner = await provider({
    slug: 'pizza-corner',
    name: 'Pizza Corner',
    categories: ['RESTAURANT'],
    description: 'Oven-fresh pizza and Italian classics.',
    rating: 4.6,
    ratingCount: 198,
    loc: LOC.waterford,
    line1: '8 Waterford Blvd',
  });
  const jerkHub = await provider({
    slug: 'jerk-hub-express',
    name: 'Jerk Hub Express',
    categories: ['RESTAURANT'],
    description: 'Real jerk. Real flavour. Real fast.',
    rating: 4.5,
    ratingCount: 72,
    loc: LOC.gregoryPark,
    line1: '22 Gregory Park Rd',
  });

  const restaurantDefs: Array<{
    providerId: string;
    name: string;
    cuisineTags: string[];
    deliveryFee: number;
    promoted?: boolean;
    minutes: [number, number];
    menu: Array<{ category: string; items: Array<{ name: string; desc: string; price: number; options?: Array<{ group: string; name: string; delta: number; isDefault?: boolean }> }> }>;
  }> = [
    {
      providerId: islandBites.id,
      name: 'Island Bites',
      cuisineTags: ['Caribbean', 'BBQ'],
      deliveryFee: 250, // JMD major units
      promoted: true,
      minutes: [20, 30],
      menu: [
        {
          category: 'Popular',
          items: [
            {
              name: 'Jerk Chicken Combo',
              desc: 'Juicy jerk chicken with rice & peas, festival and slaw.',
              price: 1450,
              options: [
                { group: 'Spice level', name: 'Mild', delta: 0 },
                { group: 'Spice level', name: 'Medium', delta: 0, isDefault: true },
                { group: 'Spice level', name: 'Hot', delta: 0 },
              ],
            },
            { name: 'BBQ Chicken Meal', desc: 'Tender BBQ chicken with rice & peas and coleslaw.', price: 1350 },
            { name: 'Oxtail Plate', desc: 'Slow-cooked oxtail in rich gravy with rice & peas and steamed veg.', price: 1950 },
            { name: 'Festival & Fried Plantain', desc: 'Sweet festival served with golden fried plantain.', price: 550 },
            {
              name: 'Tropical Fruit Punch',
              desc: 'Refreshing blend of tropical fruits served chilled.',
              price: 350,
              options: [
                { group: 'Size', name: 'Regular', delta: 0, isDefault: true },
                { group: 'Size', name: 'Large', delta: 50 },
              ],
            },
          ],
        },
        {
          category: 'Meals',
          items: [
            { name: 'Curry Goat Plate', desc: 'Tender curry goat with white rice.', price: 1850 },
            { name: 'Brown Stew Chicken', desc: 'Classic brown stew chicken with rice & peas.', price: 1400 },
          ],
        },
        {
          category: 'Sides',
          items: [
            { name: 'Extra Coleslaw', desc: 'Fresh creamy coleslaw.', price: 120 },
            { name: 'Rice & Peas', desc: 'Coconut rice & peas.', price: 350 },
          ],
        },
        {
          category: 'Drinks',
          items: [
            { name: 'Island Spring Water', desc: '500ml bottled water.', price: 150 },
            { name: 'Ting Grapefruit', desc: 'Sparkling grapefruit soda.', price: 180 },
          ],
        },
        {
          category: 'Desserts',
          items: [{ name: 'Rum Cake Slice', desc: 'Rich Jamaican rum cake.', price: 250 }],
        },
      ],
    },
    {
      providerId: jerkPitStop.id,
      name: 'Jerk Pit Stop',
      cuisineTags: ['Jamaican', 'BBQ'],
      deliveryFee: 0,
      promoted: true,
      minutes: [20, 30],
      menu: [
        {
          category: 'Popular',
          items: [
            { name: 'Jerk Chicken Meal', desc: 'Signature jerk chicken with festival.', price: 1250 },
            { name: 'BBQ Wings', desc: 'Sticky BBQ wings (8 pc).', price: 980 },
            { name: 'Festival (4 Pack)', desc: 'Golden fried festival.', price: 450 },
          ],
        },
      ],
    },
    {
      providerId: burgerGrill.id,
      name: 'Burger Grill House',
      cuisineTags: ['Burgers', 'Fast Food'],
      deliveryFee: 300,
      minutes: [15, 25],
      menu: [
        {
          category: 'Popular',
          items: [
            { name: 'Classic Burger Meal', desc: 'Flame-grilled beef burger with fries and a drink.', price: 1250 },
            { name: 'Double Cheese Burger', desc: 'Two patties, double cheese.', price: 1550 },
          ],
        },
      ],
    },
    {
      providerId: pizzaCorner.id,
      name: 'Pizza Corner',
      cuisineTags: ['Pizza', 'Italian'],
      deliveryFee: 400,
      minutes: [25, 35],
      menu: [
        {
          category: 'Popular',
          items: [
            { name: 'Pepperoni Pizza (Medium)', desc: 'Oven-fresh pepperoni pizza.', price: 2200 },
            { name: 'Margherita Pizza (Medium)', desc: 'Tomato, mozzarella, basil.', price: 1900 },
          ],
        },
      ],
    },
    {
      providerId: jerkHub.id,
      name: 'Jerk Hub Express',
      cuisineTags: ['Jamaican', 'BBQ'],
      deliveryFee: 200,
      minutes: [20, 30],
      menu: [
        {
          category: 'Popular',
          items: [{ name: 'Jerk Pork Plate', desc: 'Smokey jerk pork with rice & peas.', price: 1500 }],
        },
      ],
    },
  ];

  for (const def of restaurantDefs) {
    await prisma.restaurant.create({
      data: {
        providerId: def.providerId,
        name: def.name,
        cuisineTags: def.cuisineTags,
        imageUrl: img(`${def.name.replaceAll(' ', '-').toLowerCase()}-hero`, 900, 540),
        deliveryFeeMinor: J(def.deliveryFee),
        minDeliveryMinutes: def.minutes[0],
        maxDeliveryMinutes: def.minutes[1],
        isPromoted: def.promoted ?? false,
        menus: {
          create: {
            name: 'Main menu',
            categories: {
              create: def.menu.map((cat, i) => ({
                name: cat.category,
                sortOrder: i,
                items: {
                  create: cat.items.map((item) => ({
                    name: item.name,
                    description: item.desc,
                    priceMinor: J(item.price),
                    imageUrl: img(item.name.replaceAll(' ', '-').toLowerCase(), 500, 400),
                    options: item.options
                      ? {
                          create: item.options.map((o) => ({
                            groupName: o.group,
                            name: o.name,
                            priceDeltaMinor: J(o.delta),
                            isDefault: o.isDefault ?? false,
                          })),
                        }
                      : undefined,
                  })),
                },
              })),
            },
          },
        },
      },
    });
  }

  // ── Stores (grocery, pharmacy, convenience) ──────────────
  const storeDefs: Array<{
    slug: string;
    name: string;
    category: ProviderCategory;
    desc: string;
    rating: number;
    count: number;
    fee: number; // JMD
    loc: { lat: number; lng: number };
    products: Array<{ cat: string; items: Array<{ name: string; price: number }> }>;
  }> = [
    {
      slug: 'fresh-basket',
      name: 'Fresh Basket',
      category: 'GROCERY',
      desc: 'Fresh produce and grocery essentials.',
      rating: 4.7,
      count: 96,
      fee: 199,
      loc: LOC.waterford,
      products: [
        {
          cat: 'Produce',
          items: [
            { name: 'Fresh Fruit Basket', price: 2100 },
            { name: 'Bananas (1 lb)', price: 180 },
          ],
        },
        {
          cat: 'Pantry',
          items: [
            { name: 'Rice 2kg', price: 650 },
            { name: 'Red Peas 1lb', price: 420 },
          ],
        },
      ],
    },
    {
      slug: 'quickmart',
      name: 'QuickMart',
      category: 'CONVENIENCE',
      desc: 'Everyday essentials, fast.',
      rating: 4.6,
      count: 84,
      fee: 149,
      loc: LOC.braeton,
      products: [
        {
          cat: 'Essentials',
          items: [
            { name: 'Home Essentials Pack', price: 1180 },
            { name: 'Premium Car Shampoo 1L', price: 650 },
            { name: 'Microfiber Towels (3 Pack)', price: 750 },
            { name: 'Tire Shine 500ml', price: 850 },
          ],
        },
      ],
    },
    {
      slug: 'medexpress',
      name: 'MedExpress',
      category: 'PHARMACY',
      desc: 'Pharmacy and health products delivered.',
      rating: 4.9,
      count: 112,
      fee: 200,
      loc: LOC.townCentre,
      products: [
        {
          cat: 'Health',
          items: [
            { name: 'Paracetamol 500mg (20)', price: 350 },
            { name: 'Vitamin C 1000mg (30)', price: 980 },
          ],
        },
      ],
    },
  ];

  for (const def of storeDefs) {
    const p = await provider({
      slug: def.slug,
      name: def.name,
      categories: [def.category],
      description: def.desc,
      rating: def.rating,
      ratingCount: def.count,
      loc: def.loc,
      line1: 'Portmore Mall',
    });
    const store = await prisma.store.create({
      data: {
        providerId: p.id,
        name: def.name,
        category: def.category,
        imageUrl: img(`${def.slug}-store`, 900, 540),
        deliveryFeeMinor: J(def.fee),
      },
    });
    for (const [i, cat] of def.products.entries()) {
      const productCategory = await prisma.productCategory.create({
        data: { storeId: store.id, name: cat.cat, sortOrder: i },
      });
      for (const item of cat.items) {
        await prisma.product.create({
          data: {
            storeId: store.id,
            categoryId: productCategory.id,
            name: item.name,
            priceMinor: J(item.price),
            imageUrl: img(item.name.replaceAll(' ', '-').toLowerCase(), 500, 400),
            inventory: { create: { quantity: 50, isInStock: true } },
          },
        });
      }
    }
  }

  // ── Service providers ────────────────────────────────────
  type PackageDef = { name: string; desc: string; price: number; included: string[]; popular?: boolean };
  type ListingDef = {
    categorySlug: string;
    title: string;
    desc: string;
    tags: string[];
    duration: number;
    mobile: boolean;
    atShop?: boolean;
    mobileFee?: number;
    emergency?: boolean;
    packages: PackageDef[];
  };

  async function serviceProvider(input: {
    slug: string;
    name: string;
    providerCategories: ProviderCategory[];
    desc: string;
    rating: number;
    count: number;
    loc: { lat: number; lng: number };
    line1: string;
    listings: ListingDef[];
  }) {
    const p = await provider({
      slug: input.slug,
      name: input.name,
      categories: input.providerCategories,
      description: input.desc,
      rating: input.rating,
      ratingCount: input.count,
      loc: input.loc,
      line1: input.line1,
    });
    for (const listing of input.listings) {
      await prisma.serviceListing.create({
        data: {
          providerId: p.id,
          categoryId: categories[listing.categorySlug]!,
          title: listing.title,
          description: listing.desc,
          imageUrl: img(`${input.slug}-${listing.categorySlug}`, 700, 460),
          tags: listing.tags,
          durationMinutes: listing.duration,
          supportsMobile: listing.mobile,
          supportsAtShop: listing.atShop ?? true,
          mobileFeeMinor: J(listing.mobileFee ?? 800),
          isEmergency: listing.emergency ?? false,
          packages: {
            create: listing.packages.map((pkg, i) => ({
              name: pkg.name,
              description: pkg.desc,
              priceMinor: J(pkg.price),
              includedItems: pkg.included,
              isPopular: pkg.popular ?? false,
              sortOrder: i,
            })),
          },
        },
      });
    }
    return p;
  }

  // Auto care
  const autoHub = await serviceProvider({
    slug: 'autohub-ja',
    name: 'AutoHub JA',
    providerCategories: ['AUTO_CARE', 'VEHICLE_RENTAL'],
    desc: 'Quick, reliable vehicle care using quality parts and fluids.',
    rating: 4.7,
    count: 182,
    loc: LOC.naggoHead,
    line1: '12-14 Red Hills Rd',
    listings: [
      {
        categorySlug: 'oil-change',
        title: 'Premium Oil Change',
        desc: 'High-quality oil and filter change to keep your engine running smoothly and efficiently.',
        tags: ['Synthetic Oil', 'Filter Included', 'Conventional Oil'],
        duration: 45,
        mobile: true,
        packages: [
          { name: 'Basic Oil Change', desc: 'Conventional oil & filter', price: 4000, included: ['Up to 5L conventional oil', 'Standard oil filter'] },
          { name: 'Premium Oil Change', desc: 'Synthetic blend oil & premium filter', price: 6000, included: ['Up to 5L synthetic blend oil', 'Premium oil filter', 'Fluid top-up & level check', 'Multi-point inspection', 'Reset maintenance reminder'], popular: true },
          { name: 'Full Synthetic Package', desc: 'Full synthetic oil, premium filter & multi-point check', price: 9000, included: ['Up to 5L full synthetic oil', 'Premium oil filter', 'Multi-point inspection'] },
        ],
      },
      {
        categorySlug: 'tire-service',
        title: 'Tire Service',
        desc: 'Rotation, balancing, puncture repair and replacements.',
        tags: ['Rotation', 'Balancing'],
        duration: 40,
        mobile: true,
        packages: [
          { name: 'Tire Rotation & Balance', desc: 'All four wheels', price: 4000, included: ['Rotation', 'Balancing', 'Pressure check'] },
        ],
      },
      {
        categorySlug: 'car-wash',
        title: 'Full Service Wash',
        desc: 'Exterior wash, interior vacuum and finish.',
        tags: ['Exterior', 'Interior'],
        duration: 40,
        mobile: false,
        packages: [{ name: 'Full Service Wash', desc: 'Wash, vacuum, tire shine', price: 1200, included: ['Exterior wash', 'Interior vacuum', 'Tire shine'] }],
      },
    ],
  });

  await serviceProvider({
    slug: 'sparkle-wash-mobile',
    name: 'Sparkle Wash Mobile',
    providerCategories: ['AUTO_CARE'],
    desc: 'Mobile car wash service — we come to you.',
    rating: 4.8,
    count: 215,
    loc: LOC.gregoryPark,
    line1: 'Mobile — Portmore wide',
    listings: [
      {
        categorySlug: 'car-wash',
        title: 'Mobile Car Wash',
        desc: 'Professional wash at your home or office.',
        tags: ['Top rated', 'Mobile service'],
        duration: 60,
        mobile: true,
        atShop: false,
        packages: [
          { name: 'Exterior Wash', desc: 'Foam wash & dry', price: 1500, included: ['Foam wash', 'Hand dry', 'Tire shine'], popular: true },
          { name: 'Full Detail', desc: 'Interior + exterior detail', price: 6000, included: ['Deep interior clean', 'Wax & polish', 'Engine bay wipe-down'] },
        ],
      },
    ],
  });

  await serviceProvider({
    slug: 'suds-express',
    name: 'Suds Express',
    providerCategories: ['AUTO_CARE'],
    desc: 'Car wash & detailing done right.',
    rating: 4.7,
    count: 139,
    loc: LOC.braeton,
    line1: '5 Braeton Pkwy',
    listings: [
      {
        categorySlug: 'car-wash',
        title: 'Car Wash & Detailing',
        desc: 'Express and premium washes.',
        tags: ['Detailing'],
        duration: 45,
        mobile: false,
        packages: [{ name: 'Express Wash', desc: 'Quick exterior wash', price: 1300, included: ['Exterior wash', 'Dry & shine'] }],
      },
    ],
  });

  await serviceProvider({
    slug: 'cleanride-portmore',
    name: 'CleanRide Portmore',
    providerCategories: ['AUTO_CARE'],
    desc: 'Affordable washes in the heart of Portmore.',
    rating: 4.5,
    count: 97,
    loc: LOC.townCentre,
    line1: 'Portmore Town Centre',
    listings: [
      {
        categorySlug: 'car-wash',
        title: 'Standard Wash',
        desc: 'Reliable exterior washes.',
        tags: [],
        duration: 30,
        mobile: false,
        packages: [{ name: 'Standard Wash', desc: 'Exterior wash', price: 1100, included: ['Exterior wash'] }],
      },
    ],
  });

  await serviceProvider({
    slug: 'kingston-auto-pro',
    name: 'Kingston Auto Pro',
    providerCategories: ['AUTO_CARE'],
    desc: 'High-quality oils and expert care for all vehicle types.',
    rating: 4.6,
    count: 143,
    loc: LOC.hellshire,
    line1: '30 Hellshire Main Rd',
    listings: [
      {
        categorySlug: 'oil-change',
        title: 'Oil Change Service',
        desc: 'Conventional, synthetic and high-mileage oils.',
        tags: ['Conventional Oil', 'Synthetic Oil', 'High Mileage'],
        duration: 45,
        mobile: false,
        packages: [
          { name: 'Conventional Oil Change', desc: 'Quality conventional oil', price: 2800, included: ['Up to 5L conventional oil', 'Oil filter'] },
          { name: 'Synthetic Oil Change', desc: 'Full synthetic', price: 5500, included: ['Up to 5L synthetic oil', 'Premium filter'], popular: true },
        ],
      },
    ],
  });

  const fixItRight = await serviceProvider({
    slug: 'fix-it-right',
    name: 'Fix It Right',
    providerCategories: ['HOME_SERVICES', 'AUTO_CARE'],
    desc: 'We come to you! Home services and mobile vehicle care.',
    rating: 4.8,
    count: 156,
    loc: LOC.waterford,
    line1: '9 Passagefort Dr',
    listings: [
      {
        categorySlug: 'handyman',
        title: 'Deep Home Cleaning',
        desc: 'Thorough home cleaning by vetted professionals.',
        tags: ['Living room', 'Kitchen', 'Bedrooms', 'Bathroom'],
        duration: 180,
        mobile: true,
        atShop: false,
        packages: [
          { name: 'Deep Home Cleaning', desc: 'Living room, kitchen, 2 bedrooms, 1 bathroom', price: 2500, included: ['Living room', 'Kitchen', '2 Bedrooms', '1 Bathroom'], popular: true },
        ],
      },
      {
        categorySlug: 'battery',
        title: 'Battery Check & Replacement',
        desc: 'Mobile battery testing and replacement.',
        tags: ['Mobile service'],
        duration: 30,
        mobile: true,
        packages: [{ name: 'Battery Check', desc: 'Test & report', price: 2000, included: ['Load test', 'Terminal cleaning'] }],
      },
      {
        categorySlug: 'oil-change',
        title: 'Mobile Oil Change',
        desc: 'We come to you! Mobile oil change at your home or office.',
        tags: ['Mobile Oil Change', 'Synthetic Oil', 'Filter Replacement'],
        duration: 50,
        mobile: true,
        atShop: false,
        packages: [{ name: 'Mobile Oil Change', desc: 'At your location', price: 3000, included: ['Up to 5L oil', 'Filter', 'Disposal'] }],
      },
    ],
  });

  // Technicians
  const techFix = await serviceProvider({
    slug: 'techfix-ja',
    name: 'TechFix JA',
    providerCategories: ['TECHNICIAN'],
    desc: 'Expert laptop and phone repairs with quality parts and fast turnaround. We come to you.',
    rating: 4.8,
    count: 146,
    loc: LOC.braeton,
    line1: '2 Braeton Pkwy',
    listings: [
      {
        categorySlug: 'laptop-repair',
        title: 'Laptop Repair',
        desc: 'High-quality laptop diagnostics and repair to keep your device performing smoothly.',
        tags: ['Diagnostics', 'Data Safe', 'Screen Repair', 'Battery'],
        duration: 90,
        mobile: true,
        mobileFee: 600,
        packages: [
          { name: 'Basic Diagnostic', desc: 'Issue assessment & troubleshooting', price: 2500, included: ['Professional diagnosis', 'Written report'] },
          { name: 'Screen Repair', desc: 'Screen replacement & calibration', price: 8500, included: ['Professional diagnosis', 'Quality parts & materials', 'Skilled technician service', 'Warranty on parts & labor', 'Post-repair performance test'], popular: true },
          { name: 'Advanced Hardware Repair', desc: 'Board, port, or internal component repair', price: 12000, included: ['Component-level repair', 'Warranty on parts & labor'] },
        ],
      },
      {
        categorySlug: 'phone-repair',
        title: 'Screen Replacement',
        desc: 'Phone screen replacement with quality parts.',
        tags: ['Screen Repair', 'Battery', 'Diagnostics'],
        duration: 60,
        mobile: true,
        mobileFee: 600,
        packages: [{ name: 'Phone Screen Replacement', desc: 'Parts & labor', price: 3500, included: ['Quality screen', '90-day warranty'], popular: true }],
      },
    ],
  });

  await serviceProvider({
    slug: 'gadgetcare-pro',
    name: 'GadgetCare Pro',
    providerCategories: ['TECHNICIAN'],
    desc: 'Reliable laptop diagnostics and repairs by certified technicians. Affordable and transparent.',
    rating: 4.7,
    count: 96,
    loc: LOC.naggoHead,
    line1: '18 Naggo Head Dr',
    listings: [
      {
        categorySlug: 'laptop-repair',
        title: 'Laptop Repair',
        desc: 'Certified laptop repairs.',
        tags: ['Diagnostics', 'Software Repair', 'Battery'],
        duration: 90,
        mobile: false,
        packages: [{ name: 'Laptop Diagnostic & Repair', desc: 'From', price: 2800, included: ['Diagnosis', 'Repair quote'], popular: true }],
      },
      {
        categorySlug: 'console-repair',
        title: 'Console Repair',
        desc: 'Game console diagnostics and repair.',
        tags: ['HDMI', 'Overheating'],
        duration: 90,
        mobile: false,
        packages: [{ name: 'Console Diagnostic', desc: 'All consoles', price: 3000, included: ['Diagnosis', 'Cleaning'] }],
      },
    ],
  });

  await serviceProvider({
    slug: 'device-doctors',
    name: 'Device Doctors',
    providerCategories: ['TECHNICIAN'],
    desc: 'Your laptop, our priority. Professional repairs with a satisfaction guarantee.',
    rating: 4.6,
    count: 87,
    loc: LOC.townCentre,
    line1: 'Portmore Town Centre',
    listings: [
      {
        categorySlug: 'laptop-repair',
        title: 'Laptop Repair',
        desc: 'Professional repairs with satisfaction guarantee.',
        tags: ['Screen Repair', 'Diagnostics', 'Software Repair'],
        duration: 100,
        mobile: false,
        packages: [{ name: 'Laptop Repair', desc: 'From', price: 3000, included: ['Diagnosis', 'Repair'] }],
      },
      {
        categorySlug: 'tech-appliance-repair',
        title: 'Appliance Diagnostic',
        desc: 'Small appliance diagnostics.',
        tags: ['Diagnostics'],
        duration: 60,
        mobile: true,
        packages: [{ name: 'Appliance Diagnostic', desc: 'In-shop', price: 3000, included: ['Diagnosis'] }],
      },
    ],
  });

  await serviceProvider({
    slug: 'kingston-tech-lab',
    name: 'Kingston Tech Lab',
    providerCategories: ['TECHNICIAN'],
    desc: 'Advanced laptop repairs and upgrades. Honest advice, quality results.',
    rating: 4.5,
    count: 74,
    loc: LOC.hellshire,
    line1: '44 Hellshire Main Rd',
    listings: [
      {
        categorySlug: 'laptop-repair',
        title: 'Laptop Repairs & Upgrades',
        desc: 'Upgrades, batteries and diagnostics.',
        tags: ['Battery', 'Diagnostics', 'Software Repair'],
        duration: 120,
        mobile: false,
        packages: [{ name: 'Laptop Upgrade', desc: 'RAM/SSD installs', price: 2700, included: ['Installation', 'Data migration'] }],
      },
    ],
  });

  await serviceProvider({
    slug: 'smarthome-tech',
    name: 'SmartHome Tech',
    providerCategories: ['TECHNICIAN'],
    desc: 'Router setup, Wi-Fi optimization and CCTV installs.',
    rating: 4.6,
    count: 68,
    loc: LOC.gregoryPark,
    line1: '3 Gregory Park Rd',
    listings: [
      {
        categorySlug: 'cctv-wifi',
        title: 'Router Setup',
        desc: 'Wi-Fi setup and optimization for your home.',
        tags: ['Wi-Fi Setup', 'CCTV Setup'],
        duration: 60,
        mobile: true,
        atShop: false,
        packages: [{ name: 'Router Setup', desc: 'Install & optimize', price: 2000, included: ['Router install', 'Coverage check'], popular: true }],
      },
      {
        categorySlug: 'smart-tv',
        title: 'Smart TV Setup',
        desc: 'Mounting and configuration.',
        tags: ['Mounting'],
        duration: 60,
        mobile: true,
        atShop: false,
        packages: [{ name: 'TV Mount & Setup', desc: 'Wall mount + config', price: 4500, included: ['Wall mount', 'App setup'] }],
      },
    ],
  });

  // Home services
  const quickFixPlumbing = await serviceProvider({
    slug: 'quickfix-plumbing',
    name: 'QuickFix Plumbing',
    providerCategories: ['HOME_SERVICES'],
    desc: 'Fast, reliable plumbing solutions for homes and businesses.',
    rating: 4.8,
    count: 128,
    loc: LOC.townCentre,
    line1: '2 Braeton Pkwy',
    listings: [
      {
        categorySlug: 'plumber',
        title: 'Pipe Leak Repair',
        desc: 'Fast response leak repair and pipe replacement for kitchens, bathrooms, and outdoor lines.',
        tags: ['Pipe Leak Repair', 'Drain Unclogging', 'Faucet Installation'],
        duration: 60,
        mobile: true,
        atShop: false,
        emergency: true,
        packages: [
          { name: 'Basic Leak Inspection', desc: 'Inspect, diagnose, and provide repair recommendations.', price: 3500, included: ['On-site diagnosis and leak detection'] },
          { name: 'Standard Pipe Repair', desc: 'Fix minor leaks and replace damaged fittings or sections.', price: 6000, included: ['On-site diagnosis and leak detection', 'Leak sealing or fitting replacement', 'Cleanup of work area', 'Pressure testing to ensure no leaks', '30-day workmanship warranty'], popular: true },
          { name: 'Major Leak Replacement', desc: 'Replace leaking pipes or sections with new piping.', price: 9500, included: ['Pipe replacement', 'Pressure testing', '90-day warranty'] },
        ],
      },
    ],
  });

  await serviceProvider({
    slug: 'island-pipe-pros',
    name: 'Island Pipe Pros',
    providerCategories: ['HOME_SERVICES'],
    desc: 'Quality plumbing you can count on. Local experts.',
    rating: 4.7,
    count: 96,
    loc: LOC.braeton,
    line1: '14 Braeton Pkwy',
    listings: [
      {
        categorySlug: 'plumber',
        title: 'Plumbing Services',
        desc: 'Leak repair, drain unclogging, water tanks.',
        tags: ['Pipe Leak Repair', 'Drain Unclogging', 'Water Tank Repair'],
        duration: 60,
        mobile: true,
        atShop: false,
        packages: [{ name: 'Plumbing Call-out', desc: 'From', price: 3800, included: ['Diagnosis', 'Minor repair'] }],
      },
    ],
  });

  await serviceProvider({
    slug: 'home-rescue-ja',
    name: 'Home Rescue JA',
    providerCategories: ['HOME_SERVICES'],
    desc: 'We fix it right the first time.',
    rating: 4.6,
    count: 84,
    loc: LOC.waterford,
    line1: '21 Waterford Blvd',
    listings: [
      {
        categorySlug: 'plumber',
        title: 'Plumbing & Drains',
        desc: 'Drains, faucets and tanks.',
        tags: ['Drain Unclogging', 'Faucet Installation', 'Water Tank Repair'],
        duration: 75,
        mobile: true,
        atShop: false,
        packages: [{ name: 'Drain Unclogging', desc: 'From', price: 4000, included: ['Unclogging', 'Flow test'] }],
      },
      {
        categorySlug: 'handyman',
        title: 'Handyman Service',
        desc: 'Odd jobs and repairs.',
        tags: ['Repairs'],
        duration: 120,
        mobile: true,
        atShop: false,
        packages: [{ name: 'Handyman (2 hrs)', desc: 'General repairs', price: 5000, included: ['2 hours labour'] }],
      },
    ],
  });

  await serviceProvider({
    slug: 'blue-tap-services',
    name: 'Blue Tap Services',
    providerCategories: ['HOME_SERVICES'],
    desc: 'Modern plumbing solutions with a personal touch.',
    rating: 4.5,
    count: 72,
    loc: LOC.gregoryPark,
    line1: '7 Gregory Park Rd',
    listings: [
      {
        categorySlug: 'plumber',
        title: 'Plumbing Services',
        desc: 'Leaks, drains and installations.',
        tags: ['Pipe Leak Repair', 'Drain Unclogging', 'Faucet Installation'],
        duration: 60,
        mobile: true,
        atShop: false,
        packages: [{ name: 'Plumbing Visit', desc: 'From', price: 3500, included: ['Diagnosis'] }],
      },
    ],
  });

  await serviceProvider({
    slug: 'bright-spark-ja',
    name: 'Bright Spark JA',
    providerCategories: ['HOME_SERVICES'],
    desc: 'Licensed electrical services — safe and up to code.',
    rating: 4.7,
    count: 103,
    loc: LOC.naggoHead,
    line1: '11 Naggo Head Dr',
    listings: [
      {
        categorySlug: 'electrician',
        title: 'Electrical Services',
        desc: 'Outlets, panels, lighting and wiring.',
        tags: ['Electrical', 'Installations'],
        duration: 75,
        mobile: true,
        atShop: false,
        emergency: true,
        packages: [
          { name: 'Outlet Installation', desc: 'Per outlet', price: 4000, included: ['Outlet & wiring', 'Safety test'], popular: true },
          { name: 'Electrical Inspection', desc: 'Whole home', price: 6500, included: ['Panel check', 'Report'] },
        ],
      },
    ],
  });

  await serviceProvider({
    slug: 'cool-breeze-tech',
    name: 'Cool Breeze Tech',
    providerCategories: ['HOME_SERVICES'],
    desc: 'Air conditioning installs, cleaning and maintenance.',
    rating: 4.6,
    count: 91,
    loc: LOC.hellshire,
    line1: '2 Hellshire Main Rd',
    listings: [
      {
        categorySlug: 'ac-service',
        title: 'AC Cleaning',
        desc: 'Deep clean and maintenance for split units.',
        tags: ['AC Service', 'Maintenance'],
        duration: 90,
        mobile: true,
        atShop: false,
        packages: [
          { name: 'AC Cleaning', desc: 'Per unit', price: 5500, included: ['Coil cleaning', 'Filter wash', 'Gas pressure check'], popular: true },
        ],
      },
    ],
  });

  await serviceProvider({
    slug: 'homecare-pros',
    name: 'HomeCare Pros',
    providerCategories: ['HOME_SERVICES'],
    desc: 'Appliance repair experts for washers, dryers, and fridges.',
    rating: 4.7,
    count: 88,
    loc: LOC.townCentre,
    line1: 'Portmore Town Centre',
    listings: [
      {
        categorySlug: 'home-appliance-repair',
        title: 'Washing Machine Repair',
        desc: 'Diagnosis and repair for all major brands.',
        tags: ['Appliance', 'Repairs'],
        duration: 90,
        mobile: true,
        atShop: false,
        packages: [{ name: 'Washer Diagnostic & Repair', desc: 'From', price: 4800, included: ['Diagnosis', 'Minor parts'], popular: true }],
      },
    ],
  });

  // ── Rental companies & vehicles ──────────────────────────
  const islandRides = await provider({
    slug: 'island-rides',
    name: 'Island Rides',
    categories: ['RIDES', 'VEHICLE_RENTAL', 'AUTO_CARE'],
    description: 'Trusted rides and rentals across Portmore.',
    rating: 4.8,
    ratingCount: 156,
    loc: LOC.townCentre,
    line1: 'Portmore Mall',
  });

  const rentalCompanies: Array<{ slug: string; name: string; rating: number; count: number; loc: { lat: number; lng: number } }> = [
    { slug: 'prestige-drive', name: 'Prestige Drive', rating: 4.7, count: 89, loc: LOC.braeton },
    { slug: 'kingston-executive-rentals', name: 'Kingston Executive Rentals', rating: 4.8, count: 132, loc: LOC.naggoHead },
    { slug: 'blueline-mobility', name: 'BlueLine Mobility', rating: 4.7, count: 77, loc: LOC.waterford },
    { slug: 'luxury-lane', name: 'Luxury Lane', rating: 4.9, count: 64, loc: LOC.gregoryPark },
  ];
  const rentalProviderIds: Record<string, string> = { 'island-rides': islandRides.id, 'autohub-ja': autoHub.id };
  for (const rc of rentalCompanies) {
    const p = await provider({
      slug: rc.slug,
      name: rc.name,
      categories: ['VEHICLE_RENTAL'],
      description: 'Third-party rental provider — verified partner.',
      rating: rc.rating,
      ratingCount: rc.count,
      loc: rc.loc,
      line1: 'Portmore',
    });
    rentalProviderIds[rc.slug] = p.id;
  }

  const vehicles: Array<{
    providerSlug: string;
    make: string;
    model: string;
    category: VehicleCategory;
    seats: number;
    bags: number;
    transmission: string;
    fuel: string;
    rate: number; // JMD/day
    deposit: number;
    plate: string;
    color: string;
    loc: { lat: number; lng: number };
  }> = [
    { providerSlug: 'island-rides', make: 'Toyota', model: 'Axio', category: 'ECONOMY', seats: 5, bags: 2, transmission: 'A/T', fuel: 'Petrol', rate: 6500, deposit: 5000, plate: '1234 JQ', color: 'White', loc: LOC.townCentre },
    { providerSlug: 'island-rides', make: 'Toyota', model: 'Hiace', category: 'VAN', seats: 15, bags: 6, transmission: 'M/T', fuel: 'Diesel', rate: 12500, deposit: 10000, plate: '4821 JH', color: 'White', loc: LOC.braeton },
    { providerSlug: 'island-rides', make: 'BMW', model: '3 Series', category: 'LUXURY', seats: 5, bags: 2, transmission: 'A/T', fuel: 'Petrol', rate: 7200, deposit: 15000, plate: '7301 JB', color: 'White', loc: LOC.townCentre },
    { providerSlug: 'island-rides', make: 'BMW', model: '4 Series', category: 'LUXURY', seats: 4, bags: 2, transmission: 'A/T', fuel: 'Petrol', rate: 8900, deposit: 15000, plate: '5512 JB', color: 'White', loc: LOC.naggoHead },
    { providerSlug: 'autohub-ja', make: 'Honda', model: 'CR-V', category: 'SUV', seats: 5, bags: 3, transmission: 'A/T', fuel: 'Petrol', rate: 9800, deposit: 8000, plate: '9034 JC', color: 'Silver', loc: LOC.naggoHead },
    { providerSlug: 'autohub-ja', make: 'BMW', model: '5 Series', category: 'LUXURY', seats: 5, bags: 2, transmission: 'A/T', fuel: 'Petrol', rate: 9800, deposit: 18000, plate: '2210 JB', color: 'Black', loc: LOC.braeton },
    { providerSlug: 'autohub-ja', make: 'BMW', model: 'X6', category: 'LUXURY', seats: 5, bags: 3, transmission: 'A/T', fuel: 'Diesel', rate: 15000, deposit: 25000, plate: '8845 JB', color: 'Blue', loc: LOC.waterford },
    { providerSlug: 'blueline-mobility', make: 'Nissan', model: 'Note', category: 'ECONOMY', seats: 5, bags: 2, transmission: 'A/T', fuel: 'Petrol', rate: 5900, deposit: 4000, plate: '3310 JN', color: 'Blue', loc: LOC.gregoryPark },
    { providerSlug: 'prestige-drive', make: 'BMW', model: 'X1', category: 'SUV', seats: 5, bags: 2, transmission: 'A/T', fuel: 'Petrol', rate: 8000, deposit: 12000, plate: '6621 JP', color: 'White', loc: LOC.braeton },
    { providerSlug: 'kingston-executive-rentals', make: 'BMW', model: 'X3', category: 'SUV', seats: 5, bags: 3, transmission: 'A/T', fuel: 'Diesel', rate: 11500, deposit: 20000, plate: '1108 JK', color: 'Grey', loc: LOC.naggoHead },
    { providerSlug: 'blueline-mobility', make: 'BMW', model: 'X5', category: 'SUV', seats: 7, bags: 3, transmission: 'A/T', fuel: 'Diesel', rate: 13500, deposit: 22000, plate: '4419 JL', color: 'Black', loc: LOC.waterford },
    { providerSlug: 'luxury-lane', make: 'BMW', model: '7 Series', category: 'PREMIUM', seats: 5, bags: 3, transmission: 'A/T', fuel: 'Petrol', rate: 18500, deposit: 30000, plate: '9902 JL', color: 'Grey', loc: LOC.gregoryPark },
  ];

  const providerBySlug: Record<string, string> = {
    ...rentalProviderIds,
  };
  for (const v of vehicles) {
    const providerId = providerBySlug[v.providerSlug];
    if (!providerId) continue;
    await prisma.rentalVehicle.create({
      data: {
        providerId,
        make: v.make,
        model: v.model,
        year: 2021,
        color: v.color,
        plateNo: v.plate,
        category: v.category,
        seats: v.seats,
        bags: v.bags,
        transmission: v.transmission,
        fuelType: v.fuel,
        features: ['Air conditioning', 'Bluetooth', 'Backup camera', 'Unlimited support'],
        fuelPercent: 70 + ((v.plate.charCodeAt(0) + v.plate.charCodeAt(1)) % 29), // 70–98%, stable per vehicle
        odometerKm: 9000 + ((v.plate.charCodeAt(0) * 137 + v.plate.charCodeAt(2) * 61) % 42000),
        dailyRateMinor: J(v.rate),
        depositMinor: J(v.deposit),
        imageUrl: img(`${v.make}-${v.model}`.toLowerCase().replaceAll(' ', '-'), 800, 500),
        pickupBranchName: 'Portmore Mall • Bay B',
        latitude: v.loc.lat,
        longitude: v.loc.lng,
        ratingAvg: 4.6 + Math.random() * 0.3,
        ratingCount: 40 + Math.floor(Math.random() * 100),
      },
    });
  }

  // ── Drivers, couriers, technicians ───────────────────────
  const driverDefs: Array<{ name: string; email: string; category: RideCategory; make: string; model: string; color: string; plate: string; rating: number; trips: number }> = [
    { name: 'Kemar S.', email: 'kemar@seed.voryn.dev', category: 'ECONOMY', make: 'Toyota', model: 'Axio', color: 'Silver', plate: '8392 JN', rating: 4.9, trips: 2340 },
    { name: 'Andre M.', email: 'andre.m@seed.voryn.dev', category: 'COMFORT', make: 'Toyota', model: 'Corolla', color: 'White', plate: '1234 JM', rating: 4.8, trips: 1870 },
    { name: 'Shanice B.', email: 'shanice@seed.voryn.dev', category: 'XL', make: 'Toyota', model: 'Noah', color: 'Grey', plate: '5522 JX', rating: 4.7, trips: 990 },
    { name: 'Rohan T.', email: 'rohan@seed.voryn.dev', category: 'MOTO', make: 'Yamaha', model: 'Jog', color: 'Blue', plate: '221 MJ', rating: 4.8, trips: 3105 },
  ];
  for (const d of driverDefs) {
    const user = await seedUser({ fullName: d.name, email: d.email, role: 'DRIVER' });
    await prisma.driverProfile.create({
      data: {
        userId: user.id,
        providerId: islandRides.id,
        vehicleMake: d.make,
        vehicleModel: d.model,
        vehicleColor: d.color,
        plateNo: d.plate,
        rideCategory: d.category,
        ratingAvg: d.rating,
        ratingCount: Math.floor(d.trips / 3),
        tripsCount: d.trips,
        isOnline: true,
      },
    });
  }

  const courierDefs = [
    { name: 'Dwayne M.', email: 'dwayne@seed.voryn.dev', vehicleDesc: 'Yamaha Jog • Blue' },
    { name: 'Mark Anthony', email: 'mark@seed.voryn.dev', vehicleDesc: 'Yamaha Jog • Blue' },
  ];
  for (const c of courierDefs) {
    const user = await seedUser({ fullName: c.name, email: c.email, role: 'COURIER' });
    await prisma.courierProfile.create({
      data: { userId: user.id, vehicleType: 'moto', vehicleDesc: c.vehicleDesc, ratingAvg: 4.8, ratingCount: 220, isOnline: true },
    });
  }

  const technicianDefs = [
    { name: 'Andre Williams', email: 'andre.w@seed.voryn.dev', providerId: autoHub.id, skills: ['Tire Service', 'Oil Change'], jobs: 12 },
    { name: 'Jason Brown', email: 'jason@seed.voryn.dev', providerId: techFix.id, skills: ['Laptop Repair', 'Screen Repair'], jobs: 80 },
    { name: 'Ricardo Allen', email: 'ricardo@seed.voryn.dev', providerId: quickFixPlumbing.id, skills: ['Pipe Leak Repair', 'Drain Unclogging'], jobs: 126 },
    { name: 'Andre P.', email: 'andre.p@seed.voryn.dev', providerId: fixItRight.id, skills: ['Deep Cleaning'], jobs: 128 },
  ];
  for (const t of technicianDefs) {
    const user = await seedUser({ fullName: t.name, email: t.email, role: 'TECHNICIAN' });
    await prisma.technicianProfile.create({
      data: {
        userId: user.id,
        providerId: t.providerId,
        skills: t.skills,
        jobsCompleted: t.jobs,
        ratingAvg: 4.8,
        ratingCount: t.jobs,
        isOnline: true,
      },
    });
  }

  // ── Promotions & promo codes ─────────────────────────────
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 24 * 3600 * 1000);
  await prisma.promotion.create({
    data: {
      title: 'Deals near you',
      subtitle: 'Save on food, rides, auto care, home services & more.',
      imageUrl: img('deals-banner', 900, 420),
      type: 'PERCENT_OFF',
      value: 25,
      startsAt: now,
      endsAt: in30,
    },
  });
  await prisma.promotion.create({
    data: {
      title: 'Get it fast with Voryn Connect',
      subtitle: 'Save more with Voryn Wallet on every order.',
      imageUrl: img('delivery-banner', 900, 420),
      type: 'AMOUNT_OFF',
      value: J(200),
      startsAt: now,
      endsAt: in30,
    },
  });
  await prisma.promoCode.createMany({
    data: [
      { code: 'WELCOME10', type: 'PERCENT_OFF', value: 10, minSpendMinor: J(1000), perUserLimit: 1, isActive: true },
      { code: 'FREEDEL', type: 'FREE_DELIVERY', value: 0, minSpendMinor: J(1500), perUserLimit: 3, isActive: true },
      { code: 'VORYN250', type: 'AMOUNT_OFF', value: J(250), minSpendMinor: J(2000), perUserLimit: 1, isActive: true },
    ],
  });

  // ── Partner dashboard owner logins (DEV ONLY) ────────────
  // Each can sign into the provider dashboard and manage their business.
  // Password for all: PartnerDev1!  (documented in docs/DEV_CREDENTIALS.md)
  const partnerOwners: Array<{ slug: string; email: string; fullName: string }> = [
    { slug: 'island-bites', email: 'owner@islandbites.dev', fullName: 'Island Bites Owner' },
    { slug: 'island-rides', email: 'owner@islandrides.dev', fullName: 'Island Rides Owner' },
    { slug: 'autohub-ja', email: 'owner@autohub.dev', fullName: 'AutoHub JA Owner' },
    { slug: 'techfix-ja', email: 'owner@techfix.dev', fullName: 'TechFix JA Owner' },
    { slug: 'quickfix-plumbing', email: 'owner@quickfix.dev', fullName: 'QuickFix Plumbing Owner' },
    { slug: 'fresh-basket', email: 'owner@freshbasket.dev', fullName: 'Fresh Basket Owner' },
  ];
  const partnerHash = await argon2.hash('PartnerDev1!');
  for (const owner of partnerOwners) {
    const providerRow = await prisma.provider.findUnique({ where: { slug: owner.slug } });
    if (!providerRow) continue;
    await prisma.user.create({
      data: {
        fullName: owner.fullName,
        email: owner.email,
        passwordHash: partnerHash,
        role: 'PROVIDER_OWNER',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        providerStaff: { create: { providerId: providerRow.id, role: 'OWNER' } },
      },
    });
  }
  console.log(`Partner dashboard owners: ${partnerOwners.map((o) => o.email).join(', ')} (password PartnerDev1!)`);

  const providersCount = await prisma.provider.count({ where: { isSeedData: true } });
  const listingsCount = await prisma.serviceListing.count();
  const vehiclesCount = await prisma.rentalVehicle.count();
  const menuItemsCount = await prisma.menuItem.count();
  console.log(
    `Seed complete: ${providersCount} providers, ${listingsCount} service listings, ${vehiclesCount} rental vehicles, ${menuItemsCount} menu items.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
