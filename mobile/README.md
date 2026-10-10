# BookMyDoctor24 — mobile app

Flutter app for all 4 roles (Patient, Doctor, Receptionist, Admin/Superadmin), talking to the
SAME backend and database as the web app (`server/`) — no separate backend for mobile.

**Feature status:** all role portals use the same backend as the website. The
public mobile experience also includes doctor/clinic search, emergency care,
legal/support pages, and a doctor/clinic onboarding page with demo requests.

## Prerequisites

Run the checks below on the release machine before publishing. Android support
is included in this project; iOS support needs to be added separately if you
plan to publish on the App Store.

1. Install the Flutter SDK if you haven't already: https://docs.flutter.dev/get-started/install
2. Make sure the backend is running (Terminal 1: `npm run dev` in `server/`, Terminal 2:
   `npm run worker`, and Memurai/Redis running)

## Run it

```
cd mobile
flutter pub get
flutter run
```

For a production check, also run:

```
flutter test
flutter analyze
flutter build appbundle --release --dart-define=API_BASE_URL=https://api.bookmydoctors.me
```

Release builds require `android/key.properties` and the configured upload
keystore. The build deliberately fails if they are missing, so a Play Store
artifact can never be signed with a debug key by mistake.

## Google sign-in setup

The website and app both use the same Google **Web application** client ID;
the backend verifies that ID token before creating a session. The client ID in
`lib/core/google_auth_config.dart` already matches the web and backend setup.

For Google sign-in on Android to open successfully, complete this one-time
Google Cloud Console setup in the same OAuth project:

1. Create an **Android** OAuth client for package name `com.bookmydoctor24.app`.
2. Add the SHA-1 certificate for the debug app and the release/upload app. Get
   the values with `cd android; .\\gradlew signingReport` (use both variants).
3. Keep the existing **Web application** OAuth client. Do not paste an Android
   client ID into `google_auth_config.dart`; `serverClientId` must remain the
   Web client ID so the backend can verify the returned token.
4. Test a debug build on a physical Android phone, then test a signed release
   build before publishing.

If the Google account chooser closes immediately or shows configuration error
10/`DEVELOPER_ERROR`, the package name or SHA-1 in Google Cloud is missing or
does not match the installed app's signing certificate.

### Ways to see it

- **Quickest UI check, no emulator needed**: `flutter run -d chrome` — opens in a Chrome window.
- **Android emulator**: Android Studio → Virtual Device Manager → start a device → `flutter run`
  (auto-detected).
- **A real Android/iOS phone**: enable USB debugging (Android) or trust the computer (iOS),
  connect by USB, confirm with `flutter devices`, then `flutter run`.

## Connecting to the backend from a phone/emulator

The backend runs on your PC at `http://localhost:4000`, but "localhost" means something
different depending on where the Flutter app itself is running:

- **Android emulator**: works automatically — the app detects Android and uses `10.0.2.2:4000`,
  which is the emulator's special alias for your PC's localhost. No config needed.
- **iOS simulator**: works automatically — the simulator shares your PC's localhost directly.
- **A real phone** (Android or iOS) on the same Wi-Fi as your PC: `localhost` won't reach your
  PC from a separate physical device. Find your PC's LAN IP (Windows: `ipconfig`, look for
  "IPv4 Address", usually starts with `192.168.` or `10.`), then run:
  ```
  flutter run --dart-define=API_BASE_URL=http://YOUR_PC_IP:4000
  ```
  Also make sure Windows Firewall allows incoming connections to port 4000 (you may get a
  firewall prompt the first time — allow it), and that your phone is on the same Wi-Fi network.

## Demo accounts

Same 5 accounts as the web app — a "Demo accounts" row of quick-fill chips is on the login
screen itself, or type them manually:

| Role | Email | Password |
|---|---|---|
| Patient | patient@connectdoctor.test | Patient#DC2026!Test |
| Doctor | doctor@connectdoctor.test | Doctor#DC2026!Test |
| Receptionist | receptionist@connectdoctor.test | Reception#DC2026!Test |
| Admin | admin@connectdoctor.test | Admin#DC2026!Test |
| Superadmin | superadmin@connectdoctor.test | Super#DC2026!Test |

## What's in each portal

**Patient** — find/search doctors, book an appointment (async job-polling flow, shows token
number on confirm), my appointments (cancel, leave a review), medical records,
family members, payments (read-only — there's no patient self-pay endpoint), help & complaints.

**Doctor** — dashboard (today's appointments + live queue), queue console (call → consultation →
complete), appointments (confirm/complete/cancel/no-show), write medical records,
OPD weekly hours + closed dates, manage linked clinics (add new / edit owned), manage clinic
receptionists, payments (read-only, sees only the consultation fee — fee masking is server-side).

**Receptionist** — dashboard, walk-in booking on behalf of a patient (same async booking flow;
patient picker is limited to patients who've visited this clinic before — there's no
platform-wide patient search endpoint anywhere in this API), queue console, appointments, record
cash/UPI/card payments, read-only doctor/OPD-hours lookup for the clinic.

**Admin / Superadmin** — dashboard stats, doctor onboarding (`Add doctor` — this is the only way
a doctor account is created) with a status toggle for doctors already visible in the list, clinic
approval queue, receptionist management (all clinics), reviews/complaints/contact moderation,
geography (cities/areas/specializations), platform charges + system settings + booking rules,
broadcast notifications (+ history), activity log.

A few things are flagged as genuine API gaps rather than faked client-side (each has an inline
comment at the relevant screen): no "pending doctors" moderation queue, no analytics/revenue
time-series, no platform-wide patient search, no photo upload endpoint.

## Project layout

```
lib/
  config/env.dart          backend URL resolution (emulator/simulator/real device)
  core/                     API client (mirrors client/src/lib/apiClient.js), token storage
  models/                   data classes matching every backend response shape exactly
  state/auth_provider.dart  login/session state, shared across the whole app
  theme/                    colors, spacing, shared ThemeData
  widgets/                  shared building blocks (loading/error/empty states, role shell)
  routing/app_router.dart   splash -> login -> correct role's home screen
  screens/
    auth/                   login, register
    shared/                 notifications inbox + profile (used by all 4 roles)
    patient/                search, book, appointments, records, family, payments, complaints
    doctor/                 dashboard, queue, appointments, records, OPD hours, clinics, receptionists, payments
    receptionist/           dashboard, walk-in booking, queue, appointments, payments, doctors
    admin/                  dashboard, doctors, clinics, receptionists, reviews, complaints, contact, geography, platform settings, broadcast, activity log
```

## Crash reporting & connectivity

- **Crash reporting (Sentry)** — `sentry_flutter` is a dependency (see `pubspec.yaml`). It's
  initialized in `lib/main.dart`, but only when a `SENTRY_DSN` value is supplied at build time:
  ```
  flutter run --dart-define=SENTRY_DSN=https://your-key@oXXXXXX.ingest.sentry.io/XXXXXX
  ```
  With no `SENTRY_DSN` (the default for every build so far, including any made in a sandbox with
  no network access to Sentry) nothing is initialized and nothing is sent anywhere — the app runs
  exactly the same either way. Never commit a real DSN value into source control.
- **Offline banner** — `connectivity_plus` is a dependency. `lib/widgets/connectivity_banner.dart`
  (`ConnectivityBanner`) listens for connectivity changes and shows a small "No internet
  connection" bar; it's mounted at the top of `RoleScaffold`'s body (`lib/widgets/role_scaffold.dart`),
  so every signed-in role portal screen shows it automatically the moment the device goes offline,
  and hides it again once reconnected. It only watches the device's own network interfaces, not
  whether the backend itself is reachable — a screen's own error banner still covers that.
  It is not currently mounted on the signed-out screens (login/register/guest home).

Run `flutter pub get` after pulling these dependency changes.
