# `be-card-g` — Arcana Five: Wuxing Blood Cards Backend

Lightweight, zero-dependency Node.js backend for **Arcana Five: Wuxing Blood Cards (`Arcana Five: Huyết Bài Ngũ Hành`)**, designed for **Online + Offline Hybrid Gameplay**, **Google / Firebase Auth**, **10-Second Smart Matchmaking with Automatic AI Bot Fallback**, **Custom Rooms with Bot Fill**, and **Firebase Crashlytics & Analytics**.

---

## 1. Core Features

1. **Google Sign-In & Firebase Auth (`/api/v1/auth/google`)**
   - Verifies Firebase Auth ID Tokens (`identitytoolkit.googleapis.com`), Google OAuth2 ID Tokens (`oauth2.googleapis.com`), or offline/local Google Sign-In credentials.
   - Automatically merges local offline progress (`gold`, `diamonds`, `ownedCounts` across the 500 Wuxing cards, and 15-card `loadoutDeck`) with the cloud profile.
2. **Smart Matchmaking with 10-Second Bot Fallback (`/api/v1/matchmaking/enqueue`)**
   - Supports `2`, `3`, or `4` players.
   - If another waiting matchmaking room for the same mode is ready within 10 seconds, joins immediately.
   - If the room reaches full human capacity (`2/2`, `3/3`, or `4/4`), starts immediately (`matched_all_humans`).
   - If **10 seconds (`10,000 ms`)** pass and no other players join (or the room still has fewer than `mode` players), the server **automatically fills all remaining empty corners with AI Bots** (`Bot Huyết Ma Vương`, `Bot Cổ Thụ Đại Drui`, `Bot Thái Dương Thánh Kỵ`) and starts the battle (`timeout_10s_filled_with_bots`).
3. **Custom Room Creation & Bot Fill (`/api/v1/rooms/create`, `/api/v1/rooms/join`, `/api/v1/rooms/start`)**
   - Generates a 6-character room code (e.g. `ARC589`).
   - When the room starts (either after the 10-second waiting window or when the host presses Start) and has fewer human players than `mode`, the backend **automatically fills all missing slots with AI Bots**.
4. **Firebase Project Integration (`arcana-five-card-g`)**
   - **Project ID:** `arcana-five-card-g`
   - **Android App (`com.dochung.arcanafive`):** `1:673339667273:android:03922dbe27f2e78336a098`
   - **iOS App (`com.dochung.arcanafive`):** `1:673339667273:ios:8c700ab687abfdc236a098`
   - **Web App:** `1:673339667273:web:24654b1b2267e9e136a098`
   - **Enabled Services:** Firebase Auth (`identitytoolkit`), Firebase Crashlytics (`firebasecrashlytics`), Google Analytics (`analytics`), Cloud Firestore (`firestore`).

---

## 2. Quick Start

```bash
# Run tests
npm test

# Start server (default port 8787)
npm start
```
