import { create } from 'zustand';
import { api, tokenStore } from '@/lib/api';

export type SessionUser = {
  id: string;
  email: string | null;
  phone: string | null;
  fullName: string;
  role: string;
  status: string;
  emailVerified: boolean;
  phoneVerified: boolean;
};

export type CustomerProfile = {
  id: string;
  username: string | null;
  dateOfBirth: string | null;
  avatarUrl: string | null;
  primaryUse: string | null;
  memberTier: string;
} | null;

type AuthState = {
  status: 'restoring' | 'signedOut' | 'signedIn';
  user: SessionUser | null;
  profile: CustomerProfile;
  /** Restore the session on app launch from SecureStore tokens. */
  restore: () => Promise<void>;
  /** Store tokens + user after login / OTP verification. */
  setSession: (data: { accessToken: string; refreshToken: string; user: SessionUser }) => Promise<void>;
  refreshMe: () => Promise<void>;
  signOut: () => Promise<void>;
};

export const useAuth = create<AuthState>((set, get) => ({
  status: 'restoring',
  user: null,
  profile: null,

  restore: async () => {
    try {
      const token = await tokenStore.getRefresh();
      if (!token) {
        set({ status: 'signedOut', user: null, profile: null });
        return;
      }
      const me = await api<{ user: SessionUser; profile: CustomerProfile }>('/v1/users/me');
      set({ status: 'signedIn', user: me.user, profile: me.profile });
    } catch {
      set({ status: 'signedOut', user: null, profile: null });
    }
  },

  setSession: async ({ accessToken, refreshToken, user }) => {
    await tokenStore.set(accessToken, refreshToken);
    set({ status: 'signedIn', user });
    // Profile is fetched lazily; failures here shouldn't block sign-in.
    get()
      .refreshMe()
      .catch(() => undefined);
  },

  refreshMe: async () => {
    const me = await api<{ user: SessionUser; profile: CustomerProfile }>('/v1/users/me');
    set({ user: me.user, profile: me.profile });
  },

  signOut: async () => {
    try {
      await api('/v1/auth/logout', { method: 'POST' });
    } catch {
      // Server-side revocation failing shouldn't trap the user in the app.
    }
    await tokenStore.clear();
    set({ status: 'signedOut', user: null, profile: null });
  },
}));
