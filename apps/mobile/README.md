# Smart_Fleet Mobile

Expo React Native app. Single codebase, two app config profiles via `APP_VARIANT`:

```bash
APP_VARIANT=distributor npm run start   # distributor app (default)
APP_VARIANT=driver      npm run start   # driver app
```

Each variant has a distinct bundle id / permission set so the App Store / Play Store sees them as separate apps. `app.config.ts` selects entitlements, plugins, and the iOS background-location permission only when building the driver variant.

## Required dev env
- Node 20+
- Expo CLI (`npm i -g expo`)
- iOS simulator (macOS) or Android emulator/device
- API running locally on `http://localhost:3000` (proxy via `EXPO_PUBLIC_API_BASE_URL` for device testing)

## Asset placeholders
Drop `icon.png` and `splash.png` (1024×1024) into `assets/`. Not committed.
