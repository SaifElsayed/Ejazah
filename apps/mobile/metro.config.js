// Bundler configuration (T006). Expo's default Metro config, unmodified. It is stated
// explicitly rather than left implicit because the isolated, symlinked workspace layout
// (research R-1) is the case Metro most often needs to be pointed at.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
