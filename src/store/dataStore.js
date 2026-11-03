import fs from "node:fs";
import path from "node:path";
import { CONFIG } from "../config.js";

const DB_FILE = path.join(CONFIG.dataDir, "database.json");

/**
 * 15 Default Starter Cards gifted on first Google Login when the player has 0 cards:
 * - 3 Physical Offense: C001_kim, C002_moc, C003_thuy
 * - 3 Magic Offense:    C021_hoa, C022_tho, C024_kim
 * - 3 Tanker:           C041_moc, C042_thuy, C047_hoa
 * - 3 Support:          C061_tho, C063_kim, C066_moc
 * - 3 Items:            C081_thuy, C082_hoa, C085_tho
 */
export const DEFAULT_STARTER_15_CARDS = {
  C001_kim: 1, C002_moc: 1, C003_thuy: 1,
  C021_hoa: 1, C022_tho: 1, C024_kim: 1,
  C041_moc: 1, C042_thuy: 1, C047_hoa: 1,
  C061_tho: 1, C063_kim: 1, C066_moc: 1,
  C081_thuy: 1, C082_hoa: 1, C085_tho: 1
};

export const DEFAULT_LOADOUT_DECK = Object.keys(DEFAULT_STARTER_15_CARDS);

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

      // If for any reason existing user had 0 cards, gift the 15 default starter cards
      const totalOwned = Object.values(existing.ownedCounts || {}).reduce((acc, v) => acc + Number(v || 0), 0);
      let giftedStarter = false;
      if (totalOwned === 0) {
        existing.ownedCounts = { ...DEFAULT_STARTER_15_CARDS };
        existing.loadoutDeck = [...DEFAULT_LOADOUT_DECK];
        giftedStarter = true;
      }
      existing.isFirstLogin = giftedStarter;
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
      isFirstLogin: true,
      starterGiftCount: 15,
      starterGiftCards: [...DEFAULT_LOADOUT_DECK],
      gold: 3500,
      diamonds: 600,
      packCountsByType: { "1": 4, "2": 3, "3": 2, "4": 2, "5": 1 },
      ownedCounts: { ...DEFAULT_STARTER_15_CARDS },
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
      for (const [cardUid, cnt] of Object.entries(payload.ownedCounts)) {
        const num = Number(cnt || 0);
        if (num > 0) {
          user.ownedCounts[cardUid] = Math.max(Number(user.ownedCounts[cardUid] || 0), num);
        }
      }
    }
    // Ensure a user always has at least the 15 starter cards
    const totalOwned = Object.values(user.ownedCounts || {}).reduce((acc, v) => acc + Number(v || 0), 0);
    if (totalOwned === 0) {
      user.ownedCounts = { ...DEFAULT_STARTER_15_CARDS };
      user.loadoutDeck = [...DEFAULT_LOADOUT_DECK];
    } else if (Array.isArray(payload.loadoutDeck) && payload.loadoutDeck.length === 15) {
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
