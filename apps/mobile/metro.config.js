// Monorepo-aware Metro config: watch the workspace root and resolve
// dependencies from both the app and root node_modules.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Preserve Expo's default watch folders and add the workspace root so Metro
// picks up hoisted deps in the monorepo.
config.watchFolders = [...(config.watchFolders ?? []), workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Web-only aliases: these native modules have no web implementation, so on the
// web target they resolve to local stubs (see web-shims/). Native builds are
// unaffected — the real modules resolve normally for ios/android.
const WEB_ALIASES = {
  'react-native-maps': path.resolve(projectRoot, 'web-shims/react-native-maps.web.js'),
  'expo-secure-store': path.resolve(projectRoot, 'web-shims/expo-secure-store.web.js'),
};

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && WEB_ALIASES[moduleName]) {
    return { type: 'sourceFile', filePath: WEB_ALIASES[moduleName] };
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
