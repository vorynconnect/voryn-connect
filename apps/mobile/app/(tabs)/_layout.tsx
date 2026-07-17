import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize } from '@/theme/tokens';

const TAB_ICONS: Record<string, { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }> = {
  home: { active: 'home', inactive: 'home-outline' },
  services: { active: 'grid', inactive: 'grid-outline' },
  wallet: { active: 'wallet', inactive: 'wallet-outline' },
  orders: { active: 'clipboard', inactive: 'clipboard-outline' },
  profile: { active: 'person', inactive: 'person-outline' },
};

/**
 * Bottom navigation — exactly Home · Services · Wallet · Orders · Profile,
 * matching the order and visual behavior of the approved mockups.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.blue,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          height: 84,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: fontSize.xs, fontWeight: '500' },
        tabBarIcon: ({ focused, color }) => {
          const icons = TAB_ICONS[route.name] ?? TAB_ICONS.home!;
          return <Ionicons name={focused ? icons.active : icons.inactive} size={24} color={color} />;
        },
        sceneStyle: { backgroundColor: colors.background },
      })}
    >
      <Tabs.Screen name="home" options={{ title: 'Home' }} />
      <Tabs.Screen name="services" options={{ title: 'Services' }} />
      <Tabs.Screen name="wallet" options={{ title: 'Wallet' }} />
      <Tabs.Screen name="orders" options={{ title: 'Orders' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile' }} />
    </Tabs>
  );
}
