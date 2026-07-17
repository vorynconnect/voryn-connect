import Constants from 'expo-constants';

/**
 * API base URL resolution, in priority order:
 *  1. EXPO_PUBLIC_API_URL — build-time override (e.g. an EAS build profile).
 *  2. The Expo host URI's LAN address — dev: simulators/devices on the same
 *     network reach the local API. Only present when served by Metro.
 *  3. expo.extra.apiUrl — the production URL baked into app.json. This is what
 *     store/standalone builds use (no Metro host to derive from). It sits after
 *     the host-URI check so it never hijacks local development.
 *  4. localhost — last-resort dev default.
 */
function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv;

  const hostUri = Constants.expoConfig?.hostUri;
  const host = hostUri?.split(':')[0];
  if (host) return `http://${host}:4100`;

  const fromExtra = Constants.expoConfig?.extra?.apiUrl as string | undefined;
  if (fromExtra) return fromExtra;

  return 'http://localhost:4100';
}

export const API_URL = resolveApiUrl();
export const WS_URL = API_URL;
