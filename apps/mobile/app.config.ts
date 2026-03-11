import type { ExpoConfig } from "expo/config";

const googleMapsApiKey =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";

const config: ExpoConfig = {
  name: "DIVA DRIVE",
  slug: "diva-drive",
  scheme: "divadrive",
  version: "0.1.0",
  orientation: "portrait",
  platforms: ["android"],
  assetBundlePatterns: ["**/*"],
  plugins: googleMapsApiKey
    ? [
        [
          "react-native-maps",
          {
            androidGoogleMapsApiKey: googleMapsApiKey
          }
        ]
      ]
    : [],
  android: {
    package: "com.anonymous.divadrive",
    permissions: ["ACCESS_COARSE_LOCATION", "ACCESS_FINE_LOCATION"]
  },
  extra: {
    googleMapsConfigured: Boolean(googleMapsApiKey)
  }
};

export default config;
