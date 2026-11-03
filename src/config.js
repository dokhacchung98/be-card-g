import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..");

let firebaseConfig = {
  projectId: process.env.FIREBASE_PROJECT_ID || "arcana-five-card-g",
  projectNumber: "673339667273",
  packageName: "com.dochung.arcanafive",
  androidAppId: "1:673339667273:android:03922dbe27f2e78336a098",
  iosAppId: "",
  webAppId: "1:673339667273:web:24654b1b2267e9e136a098",
  apiKey: process.env.FIREBASE_API_KEY || "",
  authDomain: "arcana-five-card-g.firebaseapp.com",
  services: {
    auth: true,
    crashlytics: true,
    analytics: true,
    firestore: true
  }
};

const fbConfigFile = path.join(ROOT_DIR, "config", "firebase-config.json");
if (fs.existsSync(fbConfigFile)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(fbConfigFile, "utf8"));
    firebaseConfig = { ...firebaseConfig, ...parsed };
  } catch (_err) {
    // keep default config
  }
}

export const CONFIG = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || "0.0.0.0",
  jwtSecret: process.env.JWT_SECRET || "arcana-five-wuxing-secret-key-2026",
  matchmakingTimeoutMs: Number(process.env.MATCHMAKING_TIMEOUT_MS || 10000),
  roomAutoBotTimeoutMs: Number(process.env.ROOM_AUTO_BOT_TIMEOUT_MS || 10000),
  dataDir: path.join(ROOT_DIR, "data"),
  firebase: firebaseConfig
};
