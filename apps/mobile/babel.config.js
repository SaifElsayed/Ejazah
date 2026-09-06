// Metro's transformer configuration (T006). `babel-preset-expo` is declared as a direct
// devDependency because the workspace is non-hoisted: a package cannot resolve what it did
// not declare (research R-1).
module.exports = function babelConfig(api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
