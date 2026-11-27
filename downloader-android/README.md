# Torrentio Downloader for Android

An independent Android companion app for downloading user-authorized BitTorrent content from magnet links.

## Current status

**Development scaffold — not a release APK yet.**

The initial Android app and foreground download service are in place. The native engine is [libtorrent4j](https://github.com/aldenml/libtorrent4j), which provides magnet support, DHT, peer connections, file storage, and download status APIs. The first target is Android 9+ (API 28+) because the current libtorrent4j Android binaries require that baseline.

## Build

Open this directory in Android Studio with JDK 17 and Android SDK 36 installed, then run:

```sh
gradle :app:assembleDebug
```

The debug APK will be written to `app/build/outputs/apk/debug/app-debug.apk`.

## First milestone

- [x] Android application structure and Arabic-first starter screen
- [x] Foreground service to keep a user-started transfer active
- [x] Native libtorrent4j dependency for Android ABIs
- [x] Magnet validation and engine handoff
- [x] Basic notification progress polling
- [ ] Build verification on CI and physical Android device
- [ ] Persistent resume data and pause/resume controls
- [ ] Public Downloads export using Android's Storage Access Framework
- [ ] Multi-torrent queue, per-file selection, and settings
- [ ] Verified integration handoff from Nuvio

## Storage note

The development build stores active downloads in the app-specific external Downloads directory. A later milestone will add a system folder picker and safe export into the user's public Downloads folder. No broad storage permission is requested.

Use this app only for content you own or are authorized to download. It does not bypass DRM.

## Engine reference

- [libtorrent4j](https://github.com/aldenml/libtorrent4j)
- [libtorrent4j releases](https://github.com/aldenml/libtorrent4j/releases)
