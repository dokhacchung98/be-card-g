import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "../config.js";

const DB_FILE = path.join(CONFIG.dataDir, "database.json");

const DEFAULT_STARTER_CARDS = {
  c001_kim: 1, c002_moc: 1, c003_thuy: 1,
  c026_hoa: 1, c027_tho: 1, c028_kim: 1,
  c051_moc: 1, c052_thuy: 1, c053_hoa: 1,
  c069_tho: 1, c070_kim: 1, c071_moc: 1,
  c085_thuy: 1, c086_hoa: 1, c087_tho: 1
};

const DEFAULT_LOADOUT_DECK = Object.keys(DEFAULT_STARTER_CARDS);

export class DataStore {
  constructor(customPath = DB_FILE) {
    this.filePath = customPath;
    this.state = {
      users: {},
      matchHistory: [],
      analyticsEvents: [],
      crashReports: []
    };
    this._load();
  }

  _load() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, "utf8");
        const parsed = JSON.parse(raw);
        this.state = {
          users: parsed.users || {},
          matchHistory: parsed.matchHistory || [],
          analyticsEvents: parsed.analyticsEvents || [],
          crashReports: parsed.crashReports || []
        };
      }
    } catch (_err) {
      // start with clean in-memory state if file is empty/corrupted
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf8");
    } catch (_err) {
      // ignore write errors in read-only environments
    }
  }

  upsertGoogleUser({ uid, googleId, email, displayName, photoUrl, provider = "google.com", platform = "unknown" }) {
    const now = new Date().toISOString();
    const existing = this.state.users[uid];

    if (existing) {
      existing.email = email || existing.email;
      existing.displayName = displayName || existing.displayName;
      existing.photoUrl = photoUrl || existing.photoUrl;
      existing.googleId = googleId || existing.googleId;
      existing.lastLoginAt = now;
      existing.platform = platform || existing.platform;
      this.save();
      return existing;
    }

    const newUser = {
      uid,
      googleId: googleId || uid,
      email: email || `${uid}@google.arcanafive.local`,
      displayName: displayName || "Đại Pháp Sư Ngũ Hành",
      photoUrl: photoUrl || "",
      provider,
      platform,
      gold: 3000,
      diamonds: 450,
      packCountsByType: { "1": 2, "2": 1, "3": 1, "4": 1, "5": 0 },
      ownedCounts: { ...DEFAULT_STARTER_CARDS },
      loadoutDeck: [...DEFAULT_LOADOUT_DECK],
      elo: 1200,
      stats: {
        matchesPlayed: 0,
        wins: 0,
        botMatches: 0,
        pvpMatches: 0
      },
      createdAt: now,
      lastLoginAt: now,
      updatedAt: now
    };

    this.state.users[uid] = newUser;
    this.save();
    return newUser;
  }

  getUser(uid) {
    return this.state.users[uid] || null;
  }

  syncUserProfile(uid, payload = {}) {
    const user = this.state.users[uid];
    if (!user) return null;

    if (typeof payload.displayName === "string" && payload.displayName.trim()) {
      user.displayName = payload.displayName.trim();
    }
    if (typeof payload.gold === "number" && payload.gold >= 0) {
      user.gold = Math.floor(payload.gold);
    }
    if (typeof payload.diamonds === "number" && payload.diamonds >= 0) {
      user.diamonds = Math.floor(payload.diamonds);
    }
    if (payload.packCountsByType && typeof payload.packCountsByType === "object") {
      user.packCountsByType = { ...user.packCountsByType, ...payload.packCountsByType };
    }
    if (payload.ownedCounts && typeof payload.ownedCounts === "object") {
      // Merge owned 500-card inventory (keeping max owned count for offline->online merge safety)
      for (const [cardUid, cnt] of Object.entries(payload.ownedCounts)) {
        const num = Number(cnt || 0);
        if (num > 0) {
          user.ownedCounts[cardUid] = Math.max(Number(user.ownedCounts[cardUid] || 0), num);
        }
      }
    }
    if (Array.isArray(payload.loadoutDeck) && payload.loadoutDeck.length > 0) {
      user.loadoutDeck = payload.loadoutDeck.slice(0, 15).map(String);
    }
    user.updatedAt = new Date().toISOString();
    this.save();
    return user;
  }

  recordMatch(matchSummary) {
    this.state.matchHistory.unshift({
      ...matchSummary,
      recordedAt: new Date().toISOString()
    });
    if (this.state.matchHistory.length > 200) {
      this.state.matchHistory.length = 200;
    }
    this.save();
  }

  recordAnalyticsEvent(event) {
    const item = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ...event,
      timestamp: new Date().toISOString()
    };
    this.state.analyticsEvents.unshift(item);
    if (this.state.analyticsEvents.length > 500) {
      this.state.analyticsEvents.length = 500;
    }
    this.save();
    return item;
  }

  recordCrashReport(report) {
    const item = {
      id: `crash_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ...report,
      timestamp: new Date().toISOString()
    };
    this.state.crashReports.unshift(item);
    if (this.state.crashReports.length > 200) {
      this.state.crashReports.length = 200;
    }
    this.save();
    return item;
  }
}
