// Entry shim. Using a local index.js (rather than the workspace-fragile
// "node_modules/expo/AppEntry.js" path) makes Metro's module resolution
// find the hoisted expo package in any monorepo layout.
import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
