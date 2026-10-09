import {
    T, V3, scene, mat, candy, studMaterial, aabb, solids, kills, triggers, tickers,
    texFrom, billboard, textPlane, textCanvas, camera,
} from './engine.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { KEY, addKey, keyGrid, flushKeys, randomLetter, letterIndex, dynamicKeys, tickKeys } from './keys.js';
import { decor, flushDecor, candyModel, buildShoe, buildItem, FROSTING, SCOOPS, PASTELS } from './candy.js';
import { arrowBeltTexture, chocoRiverTexture, beamTexture, woodTexture, scrolling } from './textures.js';
import { emitTread } from './fx.js';
import { S, actions, net } from './state.js';
import {
    CFG, LOBBY, STAGES, STAGE_W, PAD, CLIMB_X, STUDS_PER_JUMP, SUMMIT, SHOES, TREADMILLS, TREAD_GEO, ITEMS, itemById, shoeById, TRAILS,
    fmt, clock, rngFrom, eventState, jumpsFor,
} from '../../shared/config.js';

const HW = STAGE_W / 2;                 // 24: half the corridor width
const LX = LOBBY.halfX, LZ0 = LOBBY.z0, LZ1 = LOBBY.z1;
export const SPAWN = new V3(LOBBY.spawn.x, LOBBY.spawn.y, LOBBY.spawn.z);
// Key looks for the lobby: the pink plaza (as in the reference), white aisle, chocolate keys
const LOOK = {
    plaza: { keys: [0xffc4e6, 0xd8c4ff, 0xf2a8e0, 0xe6d8ff, 0xffd6ee, 0xc8b0ff], ink: 0x3a2050 },
    aisle: { keys: [0xffffff, 0xfff0fa, 0xf4eaff], ink: 0x3a2050 },
    choco: { keys: [0x8a4a26, 0x6a3418, 0x9a5a32, 0x7a4022, 0xa86a3e], ink: 0xffe8cc },
};

// =====================================================================================
// Zones: the lobby (-1) and one per stage. Each zone's meshes live in their own group, so far
// stages can be hidden, and the player only collides with nearby zones.
// =====================================================================================
const zoneGroups = new Map();
export function zoneGroup(i) {
    let g = zoneGroups.get(i);
    if (!g) { g = new T.Group(); g.userData.zone = i; scene.add(g); zoneGroups.set(i, g); }
    return g;
}
// Shows the lobby and the stages next to `stage` (-1 = lobby)
export function cullZones(stage) {
    for (const [i, g] of zoneGroups) {
        g.visible = i === -1 ? stage <= 1 : Math.abs(i - Math.max(0, stage)) <= 1 || (stage < 0 && i <= 0);
    }
}

// ----- static geometry, merged per zone and material at the end -----
const geoBatches = new Map();
function addGeo(zone, geo, material, cast) {
    const k = zone + '|' + material.uuid + '|' + (cast ? 1 : 0);
    let b = geoBatches.get(k);
    if (!b) { b = { zone, material, cast, list: [] }; geoBatches.set(k, b); }
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
    if (!geo.index) { const idx = []; for (let i = 0; i < geo.attributes.position.count; i++) idx.push(i); geo.setIndex(idx); }
    b.list.push(geo);
}
function flushGeo() {
    for (const b of geoBatches.values()) {
        const mesh = new T.Mesh(mergeGeometries(b.list), b.material);
        mesh.receiveShadow = true; mesh.castShadow = !!b.cast;
        mesh.matrixAutoUpdate = false;
        zoneGroup(b.zone).add(mesh);
        for (const g of b.list) g.dispose();
    }
    geoBatches.clear();
}
function solid(zone, x, y, z, sx, sy, sz, extra) {
    const c = aabb(x, y, z, sx, sy, sz);
    c.zone = zone;
    if (extra) Object.assign(c, extra);
    solids.push(c);
    return c;
}
// Box with Roblox studs: UVs in world units / 8 so the stud tile keeps its size on any face
function studBox(zone, sx, sy, sz, x, y, z, color, o) {
    o = o || {};
    const g = new T.BoxGeometry(sx, sy, sz);
    const uv = g.attributes.uv;
    const faces = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, uv.getX(i) * faces[f][0] / 8, uv.getY(i) * faces[f][1] / 8);
    }
    g.translate(x, y, z);
    addGeo(zone, g, studMaterial(color, { rough: o.rough }), o.cast);
    if (o.solid !== false) return solid(zone, x, y, z, sx, sy, sz, o.extra);
    return null;
}
function plainBox(zone, sx, sy, sz, x, y, z, material, o) {
    o = o || {};
    const g = new T.BoxGeometry(sx, sy, sz);
    if (o.rx) g.rotateX(o.rx);
    if (o.rz) g.rotateZ(o.rz);
    if (o.ry) g.rotateY(o.ry);
    g.translate(x, y, z);
    addGeo(zone, g, material, o.cast);
    if (o.solid) return solid(zone, x, y, z, sx, sy, sz, o.extra);
    return null;
}
function roundBox(zone, sx, sy, sz, x, y, z, material, r, o) {
    o = o || {};
    const g = new RoundedBoxGeometry(sx, sy, sz, 2, Math.min(r, sx / 2 - 0.01, sy / 2 - 0.01, sz / 2 - 0.01));
    g.translate(x, y, z);
    addGeo(zone, g, material, o.cast);
    if (o.solid) return solid(zone, x, y, z, sx, sy, sz, o.extra);
    return null;
}
const glowMat = (c, k) => mat(c, { neon: true, boost: k });
function glowBox(zone, sx, sy, sz, x, y, z, color, k) { plainBox(zone, sx, sy, sz, x, y, z, glowMat(color, k)); }
function cyl(zone, r0, r1, h, x, y, z, material, seg, o) {
    o = o || {};
    const g = new T.CylinderGeometry(r0, r1, h, seg || 24);
    if (o.rx) g.rotateX(o.rx);
    if (o.rz) g.rotateZ(o.rz);
    g.translate(x, y, z);
    addGeo(zone, g, material, o.cast);
}
const shade = (c, k) => new T.Color(c).multiplyScalar(k).getHex();
const lighten = (c, k) => new T.Color(c).lerp(new T.Color(0xffffff), k).getHex();
const css = (h) => '#' + h.toString(16).padStart(6, '0');

// ----- keyboards -----
// A keyboard tier: rounded case in the theme colour, a raised rim, keycaps on top (tops at `top`).
// Solid down to `top - thick`.
function kbSlab(zone, look, x, z, w, d, top, rng, o) {
    o = o || {};
    const thick = o.thick ?? 3;
    const caseM = candy(o.caseColor ?? look.case ?? 0xff9ad6, { rough: 0.32 });
    roundBox(zone, w + 1.8, thick, d + 1.8, x, top - 0.6 - thick / 2, z, caseM, 0.55, { cast: o.cast });
    // Rim around the keys, just below their tops
    const rimM = candy(lighten(o.caseColor ?? look.case ?? 0xff9ad6, 0.25), { rough: 0.3 });
    for (const s of [-1, 1]) {
        roundBox(zone, w + 1.8, 0.7, 0.9, x, top - 0.6, z + s * (d / 2 + 0.45), rimM, 0.3);
        roundBox(zone, 0.9, 0.7, d + 1.8, x + s * (w / 2 + 0.45), top - 0.6, z, rimM, 0.3);
    }
    if (!o.noKeys) keyGrid(zone, look, x, z, w, d, top, rng, o.pick, { blank: o.blank, skip: o.skip });
    if (o.solid === false) return null;
    return solid(zone, x, top - (thick + 0.6) / 2, z, w + 1.8, thick + 0.6, d + 1.8, o.extra);
}
// A single big key to stand on, on a candy stem down into the void. size: key units (1 = 3.7 studs)
function keyStone(zone, look, x, z, size, top, rng, o) {
    o = o || {};
    const color = o.color ?? look.keys[Math.floor(rng() * look.keys.length)];
    addKey(zone, look, x, top, z, color, o.letter ?? randomLetter(rng), size, size, o.sy || 1);
    if (o.stem !== false) cyl(zone, 0.7 * size, 0.9 * size, 30, x, top - 1 - 15, z, candy(shade(look.case ?? 0xff9ad6, 0.85), { rough: 0.4 }), 10);
    const half = 1.62 * size;
    return solid(zone, x, top - 0.5, z, half * 2, 1, half * 2, o.extra);
}
// A long space bar (no letter): length along z
function spaceBar(zone, look, x, z, len, top, wid, o) {
    o = o || {};
    const color = o.color ?? look.keys[0];
    addKey(zone, look, x, top, z, color, -1, (wid || 4) / 3.7, len / 3.7);
    return solid(zone, x, top - 0.5, z, (wid || 4) * 0.88, 1, len * 0.88, o.extra);
}

// ----- text -----
// Floating title: gradient text with an outline, optional yellow subtitle
function banner(zone, text, colors, w, pos, face, sub, subColor) {
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = sub ? 300 : 200;
    const x = cv.getContext('2d');
    x.font = '700 118px Fredoka, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    let px = 118;
    while (x.measureText(text).width > 990 && px > 40) { px -= 4; x.font = `700 ${px}px Fredoka, sans-serif`; }
    x.lineJoin = 'round'; x.lineWidth = 18; x.strokeStyle = '#2a1640'; x.strokeText(text, 512, 100);
    const g = x.createLinearGradient(0, 40, 0, 160);
    g.addColorStop(0, colors[0]); g.addColorStop(1, colors[1]);
    x.fillStyle = g; x.fillText(text, 512, 100);
    if (sub) {
        let sp = 58;
        x.font = `700 ${sp}px Fredoka, sans-serif`;
        while (x.measureText(sub).width > 990 && sp > 20) { sp -= 2; x.font = `700 ${sp}px Fredoka, sans-serif`; }
        x.lineWidth = 12; x.strokeText(sub, 512, 232);
        x.fillStyle = subColor || '#ffd028'; x.fillText(sub, 512, 232);
    }
    const m = new T.Mesh(new T.PlaneGeometry(w, w * cv.height / 1024), new T.MeshBasicMaterial({ map: texFrom(cv), transparent: true, depthWrite: false, side: T.DoubleSide, toneMapped: false }));
    m.position.copy(pos); m.rotation.y = Math.atan2(face.x, face.z);
    zoneGroup(zone).add(m);
    return m;
}
function canvasPlane(zone, w, h, pxW, pxH, pos, face) {
    const cv = document.createElement('canvas'); cv.width = pxW; cv.height = pxH;
    const tex = texFrom(cv);
    const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
    m.position.copy(pos); m.rotation.y = Math.atan2(face.x, face.z);
    zoneGroup(zone).add(m);
    return { cv, tex, m };
}

// ----- candy scattered on walls -----
const DECO_SETS = {
    sweets: [['donut', FROSTING], ['icecream', SCOOPS], ['lolliPink'], ['lolliRainbow'], ['mintRed'], ['macaron', PASTELS], ['cupcake', FROSTING], ['bonbon', PASTELS]],
    bubble: [['gumball', PASTELS], ['bonbon', [0x8ad8ff, 0xff8ad0]], ['lolliBlue'], ['donut', [0x8ad8ff, 0xffffff, 0xff8ad0]], ['macaron', [0x8ad8ff, 0xffd0f0]]],
    mint: [['mintGreen'], ['macaron', [0xb8ffd8, 0xffd0e8]], ['cupcake', [0xb8ffd8, 0xffffff]], ['donut', [0xffffff, 0xb8ffd8]], ['gumdrop', [0x7affb8, 0xffffff]]],
    choco: [['chocobar'], ['cookie'], ['donut', [0x7a4022, 0x5a2e14, 0xffe8cc]], ['icecream', [0x9a5a32, 0xfff4e0]], ['waffle']],
    neon: [['gumball', [0xff3ad8, 0x3affd8, 0x8a5aff]], ['lolliRainbow'], ['bonbon', [0xff3ad8, 0x3ad8ff]], ['gumdrop', [0xff5ad8, 0x5affe6]]],
    citrus: [['gumdrop', [0xffa84a, 0xffe05a, 0xff7a3a]], ['lolliRainbow'], ['bonbon', [0xffd028, 0xff8a3a]], ['icecream', [0xffe08a, 0xffb08a]], ['donut', [0xffe08a, 0xffb84a]]],
    gumball: [['gumball', [0xff5a7a, 0x5ac8ff, 0xffe05a, 0x7aff8a, 0xb88aff, 0xffffff]]],
    frost: [['icecream', [0xffffff, 0xc8eaff]], ['donut', [0xffffff, 0xc8eaff]], ['mintBlue'], ['macaron', [0xc8eaff, 0xffffff]]],
    peppermint: [['mintRed'], ['cane'], ['lolliPink'], ['bonbon', [0xff3a50, 0xffffff]]],
    tech: [['bonbon', [0x5ad0ff, 0xc8ccd8]], ['gumball', [0x5ad0ff, 0xffffff, 0x8a8ea0]], ['cookie']],
    jelly: [['gumdrop', [0xa8ff5a, 0xff8ae0, 0xffe05a, 0x5ae0ff]], ['gumball', [0xa8ff5a, 0xff8ae0]], ['bonbon', [0xc89aff, 0xa8ff5a]]],
    storm: [['cloud', [0x8a9ad8, 0xc8d0ff]], ['lolliBlue'], ['gumball', [0x7ad8ff, 0x5a6aa8]]],
    rainbow: [['lolliRainbow'], ['donut', FROSTING], ['gumball', PASTELS], ['icecream', SCOOPS], ['macaron', PASTELS], ['cupcake', FROSTING]],
};
function wallCandy(zone, set, side, z0, z1, y0, y1, rng, density) {
    const list = DECO_SETS[set] || DECO_SETS.sweets;
    const area = (z1 - z0) * (y1 - y0);
    const n = Math.min(200, Math.floor(area / (density || 70)));
    for (let k = 0; k < n; k++) {
        const z = z0 + rng() * (z1 - z0), y = y0 + rng() * (y1 - y0);
        const [type, pal] = list[Math.floor(rng() * list.length)];
        const s = 1.3 + rng() * 1.5;
        const x = side * (HW - 0.4 - s * 0.6);
        // Lie on the wall: flat things face out of it, cones point down-ish
        const flat = type === 'donut' || type === 'cookie' || type === 'waffle' || type === 'chocobar';
        decor(zone, type, x, y, z, flat ? 0 : (rng() - 0.5) * 0.6, side > 0 ? -Math.PI / 2 : Math.PI / 2, flat ? side * Math.PI / 2 : (rng() - 0.5) * 0.8, s, pal ? pal[Math.floor(rng() * pal.length)] : undefined);
    }
}
function clouds(zone, n, x0, x1, y0, y1, z0, z1, rng, tints) {
    for (let k = 0; k < n; k++) {
        const side = rng() < 0.5 ? -1 : 1;
        decor(zone, 'cloud', side * (x0 + rng() * (x1 - x0)), y0 + rng() * (y1 - y0), z0 + rng() * (z1 - z0), 0, rng() * 6, 0, 4 + rng() * 7, tints[Math.floor(rng() * tints.length)]);
    }
}

// =====================================================================================
// Lobby: a pink keyboard plaza facing the Stage 1 corridor (north, +z), with the chocolate half
// behind the spawn: TREADMILLS on the east (left, +x), SHOES on the west, shops on the south wall.
// =====================================================================================
const shopItems = [];   // shoe pads, treadmills, trails: refreshed labels
const boards = {};
const signs = {};
const floaters = new T.Group();
export function treadOwned(def) { return def.cost === 0 && !def.daily ? true : !!S.treads[def.id]; }

function buildLobby() {
    const Z = -1, rng = rngFrom(11);
    const g = zoneGroup(Z);
    // Floor: keys everywhere (pink plaza north of z = -30, chocolate south), a white aisle to Stage 1
    const blocked = (x, z) =>
        (x > 23 && z < -31 && z > -100) ||                                // treadmill deck
        (x <= -26 && x >= -74 && z < -34 && z > -102);                   // shoe stand
    const pitch = KEY.pitch;
    for (let z = LZ0 + 2; z < LZ1; z += pitch) for (let x = -LX + 2; x < LX; x += pitch) {
        if (blocked(x, z)) continue;
        const choc = z < -30;
        const aisle = !choc && Math.abs(x) < 9;
        const look = choc ? LOOK.choco : aisle ? LOOK.aisle : LOOK.plaza;
        addKey(Z, look, x, 0, z, look.keys[Math.floor(rng() * look.keys.length)], randomLetter(rng));
    }
    // Base under the keys (seen in the gaps), and the floor collision
    plainBox(Z, LX * 2, 1.2, LZ1 + 30, 0, -1.0, (LZ1 - 30) / 2, candy(0x5a2a8a, { rough: 0.7 }));
    plainBox(Z, LX * 2, 1.2, -30 - LZ0, 0, -1.0, (-30 + LZ0) / 2, candy(0x3a1a0c, { rough: 0.7 }));
    solid(Z, 0, -2, (LZ0 + LZ1) / 2, LX * 2, 4, LZ1 - LZ0);

    // Walls: purple studs with pink trims, an opening for the Stage 1 corridor
    const WH = LOBBY.wallHeight, wallC = 0x9a5cf0, trim = 0xff8ad8;
    studBox(Z, 2, WH, LZ1 - LZ0 + 4, LX + 1, WH / 2, (LZ0 + LZ1) / 2, wallC);
    studBox(Z, 2, WH, LZ1 - LZ0 + 4, -LX - 1, WH / 2, (LZ0 + LZ1) / 2, wallC);
    studBox(Z, LX * 2 + 4, WH, 2, 0, WH / 2, LZ0 - 1, wallC);
    for (const s of [-1, 1]) studBox(Z, LX - HW, WH, 2, s * (HW + (LX - HW) / 2), WH / 2, LZ1 + 1, wallC);
    studBox(Z, HW * 2, WH - 40, 2, 0, 40 + (WH - 40) / 2, LZ1 + 1, wallC);
    for (const [sx, sz, x, z] of [[2.4, LZ1 - LZ0 + 4, LX + 1, (LZ0 + LZ1) / 2], [2.4, LZ1 - LZ0 + 4, -LX - 1, (LZ0 + LZ1) / 2], [LX * 2 + 4, 2.4, 0, LZ0 - 1], [LX * 2 + 4, 2.4, 0, LZ1 + 1]]) {
        roundBox(Z, sx, 1.4, sz, x, WH + 0.7, z, candy(trim, { rough: 0.3 }), 0.5);
    }
    // Pink frame round the Stage 1 doorway
    for (const s of [-1, 1]) roundBox(Z, 2.6, 40, 3, s * (HW + 1.3), 20, LZ1 - 0.2, candy(trim, { rough: 0.3 }), 0.6);
    roundBox(Z, HW * 2 + 5.2, 2.6, 3, 0, 40, LZ1 - 0.2, candy(trim, { rough: 0.3 }), 0.6);
    banner(Z, '😊 STAGE 1 😊', ['#ffffff', '#ffe36b'], 34, new V3(0, 47, LZ1 - 0.6), new V3(0, 0, -1));
    // Candy all over the walls
    for (const [side, set] of [[1, 'sweets'], [-1, 'sweets']]) {
        const r2 = rngFrom(side > 0 ? 21 : 22);
        for (let k = 0; k < 70; k++) {
            const z = LZ0 + 6 + r2() * (LZ1 - LZ0 - 12), y = 10 + r2() * 30;
            const list = DECO_SETS[set];
            const [type, pal] = list[Math.floor(r2() * list.length)];
            const s = 1.6 + r2() * 1.6, flat = type === 'donut' || type === 'cookie';
            decor(Z, type, side * (LX - 0.6 - s * 0.6), y, z, flat ? 0 : 0, side > 0 ? -Math.PI / 2 : Math.PI / 2, flat ? side * Math.PI / 2 : (r2() - 0.5) * 0.6, s, pal ? pal[Math.floor(r2() * pal.length)] : undefined);
        }
    }
    for (let k = 0; k < 40; k++) {
        const r2 = rng, x = -LX + 6 + r2() * (LX * 2 - 12), y = 10 + r2() * 30;
        const [type, pal] = DECO_SETS.choco[Math.floor(r2() * DECO_SETS.choco.length)];
        decor(Z, type, x, y, LZ0 + 0.6 + 1.2, type === 'donut' || type === 'cookie' || type === 'waffle' || type === 'chocobar' ? Math.PI / 2 : 0, 0, 0, 1.8 + r2() * 1.4, pal ? pal[Math.floor(r2() * pal.length)] : undefined);
    }
    for (let k = 0; k < 30; k++) {
        const x = (rng() < 0.5 ? -1 : 1) * (HW + 6 + rng() * (LX - HW - 12)), y = 8 + rng() * 32;
        const [type, pal] = DECO_SETS.sweets[Math.floor(rng() * DECO_SETS.sweets.length)];
        decor(Z, type, x, y, LZ1 - 0.6 - 1.2, type === 'donut' ? Math.PI / 2 : 0, Math.PI, 0, 1.8 + rng() * 1.4, pal ? pal[Math.floor(rng() * pal.length)] : undefined);
    }
    // Wooden lattice over the chocolate half (big X beams, as in the reference)
    const woodM = candy(0xffffff, { rough: 0.75 }); woodM.map = woodTexture(); woodM.map.repeat.set(1, 6);
    const latticeAt = (x, z, ry, w, h) => {
        for (const s of [-1, 1]) plainBox(Z, 1.6, Math.hypot(w, h), 1.2, x, 26, z, woodM, { rz: s * Math.atan2(w, h), ry });
        plainBox(Z, w, 1.6, 1.4, x, 26 - h / 2, z, woodM, { ry });
        plainBox(Z, w, 1.6, 1.4, x, 26 + h / 2, z, woodM, { ry });
    };
    for (let x = -LX + 14; x < LX - 10; x += 28) latticeAt(x, LZ0 + 2.2, 0, 26, 30);
    for (const s of [-1, 1]) for (let z = LZ0 + 16; z < -34; z += 28) latticeAt(s * (LX - 2.2), z, Math.PI / 2, 26, 30);
    // Overhead beams across the chocolate half
    for (let z = LZ0 + 14; z < -30; z += 26) plainBox(Z, LX * 2, 1.8, 1.8, 0, 42, z, woodM);
    // Floating sweets and cotton-candy clouds over the chocolate half; clouds over the plaza
    {
        const fl = rngFrom(31);
        for (let k = 0; k < 34; k++) {
            const types = ['cookie', 'waffle', 'chocobar', 'icecream', 'donut', 'macaron', 'bonbon'];
            const type = types[Math.floor(fl() * types.length)];
            const pal = type === 'donut' ? FROSTING : type === 'icecream' ? SCOOPS : PASTELS;
            const m = candyModel(type, pal[Math.floor(fl() * pal.length)]);
            m.position.set(-LX + 10 + fl() * (LX * 2 - 20), 16 + fl() * 22, LZ0 + 8 + fl() * 66);
            m.rotation.set(fl() * 6, fl() * 6, fl() * 6);
            m.scale.setScalar(1.2 + fl() * 1.2);
            m.userData.spin = (fl() - 0.5) * 0.8;
            m.traverse((o) => { o.castShadow = false; });
            floaters.add(m);
        }
        g.add(floaters);
        clouds(Z, 18, 10, 80, 46, 70, LZ0, LZ1, fl, [0xffc8e8, 0xc8e0ff, 0xffffff, 0xe0c8ff]);
    }

    // Spawn: a glowing ring on the aisle
    const ring = new T.Mesh(new T.RingGeometry(5.2, 6.4, 48), glowMat(0xff8ad8, 1.6));
    ring.rotation.x = -Math.PI / 2; ring.position.set(SPAWN.x, 0.06, SPAWN.z); g.add(ring);
    // Giant candy canes and lollipops framing the plaza
    for (const [x, z, s] of [[-30, 52, 3.2], [30, 52, 3.2], [-12, -24, 2.4], [12, -24, 2.4]]) decor(Z, 'cane', x, 2.4 * s, z, 0, x > 0 ? Math.PI : 0, 0, s);
    for (const [x, z, t] of [[-70, 54, 'lolliRainbow'], [70, 54, 'lolliPink'], [-70, -26, 'lolliPink'], [70, -26, 'lolliRainbow']]) decor(Z, t, x, 10, z, 0, x > 0 ? -0.6 : 0.6, 0, 2.6);

    buildBoards(Z);
    buildChests(Z);
    buildEventBoard(Z);
    buildShowcases(Z);
    buildTreadmills(Z);
    buildShoes(Z);
    buildShops(Z);
}

// ----- leaderboards: TOP SPEED / TOP WINS / TOP REBIRTHS in candy frames on the left -----
function leaderboard(Z, pos, title, color, face) {
    const grp = new T.Group(); grp.position.copy(pos); grp.rotation.y = Math.atan2(face.x, face.z); zoneGroup(Z).add(grp);
    const frameM = candy(color, { rough: 0.3 });
    const add = (geo, m, x, y, z) => { const o = new T.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; grp.add(o); return o; };
    add(new RoundedBoxGeometry(17, 24, 1.6, 2, 0.6), frameM, 0, 14.5, 0);
    for (const sx of [-1, 1]) add(new RoundedBoxGeometry(1.4, 4, 1.4, 2, 0.4), candy(shade(color, 0.7), { rough: 0.4 }), sx * 6, 1.6, 0);
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 640;
    const tex = texFrom(cv);
    const scr = new T.Mesh(new T.PlaneGeometry(15, 18.75), new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
    scr.position.set(0, 13.4, 0.82); grp.add(scr);
    const head = textPlane([{ t: title, c: '#ffffff', s: '#2a1640', px: 92 }], 15, 1024, new V3(), new V3(0, 0, 1), grp);
    head.position.set(0, 24.4, 0.85);
    solids.push(Object.assign(aabb(pos.x, 13, pos.z, 12, 26, 12), { zone: Z }));
    return { cv, tex, color };
}
function buildBoards(Z) {
    const face = new V3(-0.25, 0, -1).normalize();
    boards.speed = leaderboard(Z, new V3(34, 0, 52), '👟 Top Speed', 0x3a8cff, face);
    boards.wins = leaderboard(Z, new V3(54, 0, 50), '🏆 Top Wins', 0xffb81c, face);
    boards.rebirths = leaderboard(Z, new V3(73, 0, 46), '🔄 Top Rebirths', 0xff5ab8, new V3(-0.6, 0, -1).normalize());
}
function drawBoard(b, rows, kind) {
    const x = b.cv.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 640);
    g.addColorStop(0, '#3a1a6a'); g.addColorStop(1, '#1a0c3a');
    x.fillStyle = g; x.fillRect(0, 0, 512, 640);
    x.font = '700 32px Fredoka, sans-serif'; x.textBaseline = 'middle';
    if (!rows.length) { x.textAlign = 'center'; x.fillStyle = '#ffffff'; x.fillText('Be the first!', 256, 320); }
    rows.forEach((r, i) => {
        const y = 34 + i * 62;
        if (i % 2 === 0) { x.fillStyle = 'rgba(255,255,255,0.06)'; x.fillRect(0, y - 31, 512, 62); }
        x.textAlign = 'left'; x.fillStyle = r.you ? '#7dff6b' : i < 3 ? ['#ffd028', '#e0e6f0', '#e8a060'][i] : '#ffffff';
        x.fillText('#' + (i + 1), 14, y);
        x.fillText(r.n.slice(0, 13), 78, y);
        x.textAlign = 'right'; x.fillStyle = kind === 'speed' ? '#6fe0ff' : kind === 'wins' ? '#ffd028' : '#ff8ad8';
        x.fillText(fmt(r.v), 500, y);
    });
    b.tex.needsUpdate = true;
}
// msg = { speed: [{n, v}], wins: [...], rebirths: [...] } from the server, top 10 each
export function renderBoards(msg) {
    if (!boards.speed || !msg) return;
    for (const kind of ['speed', 'wins', 'rebirths']) {
        drawBoard(boards[kind], (msg[kind] || []).map((r) => ({ n: r.n, v: r.v, you: r.n === S.name })), kind);
    }
}

// ----- chests: Codes (blue) and Group Reward (gold), in front of the boards -----
function chest(Z, x, z, body, trimC, title, sub, act) {
    const grp = new T.Group(); grp.position.set(x, 0, z); grp.rotation.y = Math.PI + 0.25; zoneGroup(Z).add(grp);
    const add = (geo, m, px, py, pz, rx) => { const o = new T.Mesh(geo, m); o.position.set(px, py, pz); if (rx) o.rotation.x = rx; o.castShadow = true; grp.add(o); return o; };
    const bodyM = candy(body, { rough: 0.3, clear: true }), trimM = new T.MeshStandardMaterial({ color: trimC, roughness: 0.25, metalness: 0.7 });
    add(new RoundedBoxGeometry(8, 4.6, 5.4, 2, 0.5), bodyM, 0, 2.3, 0);
    add(new RoundedBoxGeometry(8.2, 2.4, 5.6, 2, 0.6), bodyM, 0, 5.4, -0.3, -0.18);
    for (const sx of [-2.8, 0, 2.8]) add(new T.BoxGeometry(0.6, 4.8, 5.6), trimM, sx, 2.4, 0);
    add(new RoundedBoxGeometry(1.4, 1.6, 0.5, 2, 0.2), trimM, 0, 3.6, 2.8);
    const glow = new T.Mesh(new T.SphereGeometry(0.9, 12, 10), glowMat(trimC, 1.4)); glow.position.set(0, 5.6, 1.6); grp.add(glow);
    banner(Z, title, ['#ffffff', css(lighten(body, 0.4))], 14, new V3(x, 11.5, z), new V3(-0.25, 0, -1), sub, '#ffffff');
    solids.push(Object.assign(aabb(x, 3, z, 8, 6, 6), { zone: Z }));
    const tr = aabb(x, 3, z - 4, 11, 6, 6); tr.enter = act; tr.zone = Z; triggers.push(tr);
    tickers.push((dt, t) => { glow.position.y = 5.6 + Math.sin(t * 3) * 0.3; });
}
function buildChests(Z) {
    chest(Z, 26, 34, 0x2a8cff, 0xffd028, 'Codes', 'Free Stuff!', () => actions.openCodes());
    chest(Z, 42, 32, 0xffb81c, 0xff5ab8, 'Group Reward', 'Free Rewards', () => actions.chest());
}

// ----- "UPDATE + ADMIN ABUSE IN" board: here the Sugar Rush countdown -----
function buildEventBoard(Z) {
    const pos = new V3(-36, 0, 48), face = new V3(0.35, 0, -1).normalize();
    const grp = new T.Group(); grp.position.copy(pos); grp.rotation.y = Math.atan2(face.x, face.z); zoneGroup(Z).add(grp);
    const post = new T.Mesh(new RoundedBoxGeometry(1.2, 8, 1.2, 2, 0.3), candy(0x6a3418, { rough: 0.5 }));
    post.position.set(0, 4, 0); grp.add(post);
    const board = new T.Mesh(new RoundedBoxGeometry(18, 10, 1, 2, 0.4), candy(0x1a1024, { rough: 0.4 }));
    board.position.set(0, 12, 0); grp.add(board);
    const c = document.createElement('canvas'); c.width = 768; c.height = 420;
    const tex = texFrom(c);
    const scr = new T.Mesh(new T.PlaneGeometry(17, 9.3), new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
    scr.position.set(0, 12, 0.52); grp.add(scr);
    signs.event = { cv: c, tex, last: '' };
    solids.push(Object.assign(aabb(pos.x, 8, pos.z, 18, 16, 3), { zone: Z }));
}
function drawEventBoard() {
    const e = signs.event;
    if (!e) return;
    const ev = eventState(net.now());
    const key = ev.on + '|' + Math.floor(ev.left);
    if (key === e.last) return;
    e.last = key;
    const x = e.cv.getContext('2d'), W = e.cv.width, H = e.cv.height;
    x.fillStyle = '#140a22'; x.fillRect(0, 0, W, H);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineJoin = 'round';
    const line = (t, y, px, col, stroke) => { x.font = `700 ${px}px Fredoka, sans-serif`; if (stroke) { x.lineWidth = px * 0.2; x.strokeStyle = '#000'; x.strokeText(t, W / 2, y); } x.fillStyle = col; x.fillText(t, W / 2, y); };
    if (ev.on) {
        line('🍭 SUGAR RUSH! 🍭', 80, 72, '#ff8ad8', true);
        line('x2 SPEED & x2 WINS', 190, 64, '#7dff6b', true);
        line('Ends in ' + clock(ev.left), 300, 56, '#ffffff');
    } else {
        line('SUGAR RUSH IN:', 70, 60, '#ffffff', true);
        const h = Math.floor(ev.left / 3600), m = Math.floor((ev.left % 3600) / 60), s = Math.floor(ev.left % 60);
        line((h ? h + 'h ' : '') + m + 'm ' + String(s).padStart(2, '0') + 's', 170, 70, '#ffd028', true);
        line('???', 285, 110, '#ffffff', true);
        line('x2 SPEED & WINS FOR EVERYONE', 385, 34, '#ff8ad8');
    }
    e.tex.needsUpdate = true;
}

// ----- showcases on the right: the Demon Wings and Lava Treads, a step opens the Shop -----
function buildShowcases(Z) {
    const show = (x, z, model, lines, tab) => {
        cyl(Z, 4.2, 4.6, 1.2, x, 0.6, z, candy(0x1a1024, { rough: 0.35 }), 28);
        const ringM = new T.Mesh(new T.TorusGeometry(4.3, 0.22, 8, 40), glowMat(0xff3ad8, 1.6));
        ringM.rotation.x = Math.PI / 2; ringM.position.set(x, 1.25, z); zoneGroup(Z).add(ringM);
        model.position.set(x, 3.6, z); zoneGroup(Z).add(model);
        billboard(lines, 10, 512, new V3(x, 11, z), zoneGroup(Z));
        tickers.push((dt, t) => { model.rotation.y = t * 0.8; model.position.y = 3.6 + Math.sin(t * 2) * 0.4; });
        const tr = aabb(x, 2, z, 8, 4, 8); tr.enter = () => actions.openShop(tab); tr.zone = Z; triggers.push(tr);
    };
    const wings = buildItem(itemById.demon).group; wings.scale.setScalar(1.6);
    show(-54, 40, wings, [{ t: 'Demon Wings', c: '#ff5a6a', s: '#16121f', px: 60 }, { t: 'x2.5 Speed', c: '#7dff6b', s: '#16121f', px: 52 }, { t: '🏆 1.2K Wins', c: '#ffd028', s: '#16121f', px: 48 }], 'items');
    const shoe = buildShoe(shoeById.lava); shoe.scale.setScalar(1.8);
    show(-68, 24, shoe, [{ t: 'Lava Treads', c: '#ff8a3a', s: '#16121f', px: 60 }, { t: '+400 Steps', c: '#7dff6b', s: '#16121f', px: 52 }, { t: '🏆 3.5K Wins', c: '#ffd028', s: '#16121f', px: 48 }], 'shoes');
}

// ----- TREADMILLS (east, +x): a dark deck with a row of glowing treadmills, trails in front -----
export let beltTex;
function treadLines(def) {
    const owned = treadOwned(def);
    const lines = [{ t: (def.label && def.daily ? def.label + ' ' : def.label === 'Starter' ? 'Starter ' : '') + 'x' + def.mult + ' Steps', c: css(lighten(def.color, 0.2)), s: '#16121f', px: 64 }];
    if (def.tag) lines.push({ t: def.tag, c: '#ffffff', s: '#16121f', px: 38 });
    if (owned) lines.push({ t: '✓ OWNED', c: '#7dff6b', s: '#16121f', px: 44 });
    else if (def.daily) lines.push({ t: '📅 Daily Reward Day 7', c: '#ffd028', s: '#16121f', px: 40 });
    else lines.push({ t: '🏆 ' + fmt(def.cost) + ' Wins', c: S.wins >= def.cost ? '#7dff6b' : '#ffd028', s: '#16121f', px: 48 });
    return lines;
}
function buildTreadmills(Z) {
    const g = TREAD_GEO;
    const bc = document.createElement('canvas'); bc.width = 64; bc.height = 64;
    const bx = bc.getContext('2d');
    bx.fillStyle = '#2a2a36'; bx.fillRect(0, 0, 64, 64);
    bx.fillStyle = '#4a4a5a'; for (let i = 0; i < 4; i++) bx.fillRect(0, i * 16, 64, 5);
    beltTex = texFrom(bc); beltTex.wrapS = beltTex.wrapT = T.RepeatWrapping; beltTex.repeat.set(1, 3);
    scrolling.push({ tex: beltTex, u: 0, v: -1.6 });
    // Deck
    const x0 = 24, x1 = 82, z0 = -98, z1 = -32;
    roundBox(Z, x1 - x0, 1.2, z1 - z0, (x0 + x1) / 2, 0.6, (z0 + z1) / 2, candy(0x2a1a3a, { rough: 0.45 }), 0.4, { solid: true });
    keyGrid(Z, LOOK.choco, (x0 + x1) / 2, -40, x1 - x0 - 4, 8, 1.2, rngFrom(5), null, {});
    banner(Z, 'TREADMILLS', ['#ffffff', '#ffb0e8'], 40, new V3(53, 34, -98.2 + 0.2), new V3(0, 0, 1), 'Automatically increases your Speed!');
    TREADMILLS.forEach((def, i) => {
        const cx = g.x0 + i * g.step, cz = g.z, top = g.top;
        const beltMat = new T.MeshStandardMaterial({ map: beltTex, roughness: 0.6 });
        const belt = new T.Mesh(new T.BoxGeometry(g.width, 0.3, g.len), beltMat);
        belt.position.set(cx, top + 0.15, cz); belt.receiveShadow = true; zoneGroup(Z).add(belt);
        const c = solid(Z, cx, top + 0.15, cz, g.width, 0.3, g.len, { tread: def });
        void c;
        // Frame, glowing rails, a console at the front (+z) with the multiplier on its screen
        roundBox(Z, g.width + 1.2, 1, g.len + 1.2, cx, top - 0.4, cz, candy(0x1a1a24, { rough: 0.4 }), 0.3);
        for (const s of [-1, 1]) glowBox(Z, 0.35, 0.5, g.len, cx + s * (g.width / 2 + 0.25), top + 0.3, cz, def.color, 1.5);
        roundBox(Z, g.width, 4.5, 1, cx, top + 2.2, cz + g.len / 2 + 0.6, candy(0x22222e, { rough: 0.35 }), 0.3, { solid: true });
        for (const s of [-1, 1]) roundBox(Z, 0.4, 3.6, 0.4, cx + s * (g.width / 2 - 0.3), top + 1.8, cz + g.len / 2 - 1, candy(0xc8c8d8, { rough: 0.3 }), 0.15);
        const scr = textPlane([{ t: 'x' + def.mult, c: css(lighten(def.color, 0.3)), s: '#16121f', px: 150 }], 4, 256, new V3(cx, top + 3.4, cz + g.len / 2 + 0.05), new V3(cx, top + 3.4, cz - 10), zoneGroup(Z));
        scr.renderOrder = 2;
        const sp = billboard(treadLines(def), 7.5, 512, new V3(cx, top + 9.5, cz + 2), zoneGroup(Z));
        shopItems.push({ kind: 'tread', def, sp, sig: '' });
        // Particles over the belt while it runs
        const at = new V3(cx, top + 0.4, cz);
        let acc = Math.random();
        tickers.push((dt) => {
            if (!zoneGroup(Z).visible || camera.position.distanceToSquared(at) > 120 * 120) return;
            acc += dt * (treadOwned(def) ? 6 : 1.5);
            while (acc > 1) { acc -= 1; emitTread(at, def.mult, g.width * 0.8, g.len * 0.9, def.color); }
        });
        // Locked: stepping on it offers to buy it
        const tr = aabb(cx, top + 2, cz, g.width, 3, g.len); tr.zone = Z;
        tr.enter = () => { if (!treadOwned(def)) actions.treadBuy(def); };
        triggers.push(tr);
    });
    // Trails: dark pads with a label each, step on one to equip it
    TRAILS.forEach((def, i) => {
        const x = 30 + i * 8.2, z = -86, top = 1.2;
        roundBox(Z, 6.4, 0.5, 6.4, x, top + 0.25, z, candy(0x14141e, { rough: 0.4 }), 0.25);
        const ringM = new T.Mesh(new T.TorusGeometry(2.6, 0.18, 8, 36), glowMat(def.rainbow ? 0xffffff : def.color, 1.6));
        ringM.rotation.x = Math.PI / 2; ringM.position.set(x, top + 0.6, z); zoneGroup(Z).add(ringM);
        if (def.rainbow) tickers.push((dt, t) => { ringM.material.color.setHSL((t * 0.25) % 1, 1, 0.6).multiplyScalar(1.6); });
        const sp = billboard(trailLines(def), 7, 512, new V3(x, top + 7, z), zoneGroup(Z));
        shopItems.push({ kind: 'trail', def, sp, sig: '' });
        const tr = aabb(x, top + 2, z, 6, 4, 6); tr.zone = Z;
        tr.enter = () => actions.trail(def);
        triggers.push(tr);
    });
}
function trailLines(def) {
    const ok = def.daily ? !!S.trails[def.id] : S.rebirths >= def.reb;
    const head = def.reb ? def.reb + ' Rebirth' + (def.reb > 1 ? 's' : '') : def.daily ? def.name : 'Starter';
    const lines = [{ t: head, c: css(lighten(def.color, 0.15)), s: '#16121f', px: 56 }, { t: 'x' + def.mult + ' Step', c: '#ffffff', s: '#16121f', px: 50 }];
    lines.push(S.trail === def.id ? { t: 'EQUIPPED', c: '#6fe0ff', s: '#16121f', px: 40 } : ok ? { t: 'Step to equip', c: '#7dff6b', s: '#16121f', px: 36 } : { t: '🔒', c: '#ffd028', s: '#16121f', px: 40 });
    return lines;
}

// ----- SHOES (west): chocolate bleachers with a red pad and a sneaker for each pair -----
function shoeLines(d) {
    let sub;
    if (S.shoe === d.id) sub = { t: 'EQUIPPED', c: '#6fe0ff' };
    else if (S.shoes[d.id]) sub = { t: 'OWNED · step to equip', c: '#7dff6b' };
    else sub = { t: fmt(d.cost) + ' Wins', c: S.wins >= d.cost ? '#7dff6b' : '#ffd028' };
    return [{ t: '+' + fmt(d.bonus) + ' Steps', c: '#ffffff', s: '#16121f', px: 66 }, { ...sub, s: '#16121f', px: 52 }, { t: d.name, c: css(lighten(d.color, 0.35)), s: '#16121f', px: 36 }];
}
function buildShoes(Z) {
    const rows = 4, perRow = 4, chocoM = candy(0x6a3418, { rough: 0.5 }), padM = candy(0xe8283a, { rough: 0.4 });
    for (let r = 0; r < rows; r++) {
        const x = -32 - r * 12, top = 1.2 + r * 1.6;
        // Tier (bleacher step) with chocolate keys on its front edge
        roundBox(Z, 12, top, 64, x, top / 2, -68, chocoM, 0.4, { solid: true });
        for (let k = 0; k < perRow; k++) {
            const d = SHOES[r * perRow + k];
            if (!d) continue;
            const z = -46 - k * 15;
            roundBox(Z, 7, 0.5, 7, x, top + 0.25, z, padM, 0.3);
            glowBox(Z, 7.2, 0.12, 7.2, x, top + 0.04, z, 0xff4a6a, 1.4);
            const shoe = buildShoe(d);
            shoe.scale.setScalar(1.7);
            shoe.position.set(x, top + 0.6, z);
            shoe.rotation.y = Math.PI / 2 + 0.5;
            zoneGroup(Z).add(shoe);
            const at = new V3(x, top + 1, z);
            tickers.push((dt) => { if (zoneGroup(Z).visible && camera.position.distanceToSquared(at) < 140 * 140) shoe.rotation.y += dt * 0.6; });
            const sp = billboard(shoeLines(d), 8.5, 512, new V3(x, top + 8, z), zoneGroup(Z));
            shopItems.push({ kind: 'shoe', def: d, sp, sig: '' });
            const tr = aabb(x, top + 2, z, 6.5, 4, 6.5); tr.zone = Z;
            tr.enter = () => actions.shoe(d);
            triggers.push(tr);
        }
    }
    banner(Z, 'SHOES', ['#ffffff', '#ffb0e8'], 30, new V3(-60, 30, -98.2 + 0.2), new V3(0, 0, 1), 'More Steps on every step!');
}

// ----- Items Shop (pink booth), Gift Shop (striped stall), World portal -----
function buildShops(Z) {
    // Items Shop
    {
        const x = 14, z = -96;
        studBox(Z, 20, 16, 4, x, 8, z - 3, 0xff8ad8);
        roundBox(Z, 22, 1.4, 6, x, 16.4, z - 1.5, candy(0xffc4e6, { rough: 0.3 }), 0.5);
        roundBox(Z, 14, 3.2, 1, x, 13.4, z - 0.6, candy(0x9a4aff, { rough: 0.35 }), 0.4);
        textPlane([{ t: 'Items Shop', c: '#ffffff', s: '#2a1640', px: 96 }], 12, 1024, new V3(x, 13.4, z), new V3(x, 13.4, z + 10), zoneGroup(Z));
        roundBox(Z, 18, 3, 3, x, 1.5, z + 1, candy(0xffffff, { rough: 0.35 }), 0.5, { solid: true });
        for (const [dx, t] of [[-6, 0xff8ad0], [0, 0x8ad8ff], [6, 0xffffff]]) decor(Z, 'donut', x + dx, 7.5, z - 0.6, Math.PI / 2, 0, 0, 2.2, t);
        const wings = buildItem(itemById.angel).group; wings.position.set(x, 6, z + 0.6); wings.scale.setScalar(1.3); zoneGroup(Z).add(wings);
        tickers.push((dt, t) => { wings.rotation.y = Math.sin(t * 0.8) * 0.4; });
        const tr = aabb(x, 2, z + 5, 18, 4, 5); tr.zone = Z; tr.enter = () => actions.openShop('items'); triggers.push(tr);
    }
    // Gift Shop
    {
        const x = -14, z = -94;
        const woodM = candy(0xffd25a, { rough: 0.5 });
        for (const sx of [-7, 7]) roundBox(Z, 1, 10, 1, x + sx, 5, z + 3, woodM, 0.3);
        roundBox(Z, 16, 2.6, 6, x, 1.3, z + 1, candy(0xffffff, { rough: 0.4 }), 0.4, { solid: true });
        for (let k = 0; k < 8; k++) plainBox(Z, 2, 0.4, 8, x - 7 + k * 2 + 1, 10.6, z + 1, candy(k % 2 ? 0xffffff : 0xffc828, { rough: 0.5 }), { rx: -0.3 });
        banner(Z, 'GIFT SHOP', ['#ffffff', '#ffe36b'], 14, new V3(x, 14, z + 2), new V3(0, 0, 1), 'Gift items to friends!', '#ffffff');
        const box1 = candyModel('bonbon', 0xff5ab8); box1.position.set(x - 3, 3.6, z + 1); box1.scale.setScalar(1.2); zoneGroup(Z).add(box1);
        const box2 = candyModel('macaron', 0x8ad8ff); box2.position.set(x + 3, 3.4, z + 1); box2.scale.setScalar(1.1); zoneGroup(Z).add(box2);
        const tr = aabb(x, 2, z + 6, 14, 4, 5); tr.zone = Z; tr.enter = () => actions.openGift(); triggers.push(tr);
    }
    // World 2 portal: white studded arch with a pink swirl
    {
        const x = 0, z = -100;
        for (const sx of [-1, 1]) studBox(Z, 3, 18, 3, x + sx * 6, 9, z, 0xffffff);
        studBox(Z, 15, 3, 3, x, 19.5, z, 0xffffff);
        const sw = new T.Mesh(new T.CircleGeometry(5, 40), new T.MeshBasicMaterial({ color: 0xff5ad8, toneMapped: false }));
        sw.material.color.multiplyScalar(1.4);
        sw.position.set(x, 9.5, z + 1.6); zoneGroup(Z).add(sw);
        sw.scale.set(1, 1.7, 1);
        const swirl = textPlane([{ t: '@', c: '#ffffff', px: 300 }], 7, 256, new V3(x, 9.5, z + 1.7), new V3(x, 9.5, z + 10), zoneGroup(Z));
        tickers.push((dt, t) => { swirl.rotation.z = -t * 2; });
        banner(Z, 'World 2', ['#ffffff', '#ffb0e8'], 12, new V3(x, 25, z + 1), new V3(0, 0, 1), 'Coming soon!');
        const tr = aabb(x, 3, z + 3, 9, 6, 3); tr.zone = Z; tr.enter = () => actions.portal(); triggers.push(tr);
    }
    // Feedback board
    textPlane([{ t: 'Feedback', c: '#ff8ad8', s: '#2a1640', px: 84 }, { t: 'Thanks for playing! 💖', c: '#ffffff', s: '#2a1640', px: 58 }, { t: 'Like & favorite for updates', c: '#ffd028', s: '#2a1640', px: 50 }], 16, 1024, new V3(36, 12, LZ0 + 0.3), new V3(36, 12, LZ0 + 10), zoneGroup(Z));
}

// Labels on the shoe pads, treadmills and trails, redrawn only when what they show changes
export function refreshShop() {
    for (const it of shopItems) {
        let sig;
        if (it.kind === 'shoe') sig = S.shoe + (S.shoes[it.def.id] ? 1 : 0) + (S.wins >= it.def.cost ? 'w' : '');
        else if (it.kind === 'tread') sig = (treadOwned(it.def) ? 'o' : '') + (S.wins >= it.def.cost ? 'w' : '');
        else sig = S.trail + '|' + S.rebirths + '|' + (S.trails[it.def.id] ? 1 : 0);
        if (sig === it.sig) continue;
        it.sig = sig;
        it.sp.userData.set(it.kind === 'shoe' ? shoeLines(it.def) : it.kind === 'tread' ? treadLines(it.def) : trailLines(it.def));
    }
}
export function updateLobbySigns() { drawEventBoard(); }

// =====================================================================================
// Hazards. Everything moves on the server clock, so every player sees the same thing.
// =====================================================================================
const hazards = [];   // { zone, update(t, dt) }
function hz(zone, update) { hazards.push({ zone, update }); }
// A moving solid: place(x, topY, z) moves it and records how far it went (to carry riders)
function mover(zone, sx, sy, sz, extra) {
    const c = { min: new V3(0, -1e5, 0), max: new V3(0, -1e5, 0), zone, mover: true, delta: new V3(), half: new V3(sx / 2, sy, sz / 2), fresh: true };
    Object.assign(c, extra || {});
    solids.push(c);
    return c;
}
function place(c, x, top, z) {
    const nx = x - c.half.x, ny = top - c.half.y, nz = z - c.half.z;
    if (c.fresh) { c.delta.set(0, 0, 0); c.fresh = false; } else c.delta.set(nx - c.min.x, ny - c.min.y, nz - c.min.z);
    c.min.set(nx, ny, nz);
    c.max.set(x + c.half.x, top, z + c.half.z);
}
function killBox(zone, cause) {
    const k = { min: new V3(), max: new V3(), active: false, cause, zone };
    kills.push(k);
    return k;
}
function killTest(zone, cause, test) {
    const k = { test, active: true, cause, zone };
    kills.push(k);
    return k;
}
const cyc = (t, period, phase) => ((((t + (phase || 0)) % period) + period) % period) / period;

// ----- piston keys: big keys bobbing up and down in a wave -----
function pistons(Z, look, list, rng) {
    const dk = dynamicKeys(look, list.length, zoneGroup(Z));
    list.forEach((p, i) => {
        p.c = mover(Z, p.size * 3.24, 1, p.size * 3.24);
        dk.color(i, p.color ?? look.keys[Math.floor(rng() * look.keys.length)]);
        dk.letter(i, randomLetter(rng));
        // Stem under each piston
        cyl(Z, 0.7 * p.size, 0.9 * p.size, 40, p.x, p.base - 22, p.z, candy(shade(look.case, 0.85), { rough: 0.4 }), 10);
    });
    hz(Z, (t) => {
        list.forEach((p, i) => {
            const k = 0.5 + 0.5 * Math.sin(2 * Math.PI * cyc(t, p.period, p.phase));
            const top = p.base + k * p.amp;
            place(p.c, p.x, top, p.z);
            dk.set(i, p.x, top, p.z, p.size, p.size, 1.6);
        });
        dk.done();
    });
}
// ----- sliders: platforms gliding side to side (or forward and back) -----
function sliders(Z, list, buildVisual) {
    list.forEach((p) => {
        p.c = mover(Z, p.w, 1, p.d, p.extra);
        p.obj = buildVisual(p);
        zoneGroup(Z).add(p.obj);
    });
    hz(Z, (t) => {
        for (const p of list) {
            const k = Math.sin(2 * Math.PI * cyc(t, p.period, p.phase));
            const x = p.x + (p.ax || 0) * k, z = p.z + (p.az || 0) * k, top = p.top + (p.ay || 0) * k;
            place(p.c, x, top, z);
            p.obj.position.set(x, top, z);
        }
    });
}
// ----- lasers: beams across the corridor; sweep up and down, or blink on and off -----
const beamGeo = new T.PlaneGeometry(1, 1);
function laserBeam(Z, color) {
    const grp = new T.Group();
    const m = new T.MeshBasicMaterial({ map: beamTexture(), color, transparent: true, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false });
    m.color.multiplyScalar(3);
    const a = new T.Mesh(beamGeo, m), b = new T.Mesh(beamGeo, m);
    b.rotation.x = Math.PI / 2;
    grp.add(a, b);
    const core = new T.Mesh(new T.CylinderGeometry(0.12, 0.12, 1, 6), glowMat(0xffffff, 2.2));
    core.rotation.z = Math.PI / 2;
    grp.add(core);
    zoneGroup(Z).add(grp);
    return grp;
}
function sweepLaser(Z, color, z, y0, y1, period, phase) {
    const beam = laserBeam(Z, color);
    beam.scale.set(STAGE_W, 1.2, 1);
    for (const s of [-1, 1]) {
        const emitter = new T.Mesh(new RoundedBoxGeometry(1.6, 1.6, 2.4, 2, 0.3), candy(0x2a2a36, { rough: 0.3 }));
        emitter.position.set(s * (HW - 0.4), 0, z); zoneGroup(Z).add(emitter);
        beam.userData[s] = emitter;
    }
    const k = killBox(Z, 'laser');
    hz(Z, (t) => {
        const c = 0.5 - 0.5 * Math.cos(2 * Math.PI * cyc(t, period, phase));
        const y = y0 + (y1 - y0) * c;
        beam.position.set(0, y, z);
        beam.userData[-1].position.y = y; beam.userData[1].position.y = y;
        k.min.set(-HW, y - 0.35, z - 0.35); k.max.set(HW, y + 0.35, z + 0.35); k.active = true;
    });
}
function blinkLaser(Z, color, z, y0, h, period, onFrac, phase, x0, x1) {
    x0 = x0 ?? -HW; x1 = x1 ?? HW;
    const beams = [];
    for (let k = 0; k < Math.max(2, Math.round(h / 2.2)); k++) {
        const b = laserBeam(Z, color);
        b.scale.set(x1 - x0, 0.9, 1);
        b.position.set((x0 + x1) / 2, y0 + 0.8 + k * 2.2, z);
        beams.push(b);
    }
    for (const x of [x0, x1]) roundBox(Z, 1.4, h + 2, 1.4, x, y0 + (h + 2) / 2, z, candy(0x2a2a36, { rough: 0.3 }), 0.3);
    const kb = killBox(Z, 'laser');
    kb.min.set(x0, y0, z - 0.6); kb.max.set(x1, y0 + h, z + 0.6);
    hz(Z, (t) => {
        const c = cyc(t, period, phase);
        const on = c < onFrac, warn = !on && c > 1 - 0.14;
        kb.active = on;
        for (const b of beams) {
            b.visible = on || (warn && Math.floor(t * 14) % 2 === 0);
            b.scale.y = on ? 0.9 : 0.25;
        }
    });
}
// ----- conveyor belt (arrow keys) -----
function conveyor(Z, x, z, w, d, top, push, look) {
    const tex = arrowBeltTexture(look.case, 0xffffff).clone();
    tex.needsUpdate = true;
    const len = Math.hypot(push.x, push.z) || 1;
    // The arrows point the way the belt pushes: rotate the texture accordingly
    tex.center.set(0.5, 0.5);
    tex.rotation = Math.atan2(push.x, -push.z);
    tex.repeat.set(w / 6, d / 6);
    const m = new T.MeshStandardMaterial({ map: tex, roughness: 0.45 });
    const belt = new T.Mesh(new T.BoxGeometry(w, 1, d), [candy(shade(look.case, 0.6)), candy(shade(look.case, 0.6)), m, candy(shade(look.case, 0.6)), candy(shade(look.case, 0.6)), candy(shade(look.case, 0.6))]);
    belt.position.set(x, top - 0.5, z); belt.receiveShadow = true;
    zoneGroup(Z).add(belt);
    scrolling.push({ tex, u: 0, v: len / 6 * 0.5 });
    for (const s of [-1, 1]) {
        if (push.z !== 0) glowBox(Z, 0.4, 0.4, d, x + s * (w / 2 + 0.2), top + 0.05, z, look.accent, 1.3);
        else glowBox(Z, w, 0.4, 0.4, x, top + 0.05, z + s * (d / 2 + 0.2), look.accent, 1.3);
    }
    return solid(Z, x, top - 0.5, z, w, 1, d, { belt: new V3(push.x, 0, push.z) });
}
// ----- gumballs rolling down lanes -----
function gumballs(Z, lanes, z0, z1, floorAt, rng) {
    const colors = [0xff5a7a, 0x5ac8ff, 0xffe05a, 0x7aff8a, 0xb88aff, 0xff9a3a];
    const balls = [];
    for (const L of lanes) {
        for (let k = 0; k < L.count; k++) {
            const r = L.r;
            const mesh = new T.Mesh(new T.SphereGeometry(r, 28, 20), candy(colors[Math.floor(rng() * colors.length)], { rough: 0.1, clear: true }));
            mesh.castShadow = true;
            zoneGroup(Z).add(mesh);
            balls.push({ L, k, r, mesh });
        }
    }
    const len = z1 - z0;
    killTest(Z, 'gumball', (p) => {
        for (const b of balls) {
            if (!b.mesh.visible) continue;
            const dx = p.x - b.mesh.position.x, dy = p.y + 2.5 - b.mesh.position.y, dz = p.z - b.mesh.position.z;
            if (dx * dx + dy * dy + dz * dz < (b.r + 1.4) * (b.r + 1.4)) return true;
        }
        return false;
    });
    hz(Z, (t) => {
        for (const b of balls) {
            const travel = len / b.L.speed;
            const c = cyc(t, b.L.every * b.L.count, b.L.phase + b.k * b.L.every);
            const tt = c * b.L.every * b.L.count;
            b.mesh.visible = tt < travel;
            if (!b.mesh.visible) continue;
            const z = z1 - tt * b.L.speed;
            const x = b.L.x + Math.sin(tt * 2 + b.k) * (b.L.wobble || 0);
            b.mesh.position.set(x, floorAt(z) + b.r, z);
            b.mesh.rotation.x = -tt * b.L.speed / b.r;
        }
    });
}
// ----- spinning lollipop bars -----
function spinner(Z, x, z, top, len, h, speed, phase, color, double) {
    const grp = new T.Group(); grp.position.set(x, top, z); zoneGroup(Z).add(grp);
    const hub = new T.Mesh(new T.CylinderGeometry(1.2, 1.4, h + 1.6, 16), candy(0xffffff, { rough: 0.3 }));
    hub.position.y = (h + 1.6) / 2; hub.castShadow = true; grp.add(hub);
    const cap = candyModel('mintRed'); cap.rotation.x = -Math.PI / 2; cap.position.y = h + 1.7; cap.scale.setScalar(1.1); grp.add(cap);
    const arms = double ? 2 : 1;
    const bars = new T.Group(); grp.add(bars);
    for (let a = 0; a < arms; a++) {
        const bar = new T.Mesh(new T.CylinderGeometry(0.55, 0.55, len, 14), candy(color, { rough: 0.2, clear: true }));
        bar.rotation.z = Math.PI / 2; bar.rotation.y = a * Math.PI / 2;
        bar.position.y = h; bar.castShadow = true; bars.add(bar);
        for (const s of [-1, 1]) {
            const tip = candyModel('lolliPink'); tip.scale.setScalar(0.7);
            const dir = new V3(Math.cos(a * Math.PI / 2), 0, -Math.sin(a * Math.PI / 2)).multiplyScalar(s * len / 2);
            tip.position.set(dir.x, h + 1.2, dir.z); tip.rotation.y = a * Math.PI / 2; bars.add(tip);
        }
    }
    solids.push(Object.assign(aabb(x, top + (h + 1.6) / 2, z, 2.4, h + 1.6, 2.4), { zone: Z }));
    let ang = 0;
    killTest(Z, 'spinner', (p) => {
        if (p.y > top + h + 0.7 || p.y + 5 < top + h - 0.7) return false;
        const dx = p.x - x, dz = p.z - z;
        const r = Math.hypot(dx, dz);
        if (r > len / 2 + 1 || r < 1.4) return false;
        for (let a = 0; a < arms; a++) {
            // distance from the player to the bar's line through the hub
            const ba = ang + a * Math.PI / 2, ux = Math.cos(ba), uz = -Math.sin(ba);
            if (Math.abs(dx * uz - dz * ux) < 1.55) return true;
        }
        return false;
    });
    hz(Z, (t) => { ang = t * speed + phase; bars.rotation.y = ang; });
}
// ----- blinking (glitch) keys: solid only part of the cycle, flickering before they vanish -----
function blinkKeys(Z, look, list, rng) {
    const dk = dynamicKeys(look, list.length, zoneGroup(Z));
    list.forEach((p, i) => {
        p.c = solid(Z, p.x, p.top - 0.5, p.z, p.size * 3.24, 1, p.size * 3.24);
        dk.color(i, p.color ?? look.keys[Math.floor(rng() * look.keys.length)]);
        dk.letter(i, randomLetter(rng));
    });
    hz(Z, (t) => {
        list.forEach((p, i) => {
            const c = cyc(t, p.period, p.phase);
            const on = c < p.on, warn = on && c > p.on - 0.16;
            p.c.off = !on;
            const flick = warn && Math.floor(t * 16) % 2 === 0;
            dk.set(i, p.x, p.top, p.z, p.size, p.size, 1, !on || flick);
        });
        dk.done();
    });
}
// ----- crushers: giant computer mice slamming down -----
function crusher(Z, x, z, w, d, floor, period, phase) {
    const grp = new T.Group(); zoneGroup(Z).add(grp);
    const body = new T.Mesh(new RoundedBoxGeometry(w, 6, d, 3, 2.4), candy(0xe8eaf2, { rough: 0.25, clear: true }));
    body.castShadow = true; grp.add(body);
    for (const s of [-1, 1]) {
        const btn = new T.Mesh(new RoundedBoxGeometry(w / 2 - 0.6, 0.6, d * 0.4, 2, 0.25), candy(0xc8ccd8, { rough: 0.3 }));
        btn.position.set(s * w / 4, 3.1, -d * 0.25); grp.add(btn);
    }
    const wheel = new T.Mesh(new T.CylinderGeometry(0.5, 0.5, 1, 12), glowMat(0x4ac8ff, 1.8));
    wheel.rotation.z = Math.PI / 2; wheel.position.set(0, 3.3, -d * 0.25); grp.add(wheel);
    const cable = new T.Mesh(new T.CylinderGeometry(0.25, 0.25, 60, 6), candy(0x2a2e3e, { rough: 0.5 }));
    cable.position.set(0, 33, -d / 2 + 0.6); grp.add(cable);
    const warn = new T.Mesh(new T.CircleGeometry(Math.min(w, d) / 2, 32), new T.MeshBasicMaterial({ color: 0xff2a3a, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }));
    warn.rotation.x = -Math.PI / 2; warn.position.set(x, floor + 0.08, z); warn.scale.set(w / Math.min(w, d), d / Math.min(w, d), 1);
    zoneGroup(Z).add(warn);
    const k = killBox(Z, 'crusher');
    const UP = 14;
    hz(Z, (t) => {
        const c = cyc(t, period, phase) * period;
        // up 1.4 s, warn 0.7 s, slam 0.12 s, down 0.55 s, rise
        let y;
        if (c < 1.4) y = UP;
        else if (c < 2.1) y = UP + Math.sin(c * 40) * 0.15;
        else if (c < 2.22) y = UP * (1 - (c - 2.1) / 0.12);
        else if (c < 2.77) y = 0;
        else y = Math.min(UP, UP * (c - 2.77) / Math.max(0.2, period - 2.77));
        grp.position.set(x, floor + y + 3, z);
        warn.visible = c >= 1.2 && c < 2.3;
        warn.material.opacity = 0.35 + 0.3 * Math.sin(c * 25);
        k.active = y < 5.2;
        k.min.set(x - w / 2 + 0.4, floor, z - d / 2 + 0.4); k.max.set(x + w / 2 - 0.4, floor + y + 5.5, z + d / 2 - 0.4);
    });
    return k;
}
// ----- jelly bounce pads -----
function jellyPad(Z, x, z, top, r, power, color) {
    const m = candy(color, { rough: 0.12, clear: true, emissive: color, emissiveIntensity: 0.35 });
    m.transparent = true; m.opacity = 0.88;
    const pad = new T.Mesh(new T.CylinderGeometry(r, r * 1.08, 1.6, 28), m);
    pad.position.set(x, top - 0.8, z); pad.castShadow = true; zoneGroup(Z).add(pad);
    const dome = new T.Mesh(new T.SphereGeometry(r, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2), m);
    dome.scale.y = 0.25; dome.position.set(x, top, z); zoneGroup(Z).add(dome);
    cyl(Z, r * 0.5, r * 0.6, 30, x, top - 16, z, candy(shade(color, 0.7), { rough: 0.4 }), 12);
    const c = solid(Z, x, top - 0.5, z, r * 1.6, 1, r * 1.6, { bounce: power, onBounce: () => { dome.scale.y = 0.08; } });
    tickers.push((dt) => { dome.scale.y += (0.25 - dome.scale.y) * Math.min(1, dt * 8); });
    return c;
}
// ----- wind gusts: a zone that pushes sideways now and then (arrows show it coming) -----
export const winds = [];
function windZone(Z, z0, z1, y0, y1, period, phase, strength) {
    const w = { z0, z1, y0, y1, push: 0 };
    winds.push(w);
    const arrows = [];
    for (let k = 0; k < 6; k++) {
        const a = textPlane([{ t: '⇦', c: '#c8e8ff', s: '#16121f', px: 200 }], 6, 256, new V3(0, y0 + 6 + (k % 2) * 6, z0 + (k + 0.5) * (z1 - z0) / 6), new V3(0, y0 + 6, z0 - 100), zoneGroup(Z));
        arrows.push(a);
    }
    hz(Z, (t) => {
        const c = cyc(t, period, phase);
        // calm, warning (arrows flash), gust left, gust right
        const dir = c < 0.5 ? 1 : -1, local = (c % 0.5) / 0.5;
        const gust = local > 0.45 ? Math.sin((local - 0.45) / 0.55 * Math.PI) : 0;
        w.push = dir * gust * strength;
        const warn = local > 0.25;
        for (const a of arrows) {
            a.visible = warn && (gust > 0.1 || Math.floor(t * 6) % 2 === 0);
            a.rotation.z = dir > 0 ? 0 : Math.PI;
            a.material.opacity = 0.4 + 0.6 * gust;
        }
    });
}
// ----- falling keycaps with a red shadow warning -----
function fallingKeys(Z, look, spots, period, floorAt, rng) {
    const dk = dynamicKeys(look, spots.length, zoneGroup(Z));
    const warns = [];
    spots.forEach((s, i) => {
        dk.color(i, look.keys[Math.floor(rng() * look.keys.length)]);
        dk.letter(i, randomLetter(rng));
        const wm = new T.Mesh(new T.CircleGeometry(4.2, 28), new T.MeshBasicMaterial({ color: 0xff2a3a, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }));
        wm.rotation.x = -Math.PI / 2; wm.position.set(s.x, floorAt(s.z) + 0.1, s.z); zoneGroup(Z).add(wm);
        warns.push(wm);
        s.k = killBox(Z, 'falling key');
    });
    hz(Z, (t) => {
        spots.forEach((s, i) => {
            const c = cyc(t, period, s.phase) * period;
            const fy = floorAt(s.z);
            // warn 1.0 s, fall 0.45 s, sit 0.5 s, gone
            let y = fy + 60, vis = false;
            if (c < 1.0) { vis = false; }
            else if (c < 1.45) { vis = true; y = fy + 60 - 60 * ((c - 1.0) / 0.45) ** 2 + 1; }
            else if (c < 1.95) { vis = true; y = fy + 1; }
            warns[i].visible = c < 1.45;
            warns[i].scale.setScalar(c < 1.0 ? 0.6 + 0.4 * c : 1);
            dk.set(i, s.x, y + 2.4, s.z, 2.2, 2.2, 2.4, !vis);
            s.k.active = vis && c < 1.6;
            s.k.min.set(s.x - 3.6, y - 0.5, s.z - 3.6); s.k.max.set(s.x + 3.6, y + 3, s.z + 3.6);
        });
        dk.done();
    });
}

// =====================================================================================
// Stages
// =====================================================================================
export const checkpoints = STAGES.map(() => []);
function checkpoint(Z, s, k, x, y, z) {
    checkpoints[s.i][k] = new V3(x, y + 0.5, z);
    const pole = new T.Mesh(new T.CylinderGeometry(0.22, 0.22, 7, 8), candy(0xffffff, { rough: 0.3 }));
    pole.position.set(x + 7, y + 3.5, z); zoneGroup(Z).add(pole);
    const flag = new T.Mesh(new T.PlaneGeometry(3, 2), new T.MeshStandardMaterial({ color: s.theme.accent, side: T.DoubleSide, roughness: 0.5 }));
    flag.position.set(x + 8.5, y + 6, z); zoneGroup(Z).add(flag);
    tickers.push((dt, t) => { flag.rotation.y = Math.sin(t * 3 + z) * 0.3; });
    const tr = aabb(x, y + 3, z, STAGE_W, 8, 6); tr.zone = Z;
    tr.enter = () => actions.checkpoint(s.i, k);
    triggers.push(tr);
}
// Side walls, candy on them, the abyss far below, clouds over the top, the stage sign
function stageShell(s, rng) {
    const Z = s.i, th = s.theme;
    const bottom = s.y0 - CFG.voidDepth - 12, top = s.top + 46, len = s.zE - s.zS;
    for (const side of [-1, 1]) {
        studBox(Z, 2, top - bottom, len, side * (HW + 1), (top + bottom) / 2, (s.zS + s.zE) / 2, th.wall);
        roundBox(Z, 2.8, 1.4, len, side * (HW + 1), top + 0.7, (s.zS + s.zE) / 2, candy(th.trim, { rough: 0.3 }), 0.5);
        glowBox(Z, 0.3, 0.3, len, side * (HW - 0.05), s.y1 + 0.2, (s.zS + s.zE) / 2, th.accent, 1.2);
        wallCandy(Z, th.deco, side, s.zS + 3, s.zE - 3, s.y0 + 4, s.top + 30, rng, s.i < 3 ? 55 : 80);
    }
    // The abyss: a glowing candy-floss floor far below
    const ab = new T.Mesh(new T.PlaneGeometry(STAGE_W, len), new T.MeshBasicMaterial({ color: shade(th.accent, 0.5), toneMapped: false }));
    ab.rotation.x = -Math.PI / 2; ab.position.set(0, s.y0 - CFG.voidDepth, (s.zS + s.zE) / 2); zoneGroup(Z).add(ab);
    for (let k = 0; k < 14; k++) decor(Z, 'cloud', (rng() - 0.5) * 40, s.y0 - CFG.voidDepth + 2 + rng() * 6, s.zS + rng() * len, 0, rng() * 6, 0, 3 + rng() * 3, lighten(th.accent, 0.55));
    clouds(Z, 8, 40, 110, s.top - 20, s.top + 80, s.zS, s.zE, rng, [lighten(th.sky, 0.3), 0xffffff, lighten(th.accent, 0.6)]);
    // "😊 STAGE N 😊" over the entry, the hint under it
    banner(Z, '😊 ' + s.name.toUpperCase() + ' 😊', ['#ffffff', css(lighten(th.accent, 0.5))], 30, new V3(0, s.y0 + 26, s.zS + 3), new V3(0, 0, -1), s.sub);
}
// Keys on the entry landing (the top of the wall before) and the wall-base landing
function landings(s, rng) {
    const Z = s.i, th = s.theme;
    if (s.i > 0) keyGrid(Z, th, 0, s.zS + 10, STAGE_W, 20, s.y0, rng);
    else kbSlab(Z, th, 0, s.zS + 10, STAGE_W - 4, 20, s.y0, rng, { thick: 4 });
    kbSlab(Z, th, 0, s.zE - 12, STAGE_W - 4, 24, s.y1, rng, { thick: 8 });
    checkpoint(Z, s, 0, 0, s.y0, s.zS + 12);
    checkpoint(Z, s, 1, CLIMB_X, s.y1, s.zE - 14);
}
// The end wall: a block up to the next stage's floor, three Wins pads on its left, jump markers
// and arrows on the climbing side (right)
function endWall(s, rng) {
    const Z = s.i, th = s.theme, last = s.i === STAGES.length - 1;
    const depth = last ? SUMMIT.len : 20, bottom = s.y1 - 40;
    // The block (its top is the next stage's entry landing)
    studBox(Z, STAGE_W, s.top - 0.6 - bottom, depth, 0, (s.top - 0.6 + bottom) / 2, s.zE + depth / 2, shade(th.wall, 0.92), { solid: false });
    solid(Z, 0, (s.top + bottom) / 2, s.zE + depth / 2, STAGE_W, s.top - bottom, depth);
    roundBox(Z, STAGE_W + 1, 1.2, 1.4, 0, s.top - 0.2, s.zE - 0.2, candy(th.trim, { rough: 0.3 }), 0.5);
    // Climb lane: glowing arrows and jump markers every 5 jumps
    for (let n = 5; n <= s.jumps; n += 5) {
        const y = s.y1 + n * STUDS_PER_JUMP;
        textPlane([{ t: n + ' JUMPS', c: '#ffffff', s: css(shade(th.accent, 0.5)), px: 86 }], 9, 512, new V3(CLIMB_X, y, s.zE - 0.12), new V3(CLIMB_X, y, s.zE - 10), zoneGroup(Z));
        glowBox(Z, 14, 0.25, 0.2, CLIMB_X, y - 1.8, s.zE - 0.1, th.accent, 1.1);
    }
    for (let y = s.y1 + 3; y < s.top - 4; y += 14) textPlane([{ t: '⬆', c: css(lighten(th.accent, 0.4)), s: '#16121f', px: 200 }], 5, 256, new V3(CLIMB_X + 5.5, y + 6, s.zE - 0.12), new V3(CLIMB_X + 5.5, y + 6, s.zE - 10), zoneGroup(Z));
    textPlane([{ t: '⬆ SPAM JUMP ⬆', c: '#ffffff', s: css(shade(th.accent, 0.4)), px: 90 }, { t: s.jumps + ' JUMPS TO ' + (last ? 'ESCAPE' : 'STAGE ' + (s.i + 2)), c: '#ffd028', s: '#16121f', px: 64 }], 16, 1024, new V3(CLIMB_X, s.y1 + 8, s.zE - 0.14), new V3(CLIMB_X, s.y1 + 8, s.zE - 10), zoneGroup(Z));
    // Candy on the wall face (non-solid)
    for (let k = 0; k < Math.min(60, s.wallH / 4); k++) {
        const set = DECO_SETS[th.deco] || DECO_SETS.sweets;
        const [type, pal] = set[Math.floor(rng() * set.length)];
        const x = (rng() < 0.5 ? -1 : 1) * (HW - 3 - rng() * 2), y = s.y1 + 6 + rng() * (s.wallH - 8);
        if (x < -6 && x > CLIMB_X - 10) continue;
        decor(Z, type, x, y, s.zE - 1.2, type === 'donut' || type === 'cookie' ? Math.PI / 2 : 0, Math.PI, 0, 1.6 + rng(), pal ? pal[Math.floor(rng() * pal.length)] : undefined);
    }
    // Wins pads: ledges sticking out of the wall (yellow +1x, cyan +2x, pink +3x)
    const PADC = [0xffd028, 0x3ad8ff, 0xff5ad8];
    s.pads.forEach((p) => {
        const c = PADC[p.k];
        roundBox(Z, PAD.w, 1.2, PAD.d, p.x, p.y - 0.6, p.z, candy(c, { rough: 0.25, clear: true }), 0.35, { solid: true });
        glowBox(Z, PAD.w - 0.6, 0.08, PAD.d - 0.6, p.x, p.y + 0.02, p.z, c, 1.25);
        // A bracket under the ledge
        plainBox(Z, 1.2, 3, 1.2, p.x, p.y - 2.4, s.zE - 0.8, candy(shade(c, 0.6), { rough: 0.4 }), { rx: 0.6 });
        billboard([
            { t: '+' + fmt(p.wins) + ' Win' + (p.wins > 1 ? 's' : ''), c: css(lighten(c, 0.2)), s: '#16121f', px: 76 },
            { t: '🦘 ' + p.req + ' jump' + (p.req > 1 ? 's' : ''), c: '#ffffff', s: '#16121f', px: 46 },
        ], 7, 512, new V3(p.x, p.y + 4.6, p.z - 1), zoneGroup(Z));
        const tr = aabb(p.x, p.y + 2, p.z, PAD.w, 4, PAD.d); tr.zone = Z;
        tr.enter = () => actions.pad(s.i, p.k);
        triggers.push(tr);
    });
    if (last) buildSummit(s, rng);
}
// The summit: a golden keyboard plaza with a giant trophy and the ESCAPE pad
function buildSummit(s, rng) {
    const Z = s.i, y = s.top, z0 = s.zE;
    const gold = { keys: [0xffd028, 0xffe68a, 0xffffff, 0xffc828], ink: 0x6a4a10, glow: false };
    keyGrid(Z, gold, 0, z0 + SUMMIT.len / 2, STAGE_W, SUMMIT.len, y, rng);
    const trophy = new T.Group(); trophy.position.set(0, y, z0 + SUMMIT.len - 14); zoneGroup(Z).add(trophy);
    const goldM = new T.MeshStandardMaterial({ color: 0xffc828, roughness: 0.2, metalness: 0.85 });
    const add = (geo, px, py, pz) => { const m = new T.Mesh(geo, goldM); m.position.set(px, py, pz); m.castShadow = true; trophy.add(m); return m; };
    add(new RoundedBoxGeometry(10, 3, 10, 2, 0.5), 0, 1.5, 0);
    add(new T.CylinderGeometry(1.2, 2, 8, 16), 0, 7, 0);
    add(new T.CylinderGeometry(7, 3, 9, 28, 1, true), 0, 15.5, 0).material.side = T.DoubleSide;
    for (const sx of [-1, 1]) { const h = add(new T.TorusGeometry(2.6, 0.6, 10, 24, Math.PI), sx * 7.2, 15.5, 0); h.rotation.z = sx * Math.PI / 2; }
    tickers.push((dt, t) => { trophy.rotation.y = Math.sin(t * 0.5) * 0.3; });
    banner(Z, '👑 YOU ESCAPED! 👑', ['#ffffff', '#ffd028'], 40, new V3(0, y + 34, z0 + SUMMIT.len - 4), new V3(0, 0, -1), 'You beat all 15 stages of the keyboard!');
    roundBox(Z, 12, 0.6, 9, SUMMIT.x, y + 0.3, SUMMIT.z, candy(0xffd028, { rough: 0.2, clear: true }), 0.4);
    glowBox(Z, 11.4, 0.1, 8.4, SUMMIT.x, y + 0.62, SUMMIT.z, 0xffe06a, 1.5);
    billboard([{ t: 'ESCAPE!', c: '#ffd028', s: '#16121f', px: 90 }, { t: '+' + fmt(SUMMIT.wins) + ' Wins', c: '#ffffff', s: '#16121f', px: 56 }], 10, 512, new V3(SUMMIT.x, y + 7, SUMMIT.z), zoneGroup(Z));
    const tr = aabb(SUMMIT.x, y + 2, SUMMIT.z, 12, 4, 9); tr.zone = Z; tr.enter = () => actions.summit(); triggers.push(tr);
    for (const sx of [-1, 1]) studBox(Z, 2, 60, SUMMIT.len, sx * (HW + 1), y + 30, z0 + SUMMIT.len / 2, s.theme.wall);
    studBox(Z, STAGE_W + 4, 60, 2, 0, y + 30, z0 + SUMMIT.len + 1, s.theme.wall);
}

// ----- the 15 stage layouts. Each fills the corridor from zA to zB, rising from y0 to y1 -----
const BUILD = {
    // 1. Candy Keys: keyboard tiers stacked like the reference, no gaps
    tiers(s, rng, Z, th, zA, zB) {
        const n = 5, step = (zB - zA) / n;
        for (let k = 0; k < n; k++) {
            const top = s.y0 + (s.rise * k) / (n - 1);
            kbSlab(Z, th, 0, zA + (k + 0.5) * step, STAGE_W - 4, step - 2, top, rng, { thick: Math.max(4, top - s.y0 + 4) });
        }
    },
    // 2. Spacebar Bridges: long space bars and floating keys over the void
    bridges(s, rng, Z, th, zA, zB) {
        const y = s.y0;
        spaceBar(Z, th, 0, zA + 12, 22, y, 12, { color: 0xffffff });
        spaceBar(Z, th, -12, zA + 41, 22, y + 2, 9, { color: th.keys[0] });
        spaceBar(Z, th, 11, zA + 69, 22, y + 4, 9, { color: th.keys[2] });
        spaceBar(Z, th, -2, zA + 96, 18, y + 5.5, 8, { color: 0xffffff });
        const stones = [[8, 112, 7], [-6, 122, 8.5], [6, 132, 10], [-4, 142, 11]];
        for (const [x, dz, h] of stones) if (zA + dz < zB - 4) keyStone(Z, th, x, zA + dz, 1.6, y + h, rng);
    },
    // 3. Typing Keys: three rows of piston keys bobbing in a wave
    pistons(s, rng, Z, th, zA, zB) {
        const list = [], rows = Math.floor((zB - zA - 6) / 9);
        for (let r = 0; r < rows; r++) {
            const base = s.y0 - 2 + (s.rise * r) / rows;
            for (const x of [-13, 0, 13]) {
                if ((r + (x > 0 ? 1 : x < 0 ? 2 : 0)) % 3 === 2 && r % 4 !== 0) continue;
                list.push({ x, z: zA + 6 + r * 9, base, amp: 6, size: 1.7, period: 2.8 + (x === 0 ? 0.4 : 0), phase: r * 0.35 + (x + 13) * 0.04 });
            }
        }
        pistons(Z, th, list, rng);
        // A static rest key every few rows
        for (let r = 4; r < rows; r += 5) keyStone(Z, th, 21, zA + 6 + r * 9, 0.9, s.y0 + (s.rise * r) / rows + 2, rng);
    },
    // 4. Chocolate River: cookies sliding over a flowing chocolate river, wafer bridges
    river(s, rng, Z, th, zA, zB) {
        const y = s.y0, riverY = y - 4;
        const tex = chocoRiverTexture().clone(); tex.needsUpdate = true; tex.repeat.set(4, (zB - zA) / 12);
        const rm = new T.MeshStandardMaterial({ map: tex, roughness: 0.15, metalness: 0.1, color: 0xffffff });
        const river = new T.Mesh(new T.PlaneGeometry(STAGE_W, zB - zA + 8), rm);
        river.rotation.x = -Math.PI / 2; river.position.set(0, riverY, (zA + zB) / 2); zoneGroup(Z).add(river);
        scrolling.push({ tex, u: 0, v: -0.25 });
        const k = killBox(Z, 'chocolate'); k.min.set(-HW, riverY - 10, zA - 4); k.max.set(HW, riverY + 0.4, zB + 4); k.active = true;
        const list = [];
        for (let r = 0; r < 9; r++) {
            const z = zA + 10 + r * 17;
            if (z > zB - 6) break;
            list.push({ x: 0, z, top: y + (s.rise * r) / 9, w: 7.6, d: 7.6, ax: r % 2 ? 13 : -13, period: 3.6 + (r % 3) * 0.6, phase: r * 0.9 });
        }
        sliders(Z, list, () => {
            const c = candyModel('cookie'); c.scale.set(2.75, 1.6, 2.75);
            const grp = new T.Group(); c.position.y = -0.29; grp.add(c); return grp;
        });
        // Wafer bridges on alternate sides
        for (let r = 1; r < 9; r += 3) {
            const z = zA + 18 + r * 17;
            if (z > zB - 12) break;
            const top = y + (s.rise * (r + 0.5)) / 9;
            plainBox(Z, 5, 1, 12, (r % 2 ? 1 : -1) * 18, top - 0.5, z, candy(0xe8b064, { rough: 0.7 }), { solid: true, extra: {} });
        }
        for (let k2 = 0; k2 < 12; k2++) decor(Z, 'chocobar', (rng() - 0.5) * 40, riverY + 0.3, zA + rng() * (zB - zA), 0, rng() * 6, 0, 1.6);
    },
    // 5. Caps Lock Lasers: tiers with sweeping lasers and blinking laser gates
    lasers(s, rng, Z, th, zA, zB) {
        const n = 6, step = (zB - zA) / n;
        for (let k = 0; k < n; k++) {
            const top = s.y0 + (s.rise * k) / (n - 1);
            kbSlab(Z, th, 0, zA + (k + 0.5) * step, STAGE_W - 4, step - 1, top, rng, { thick: Math.max(4, top - s.y0 + 4) });
            const zc = zA + (k + 0.5) * step;
            if (k % 2 === 0) sweepLaser(Z, 0xff2ad0, zc, top + 0.6, top + 9, 2.6 + k * 0.1, k * 0.7);
            else blinkLaser(Z, 0x3affd8, zc, top, 8, 2.8, 0.5, k * 0.6);
        }
    },
    // 6. Arrow Key Conveyors over the void
    conveyors(s, rng, Z, th, zA, zB) {
        const y = s.y0;
        conveyor(Z, 0, zA + 18, 14, 36, y, new V3(0, 0, -15), th);
        conveyor(Z, -10, zA + 60, 12, 32, y + 3, new V3(9, 0, 0), th);
        conveyor(Z, 10, zA + 101, 12, 34, y + 6, new V3(0, 0, -22), th);
        conveyor(Z, -2, zA + 133, 30, 14, y + 9, new V3(-12, 0, 0), th);
        keyStone(Z, th, 14, zA + 149, 1.4, y + 10, rng);
        keyStone(Z, th, 2, zA + 158, 1.4, y + 11, rng);
        keyStone(Z, th, -8, zA + 167, 1.4, y + 11.5, rng);
    },
    // 7. Gumball Alley: a long keyboard ramp with giant gumballs rolling down it
    gumballs(s, rng, Z, th, zA, zB) {
        // Steps of 1.67 studs: walkable without jumping (the auto-step is 1.7)
        const steps = 18, step = (zB - zA) / steps;
        for (let k = 0; k < steps; k++) {
            const top = s.y0 + (s.rise * (k + 1)) / steps;
            kbSlab(Z, th, 0, zA + (k + 0.5) * step, STAGE_W - 4, step, top, rng, { thick: top - s.y0 + 6 });
        }
        const stepFloor = (z) => s.y0 + (s.rise * (Math.min(steps - 1, Math.max(0, Math.floor((z - zA) / step))) + 1)) / steps;
        gumballs(Z, [
            { x: -14, r: 4.2, speed: 30, every: 2.2, count: 3, phase: 0, wobble: 2 },
            { x: 1, r: 4.2, speed: 34, every: 1.9, count: 3, phase: 0.7, wobble: 1.5 },
            { x: 15, r: 4.2, speed: 28, every: 2.6, count: 3, phase: 1.3, wobble: 2 },
        ], zA, zB, stepFloor, rng);
        // Safe nooks: keycap shields to hide behind
        for (let k = 2; k < steps - 1; k += 3) for (const x of [-7.5, 8]) {
            const z = zA + (k + 0.5) * step;
            keyStone(Z, th, x, z + 2, 1, stepFloor(z) + 3.2, rng, { stem: false });
        }
    },
    // 8. Slippery Frosting: icy keys, narrow paths and gliding ice blocks over the void
    ice(s, rng, Z, th, zA, zB) {
        const y = s.y0, ice = { ice: true };
        const path = [[0, 10, 30, 14, 0], [-10, 38, 8, 22, 2], [6, 58, 22, 6, 3], [14, 80, 8, 26, 4.5]];
        for (const [x, dz, w, d, h] of path) {
            kbSlab(Z, th, x, zA + dz, w, d, y + h, rng, { thick: 3, extra: ice, caseColor: 0x9ad8ff });
        }
        const list = [];
        for (let r = 0; r < 4; r++) list.push({ x: 0, z: zA + 104 + r * 14, top: y + 6 + r * 1.5, w: 8, d: 8, ax: r % 2 ? 12 : -12, period: 3.2 + r * 0.4, phase: r * 1.1, extra: ice });
        sliders(Z, list, () => { const g = new T.Group(); const m = new T.Mesh(new RoundedBoxGeometry(8, 1.6, 8, 2, 0.5), candy(0xc8eaff, { rough: 0.05, clear: true })); m.position.y = -0.8; m.castShadow = true; g.add(m); return g; });
        kbSlab(Z, th, -12, zA + 166, 16, 10, y + s.rise - 1.5, rng, { thick: 3, extra: ice, caseColor: 0x9ad8ff });
    },
    // 9. Lollipop Spinners: peppermint discs with spinning bars
    spinners(s, rng, Z, th, zA, zB) {
        const discs = 5, gap = (zB - zA) / discs;
        for (let k = 0; k < discs; k++) {
            const z = zA + (k + 0.5) * gap, top = s.y0 + (s.rise * k) / (discs - 1);
            // A peppermint disc: red rim, white top, keys in the middle
            cyl(Z, 15, 15, 2, 0, top - 1.6, z, candy(0xff5a6a, { rough: 0.2, clear: true }), 40);
            cyl(Z, 13.6, 13.6, 2.04, 0, top - 1.6, z, candy(0xffffff, { rough: 0.2, clear: true }), 40);
            keyGrid(Z, th, 0, z, 20, 20, top, rng);
            solids.push(Object.assign(aabb(0, top - 1.3, z, 27, 2.6, 27), { zone: Z }));
            // Low bars: jump them. High bars (above your head): don't jump into them!
            spinner(Z, 0, z, top, 28, k % 2 ? 6.4 : 1.6, (k % 2 ? -1 : 1) * (1.3 + k * 0.12), k, k % 2 ? 0xff3a50 : 0xffffff, k >= 3);
            if (k < discs - 1) plainBox(Z, 6, 1, gap - 28, 0, top - 0.5 + (s.rise / (discs - 1)) / 2, z + gap / 2, candy(0xffffff, { rough: 0.3 }), { solid: true });
        }
    },
    // 10. Glitch Keys: keys blink in and out over the void
    glitch(s, rng, Z, th, zA, zB) {
        const list = [], rows = Math.floor((zB - zA - 4) / 8.5);
        for (let r = 0; r < rows; r++) {
            const top = s.y0 + (s.rise * r) / rows;
            for (const x of [-12, 0, 12]) {
                if ((r * 7 + x) % 3 === 0 && r % 3) continue;
                list.push({ x: x + (r % 2 ? 3 : -3), z: zA + 5 + r * 8.5, top, size: 1.5, period: 3.6, on: 0.62, phase: ((r * 0.9 + (x + 12) * 0.05) % 3.6) });
            }
        }
        blinkKeys(Z, th, list, rng);
        for (let k = 1; k < 4; k++) blinkLaser(Z, 0x3affd8, zA + k * (zB - zA) / 4, s.y0 + (s.rise * k) / 4 - 2, 10, 3.2, 0.35, k * 1.1);
    },
    // 11. Mouse Click Crushers: giant mice slam down across the path
    crushers(s, rng, Z, th, zA, zB) {
        const n = 6, step = (zB - zA) / n;
        for (let k = 0; k < n; k++) {
            const top = s.y0 + (s.rise * k) / (n - 1), zc = zA + (k + 0.5) * step;
            kbSlab(Z, th, 0, zc, STAGE_W - 4, step - 1, top, rng, { thick: Math.max(4, top - s.y0 + 4) });
            const cols = k % 2 ? [-12, 12] : [-16, 0, 16];
            cols.forEach((x, i) => crusher(Z, x, zc, cols.length === 2 ? 22 : 15, 14, top, 3.1 + (k % 3) * 0.3, k * 0.8 + i * 1.05));
        }
    },
    // 12. RGB Gaming Rig: pistons, sweeping lasers and conveyors on a backlit keyboard
    rgb(s, rng, Z, th, zA, zB) {
        const y = s.y0;
        kbSlab(Z, th, 0, zA + 14, STAGE_W - 4, 26, y, rng, { thick: 4 });
        sweepLaser(Z, 0xff3a5a, zA + 14, y + 0.6, y + 9, 2.4, 0);
        const list = [];
        for (let r = 0; r < 8; r++) for (const x of [-12, 0, 12]) {
            if ((r + x / 12 + 3) % 2 === 0) continue;
            list.push({ x, z: zA + 33 + r * 8.5, base: y + 1 + r * 0.6, amp: 7, size: 1.6, period: 2.4, phase: r * 0.45 + x * 0.03 });
        }
        pistons(Z, th, list, rng);
        conveyor(Z, 0, zA + 114, 16, 28, y + 7, new V3(0, 0, -24), th);
        kbSlab(Z, th, 0, zA + 140, STAGE_W - 4, 16, y + 9, rng, { thick: 4 });
        blinkLaser(Z, 0x3affff, zA + 136, y + 9, 9, 2.2, 0.5, 0.4);
        sweepLaser(Z, 0xff3ad8, zA + 144, y + 9.6, y + 18, 2.2, 1.1);
        const list2 = [];
        for (let r = 0; r < 6; r++) list2.push({ x: (r % 2 ? 9 : -9), z: zA + 158 + r * 8, base: y + 10 + r * 0.6, amp: 5, size: 1.8, period: 2.2, phase: r * 0.6 });
        pistons(Z, th, list2, rng);
    },
    // 13. Jelly Bounce: bounce pads launch you over big gaps, spinners on the landings
    jelly(s, rng, Z, th, zA, zB) {
        const y = s.y0, cols = [0xa8ff5a, 0xff8ae0, 0xffe05a, 0x5ae0ff];
        let z = zA + 8, top = y;
        // Bounce pad -> landing (with a spinner on the later ones), four times over
        for (let k = 0; k < 4; k++) {
            jellyPad(Z, k % 2 ? 8 : -8, z, top, 5, 92, cols[k % cols.length]);
            z += 30; top += (s.rise - 2) / 4;
            kbSlab(Z, th, k % 2 ? -6 : 6, z, 22, 14, top, rng, { thick: 3 });
            if (k >= 1) spinner(Z, k % 2 ? -6 : 6, z, top, 18, 1.6, (k % 2 ? 1 : -1) * 1.6, k, cols[(k + 1) % cols.length], false);
            z += 12;
        }
        // A jelly block bobbing up and down, then a last key before the wall
        const list = [{ x: 0, z: z + 4, top: top + 1, w: 8, d: 8, ay: 3, period: 2.6, phase: 0 }];
        sliders(Z, list, () => { const g = new T.Group(); const m = new T.Mesh(new RoundedBoxGeometry(8, 1.6, 8, 2, 0.6), candy(0xc89aff, { rough: 0.1, clear: true })); m.position.y = -0.8; g.add(m); return g; });
        keyStone(Z, th, -8, Math.min(zB - 6, z + 22), 1.6, s.y1 - 1, rng);
    },
    // 14. Sugar Storm: narrow walkways, wind gusts and keys falling from the sky
    storm(s, rng, Z, th, zA, zB) {
        const y = s.y0;
        const segs = [[0, 0, 40, 10], [-14, 44, 36, 8], [8, 86, 40, 8], [-6, 130, 30, 10], [10, 164, 26, 12], [0, 194, 20, 14]];
        const tops = [];
        segs.forEach(([x, dz, len, w], i) => {
            const top = y + (s.rise * i) / (segs.length - 1);
            tops.push([zA + dz, zA + dz + len, top]);
            kbSlab(Z, th, x, zA + dz + len / 2, w, len, top, rng, { thick: 3 });
            if (i < segs.length - 1) {
                const nx = segs[i + 1][0];
                plainBox(Z, Math.abs(nx - x) + 6, 1, 4, (x + nx) / 2, top + (s.rise / (segs.length - 1)) / 2 - 0.5, zA + dz + len + 2, candy(th.case, { rough: 0.4 }), { solid: true });
            }
            windZone(Z, zA + dz, zA + dz + len, top, top + 20, 7, i * 1.7, 14 + i * 3);
        });
        const floorAt = (zz) => { for (const [a, b, t] of tops) if (zz >= a && zz <= b + 4) return t; return y; };
        const spots = [];
        segs.forEach(([x, dz, len], i) => { for (let k = 0; k < 3; k++) spots.push({ x: x + (rng() - 0.5) * 4, z: zA + dz + (k + 0.5) * len / 3, phase: i * 0.7 + k * 1.3 }); });
        fallingKeys(Z, th, spots, 3.4, floorAt, rng);
        // Lightning flashes in the sky
        const flash = new T.Mesh(new T.PlaneGeometry(400, 300), new T.MeshBasicMaterial({ color: 0xeaf4ff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
        flash.position.set(0, s.top + 80, (zA + zB) / 2); flash.rotation.x = Math.PI / 2; zoneGroup(Z).add(flash);
        hz(Z, (t) => { const c = cyc(t, 9, 0.3) * 9; flash.material.opacity = c < 0.12 || (c > 0.25 && c < 0.33) ? 0.6 : 0; });
    },
    // 15. Rainbow Finale: a bit of everything on a rainbow keyboard
    finale(s, rng, Z, th, zA, zB) {
        const y = s.y0;
        kbSlab(Z, th, 0, zA + 12, STAGE_W - 4, 22, y, rng, { thick: 4 });
        spinner(Z, 0, zA + 12, y, 36, 1.6, 1.8, 0, 0xffe05a, true);
        const list = [];
        for (let r = 0; r < 6; r++) for (const x of [-10, 4]) list.push({ x: x + (r % 2) * 6, z: zA + 30 + r * 8.5, top: y + 1 + r * 0.8, size: 1.4, period: 3, on: 0.58, phase: r * 0.55 + (x > 0 ? 1.4 : 0) });
        blinkKeys(Z, th, list, rng);
        const top2 = y + 6;
        const steps = 6, zr = zA + 86, step = 8;
        for (let k = 0; k < steps; k++) kbSlab(Z, th, 0, zr + (k + 0.5) * step, STAGE_W - 4, step, top2 + k * 0.9, rng, { thick: 4 });
        const floorRamp = (z) => top2 + Math.max(0, Math.min(steps - 1, Math.floor((z - zr) / step))) * 0.9;
        gumballs(Z, [{ x: -10, r: 3.6, speed: 26, every: 2.4, count: 2, phase: 0, wobble: 2 }, { x: 10, r: 3.6, speed: 30, every: 2.1, count: 2, phase: 1, wobble: 2 }], zr, zr + steps * step, floorRamp, rng);
        const top3 = top2 + steps * 0.9;
        kbSlab(Z, th, 0, zA + 150, STAGE_W - 4, 20, top3, rng, { thick: 4 });
        sweepLaser(Z, 0xffe05a, zA + 146, top3 + 0.6, top3 + 9, 2.2, 0.5);
        blinkLaser(Z, 0xff5ad8, zA + 156, top3, 9, 2.6, 0.45, 1.2);
        const crusherTop = top3;
        crusher(Z, -10, zA + 176, 18, 12, crusherTop, 3, 0.2);
        crusher(Z, 10, zA + 176, 18, 12, crusherTop, 3, 1.7);
        kbSlab(Z, th, 0, zA + 176, STAGE_W - 4, 16, crusherTop, rng, { thick: 4 });
        if (zA + 194 < zB) kbSlab(Z, th, 0, (zA + 186 + zB) / 2, STAGE_W - 4, zB - zA - 186, s.y1, rng, { thick: 4 });
    },
};
function buildStage(s) {
    const rng = rngFrom(100 + s.i * 37), Z = s.i, th = s.theme;
    const zA = s.zS + 20, zB = s.zE - 24;
    stageShell(s, rng);
    landings(s, rng);
    BUILD[s.type](s, rng, Z, th, zA, zB);
    endWall(s, rng);
}

// =====================================================================================
// Per frame: hazards near the player, RGB keys, floating sweets
// =====================================================================================
export function updateWorld(dt, stage) {
    const t = net.now() / 1000;
    tickKeys(t);
    for (const h of hazards) if (Math.abs(h.zone - Math.max(0, stage)) <= 1) h.update(t, dt);
    if (floaters.parent && floaters.parent.visible) {
        floaters.position.y = Math.sin(t * 0.6) * 1.2;
        for (const m of floaters.children) m.rotation.y += m.userData.spin * dt;
    }
}
export function windAt(p) {
    for (const w of winds) if (p.z >= w.z0 && p.z <= w.z1 && p.y >= w.y0 - 2 && p.y <= w.y1) return w.push;
    return 0;
}
export function buildWorld() {
    buildLobby();
    STAGES.forEach((s) => buildStage(s));
    flushGeo();
    flushKeys(zoneGroup);
    flushDecor(zoneGroup);
    refreshShop();
    drawEventBoard();
    cullZones(-1);
}
// Facing a stage's wall from its climbing lane (for the Teleport menu and Auto Train)
export function stageStart(i) {
    const s = STAGES[i];
    return { pos: checkpoints[i][0] ? checkpoints[i][0].clone() : new V3(0, s.y0 + 0.5, s.zS + 12), yaw: 0 };
}
export const jumpsNow = () => jumpsFor(S.level, S.rebirths);
