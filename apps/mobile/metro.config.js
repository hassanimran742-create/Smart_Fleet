// Metro config for the Smart_Fleet monorepo.
// Without this, Metro only searches apps/mobile/node_modules and never
// finds @smartfleet/shared-* packages hoisted by npm workspaces — which
// surfaces on the phone as "Something went wrong" with the actual
// "Unable to resolve module @smartfleet/shared-types" error sitting in
// the terminal.
//
// Standard Expo monorepo recipe:
// https://docs.expo.dev/guides/monorepos/

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1. Watch the entire monorepo so edits to packages/* trigger reloads.
config.watchFolders = [workspaceRoot];

// 2. Let Metro resolve modules from BOTH the local node_modules and
//    the hoisted workspace-root node_modules.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// 3. Avoid traversing up the disk looking for node_modules — the two
//    paths above are exhaustive in a workspaces setup.
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
