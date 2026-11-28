// R3 T182 (Q-4 (a); the note under T182, (4)): `app.json` stays the configuration, and Expo hands
// it here as `config` (a dynamic configuration extends the static one). The one addition is the
// Firebase file of the push set-up (`expo-notifications`' FCM credentials), never committed
// (`.gitignore`): EAS writes it on the build machine and gives its path in the file variable
// `GOOGLE_SERVICES_JSON` (docs/RUNBOOK.md, «The store build»). Without the variable nothing is
// added, so a local run and a build without the file never name a file that is not there.
module.exports = ({ config }) => {
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
  if (googleServicesFile === undefined || googleServicesFile === '') return config;
  return { ...config, android: { ...config.android, googleServicesFile } };
};
