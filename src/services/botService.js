/**
 * Generates AI Commander Bots and balanced 15-card Wuxing Elemental decks
 * when matchmaking times out after 10s or when a custom room lacks human players.
 */
const BOT_PROFILES = [
  {
    botIndex: 1,
    uid: "bot_commander_red",
    displayName: "Bot Huyết Ma Vương",
    roleTitle: "Huyết Ma Chiến Vương (AI)",
    avatar: "res://assets/ui_hud/avatars/commander_p2_red.png",
    elo: 1220,
    preferredElement: "hoa"
  },
  {
    botIndex: 2,
    uid: "bot_commander_green",
    displayName: "Bot Cổ Thụ Đại Drui",
    roleTitle: "Cổ Thụ Đại Drui (AI)",
    avatar: "res://assets/ui_hud/avatars/commander_p3_green.png",
    elo: 1190,
    preferredElement: "moc"
  },
  {
    botIndex: 3,
    uid: "bot_commander_amber",
    displayName: "Bot Thái Dương Thánh Kỵ",
    roleTitle: "Thái Dương Thánh Kỵ (AI)",
    avatar: "res://assets/ui_hud/avatars/commander_p4_amber.png",
    elo: 1240,
    preferredElement: "kim"
  },
  {
    botIndex: 4,
    uid: "bot_commander_abyss",
    displayName: "Bot Hàn Băng Pháp Hoàng",
    roleTitle: "Hàn Băng Pháp Hoàng (AI)",
    avatar: "res://assets/ui_hud/avatars/commander_p1_blue.png",
    elo: 1210,
    preferredElement: "thuy"
  }
];

const ELEMENTS = ["kim", "moc", "thuy", "hoa", "tho"];

/**
 * Builds a valid 15-card Loadout Deck across the 4 role groups:
 * - Offense (C001..C040): 6 cards (3 phys + 3 mag)
 * - Tanker  (C041..C060): 3 cards
 * - Support (C061..C080): 3 cards
 * - Item    (C081..C100): 3 cards
 */
export function generateBotLoadoutDeck(seedIndex = 0) {
  const deck = [];
  const pickElem = (idx) => ELEMENTS[(idx + seedIndex) % ELEMENTS.length];

  // 3 Physical Offense cards (C001..C020)
  for (let i = 0; i < 3; i++) {
    const num = ((seedIndex * 3 + i * 5) % 20) + 1;
    deck.push(`C${String(num).padStart(3, "0")}_${pickElem(i)}`);
  }
  // 3 Magic Offense cards (C021..C040)
  for (let i = 0; i < 3; i++) {
    const num = 21 + ((seedIndex * 3 + i * 5) % 20);
    deck.push(`C${String(num).padStart(3, "0")}_${pickElem(i + 1)}`);
  }
  // 3 Tanker cards (C041..C060)
  for (let i = 0; i < 3; i++) {
    const num = 41 + ((seedIndex * 3 + i * 4) % 20);
    deck.push(`C${String(num).padStart(3, "0")}_${pickElem(i + 2)}`);
  }
  // 3 Support cards (C061..C080)
  for (let i = 0; i < 3; i++) {
    const num = 61 + ((seedIndex * 3 + i * 4) % 20);
    deck.push(`C${String(num).padStart(3, "0")}_${pickElem(i + 3)}`);
  }
  // 3 Item cards (C081..C100)
  for (let i = 0; i < 3; i++) {
    const num = 81 + ((seedIndex * 5 + i * 4) % 20);
    deck.push(`C${String(num).padStart(3, "0")}_${pickElem(i + 4)}`);
  }

  return deck;
}

export function createBotPlayer(seatIndex, botSlotOrder = 0) {
  const profile = BOT_PROFILES[(seatIndex - 1 + botSlotOrder) % BOT_PROFILES.length];
  return {
    uid: `${profile.uid}_s${seatIndex}`,
    displayName: profile.displayName,
    roleTitle: profile.roleTitle,
    avatar: profile.avatar,
    elo: profile.elo,
    seatIndex,
    isBot: true,
    isReady: true,
    loadoutDeck: generateBotLoadoutDeck(seatIndex + botSlotOrder),
    joinedAt: new Date().toISOString()
  };
}
