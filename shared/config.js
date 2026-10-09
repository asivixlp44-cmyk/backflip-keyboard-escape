// Game data shared by the client and the Colyseus server.
// +1 Backflip Keyboard Escape: every step is +Speed, Speed fills your Level, and every level is
// +3 walk speed and +1 jump. Spam jump in the air to backflip higher and climb the giant keyboard
// walls, stage after stage. There are no in-app purchases: everything is bought with Wins.

export const CFG = {
    maxLevel: 400,
    // "Level 2 / Speed 11 (+3) • Jump 2 (+1)": walk speed 5 + 3 per level, one jump per level
    walkBase: 5,
    walkPerLevel: 3,
    minWalk: 8,
    maxWalk: 100,
    rebirthWalk: 2,
    rebirthJumps: 1,
    // Roblox defaults: jump power 50, gravity 196.2 (one jump rises about 6.4 studs)
    jumpV: 50,
    grav: 196.2,
    // Mid-air jumps (backflips) are at least this far apart; presses in between are buffered.
    // That keeps every backflip at 5.3+ studs, so walls at STUDS_PER_JUMP per jump always work.
    flipGap: 0.15,
    gainInterval: 0.25,
    voidDepth: 45,
    shieldTime: 1.5,
    respawnDelay: 1.2,
    // Rebirth: from Level 15 (+5 per rebirth, up to 60). Level back to 1, +50% Speed, +25% Wins,
    // +1 jump and +2 walk speed for good
    rebirthBase: 15,
    rebirthInc: 5,
    rebirthCap: 60,
    rebirthStep: 0.5,
    rebirthWins: 0.25,
    // Sugar Rush event on the server clock: every 30 min for 5 min, x2 Speed and x2 Wins for everyone
    event: { every: 30 * 60, length: 5 * 60, speed: 2, wins: 2 },
    boostMult: 2,
    boostMinutes: 15,
    starterPackMinutes: 15,
    teleportBackSecs: 12,
    // Friend Boost: +10% Speed per Bloxity friend in the same server, up to 5
    friendBoost: 0.1,
    friendMax: 5,
    // Treadmills keep paying while you're away: Speed for up to 8 hours, at a quarter rate
    offlineHours: 8,
    offlineRate: 0.25,
    maxPlayers: 24,
};

// XP to finish each level, read off the reference (3, 4, 6, 9, 15, 22 ... 389 at Level 13), then
// x1.45 a level. XP is earned 1:1 with Speed.
const XP_TABLE = [3, 4, 6, 9, 15, 22, 33, 51, 76, 115, 172, 259, 389];
export const xpFor = (L) => (L <= 13 ? XP_TABLE[Math.max(1, L) - 1] : Math.round(389 * Math.pow(1.45, L - 13)));
export const maxSpeedFor = (L, R) => Math.min(CFG.maxWalk, CFG.walkBase + CFG.walkPerLevel * Math.max(1, L || 1) + CFG.rebirthWalk * (R || 0));
// Jumps you can chain before landing: one per level, plus one per rebirth
export const jumpsFor = (L, R) => Math.max(1, (L || 1) + CFG.rebirthJumps * (R || 0));
export const rebirthLevel = (R) => Math.min(CFG.rebirthCap, CFG.rebirthBase + CFG.rebirthInc * (R || 0));
export const rebirthMult = (R) => 1 + CFG.rebirthStep * (R || 0);
export const rebirthWinsMult = (R) => 1 + CFG.rebirthWins * (R || 0);

// Sugar Rush: { on, left (s until it ends or starts) } at server time `now` (ms)
export function eventState(now) {
    const E = CFG.event, t = now / 1000, c = ((t % E.every) + E.every) % E.every;
    return c < E.length ? { on: true, left: E.length - c } : { on: false, left: E.every - c };
}

// =====================================================================================
// The course: 15 stages climbing north (+z) out of the lobby and up. Each stage is a corridor of
// keyboard tiers and hazards that rises `rise` studs, then ends at a giant wall `jumps` jumps tall
// (STUDS_PER_JUMP each). Three Wins pads stick out of the wall's left side at 30%, 60% and 88% of
// its height (+1x, +2x, +3x the stage's Wins); the next stage starts on top of the wall.
// =====================================================================================
export const STAGE_W = 48;           // corridor width: x from -24 to 24
export const STUDS_PER_JUMP = 5.2;
export const LOBBY = { halfX: 84, z0: -104, z1: 60, wallHeight: 44, spawn: { x: 0, y: 0.5, z: -6 } };
// Pads: columns on the wall's left side (+x is screen-left facing the wall); climb on the right
export const PAD = { xs: [18, 7, -4], w: 7, d: 6, fracs: [0.3, 0.6, 0.88] };
export const CLIMB_X = -15;

// theme: keys = keycap colours, ink = letter colour, case = keyboard case, wall / trim = corridor
// walls, accent = neon trims, sky = haze colour inside, deco = candy set on the walls
export const THEMES = {
    candy: { keys: [0xffc4e6, 0xd8c4ff, 0xffffff, 0xf2a8e0, 0xe6d8ff], ink: 0x3a2050, case: 0xff9ad6, wall: 0x9a5cf0, trim: 0xff8ad8, accent: 0xff6ae0, sky: 0xe6b8ff, deco: 'sweets' },
    bubble: { keys: [0x8ae6ff, 0xffffff, 0xffb8e8, 0x6ac8ff, 0xc8f2ff], ink: 0x1a3a6a, case: 0x4aa8ff, wall: 0x5a8cff, trim: 0xff9ae0, accent: 0x5ae6ff, sky: 0xb8e2ff, deco: 'bubble' },
    mint: { keys: [0xb8ffd8, 0xffffff, 0x8af0c0, 0xe0fff0, 0xffd0e8], ink: 0x1a4a3a, case: 0x3ad89a, wall: 0x46c6a0, trim: 0xffffff, accent: 0x4affb8, sky: 0xc8ffe8, deco: 'mint' },
    choco: { keys: [0x9a5a32, 0x7a4022, 0xb8743e, 0x6a3418, 0xc8925a], ink: 0xfff0dc, case: 0x5a2e14, wall: 0x6a3a1e, trim: 0xffc86a, accent: 0xffb040, sky: 0xffd8b0, deco: 'choco' },
    laser: { keys: [0x3a2a6a, 0x2a1e4e, 0x4a3a8a, 0x22183e, 0x5a3aa0], ink: 0xff5ae6, case: 0x18102e, wall: 0x2a1a52, trim: 0xff3ad8, accent: 0xff2ad0, sky: 0x8a6aff, deco: 'neon', glow: true },
    arrow: { keys: [0xffd25a, 0xffa84a, 0xffffff, 0xffe8a0, 0xff8a5a], ink: 0x5a2a10, case: 0xff7a2a, wall: 0xff9a3a, trim: 0xfff0a0, accent: 0xffd028, sky: 0xffe0b0, deco: 'citrus' },
    gumball: { keys: [0x6ab8ff, 0xffffff, 0xff7ab8, 0xffe05a, 0x7affa8], ink: 0x1a2a5a, case: 0x3a6aff, wall: 0x3a5ae0, trim: 0xffe05a, accent: 0xff5aa8, sky: 0xa8c8ff, deco: 'gumball' },
    frost: { keys: [0xe8f8ff, 0xc8eaff, 0xffffff, 0xa8dcff, 0xf0e8ff], ink: 0x2a4a7a, case: 0x8ad0ff, wall: 0x9ac8f0, trim: 0xffffff, accent: 0x9ae8ff, sky: 0xe0f4ff, deco: 'frost', ice: true },
    peppermint: { keys: [0xffffff, 0xff5a6a, 0xffd0d6, 0xff8a96, 0xfff0f2], ink: 0x6a1020, case: 0xe8283a, wall: 0xff6a7a, trim: 0xffffff, accent: 0xff3a50, sky: 0xffd0d8, deco: 'peppermint' },
    glitch: { keys: [0x1a1a2a, 0x22223a, 0x2a2a4a, 0x14141e, 0x30304e], ink: 0x5affe6, case: 0x0a0a14, wall: 0x14142a, trim: 0x5affe6, accent: 0x3affd8, sky: 0x5a4aa0, deco: 'neon', glow: true },
    mouse: { keys: [0xe8eaf2, 0xc8ccd8, 0xffffff, 0xb0b4c4, 0xdfe2ec], ink: 0x2a2e3e, case: 0x8a8ea0, wall: 0x9aa0b8, trim: 0x5ad0ff, accent: 0x4ac8ff, sky: 0xd0d8f0, deco: 'tech' },
    rgb: { keys: [0x1e1e28, 0x26263a, 0x181822, 0x2e2e44, 0x22222e], ink: 0xffffff, case: 0x101016, wall: 0x1a1a26, trim: 0xff3a5a, accent: 0x3affff, sky: 0x6a4aaa, deco: 'neon', glow: true, rgb: true },
    jelly: { keys: [0xa8ff5a, 0xff8ae0, 0xffe05a, 0x5ae0ff, 0xc89aff], ink: 0x2a3a10, case: 0x6ad83a, wall: 0x7ae05a, trim: 0xff8ae0, accent: 0xb8ff3a, sky: 0xe0ffc0, deco: 'jelly' },
    storm: { keys: [0x5a6aa8, 0x4a5a98, 0x7a8ac8, 0x3a4a88, 0x9aa8e0], ink: 0xe8f0ff, case: 0x2a3468, wall: 0x2e3a78, trim: 0x9ae0ff, accent: 0x7ad8ff, sky: 0x4a5a9a, deco: 'storm' },
    rainbow: { keys: [0xff6a8a, 0xffb84a, 0xffe85a, 0x6aff8a, 0x5ac8ff, 0xb88aff], ink: 0x2a1a3a, case: 0xffd028, wall: 0xb86aff, trim: 0xffd028, accent: 0xffe05a, sky: 0xffc8f0, deco: 'rainbow', rgb: true },
};

// name, hint under the title, layout type (world.js), jumps to climb the end wall, base Wins,
// corridor length and how far the floor rises before the wall
const S_ = (name, sub, type, theme, jumps, wins, len, rise) => ({ name, sub, type, theme: THEMES[theme], themeKey: theme, jumps, wins, len, rise });
export const STAGES = [
    S_('Stage 1', 'SPAM JUMP TO BACKFLIP!', 'tiers', 'candy', 3, 1, 230, 16),
    S_('Stage 2', 'SPACEBAR BRIDGES', 'bridges', 'bubble', 6, 2, 280, 14),
    S_('Stage 3', 'TYPING KEYS!', 'pistons', 'mint', 10, 4, 300, 14),
    S_('Stage 4', 'CHOCOLATE RIVER', 'river', 'choco', 14, 8, 310, 12),
    S_('Stage 5', 'CAPS LOCK LASERS!', 'lasers', 'laser', 18, 15, 320, 15),
    S_('Stage 6', 'ARROW KEY CONVEYORS', 'conveyors', 'arrow', 23, 30, 330, 15),
    S_('Stage 7', 'GUMBALL ALLEY!', 'gumballs', 'gumball', 28, 60, 360, 30),
    S_('Stage 8', 'SLIPPERY FROSTING', 'ice', 'frost', 33, 120, 340, 15),
    S_('Stage 9', 'LOLLIPOP SPINNERS!', 'spinners', 'peppermint', 39, 250, 360, 15),
    S_('Stage 10', 'GLITCH KEYS', 'glitch', 'glitch', 45, 500, 360, 15),
    S_('Stage 11', 'MOUSE CLICK CRUSHERS!', 'crushers', 'mouse', 52, 1000, 370, 15),
    S_('Stage 12', 'RGB GAMING RIG', 'rgb', 'rgb', 59, 2000, 380, 18),
    S_('Stage 13', 'JELLY BOUNCE!', 'jelly', 'jelly', 66, 4000, 390, 21),
    S_('Stage 14', 'SUGAR STORM', 'storm', 'storm', 73, 8000, 400, 18),
    S_('Stage 15', 'RAINBOW FINALE!', 'finale', 'rainbow', 80, 16000, 450, 20),
];
{
    let z = LOBBY.z1, y = 0;
    STAGES.forEach((s, i) => {
        s.i = i;
        s.zS = z; s.y0 = y;
        s.zE = z + s.len;
        s.y1 = y + s.rise;
        s.wallH = Math.round(STUDS_PER_JUMP * s.jumps);
        s.top = s.y1 + s.wallH;
        // Jumps you need to have to get in at all (the wall of the stage before)
        s.need = i ? STAGES[i - 1].jumps : 1;
        s.pads = PAD.fracs.map((f, k) => {
            const h = Math.max(4, Math.round(f * s.wallH));
            return { k, x: PAD.xs[k], y: s.y1 + h, z: s.zE - PAD.d / 2, req: Math.max(1, Math.ceil(h / STUDS_PER_JUMP)), wins: s.wins * (k + 1) };
        });
        z = s.zE; y = s.top;
    });
}
export const COURSE_END = { z: STAGES[STAGES.length - 1].zE, y: STAGES[STAGES.length - 1].top };
// The summit on top of the last wall: the golden trophy and the ESCAPE pad
export const SUMMIT = { x: 0, z: COURSE_END.z + 30, y: COURSE_END.y, wins: 100000, len: 70 };
// Stage index at a position (-1 in the lobby). Stages never overlap in z: a stage owns its
// corridor up to the face of its end wall; stepping onto the top of the wall is the next stage.
export function stageAt(x, y, z) {
    if (z < LOBBY.z1) return -1;
    for (let i = 0; i < STAGES.length; i++) if (z < STAGES[i].zE) return i;
    return STAGES.length - 1;
}

// =====================================================================================
// Lobby shops. Everything costs Wins.
// =====================================================================================
// SHOES: "+N Steps" added to every step (the first is "+1 Steps / 1 Wins", as in the reference)
const SH = (id, name, bonus, cost, color, accent, extra) => Object.assign({ id, name, bonus, cost, color, accent }, extra || {});
export const SHOES = [
    SH('pink', 'Bubblegum Kicks', 1, 1, 0xff7ac8, 0xffffff),
    SH('cyan', 'Sky Runners', 3, 5, 0x3ad8ff, 0xffffff),
    SH('lime', 'Lime Sprinters', 6, 15, 0x7aff3a, 0x1a3a10),
    SH('red', 'Cherry Boosters', 12, 40, 0xff3a4a, 0xffffff),
    SH('purple', 'Grape Jumpers', 25, 100, 0x9a4aff, 0xffd028),
    SH('gold', 'Golden Toffee', 50, 250, 0xffc828, 0xffffff, { glow: 0xffd028 }),
    SH('choco', 'Choco Stompers', 100, 600, 0x7a4022, 0xffc86a),
    SH('mint', 'Mint Dashers', 200, 1500, 0x5affc0, 0xffffff, { glow: 0x5affc0 }),
    SH('lava', 'Lava Treads', 400, 3500, 0xff5a14, 0xffd028, { glow: 0xff6a14, fx: 'fire' }),
    SH('ice', 'Frost Walkers', 800, 8000, 0xbaf0ff, 0xffffff, { glow: 0x9ae8ff, fx: 'frost' }),
    SH('neon', 'Neon Keys', 1500, 18000, 0x2affd8, 0xff3ad8, { glow: 0x2affd8, fx: 'spark' }),
    SH('galaxy', 'Galaxy Soles', 3000, 40000, 0x5a1ebe, 0xff50e6, { glow: 0xb85aff, fx: 'star' }),
    SH('angel', 'Angel Steps', 6000, 90000, 0xffffff, 0xffe68a, { glow: 0xfff0b0, fx: 'star', wings: true }),
    SH('demon', 'Demon Dash', 12000, 200000, 0x1a1a22, 0xff1e3c, { glow: 0xff1e3c, fx: 'fire', wings: true }),
    SH('rainbow', 'Rainbow Rockets', 25000, 450000, 0xff5aa8, 0x5affff, { glow: 0xffffff, fx: 'rainbow' }),
    SH('keyboard', 'Keyboard Kings', 50000, 1000000, 0xffd028, 0xffffff, { glow: 0xffd028, fx: 'rainbow', wings: true }),
];
export const shoeById = Object.fromEntries(SHOES.map((d) => [d.id, d]));

// TREADMILLS: "Automatically increases your Speed!" Stand on one and every step counts xN.
// The Aqua Treadmill comes from the Day 7 daily reward.
export const TREADMILLS = [
    { id: 't2', mult: 2, cost: 0, color: 0xc8c8d8, label: 'Starter' },
    { id: 't3', mult: 3, cost: 5, color: 0xffd028 },
    { id: 't9', mult: 9, cost: 30, color: 0x3ad8ff },
    { id: 't18', mult: 18, cost: 150, color: 0x7aff3a },
    { id: 't36', mult: 36, cost: 600, color: 0xff5ad8 },
    { id: 't100', mult: 100, cost: 3000, color: 0xff3a4a, tag: '*SUPER OP*' },
    { id: 't200', mult: 200, cost: 15000, color: 0xb85aff, tag: '*GODLY*' },
    { id: 'aqua', mult: 50, cost: 0, daily: true, color: 0x2ae6ff, label: 'Aqua Treadmill' },
];
export const treadById = Object.fromEntries(TREADMILLS.map((d) => [d.id, d]));
// Belt geometry, also used by the server to know who is on which treadmill (lobby east side)
export const TREAD_GEO = { x0: 30, z: -64, step: 6.6, len: 13, width: 5.2, top: 1.2 };
export function treadmillAt(x, y, z) {
    const g = TREAD_GEO;
    if (Math.abs(z - g.z) > g.len / 2 + 0.8 || y > g.top + 3 || y < g.top - 0.6) return null;
    for (let i = 0; i < TREADMILLS.length; i++) {
        if (Math.abs(x - (g.x0 + i * g.step)) <= g.width / 2 + 0.4) return TREADMILLS[i];
    }
    return null;
}

// ITEMS SHOP: one wearable at a time, multiplies all Speed ("Multiplier xN (Items)")
const IT = (id, name, mult, cost, kind, color, accent, ic) => ({ id, name, mult, cost, kind, color, accent, ic });
export const ITEMS = [
    IT('halo', 'Donut Halo', 1.25, 10, 'halo', 0xff9ad6, 0xffd0ea, '🍩'),
    IT('angel', 'Angel Wings', 1.5, 60, 'wings', 0xffffff, 0xe8f4ff, '🪽'),
    IT('crown', 'Candy Crown', 2, 300, 'crown', 0xffd028, 0xff5ab8, '👑'),
    IT('demon', 'Demon Wings', 2.5, 1200, 'bat', 0x1a1a24, 0xff2a4a, '🦇'),
    IT('jetpack', 'Cookie Jetpack', 3, 5000, 'jetpack', 0xc8864a, 0x5a3418, '🚀'),
    IT('rainbow', 'Rainbow Wings', 4, 25000, 'wings', 0xff8ad8, 0x8affff, '🌈'),
    IT('galaxy', 'Galaxy Halo', 6, 120000, 'halo', 0x8a4aff, 0xff7af0, '🌌'),
    IT('golden', 'Golden Keyboard Wings', 10, 600000, 'keywings', 0xffd028, 0xffffff, '⌨️'),
];
export const itemById = Object.fromEntries(ITEMS.map((d) => [d.id, d]));

// TRAILS by the treadmills: "Starter", "1 Rebirth x1.5 Step", "3 Rebirth x2 Step" ... The Moon
// Trail comes from the Day 3 daily reward.
export const TRAILS = [
    { id: 'starter', name: 'Starter', mult: 1, reb: 0, color: 0xffffff },
    { id: 'r1', name: 'Bubblegum', mult: 1.5, reb: 1, color: 0xff7ad8 },
    { id: 'r3', name: 'Sky Ribbon', mult: 2, reb: 3, color: 0x3ad8ff },
    { id: 'r5', name: 'Lime Zap', mult: 3, reb: 5, color: 0x7aff3a },
    { id: 'r10', name: 'Fire Flip', mult: 5, reb: 10, color: 0xff6a14 },
    { id: 'r20', name: 'Rainbow Flip', mult: 8, reb: 20, color: 0xffffff, rainbow: true },
    { id: 'moon', name: 'Moon Trail', mult: 1.5, reb: 0, daily: true, color: 0xc8d8ff },
];
export const trailById = Object.fromEntries(TRAILS.map((d) => [d.id, d]));

// Boosts in the Shop
export const BOOSTS = {
    pass2x: { name: 'x2 Speed', cost: 50, ic: '⚡', desc: 'Double all Speed you earn. Forever!' },
    boost: { name: 'x2 Speed Boost', cost: 10, ic: '⏱️', desc: '15 minutes of double Speed (stacks)' },
    starter: { name: 'OP STARTER PACK', cost: 10, ic: '🎁', desc: 'Angel Wings + 15 min x2 Speed + 1K Speed', speed: 1000, item: 'angel' },
};
// Bottom bar: "+1 Level" and three Speed packs, priced in Wins and scaled to your level.
// The packs give 10%, 35% and 75% of the XP your current level needs.
export const levelCost = (L) => Math.max(1, Math.ceil(0.6 * Math.pow(1.19, Math.max(1, L))));
export const PACKS = [
    { frac: 0.1, cost: 0.15, color: 'g-green' },
    { frac: 0.35, cost: 0.4, color: 'g-blue' },
    { frac: 0.75, cost: 0.7, color: 'g-purple' },
];
export const packAmount = (i, L) => Math.max(1, Math.floor(xpFor(L) * PACKS[i].frac));
export const packCost = (i, L) => Math.max(1, Math.ceil(levelCost(L) * PACKS[i].cost));

// Codes (Codes chest / CODES button), each once per player
export const CODES = {
    BACKFLIP: { wins: 5 },
    KEYBOARD: { speed: 1000 },
    SUGARRUSH: { boost: 10 },
    LEGION: { wins: 25 },
    RELEASE: { speed: 5000, wins: 10 },
};

// Lobby freebies: Group Reward chest (once a day)
export const GROUP_CHEST = { hours: 24, speed: 500, wins: 3 };

// Session playtime rewards (minutes since joining)
export const FREE = [
    { min: 2, speed: 200 }, { min: 5, wins: 2 }, { min: 10, speed: 2500 },
    { min: 15, wins: 5 }, { min: 25, speed: 25000 }, { min: 40, wins: 25 }, { min: 60, boost: 15 },
];

// Daily Rewards, as in the reference: +100 Speed, +5 Wins, Moon Trail, +2.5K Speed, +25 Wins,
// +250 Wins, Aqua Treadmill. One claim per UTC day; missing a day resets the streak.
export const DAILY = [
    { speed: 100 }, { wins: 5 }, { trail: 'moon' }, { speed: 2500 }, { wins: 25 }, { wins: 250 }, { tread: 'aqua' },
];
export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
export function dailyStatus(d, now) {
    d = d || {};
    const today = dayKey(now), yesterday = dayKey(now - 86400000);
    const can = d.last !== today;
    const streak = d.last === today || d.last === yesterday ? d.streak || 0 : 0;
    return { can, streak, day: Math.min(DAILY.length - 1, can ? streak % DAILY.length : Math.max(0, streak - 1) % DAILY.length) };
}
export const rewardText = (r) => [
    r.speed ? '+' + fmt(r.speed) + ' Speed' : '',
    r.wins ? '+' + fmt(r.wins) + ' Wins' : '',
    r.boost ? r.boost + ' min x2 Speed' : '',
    r.trail ? trailById[r.trail].name : '',
    r.tread ? treadById[r.tread].label : '',
].filter(Boolean).join(' & ');

// Quests ("Tutorial: Get 1 Wins (0/1)"): one at a time, each pays a little
export const QUESTS = [
    { text: 'Tutorial: Get 1 Wins', kind: 'wins', n: 1, reward: { speed: 50 } },
    { text: 'Buy your first Shoes', kind: 'shoe', n: 1, reward: { speed: 100 } },
    { text: 'Reach Level 5', kind: 'level', n: 5, reward: { wins: 2 } },
    { text: 'Reach Stage 2', kind: 'stage', n: 2, reward: { wins: 3 } },
    { text: 'Buy the x3 Treadmill', kind: 'tread', n: 3, reward: { speed: 500 } },
    { text: 'Reach Stage 3', kind: 'stage', n: 3, reward: { wins: 5 } },
    { text: 'Buy an Item', kind: 'item', n: 1, reward: { wins: 5 } },
    { text: 'Reach Stage 4', kind: 'stage', n: 4, reward: { wins: 10 } },
    { text: 'Reach Level 15', kind: 'level', n: 15, reward: { speed: 5000 } },
    { text: 'Rebirth once', kind: 'rebirth', n: 1, reward: { wins: 25 } },
    { text: 'Reach Stage 6', kind: 'stage', n: 6, reward: { wins: 50 } },
    { text: 'Reach Stage 8', kind: 'stage', n: 8, reward: { wins: 200 } },
    { text: 'Reach Stage 10', kind: 'stage', n: 10, reward: { wins: 1000 } },
    { text: 'Reach Stage 12', kind: 'stage', n: 12, reward: { wins: 5000 } },
    { text: 'Reach Stage 15', kind: 'stage', n: 15, reward: { wins: 25000 } },
    { text: 'Escape the Keyboard!', kind: 'escape', n: 1, reward: { wins: 100000 } },
];
export function questProgress(q, p) {
    if (!q) return 0;
    switch (q.kind) {
        case 'wins': return p.totalWins || 0;
        case 'shoe': return Object.keys(p.shoes || {}).length;
        case 'level': return p.level || 1;
        case 'stage': return (p.maxStage || 0) + 1;
        case 'tread': return Object.keys(p.treads || {}).some((id) => (treadById[id] || {}).mult >= q.n && !treadById[id].daily) ? q.n : 0;
        case 'item': return Object.keys(p.items || {}).length;
        case 'rebirth': return p.rebirths || 0;
        case 'escape': return p.escaped ? 1 : 0;
        default: return 0;
    }
}

// Player outfits for the blocky fallback body (cycle by join order)
export const KITS = [
    { shirt: 0x14141e, shorts: 0x2a2a3a, socks: 0x14141e },
    { shirt: 0xff6ac8, shorts: 0x5a2a8a, socks: 0xffffff },
    { shirt: 0x3ad8ff, shorts: 0x1e3a6a, socks: 0xffffff },
    { shirt: 0x7aff3a, shorts: 0x1e2a44, socks: 0xffffff },
    { shirt: 0xffc828, shorts: 0x6a3a1e, socks: 0xffffff },
    { shirt: 0x9a4aff, shorts: 0x1e1a3a, socks: 0xffffff },
    { shirt: 0xff4a5a, shorts: 0x14141e, socks: 0xffffff },
    { shirt: 0xffffff, shorts: 0x3a3a5a, socks: 0xff6ac8 },
];
export const SKINS = [0xe1af87, 0xc88c5f, 0x8c5a3c, 0x5f3c28, 0xf0c8a0];

// Every multiplier on earned Speed, as the HUD lists them
export function multipliers(p, now, friends, onTread) {
    const ev = eventState(now);
    const item = itemById[p.item];
    const trail = trailById[p.trail];
    return {
        global: ev.on ? CFG.event.speed : 1,
        pass: (p.pass2x ? 2 : 1) * ((now || Date.now()) < (p.boostUntil || 0) ? CFG.boostMult : 1),
        items: item ? item.mult : 1,
        trail: trail ? trail.mult : 1,
        rebirth: rebirthMult(p.rebirths),
        friends: 1 + CFG.friendBoost * Math.min(CFG.friendMax, friends || 0),
        tread: onTread || 1,
    };
}
export function speedMult(p, now, friends) {
    const m = multipliers(p, now, friends);
    return m.global * m.pass * m.items * m.trail * m.rebirth * m.friends;
}
// Speed per step before multipliers: 1 + the shoes' "+N Steps"
export const stepBase = (p) => 1 + ((shoeById[p.shoe] || {}).bonus || 0);

const SUF = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
// 2700 -> "2.7K", 1000000 -> "1M", 950 -> "950"
export function fmt(v) {
    v = Math.floor(v || 0);
    if (v < 1000) return String(v);
    let i = -1, s = v;
    while (s >= 1000 && i < SUF.length - 1) { s /= 1000; i++; }
    const t = s >= 100 ? String(Math.floor(s)) : (Math.floor(s * 10) / 10).toFixed(1).replace(/\.0$/, '');
    return t + SUF[i];
}
// XP style: 57.5, 1,234.5 -> "1.2K"
export function fmt1(v) {
    v = v || 0;
    if (v >= 1000) return fmt(v);
    return (Math.floor(v * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
}
// "Total Speed: 1.05k" (the reference uses a lowercase k)
export function fmtK(v) {
    v = Math.floor(v || 0);
    if (v < 1000) return String(v);
    return fmt(v).replace(/K$/, 'k');
}
export function clock(s) {
    s = Math.max(0, Math.floor(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
    return h ? h + ':' + String(m).padStart(2, '0') + ':' + sec : m + ':' + sec;
}
// "00:20:33" (the reference's Event timer)
export function clock3(s) {
    s = Math.max(0, Math.floor(s));
    const p = (n) => String(n).padStart(2, '0');
    return p(Math.floor(s / 3600)) + ':' + p(Math.floor((s % 3600) / 60)) + ':' + p(s % 60);
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function rngFrom(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
