import { Client } from '@colyseus/sdk';
import {
    T, V3, $, canvas, scene, camera, sun, renderer, solids, kills, triggers, prompts, tickers,
    billboard, buildRig, animRig, airPose, burst, confettiAt, floatText, updateEffects, lerpAngle, updateSky, FOG,
} from './engine.js';
import { S, actions, net } from './state.js';
import { initAudio, resumeAudio, audioDebug, startMusic, sfx, setVolume, resetFlips, setMusicIntensity, audioSuspended } from './audio.js';
import * as BX from './bloxity.js';
import { createAvatar, loadBase, packAvatar, unpackAvatar, avatarStats } from './avatar.js';
import { updateMaterials } from './textures.js';
import { pad, pollGamepad, rumble, onGamepadConnection } from './gamepad.js';
import { render, setSpeedLines, updateFx, dust, sparkleColumn, ring, fireworks, setQuality, flipBurst, shoeFx, makeTrail, flame, updateAmbient } from './fx.js';
import {
    buildWorld, SPAWN, refreshShop, renderBoards, updateLobbySigns, updateWorld, cullZones, checkpoints, windAt, treadOwned, stageStart,
} from './world.js';
import { buildItem } from './candy.js';
import { redrawAtlas, keyAt, pressKey, updatePressed } from './keys.js';
import {
    updateHud, toast, levelUp, showStageTitle, showGoal, showOof, animateCounters, showOffline, openDailyOnJoin, refreshModal,
    closeModal, openModal, promptEl, promptTxtEl, jumpCounter, buyShoe, buyTread, codeResult, showTradeAsk, showTrade, tradeDone,
    showTeleBack, hideTeleBack, questDone, modalOpen,
} from './ui.js';
import {
    CFG, STAGES, SUMMIT, TREADMILLS, TREAD_GEO, trailById, itemById, shoeById, KITS, SKINS,
    maxSpeedFor, jumpsFor, stageAt, fmt, clamp,
} from '../../shared/config.js';

// =====================================================================================
// Local player
// =====================================================================================
const HW = 1, PH = 5, STEP = 1.7, GRAV = CFG.grav, JUMP_V = CFG.jumpV, PIVOT = 2.6;
const P = {
    pos: SPAWN.clone(), vel: new V3(), hv: new V3(), onGround: false, ground: null, facing: 0,
    dead: false, deadT: 0, shield: 0, stage: -1, moving: false, animPhase: 0, lockToastT: -9,
    jumpsLeft: 1, coyote: 0, lastFlip: -9, jumpPress: -9, jumpHeld: false, flips: 0,
    flipAngle: 0, flipTarget: 0, airTime: 0, lastStep: 0, squash: 1, squashV: 0,
    cp: { stage: -1, k: 0 }, padLock: false, lastClick: 0,
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let shake = 0;
function addShake(a) { if (!reduceMotion) shake = Math.min(1.2, shake + a); }
let rig = null, headLabel, nameLabelText = '';

// ----- a character: rig (feet, yaw) -> pivot (hips, backflip spin) -> body (blocky or Bloxity) -----
function buildCharacter(kit, skin) {
    const g = new T.Group();
    const pivot = new T.Group(); pivot.position.y = PIVOT; g.add(pivot);
    const k = KITS[kit % KITS.length];
    const body = buildRig({ ...k, skin: SKINS[skin % SKINS.length], hair: 0x3a2618 });
    body.position.y = -PIVOT;
    pivot.add(body);
    g.userData = { pivot, body, flipAngle: 0, flipTarget: 0, item: null, itemId: '', shoeId: '', trail: null, trailId: '' };
    return g;
}
// Wings / halos follow the body through every flip
function setItem(g, id) {
    const u = g.userData;
    if (u.itemId === (id || '')) return;
    if (u.item) { u.item.group.parent && u.item.group.parent.remove(u.item.group); u.item = null; }
    u.itemId = id || '';
    const d = itemById[id];
    if (!d) return;
    const it = buildItem(d);
    if (it.anchor === 'head') it.group.position.set(0, 5.95, 0); else it.group.position.set(0, 3.5, -0.62);
    it.base = it.group.position.y;
    u.body.add(it.group);
    u.item = it;
}
// Blocky shoes take the colour of the equipped pair
function setShoe(g, id) {
    const u = g.userData;
    if (u.shoeId === (id || '')) return;
    u.shoeId = id || '';
    const d = shoeById[id];
    const shoes = u.body.userData.shoes || [];
    for (const s of shoes) s.material = new T.MeshStandardMaterial({ color: d ? d.color : 0x141418, roughness: 0.35, emissive: d && d.glow ? d.glow : 0x000000, emissiveIntensity: d && d.glow ? 0.35 : 0 });
}
function setTrail(g, id) {
    const u = g.userData;
    const d = trailById[id] || trailById.starter;
    if (!u.trail) u.trail = makeTrail(d.color);
    if (u.trailId !== d.id) {
        u.trailId = d.id;
        u.trail.setColor(d.color, d.rainbow);
        u.trail.width = 0.7 + Math.min(1.1, (d.mult - 1) * 0.15);
    }
}
// Spin toward the target angle; each backflip adds a full turn (negative = backwards)
function animateFlip(g, dt, onGround) {
    const u = g.userData;
    const diff = u.flipTarget - u.flipAngle;
    if (Math.abs(diff) < 0.01) { u.flipAngle = u.flipTarget = 0; }
    else {
        const speed = Math.max(Math.PI * 2 / 0.38, Math.abs(diff) * (onGround ? 14 : 6));
        u.flipAngle += Math.sign(diff) * Math.min(Math.abs(diff), speed * dt);
    }
    u.pivot.rotation.x = u.flipAngle;
    return Math.abs(diff) > 0.4;
}

// ----- Bloxity avatars: replace the blocky body's meshes, keep the pivot, items and labels -----
function dressRig(group, avatar) {
    const body = group.userData.body;
    body.children.forEach((c) => { if (!(group.userData.item && c === group.userData.item.group)) c.visible = false; });
    body.add(avatar.root);
    group.userData.blox = avatar;
}
let localAvatar = null, localAvatarReq = 0;
async function setupLocalAvatar() {
    const req = ++localAvatarReq;
    const a = await createAvatar(BX.currentAvatar(), BX.getSkinTextureUrl());
    if (!a) return;
    if (req !== localAvatarReq || !rig) { a.dispose(); return; }
    if (localAvatar) localAvatar.dispose();
    localAvatar = a;
    dressRig(rig, a);
}
function syncMyAvatar() {
    const av = BX.currentAvatar();
    if (localAvatar && av) { localAvatar.setProportions(av.proportions); localAvatar.setEquipped(av, BX.getSkinTextureUrl()); }
    net.send('avatar', { av: packAvatar(av) });
}
async function playEmoteOn(avatar, id) {
    if (!avatar) return;
    const cat = await BX.loadEmotes();
    const e = cat.get(id);
    if (e && e.clip) avatar.playEmote(e.clip);
}
function chatBubble(group, text) {
    if (!group) return;
    if (group.userData.bubble) { group.remove(group.userData.bubble); group.userData.bubble.material.map.dispose(); }
    const b = billboard([{ t: '💬 ' + text, c: '#ffffff', s: '#1c1030', px: 44 }], 9, 1024, new V3(0, 9.4, 0), group);
    group.userData.bubble = b;
    setTimeout(() => { if (group.userData.bubble === b) { group.remove(b); b.material.map.dispose(); group.userData.bubble = null; } }, 5000);
}

function buildPlayer(kit, skin) {
    if (rig) { scene.remove(rig); if (rig.userData.trail) rig.userData.trail.dispose(); }
    rig = buildCharacter(kit, skin);
    scene.add(rig);
    nameLabelText = '';
    headLabel = billboard([{ t: S.name || ' ', c: '#ffffff', s: '#1c1030', px: 60 }], 6.5, 512, new V3(0, 7.6, 0), rig);
    headLabel.material.depthTest = false; headLabel.renderOrder = 10;
    rig.position.copy(P.pos);
    localAvatar = null;
    setupLocalAvatar();
}

// ----- collision against the solids near the player -----
let near = solids, nearKills = kills, nearTriggers = triggers, nearZoneKey = '';
function refreshNear(stage) {
    const zs = new Set([stage - 1, stage, stage + 1]);
    if (stage <= 1) zs.add(-1);
    const key = [...zs].join(',');
    if (key === nearZoneKey) return;
    nearZoneKey = key;
    const ok = (o) => o.zone === undefined || zs.has(o.zone);
    near = solids.filter(ok); nearKills = kills.filter(ok); nearTriggers = triggers.filter(ok);
    cullZones(stage);
}
const overlaps = (c, x, y, z) => !c.off && c.max.x > x - HW && c.min.x < x + HW && c.max.y > y && c.min.y < y + PH && c.max.z > z - HW && c.min.z < z + HW;
function freeAt(x, y, z) {
    for (const c of near) if (overlaps(c, x, y, z)) return false;
    return true;
}
function moveAxis(axis, d) {
    if (d === 0) return;
    const p = P.pos;
    p[axis] += d;
    for (const c of near) {
        if (!overlaps(c, p.x, p.y, p.z)) continue;
        if (axis === 'y') {
            if (d < 0) { p.y = c.max.y; P.vel.y = Math.max(0, P.vel.y); P.onGround = true; P.ground = c; }
            else { p.y = c.min.y - PH - 1e-4; if (P.vel.y > 0) P.vel.y = 0; }
        } else {
            const rise = c.max.y - p.y;
            if (rise > 0 && rise <= STEP && (P.onGround || P.vel.y <= 0) && freeAt(p.x, c.max.y + 0.01, p.z)) { p.y = c.max.y + 0.001; continue; }
            if (d > 0) p[axis] = c.min[axis] - HW - 1e-4; else p[axis] = c.max[axis] + HW + 1e-4;
        }
    }
}
// Moving platforms that moved into the player lift them out (or push them aside)
function depenetrate() {
    const p = P.pos;
    for (const c of near) {
        if (!c.mover || !overlaps(c, p.x, p.y, p.z)) continue;
        if (p.y >= c.max.y - 1.4) { p.y = c.max.y + 0.001; P.vel.y = Math.max(0, P.vel.y); P.onGround = true; P.ground = c; continue; }
        const dxp = c.max.x - (p.x - HW), dxn = (p.x + HW) - c.min.x, dzp = c.max.z - (p.z - HW), dzn = (p.z + HW) - c.min.z;
        const m = Math.min(dxp, dxn, dzp, dzn);
        if (m === dxp) p.x += dxp; else if (m === dxn) p.x -= dxn; else if (m === dzp) p.z += dzp; else p.z -= dzn;
    }
}
function walkSpeed() {
    const max = maxSpeedFor(S.level, S.rebirths);
    const s = S.customSpeed > 0 && S.customSpeed <= max ? S.customSpeed : max;
    return qaWalk || s;
}
const maxJumps = () => qaJumps || jumpsFor(S.level, S.rebirths);

function teleport(pos, yaw) {
    P.pos.copy(pos); P.vel.set(0, 0, 0); P.hv.set(0, 0, 0);
    P.facing = yaw || 0; cam.yaw = (yaw || 0) + Math.PI;
    P.stage = stageAt(pos.x, pos.y, pos.z);
    refreshNear(P.stage);
    for (const t of nearTriggers) t.inside = overlapsBox(t, pos);
    rig && (rig.userData.flipAngle = rig.userData.flipTarget = 0);
    sendMove(true);
}
const overlapsBox = (t, p) => t.max.x > p.x - HW && t.min.x < p.x + HW && t.max.y > p.y && t.min.y < p.y + PH && t.max.z > p.z - HW && t.min.z < p.z + HW;
function teleportLobby() { P.cp = { stage: -1, k: 0 }; P.padLock = false; teleport(SPAWN, 0); }

// =====================================================================================
// Dying, checkpoints, pads, teleports
// =====================================================================================
let deaths = 0;
function die(cause) {
    if (P.dead || P.shield > 0) return;
    P.dead = true; P.deadT = CFG.respawnDelay; deaths++;
    burst(P.pos.clone().add(new V3(0, 2.5, 0)), 0xff5ab8);
    sfx('death'); addShake(0.8); rumble(1, 350); showOof();
    if (cause === 'laser') sfx('zap'); else if (cause === 'crusher') sfx('crush');
    sendMove(true);
    net.send('died', { s: Math.max(P.stage, -1), c: cause || 'fall' });
}
function respawn() {
    P.dead = false;
    const cp = P.cp.stage >= 0 && checkpoints[P.cp.stage] && checkpoints[P.cp.stage][P.cp.k];
    if (cp) teleport(cp.clone(), 0); else teleport(SPAWN, 0);
    P.shield = CFG.shieldTime;
    sfx('teleport');
}
actions.checkpoint = (stage, k) => {
    if (P.dead) return;
    if (stage > P.cp.stage || (stage === P.cp.stage && k > P.cp.k)) {
        P.cp = { stage, k };
        if (k > 0 || stage > 0) { toast('🚩 Checkpoint!', '#7dff6b'); sfx('checkpoint'); }
    }
};
// Wins pad on the wall: tell the server (it checks your jumps and position), then home you go
actions.pad = (s, k) => {
    if (P.dead || P.padLock) return;
    const pad = STAGES[s].pads[k];
    if (maxJumps() < pad.req - 1) { toast('You need ' + pad.req + ' jumps for this pad! Level up!', '#ff5a5a'); return; }
    P.padLock = true;
    sendMove(true);
    net.send('pad', { s, k });
    lastPadStage = s;
    setTimeout(() => { teleportLobby(); showTeleBack(s); }, 650);
};
actions.summit = () => {
    if (P.dead || P.padLock) return;
    P.padLock = true;
    sendMove(true);
    net.send('summit');
    lastPadStage = STAGES.length - 1;
    setTimeout(() => { teleportLobby(); showTeleBack(STAGES.length - 1); }, 1800);
};
let lastPadStage = 0;
actions.teleportStage = (i) => {
    if (i > (S.maxStage || 0)) { toast('Reach ' + STAGES[i].name + ' first!', '#ff5a5a'); return; }
    hideTeleBack(); stopTraining();
    const st = stageStart(i);
    P.cp = { stage: i, k: 0 };
    P.padLock = false;
    teleport(st.pos, st.yaw);
    showStageTitle(STAGES[i]);
    sfx('teleport');
};
actions.teleportLobby = () => { stopTraining(); teleportLobby(); sfx('teleport'); };
actions.teleportSpot = (spot) => {
    stopTraining();
    if (spot === 'treads') teleport(new V3(53, 1.3, -48), Math.PI);
    else teleport(new V3(-22, 0.5, -60), -Math.PI / 2);
    P.cp = { stage: -1, k: 0 };
    sfx('teleport');
};

// ----- Auto Train: stand on your best treadmill and keep running while AFK -----
let training = false;
function stopTraining() { if (training) { training = false; $('#btnTreadmill').classList.remove('on'); } }
function trainOn(def) {
    const i = TREADMILLS.indexOf(def);
    if (i < 0) return;
    if (P.dead) respawn();
    teleport(new V3(TREAD_GEO.x0 + i * TREAD_GEO.step, TREAD_GEO.top + 0.6, TREAD_GEO.z - 1), 0);
    P.cp = { stage: -1, k: 0 };
    training = true;
    $('#btnTreadmill').classList.add('on');
    toast('Auto Train ON - x' + def.mult + ' treadmill (move to stop)', '#ffb04a');
}
actions.trainOn = trainOn;
actions.autoTrain = () => {
    if (!running) return;
    if (training) { stopTraining(); toast('Auto Train OFF', '#ffb04a'); return; }
    let best = null;
    for (const d of TREADMILLS) if (treadOwned(d) && (!best || d.mult > best.mult)) best = d;
    trainOn(best || TREADMILLS[0]);
};
// ----- lobby shops -----
actions.shoe = (d) => buyShoe(d);
actions.treadBuy = (d) => { if (P.lockToastT + 2 < clockT) { P.lockToastT = clockT; if (d.daily) toast('The Aqua Treadmill is the Day 7 daily reward!', '#2ae6ff'); else buyTread(d); } };
actions.trail = (d) => net.send('trail', { id: d.id });
actions.openShop = (tab) => openModal('shop', tab);
actions.openGift = () => openModal('gift');
actions.openCodes = () => openModal('codes');
actions.chest = () => net.send('chest');
actions.portal = () => toast('🌀 World 2 is coming soon!', '#ff8ad8');

// =====================================================================================
// Friend Boost
// =====================================================================================
let friendNames = [], friendsT = 3, friendSyncT = 5;
async function refreshFriends() {
    if (!BX.bloxity.ready || !BX.identity().loggedIn) return;
    const list = await BX.getFriends();
    friendNames = list.map((f) => f.displayName || f.username).filter(Boolean);
    syncFriends();
}
function syncFriends() {
    const room = net.room;
    if (!room || !room.state || !room.state.players || !friendNames.length) return;
    const here = [];
    room.state.players.forEach((p, id) => { if (id !== room.sessionId && friendNames.includes(p.name)) here.push(p.name); });
    net.send('friends', { names: here });
}

// =====================================================================================
// Other players
// =====================================================================================
const remotes = new Map();
let joinSynced = false;
class Remote {
    constructor(p) {
        this.rig = buildCharacter(p.kit, p.skin);
        this.rig.position.set(p.x, p.y, p.z);
        this.rig.rotation.y = p.ry;
        scene.add(this.rig);
        this.label = billboard([{ t: p.name, c: '#ffffff', s: '#1c1030', px: 56 }], 6, 512, new V3(0, 7.6, 0), this.rig);
        this.labelText = p.name;
        this.flips = p.flips; this.av = null; this.blox = null; this.dead = false; this.phase = 0; this.vel = 0;
        this.lastX = p.x; this.lastZ = p.z;
        this.setAvatar(p.av);
    }
    setAvatar(av) {
        this.av = av;
        const data = av ? unpackAvatar(av) : null;
        if (this.blox) { this.blox.setProportions(data && data.proportions); this.blox.setEquipped(data || {}); return; }
        if (this.loading) return;
        this.loading = true;
        createAvatar(data).then((a) => {
            this.loading = false;
            if (!a) return;
            if (this.dead) { a.dispose(); return; }
            this.blox = a;
            dressRig(this.rig, a);
            if (this.av !== av) this.setAvatar(this.av);
        });
    }
    update(p, dt, t) {
        const r = this.rig, u = r.userData;
        const k = 1 - Math.exp(-dt * 12);
        if ((r.position.x - p.x) ** 2 + (r.position.z - p.z) ** 2 + (r.position.y - p.y) ** 2 > 900) r.position.set(p.x, p.y, p.z);
        else { r.position.x += (p.x - r.position.x) * k; r.position.y += (p.y - r.position.y) * k; r.position.z += (p.z - r.position.z) * k; }
        r.rotation.y = lerpAngle(r.rotation.y, p.ry, k);
        r.visible = p.anim !== 3;
        if (p.av !== this.av) this.setAvatar(p.av);
        // Each new backflip they did: one more spin
        const df = (p.flips - this.flips + 256) % 256;
        if (df > 0 && df < 20) { u.flipTarget -= Math.PI * 2 * Math.min(3, df); }
        this.flips = p.flips;
        const air = p.anim === 2;
        const spinning = animateFlip(r, dt, !air);
        const moved = Math.hypot(r.position.x - this.lastX, r.position.z - this.lastZ);
        this.vel += ((dt > 0 ? moved / dt : 0) - this.vel) * Math.min(1, dt * 6);
        this.lastX = r.position.x; this.lastZ = r.position.z;
        const moving = p.anim === 1 && this.vel > 1;
        this.phase += dt * (moving ? Math.min(18, 4 + this.vel * 0.2) : 0);
        if (air) airPose(u.body, spinning ? 1 : 0); else if (moving) animRig(u.body, this.phase, 0.85); else animRig(u.body, 0, 0);
        if (this.blox) this.blox.update(dt, { moving, air, speed: this.vel, t });
        setItem(r, p.item); setShoe(r, p.shoe); setTrail(r, p.trail);
        if (u.item) u.item.update(t, air);
        u.trail.update(trailAt(r), (moving || air) && r.visible, dt, t);
        if (p.name !== this.labelText) { this.labelText = p.name; this.label.userData.set([{ t: p.name, c: '#ffffff', s: '#1c1030', px: 56 }]); }
    }
    dispose() {
        this.dead = true;
        if (this.blox) this.blox.dispose();
        if (this.rig.userData.trail) this.rig.userData.trail.dispose();
        scene.remove(this.rig);
    }
}
const trailTmp = new V3();
function trailAt(r) { return trailTmp.set(r.position.x - Math.sin(r.rotation.y) * 0.9, r.position.y + 2.6, r.position.z - Math.cos(r.rotation.y) * 0.9); }

// "+N" with a blue shoe pops up beside the player every time Speed goes up, like the reference
let speedSeen = false, popT = 0, popAcc = 0;
function popGain(n) {
    popAcc += n;
    if (clockT - popT < 0.3 && n < 1000) return;
    popT = clockT;
    const side = new V3(-Math.cos(P.facing) * 3.2, 5.2 + Math.random() * 1.5, Math.sin(P.facing) * 3.2);
    floatText('👟+' + fmt(popAcc), '#3aa8ff', P.pos.clone().add(side), 4.2);
    popAcc = 0;
    sfx('gain');
}
function syncRemotes(dt, t) {
    const room = net.room;
    if (!room || !room.state || !room.state.players) return 1;
    const seen = new Set();
    room.state.players.forEach((p, id) => {
        if (id === room.sessionId) {
            const oldLevel = S.level;
            if (speedSeen && p.speed > S.speed) popGain(p.speed - S.speed);
            speedSeen = true;
            S.name = p.name; S.speed = p.speed; S.wins = p.wins; S.level = p.level; S.xp = p.xp; S.rebirths = p.rebirths; S.friends = p.friends;
            if (!rig || rig.userData.kit !== p.kit) { buildPlayer(p.kit, p.skin); rig.userData.kit = p.kit; }
            if (oldLevel !== S.level) refreshModal();
            return;
        }
        seen.add(id);
        let r = remotes.get(id);
        if (!r) {
            r = new Remote(p); remotes.set(id, r);
            if (joinSynced) BX.playerJoined(p.name); else BX.playerInRoom(p.name);
        }
        r.update(p, dt, t);
    });
    for (const [id, r] of remotes) if (!seen.has(id)) { r.dispose(); remotes.delete(id); }
    joinSynced = true;
    return room.state.players.size;
}

// =====================================================================================
// Networking
// =====================================================================================
const BLOXITY_GAME_ID = import.meta.env.VITE_BLOXITY_GAME_ID || '';
const ON_BLOXITY_HOST = /\.play\.bloxity\.io$/.test(location.hostname);
const DEV_CHANNEL = /\.dev\.play\.bloxity\.io$/.test(location.hostname);
const SERVER_URL = import.meta.env.VITE_SERVER_URL
    || (ON_BLOXITY_HOST ? `https://${location.hostname.replace(/\.play\.bloxity\.io$/, '.host.bloxity.io')}`
        : BLOXITY_GAME_ID ? `https://${BLOXITY_GAME_ID}.host.bloxity.io`
        : import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2595` : location.origin);
async function serverEndpoint() {
    let url = SERVER_URL;
    if (BLOXITY_GAME_ID) {
        const r = await BX.resolveEndpoint(BLOXITY_GAME_ID, DEV_CHANNEL ? 'preview' : undefined);
        if (r && r.cold) $('#loading').textContent = 'Waking up a server…';
        url = (r && r.endpoint) || SERVER_URL;
    }
    if (!/^https?:/i.test(url)) return url;
    if (!(await serverUp(url))) {
        $('#loading').textContent = 'Waking up a server…';
        const until = Date.now() + 60000;
        while (Date.now() < until) {
            await new Promise((res) => setTimeout(res, 2000));
            if (await serverUp(url)) break;
        }
    }
    return url;
}
async function serverUp(url) {
    try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 4000);
        const r = await fetch(url.replace(/\/$/, '') + '/health', { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t);
        return r.ok;
    } catch (e) { return false; }
}
let lastMoveSent = 0, lastMoveKey = '';
function sendMove(force) {
    const now = performance.now();
    if (!force && now - lastMoveSent < 66) return;
    const a = P.dead ? 3 : !P.onGround ? 2 : P.moving ? 1 : 0;
    const m = { x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2), ry: +P.facing.toFixed(3), a, mv: P.moving ? 1 : 0, f: P.flips & 255 };
    const key = m.x + ',' + m.y + ',' + m.z + ',' + m.ry + ',' + a + ',' + m.mv + ',' + m.f;
    if (!force && key === lastMoveKey && now - lastMoveSent < 500) return;
    lastMoveKey = key; lastMoveSent = now;
    net.send('move', m);
}

function storageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
function playerUid() {
    let uid = storageGet('bke_uid');
    if (!uid) {
        uid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
        storageSet('bke_uid', uid);
    }
    return uid;
}

async function connect(name) {
    const client = new Client(await serverEndpoint());
    const id = BX.identity();
    const room = await client.joinOrCreate('keyboard', {
        uid: playerUid(), name: name || id.name, token: id.token, av: packAvatar(BX.currentAvatar()),
        save: storageGet('bke_save') || '',
    });
    net.room = room;
    joinSynced = false;
    room.onMessage('hello', (m) => { net.offset = m.now - Date.now(); net.bloxity = !!m.bloxity; });
    room.onMessage('authed', () => { net.bloxity = true; });
    room.onMessage('emote', (m) => { const r = remotes.get(m.s); if (r) playEmoteOn(r.blox, m.id); });
    room.onMessage('chat', (m) => {
        toast(m.name + ': ' + m.text, '#ffffff');
        chatBubble(m.s === room.sessionId ? rig : remotes.get(m.s) && remotes.get(m.s).rig, m.text);
    });
    BX.updateRoom(room.roomId);
    BX.gameplayStart();
    room.onMessage('profile', (m) => {
        if (m.save) storageSet('bke_save', m.save);
        delete m.save;
        Object.assign(S, m);
        refreshShop(); refreshModal();
        openDailyOnJoin();
    });
    room.onMessage('toast', (m) => toast(m.text, m.color));
    room.onMessage('offline', (m) => showOffline(m));
    room.onMessage('levelUp', (m) => {
        levelUp(m);
        sfx('levelUp'); rumble(0.3, 150);
        ring(P.pos, 0x5ae0ff, 10, 0.8);
        sparkleColumn(P.pos, 0x7dff6b);
    });
    room.onMessage('gain', (m) => { if (m.pack) { floatText('+' + fmt(m.n) + ' Speed', '#7dff6b', P.pos.clone().add(new V3(0, 6, 0))); sfx('buy'); } });
    room.onMessage('wins', (m) => {
        refreshShop();
        showGoal(m.n, m.escape);
        sfx('cheer'); rumble(0.7, 500);
        confettiAt(P.pos.clone().add(new V3(0, 4, 0)));
        fireworks(P.pos, m.escape ? 14 : 6, () => sfx('firework'));
    });
    room.onMessage('reached', (m) => {
        const s = STAGES[m.s];
        if (s) toast('🔓 ' + s.name + ' unlocked! (Teleport menu)', '#ffd028');
    });
    room.onMessage('quest', (m) => questDone(m));
    room.onMessage('codeResult', (m) => codeResult(m));
    room.onMessage('tradeAsk', (m) => showTradeAsk(m));
    room.onMessage('trade', (m) => showTrade(m));
    room.onMessage('tradeDone', () => tradeDone());
    room.onMessage('announce', (m) => toast(m.text, m.color));
    room.onMessage('event', (m) => {
        if (m.on) { toast('🍭 SUGAR RUSH! x2 Speed & x2 Wins for 5 minutes!', '#ff8ad8'); sfx('gate'); fireworks(P.pos, 5, () => sfx('firework')); }
        else toast('Sugar Rush is over. Next one in 25 minutes!', '#ffffff');
    });
    room.onMessage('fx', (m) => {
        confettiAt(P.pos.clone().add(new V3(0, 4, 0)));
        sparkleColumn(P.pos, m.kind === 'rebirth' ? 0x5ae0ff : 0xffd028);
        sfx('buy');
        if (m.kind === 'rebirth') { fireworks(P.pos, 8, () => sfx('firework')); ring(P.pos, 0xff8ad8, 14, 1); }
    });
    room.onMessage('boards', renderBoards);
    room.onLeave((code, reason) => {
        console.warn('[net] left room', code, reason || '');
        net.room = null;
        if (code !== 1000) $('#offline').hidden = false;
    });
    return room;
}

// =====================================================================================
// Camera & input
// =====================================================================================
const cam = { yaw: Math.PI, pitch: 0.36, dist: 24, target: new V3() };
let camSens = 1;
const keys = {};
const touchMove = { x: 0, y: 0 };
let touchJump = false, running = false;

function pressJump() { P.jumpPress = clockT; }
addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) { if (e.key === 'Enter') e.target.blur(); return; }
    if (e.code === 'Space' && !e.repeat && running) pressJump();
    keys[e.code] = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.code === 'KeyE' && running) usePrompt();
    if (e.code === 'Escape') {
        for (const id of ['#confirm', '#daily', '#offlinePop', '#tradeAsk']) if (!$(id).hidden) { $(id).hidden = true; return; }
        if (modalOpen()) closeModal();
        else if (running && BX.isEmbedded()) BX.showPortalMenu();
    }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const drags = new Map();
canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); drags.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.focus(); });
canvas.addEventListener('pointermove', (e) => {
    const d = drags.get(e.pointerId);
    if (!d) return;
    const k = (e.pointerType === 'touch' ? 0.008 : 0.005) * camSens;
    cam.yaw -= (e.clientX - d.x) * k;
    cam.pitch = clamp(cam.pitch + (e.clientY - d.y) * k, -0.6, 1.35);
    d.x = e.clientX; d.y = e.clientY;
});
const endDrag = (e) => drags.delete(e.pointerId);
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => { cam.dist = clamp(cam.dist + Math.sign(e.deltaY) * 2.5, 8, 60); e.preventDefault(); }, { passive: false });

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
(function joystick() {
    const stick = $('#stick'), knob = $('#knob');
    let id = null;
    const set = (e) => {
        const r = stick.getBoundingClientRect();
        let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        const max = r.width / 2, l = Math.hypot(dx, dy);
        if (l > max) { dx *= max / l; dy *= max / l; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        touchMove.x = dx / max; touchMove.y = dy / max;
    };
    stick.addEventListener('pointerdown', (e) => { id = e.pointerId; stick.setPointerCapture(id); set(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; touchMove.x = touchMove.y = 0; };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
    const jb = $('#jumpBtn');
    jb.addEventListener('pointerdown', (e) => { e.preventDefault(); touchJump = true; pressJump(); });
    jb.addEventListener('pointerup', () => { touchJump = false; });
    jb.addEventListener('pointercancel', () => { touchJump = false; });
})();

function rayHit(o, d, maxT) {
    let best = maxT;
    for (const c of near) {
        if (c.off || c.mover) continue;
        let t0 = 0, t1 = best, hit = true;
        for (const a of ['x', 'y', 'z']) {
            if (Math.abs(d[a]) < 1e-9) { if (o[a] < c.min[a] || o[a] > c.max[a]) { hit = false; break; } continue; }
            let ta = (c.min[a] - o[a]) / d[a], tb = (c.max[a] - o[a]) / d[a];
            if (ta > tb) { const q = ta; ta = tb; tb = q; }
            t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
            if (t0 > t1) { hit = false; break; }
        }
        if (hit && t0 > 0 && t0 < best) best = t0;
    }
    return best;
}
const camDir = new V3(), camGoal = new V3(), camPos = new V3(), lookTmp = new V3();
const ATTRACT_LOOK = new V3(0, 10, 30);
let intro = null, baseFov = camera.fov;
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const skyTint = new T.Color(FOG), tintTmp = new T.Color();
function updateCamera(dt) {
    const t = performance.now() / 1000;
    if (!running) {
        camera.position.set(Math.sin(t * 0.08) * 50, 24, Math.cos(t * 0.08) * 40 - 10);
        camera.lookAt(ATTRACT_LOOK);
        baseFov = camera.fov;
        updateSky(camera.position, t, tintTmp.set(FOG), dt);
        return;
    }
    cam.target.lerp(camGoal.set(P.pos.x, P.pos.y + 5.5, P.pos.z), 1 - Math.exp(-dt * 16));
    const cp = Math.cos(cam.pitch);
    camDir.set(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);
    const dist = Math.max(3, rayHit(cam.target, camDir, cam.dist) - 0.8);
    camPos.copy(cam.target).addScaledVector(camDir, dist);
    if (intro) {
        intro.t += dt;
        const k = ease(Math.min(1, intro.t / intro.dur));
        camera.position.lerpVectors(intro.from, camPos, k);
        camera.lookAt(lookTmp.lerpVectors(ATTRACT_LOOK, cam.target, k));
        if (intro.t >= intro.dur) intro = null;
    } else {
        camera.position.copy(camPos);
        camera.lookAt(cam.target);
    }
    if (shake > 0.001) {
        const s = shake * shake * 0.9;
        camera.position.x += (Math.random() * 2 - 1) * s;
        camera.position.y += (Math.random() * 2 - 1) * s;
        shake = Math.max(0, shake - dt * 2.2);
    }
    const fovBase = innerWidth < innerHeight ? 85 : 70;
    const speedKick = P.moving ? Math.min(8, Math.max(0, walkSpeed() - 40) * 0.06) : 0;
    const want = fovBase + speedKick + (!P.onGround && P.vel.y > 30 ? 3 : 0);
    baseFov += (want - baseFov) * Math.min(1, dt * 5);
    if (Math.abs(camera.fov - baseFov) > 0.01) { camera.fov = baseFov; camera.updateProjectionMatrix(); }
    sun.position.set(P.pos.x + 40, P.pos.y + 90, P.pos.z - 80);
    sun.target.position.copy(P.pos);
    const s = STAGES[P.stage];
    skyTint.set(s ? s.theme.sky : FOG);
    updateSky(camera.position, t, skyTint, dt);
    updateAmbient(camera.position, t, s ? s.theme.accent : 0xff8ad8);
}

// Proximity prompts
let activePrompt = null;
const projV = new V3();
function updatePrompt() {
    let best = null, bd = Infinity;
    if (!P.dead) for (const p of prompts) {
        const d = p.pos.distanceTo(P.pos);
        if (d < p.r && d < bd) { bd = d; best = p; }
    }
    activePrompt = best;
    if (!best) { promptEl.hidden = true; return; }
    projV.copy(best.pos).setY(best.pos.y + 2).project(camera);
    if (projV.z > 1) { promptEl.hidden = true; return; }
    promptEl.hidden = false;
    promptEl.style.left = ((projV.x + 1) / 2 * innerWidth) + 'px';
    promptEl.style.top = ((1 - projV.y) / 2 * innerHeight) + 'px';
    const txt = best.label();
    if (promptTxtEl.textContent !== txt) promptTxtEl.textContent = txt;
}
function usePrompt() { if (activePrompt) activePrompt.act(); }
promptEl.addEventListener('click', usePrompt);

// Controller buttons: popups and panels first, then gameplay shortcuts
const shownEl = (sel) => { const e = $(sel); return !!e && !e.hidden; };
function focusStep(container, dir) {
    const items = [...container.querySelectorAll('button:not(:disabled), input[type=range]')];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    const next = items[i < 0 ? 0 : (i + dir + items.length) % items.length];
    next.focus({ preventScroll: false });
    next.scrollIntoView({ block: 'nearest' });
}
let padJumpWas = false;
function padButtons() {
    if (pad.jump && !padJumpWas && running) pressJump();
    padJumpWas = pad.jump;
    const p = pad.pressed;
    if (!p.size) return;
    const overlay = ['#start', '#offline', '#confirm', '#tradeAsk', '#offlinePop', '#daily', '#tradeWin', '#modal'].find(shownEl);
    if (overlay === '#start') { if ((p.has('A') || p.has('START')) && shownEl('#playBtn')) play(); return; }
    if (overlay === '#offline') { if (p.has('A')) $('#reconnectBtn').click(); return; }
    if (overlay === '#confirm') { if (p.has('A')) $('#confirmYes').click(); else if (p.has('B')) $('#confirmNo').click(); return; }
    if (overlay === '#tradeAsk') { if (p.has('A')) $('#tradeAccept').click(); else if (p.has('B')) $('#tradeDecline').click(); return; }
    if (overlay === '#offlinePop') { if (p.has('A') || p.has('B')) $('#offlineOk').click(); return; }
    if (overlay === '#daily') { if (p.has('A') && !$('#dailyClaim').disabled) $('#dailyClaim').click(); else if (p.has('A') || p.has('B')) $('#dailyClose').click(); return; }
    if (overlay === '#modal' || overlay === '#tradeWin') {
        const body = $(overlay);
        const el = document.activeElement;
        if (p.has('DOWN') || p.has('RIGHT')) focusStep(body, 1);
        else if (p.has('UP') || p.has('LEFT')) focusStep(body, -1);
        else if (p.has('A') && el && body.contains(el) && el.tagName === 'BUTTON') el.click();
        else if (p.has('B') || p.has('BACK') || p.has('START')) { if (overlay === '#modal') closeModal(); canvas.focus(); }
        return;
    }
    if (!running) return;
    if (p.has('X')) actions.autoTrain();
    if (p.has('Y')) openModal('shop', 'boosts');
    if (p.has('LB')) openModal('rebirth');
    if (p.has('RB')) openModal('teleport');
    if (p.has('BACK')) openModal('inventory', 'items');
    if (p.has('START')) openModal('settings');
    if (p.has('UP')) cam.dist = clamp(cam.dist - 4, 8, 60);
    if (p.has('DOWN')) cam.dist = clamp(cam.dist + 4, 8, 60);
    if (['Y', 'LB', 'RB', 'BACK', 'START'].some((b) => p.has(b))) focusStep($('#modal'), 1);
}
onGamepadConnection((g, on) => { if (running) toast(on ? '🎮 Controller connected' : '🎮 Controller disconnected', on ? '#7dff6b' : '#ffb51c'); });

// =====================================================================================
// Main update
// =====================================================================================
const botInput = { f: 0, r: 0, jump: false };
let qaWalk = 0, qaJumps = 0;
let clockT = 0, hudT = 0, online = 1, footT = 0;
const tmpF = new V3(), tmpR = new V3(), mv = new V3();

function jumpLogic() {
    const maxJ = maxJumps();
    if (P.onGround) { P.jumpsLeft = maxJ; P.coyote = 0.1; }
    const pressed = clockT - P.jumpPress < 0.22;
    const held = keys.Space || touchJump || pad.jump || botInput.jump;
    if (!(pressed || (held && P.onGround))) return;
    if (P.onGround || P.coyote > 0) {
        P.vel.y = JUMP_V; P.onGround = false; P.coyote = 0; P.jumpPress = -9; P.ground = null;
        sfx('jump'); P.squashV += 5; dust(P.pos, 5, 0.7);
        resetFlips();
        return;
    }
    if (!pressed || P.jumpsLeft <= 0 || clockT - P.lastFlip < CFG.flipGap - 1e-4) return;
    // A backflip: a fresh jump in mid-air
    P.vel.y = JUMP_V; P.jumpsLeft--; P.lastFlip = clockT; P.jumpPress = -9; P.flips++;
    rig.userData.flipTarget -= Math.PI * 2;
    sfx('flip');
    flipBurst(P.pos, (trailById[S.trail] || trailById.starter).color);
    if (S.item === 'jetpack') for (let k = 0; k < 6; k++) flame(P.pos.clone().add(new V3(0, 2.2, 0)), 1, 1.2, new V3(0, -14, 0));
}

function update(dt) {
    clockT += dt;
    const t = clockT;
    let f = botInput.f, r = botInput.r;
    if (keys.KeyW || keys.ArrowUp) f += 1;
    if (keys.KeyS || keys.ArrowDown) f -= 1;
    if (keys.KeyD || keys.ArrowRight) r += 1;
    if (keys.KeyA || keys.ArrowLeft) r -= 1;
    f -= touchMove.y + pad.ly; r += touchMove.x + pad.lx;
    cam.yaw -= pad.rx * 2.8 * dt;
    cam.pitch = clamp(cam.pitch + pad.ry * 1.8 * dt, -0.6, 1.35);
    tmpF.set(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
    tmpR.set(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
    mv.set(0, 0, 0).addScaledVector(tmpF, f).addScaledVector(tmpR, r);
    if (mv.lengthSq() > 1) mv.normalize();
    if (P.dead) mv.set(0, 0, 0);
    if (training && (Math.abs(f) > 0.2 || Math.abs(r) > 0.2)) { stopTraining(); toast('Auto Train OFF', '#ffb04a'); }
    const tread = P.onGround && P.ground && P.ground.tread;
    const trainingNow = training && !P.dead && tread && treadOwned(tread);
    P.moving = mv.lengthSq() > 0.01 || !!trainingNow;

    // Hazards move first, so riders are carried and hits line up
    updateWorld(dt, P.stage);

    if (!P.dead) {
        const ws = walkSpeed();
        // Carried by a moving platform, then pushed out of any that moved into us
        if (P.onGround && P.ground && P.ground.mover) P.pos.add(P.ground.delta);
        depenetrate();
        if (!P.onGround) P.coyote -= dt;
        jumpLogic();
        P.vel.y -= GRAV * dt;
        // Horizontal: instant on keys, slippery on frosting ice
        const tx = mv.x * ws, tz = mv.z * ws;
        const ice = P.ground && P.ground.ice;
        if (ice || (P.onIce && !P.onGround)) {
            const k = 1 - Math.exp(-dt * (P.onGround ? 1.8 : 1.2));
            P.hv.x += (tx - P.hv.x) * k; P.hv.z += (tz - P.hv.z) * k;
        } else P.hv.set(tx, 0, tz);
        if (P.onGround) P.onIce = !!ice;
        let vx = P.hv.x, vz = P.hv.z;
        if (P.onGround && P.ground && P.ground.belt) { vx += P.ground.belt.x; vz += P.ground.belt.z; }
        if (tread) {
            if (trainingNow) { vx = 0; vz = 0; } else vz -= P.hv.z > 0 ? P.hv.z * 0.97 : 4;
        }
        vx += windAt(P.pos);
        const dist = Math.max(Math.abs(vx), Math.abs(vz), Math.abs(P.vel.y)) * dt;
        const n = Math.max(1, Math.ceil(dist / 0.6));
        const sdt = dt / n;
        const wasGround = P.ground;
        P.onGround = false; P.ground = null;
        // Move at the frame's average fall speed so jump arcs come out the same at any frame rate
        // (every backflip gains 5.3+ studs); a floor or ceiling hit stops the vertical move.
        let vy = P.vel.y + 0.5 * GRAV * dt;
        for (let i = 0; i < n; i++) {
            moveAxis('x', vx * sdt);
            moveAxis('z', vz * sdt);
            const before = P.vel.y;
            moveAxis('y', vy * sdt);
            if (P.vel.y !== before) vy = P.vel.y;
        }
        if (!P.onGround && wasGround && P.vel.y <= 0 && P.vel.y > -40 && !wasGround.bounce) {
            const y0 = P.pos.y;
            moveAxis('y', -0.35);
            if (!P.onGround) P.pos.y = y0;
        }
        if (P.onGround) {
            const g = P.ground;
            if (g && g.bounce && P.airTime > 0.05) {
                P.vel.y = g.bounce; P.onGround = false; P.ground = null; P.jumpsLeft = maxJumps();
                if (g.onBounce) g.onBounce();
                sfx('boing'); dust(P.pos, 10, 1.2, 0xc8ff8a); addShake(0.25);
                P.airTime = 0.01;
            } else {
                if (P.airTime > 0.3) {
                    sfx('land');
                    dust(P.pos, P.airTime > 0.8 ? 12 : 6, P.airTime > 0.8 ? 1.4 : 1);
                    P.squashV -= Math.min(9, 3 + P.airTime * 6);
                    if (P.airTime > 1) { ring(P.pos, 0xffffff, 5, 0.45); addShake(0.3); rumble(0.4, 120); }
                }
                P.airTime = 0;
            }
        } else P.airTime += dt;
        if (trainingNow) P.facing = lerpAngle(P.facing, 0, 1 - Math.exp(-dt * 14));
        else if (P.moving && mv.lengthSq() > 0.01) P.facing = lerpAngle(P.facing, Math.atan2(mv.x, mv.z), 1 - Math.exp(-dt * 14));

        if (P.shield > 0) P.shield -= dt;
        // Stage you're in, the void under it, hazards
        const here = stageAt(P.pos.x, P.pos.y, P.pos.z);
        if (here !== P.stage) {
            if (here > P.stage && here >= 0) { showStageTitle(STAGES[here]); sfx('gate'); P.cp = { stage: here, k: 0 }; P.padLock = false; }
            P.stage = here;
            refreshNear(here);
            setMusicIntensity(here >= 7 ? 1 : 0);
        }
        const voidY = here >= 0 ? STAGES[here].y0 - CFG.voidDepth + 3 : -30;
        if (P.pos.y < voidY) { P.shield = 0; die('fall'); }
        if (!P.dead) for (const k of nearKills) {
            if (!k.active) continue;
            if (k.test ? k.test(P.pos) : (k.max.x > P.pos.x - HW + 0.25 && k.min.x < P.pos.x + HW - 0.25 && k.max.y > P.pos.y + 0.1 && k.min.y < P.pos.y + PH - 0.2 && k.max.z > P.pos.z - HW + 0.25 && k.min.z < P.pos.z + HW - 0.25)) { die(k.cause); break; }
        }
        for (const tr of nearTriggers) {
            const inside = overlapsBox(tr, P.pos);
            if (inside && !tr.inside && tr.enter) tr.enter();
            tr.inside = inside;
            if (P.dead) break;
        }
        // Locked treadmill underfoot while walking on it: say so (once in a while)
        if (tread && P.moving && !treadOwned(tread) && t - P.lockToastT > 3) { P.lockToastT = t; actions.treadBuy(tread); }
    } else {
        P.deadT -= dt;
        if (P.deadT <= 0) respawn();
    }

    if (S.name && S.name !== nameLabelText && headLabel) { nameLabelText = S.name; headLabel.userData.set([{ t: S.name, c: '#ffffff', s: '#1c1030', px: 60 }]); }
    updateEffects(dt);
    updateFx(dt);
    updatePressed(dt);
    updateMaterials(dt);
    for (const fn of tickers) fn(dt, t);

    online = syncRemotes(dt, t);
    friendsT -= dt; friendSyncT -= dt;
    if (friendsT <= 0) { friendsT = 30; friendSyncT = 5; refreshFriends(); }
    else if (friendSyncT <= 0) { friendSyncT = 5; syncFriends(); }

    // The local character
    if (rig) {
        const u = rig.userData;
        rig.position.copy(P.pos);
        rig.rotation.y = P.facing;
        const hs = P.moving ? walkSpeed() : 0;
        P.animPhase += dt * (P.onGround ? Math.min(18, 4 + hs * 0.2) : 0);
        const spinning = animateFlip(rig, dt, P.onGround);
        if (!P.onGround) airPose(u.body, spinning ? 1 : 0);
        else if (P.moving) animRig(u.body, P.animPhase, 0.85);
        else animRig(u.body, 0, 0);
        if (localAvatar) localAvatar.update(dt, { moving: P.moving && P.onGround, air: !P.onGround, speed: hs, t });
        setItem(rig, S.item); setShoe(rig, S.shoe); setTrail(rig, S.trail);
        if (u.item) {
            u.item.update(t, !P.onGround);
            if (S.item === 'jetpack' && !P.onGround && P.vel.y > 0 && Math.random() < dt * 30) flame(rig.localToWorld(new V3(0.45 * (Math.random() < 0.5 ? -1 : 1), 2.3, -0.7)), 0.3, 0.8, new V3(0, -10, 0));
        }
        u.trail.update(trailAt(rig), (P.moving || !P.onGround) && !P.dead, dt, t);
        // Shoe sparkles at the feet
        const sd = shoeById[S.shoe];
        footT -= dt;
        if (sd && sd.fx && P.moving && P.onGround && footT <= 0 && !P.dead) { footT = 0.06; shoeFx(P.pos, sd.fx, sd.glow); }
        const stepN = Math.floor(P.animPhase / Math.PI);
        if (P.onGround && P.moving && !P.dead && stepN !== P.lastStep && hs > 40 && stepN % 2 === 0) dust(P.pos, 1, 0.5);
        // Each key you step onto clicks (the keys stay put, so running across them is smooth)
        const under = P.onGround && !P.dead ? keyAt(P.pos.x, P.pos.y, P.pos.z) : null;
        if (pressKey(under) && t - P.lastClick > 0.07) { P.lastClick = t; sfx('step'); }
        P.lastStep = stepN;
        P.squashV += (1 - P.squash) * 180 * dt;
        P.squashV *= Math.exp(-12 * dt);
        P.squash = clamp(P.squash + P.squashV * dt, 0.7, 1.3);
        rig.scale.set(1 / Math.sqrt(P.squash), P.squash, 1 / Math.sqrt(P.squash));
        rig.visible = !P.dead && (P.shield <= 0 || Math.floor(t * 12) % 2 === 0);
        setSpeedLines(!P.dead && P.moving && hs > 70 && !reduceMotion ? 0.5 : 0, dt);
    }
    jumpCounter(P.jumpsLeft, maxJumps(), !P.onGround && !P.dead);

    sendMove(false);
    updatePrompt();
    animateCounters(dt);
    hudT -= dt;
    if (hudT <= 0) { hudT = 0.1; updateHud(); refreshShop(); updateLobbySigns(); }
    void online;
}

// =====================================================================================
// Boot
// =====================================================================================
let lastFrame = 0, loadingSignaled = false, fpsAcc = 0, fpsFrames = 0, showFps = false;
function frame(now) {
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    fpsAcc += (now - (lastFrame || now)) / 1000; fpsFrames++;
    if (fpsAcc >= 0.5) { if (showFps) $('#fps').textContent = Math.round(fpsFrames / fpsAcc) + ' FPS'; fpsAcc = 0; fpsFrames = 0; }
    lastFrame = now;
    if (!loadingSignaled) { loadingSignaled = true; BX.triggerAllSettings(); }
    pollGamepad();
    padButtons();
    if (running) update(dt);
    else { for (const fn of tickers) fn(dt, now / 1000); updateWorld(dt, -1); }
    updateCamera(dt);
    render();
    requestAnimationFrame(frame);
}

// Straight into the game: no menu. Joins with the Bloxity name (or guest name) automatically.
let joining = false;
async function play() {
    if (joining || running) return;
    joining = true;
    const err = $('#connectErr'), retry = $('#playBtn');
    err.hidden = true; retry.hidden = true;
    $('#loading').hidden = false;
    $('#loading').textContent = 'Joining…';
    BX.loadingStep('Joining a server…');
    initAudio();
    try {
        await waitForLogin(1500);
        const saved = (storageGet('bke_name') || '').slice(0, 20);
        let room = null;
        for (let attempt = 0; !room; attempt++) {
            try { room = await connect(BX.identity().loggedIn ? '' : saved); } catch (e) {
                if (attempt >= 4) throw e;
                console.warn('[join] attempt', attempt + 1, 'failed:', e && e.message);
                $('#loading').textContent = 'Waking up a server…';
                await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
            }
        }
        const me = room.state.players && room.state.players.get(room.sessionId);
        S.name = me ? me.name : S.name;
    } catch (e) {
        console.error(e);
        joining = false;
        $('#loading').hidden = true;
        err.hidden = false;
        err.textContent = 'Could not reach the game server. Check your connection and try again.';
        retry.hidden = false;
        BX.loadingEnd();
        return;
    }
    joining = false;
    intro = { t: 0, dur: 2.2, from: camera.position.clone() };
    running = true;
    startMusic();
    $('#start').hidden = true;
    $('#hud').hidden = false;
    $('#touch').hidden = !isTouch;
    if (!rig) buildPlayer(0, 0);
    teleportLobby();
    showTips();
    toast('Every step = +Speed! Spam JUMP to backflip!', '#7dff6b');
    // Browsers start with the sound off until you click or press a key
    setTimeout(() => { if (audioSuspended()) toast('🔊 Click or tap anywhere to turn on the music!', '#ff8ad8'); }, 3500);
    canvas.focus();
    BX.loadingEnd();
}
function waitForLogin(ms) {
    if (!BX.bloxity.ready || BX.identity().loggedIn) return Promise.resolve();
    return new Promise((res) => {
        const t0 = performance.now();
        (function check() { if (BX.identity().loggedIn || performance.now() - t0 > ms) res(); else setTimeout(check, 100); })();
    });
}
function showTips() {
    const el = $('#tips');
    const k = (key, what) => `<span><kbd>${key}</kbd>${what}</span>`;
    el.innerHTML = pad.connected
        ? k('L', 'Move') + k('A', 'Jump / Backflip') + k('X', 'Auto Train') + k('R', 'Camera')
        : isTouch
            ? '<span>Joystick to move · tap JUMP again in the air to BACKFLIP · drag to look</span>'
            : k('WASD', 'Move') + k('Space', 'Jump') + k('Space ×N', 'Backflip in the air') + k('Drag', 'Camera') + k('Wheel', 'Zoom');
    el.hidden = false; el.style.opacity = 1;
    setTimeout(() => { el.style.opacity = 0; }, 9000);
    setTimeout(() => { el.hidden = true; }, 9900);
}
function unlockAudioOnGesture() {
    // Stays armed until the browser actually lets the audio run (the first gesture can be too early)
    const unlock = () => {
        resumeAudio();
        if (!audioSuspended()) for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click']) removeEventListener(ev, unlock, true);
    };
    for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click']) addEventListener(ev, unlock, true);
}
function wirePortalSettings() {
    const embedded = (fn) => (v) => { if (BX.isEmbedded()) fn(v); };
    // Portal volumes come as 0-100 (sometimes "50%" or 0-1); anything unreadable leaves the volume alone
    const pct = (v) => { const n = parseFloat(String(v)); if (!isFinite(n)) return undefined; return clamp(n > 1 ? n / 100 : n, 0, 1); };
    BX.listenSetting('master_volume', embedded((v) => { const p = pct(v); if (p !== undefined) setVolume('master', p); }));
    BX.listenSetting('music_volume', embedded((v) => { const p = pct(v); if (p !== undefined) setVolume('music', p); }));
    BX.listenSetting('graphics_quality', embedded((v) => setQuality(v === 'Low' ? 'low' : v === 'Medium' ? 'medium' : 'high')));
    BX.listenSetting('camera_sensitivity', embedded((v) => { camSens = clamp(parseFloat(v) || 1, 0.1, 5); }));
    BX.listenSetting('show_fps', (v) => { showFps = v === 'true'; $('#fps').hidden = !showFps; });
}
function wirePortalEvents() {
    BX.onPortalEvent((event, data) => {
        if (event === 'respawn_request') { if (P.dead) respawn(); else if (running) teleportLobby(); }
        else if (event === 'chat_message_sent' && data) net.send('chat', { text: String(data) });
        else if (event === 'play_emote' && data) { playEmoteOn(localAvatar, String(data)); net.send('emote', { id: String(data) }); }
    });
    BX.onAvatarChanged(() => syncMyAvatar());
    BX.onProportionsChanged(() => syncMyAvatar());
}
function showIdentity(id) {
    const avail = BX.bloxity.ready;
    $('#acct').hidden = !avail;
    if (!avail) return;
    $('#acctName').textContent = id.name || 'Guest';
    $('#acctBtn').textContent = id.loggedIn ? 'Log out' : 'Log in';
    const pfp = $('#acctPfp');
    pfp.hidden = !id.pfp;
    if (id.pfp) pfp.src = id.pfp;
}
function toggleLogin() { if (BX.identity().loggedIn) BX.logout(); else BX.login(); }

async function boot() {
    BX.initBloxity();
    BX.loadingStep('Loading fonts…');
    try { await Promise.race([Promise.all([document.fonts.load('700 40px Fredoka'), document.fonts.load('800 40px Montserrat')]), new Promise((r) => setTimeout(r, 2500))]); } catch (e) { /* fallback font */ }
    redrawAtlas();
    BX.loadingStep('Building the keyboard…');
    buildWorld();
    refreshNear(-1);
    loadBase().catch(() => {});
    wirePortalSettings();
    wirePortalEvents();
    BX.onIdentity((id) => {
        showIdentity(id);
        if (net.room && id.loggedIn && id.token && !net.bloxity) net.send('auth', { token: id.token });
        if (net.room) { setupLocalAvatar(); syncMyAvatar(); }
    });
    $('#acctBtn').addEventListener('click', toggleLogin);
    $('#acctPfp').addEventListener('error', (e) => { e.target.hidden = true; });
    $('#playBtn').addEventListener('click', play);
    $('#reconnectBtn').addEventListener('click', () => location.reload());
    unlockAudioOnGesture();
    requestAnimationFrame(frame);
    play();
}
boot();

// Dev-only hooks for automated QA runs (stripped from production builds)
if (import.meta.env.DEV) {
    window.__qa = {
        audio: () => audioDebug(), input: (o) => Object.assign(botInput, o), jump: () => pressJump(), solids, cam, P, S, STAGES, avatarStats, scene, camera, net, renderer: () => renderer,
        teleport: (x, y, z, yaw) => { P.padLock = false; teleport(new V3(x, y, z), yaw || 0); },
        walk: (n) => { qaWalk = n; }, jumps: (n) => { qaJumps = n; }, deaths: () => deaths, near: () => near.length,
        // Runs the game at 60 steps a second without rendering: hold forward f, press jump every N steps
        sim: (secs, f, jumpEvery) => { for (let i = 0; i < Math.round(secs * 60); i++) { if (jumpEvery && i % jumpEvery === 0) pressJump(); botInput.f = f || 0; update(1 / 60); } botInput.f = 0; return window.__qa.state(); },
        look: (yaw, pitch, dist) => { cam.yaw = yaw; cam.pitch = pitch; cam.dist = dist; },
        state: () => ({ x: P.pos.x, y: P.pos.y, z: P.pos.z, dead: P.dead, stage: P.stage, wins: S.wins, level: S.level, speed: S.speed, rebirths: S.rebirths, jumps: P.jumpsLeft, onGround: P.onGround, maxStage: S.maxStage }),
    };
}
