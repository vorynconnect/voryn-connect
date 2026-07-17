// Web-only stub for expo-secure-store (unsupported on web). Backs the token
// store with localStorage so auth/session works in the browser review build.
// Native builds use the real module (see metro.config.js resolver alias).
function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

Object.defineProperty(exports, '__esModule', { value: true });
exports.getItemAsync = async (key) => safe(() => window.localStorage.getItem(key), null);
exports.setItemAsync = async (key, value) => {
  safe(() => window.localStorage.setItem(key, value));
};
exports.deleteItemAsync = async (key) => {
  safe(() => window.localStorage.removeItem(key));
};
exports.isAvailableAsync = async () => true;
