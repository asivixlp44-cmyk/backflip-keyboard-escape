// Candy decorations (donuts, ice creams, lollipops, peppermints ...) drawn as instanced meshes,
// plus the wearable items (wings, halos, crown, jetpack) and the shoe models.
import { T, V3, scene, candy, mat, NEON_BOOST, toLambert } from './engine.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { KEYCAP, keyMaterial } from './keys.js';
import {
    swirlTexture, peppermintTexture, stripeTexture, waffleTexture, cookieTexture, chocoBarTexture, rainbowTexture,
} from './textures.js';
import { rngFrom } from '../../shared/config.js';

const M = (pos, rot, scl) => new T.Matrix4().compose(pos || new V3(), new T.Quaternion().setFromEuler(new T.Euler(...(rot || [0, 0, 0]))), scl || new V3(1, 1, 1));
const SPRINKLES = [0xff3a5a, 0x3ad8ff, 0xffe05a, 0x7aff5a, 0xffffff, 0xb85aff, 0xff8a2a];
export const FROSTING = [0xff8ad0, 0xffffff, 0x7a4022, 0x8ad8ff, 0xc89aff, 0xffe08a];
export const SCOOPS = [0xffc8e0, 0xfff4e0, 0x9a5a32, 0xb8f0d0, 0xffe08a, 0xc8b0ff];
export const PASTELS = [0xff8ad0, 0x8ad8ff, 0xffe08a, 0xb8ff9a, 0xc89aff, 0xffb08a];

// ----- part library -----
const G = {
    // low-poly like the top games: thousands of these are drawn (instanced) at once
    torus: new T.TorusGeometry(1, 0.42, 6, 12),
    frost: new T.TorusGeometry(1, 0.44, 6, 12),
    sprinkle: new T.CapsuleGeometry(0.05, 0.22, 1, 4),
    sphere: new T.SphereGeometry(1, 10, 6),
    sphereLo: new T.SphereGeometry(1, 8, 6),
    cone: new T.ConeGeometry(0.88, 2.6, 12, 1, true),
    disc: new T.CylinderGeometry(1, 1, 1, 20),
    stick: new T.CylinderGeometry(0.11, 0.11, 1, 8),
    wrap: new T.ConeGeometry(0.55, 0.8, 8),
    liner: new T.CylinderGeometry(0.95, 0.72, 1.2, 12),
    swirl: new T.ConeGeometry(0.95, 1.5, 12),
    box: new T.BoxGeometry(1, 1, 1),
    drop: new T.CylinderGeometry(0.55, 0.95, 1.0, 10),
};
// Candy cane: a tube along a hook
{
    const pts = [];
    for (let k = 0; k <= 12; k++) pts.push(new V3(0, -2.4 + k * 0.4, 0));
    for (let k = 1; k <= 10; k++) { const a = Math.PI * k / 10; pts.push(new V3(0.75 - Math.cos(a) * 0.75, 2.4 + Math.sin(a) * 0.75, 0)); }
    G.cane = new T.TubeGeometry(new T.CatmullRomCurve3(pts), 40, 0.26, 10, false);
}
const MAT = {
    dough: candy(0xe0a060, { rough: 0.55 }),
    frost: candy(0xffffff, { rough: 0.28 }),
    sprinkle: candy(0xffffff, { rough: 0.4 }),
    cone: (() => { const m = candy(0xffffff, { rough: 0.7 }); m.map = waffleTexture(); m.map.repeat.set(3, 2); m.side = T.DoubleSide; return m; })(),
    scoop: candy(0xffffff, { rough: 0.45 }),
    cherry: candy(0xe8182c, { rough: 0.15, clear: true }),
    stick: candy(0xffffff, { rough: 0.5 }),
    wrap: mat(0xffffff, { opacity: 0.55, rough: 0.2 }),
    liner: (() => { const m = candy(0xffffff, { rough: 0.6 }); m.map = stripeTexture(0xffffff, 0xffd0ea, 6); return m; })(),
    cookie: (() => { const m = candy(0xffffff, { rough: 0.8 }); m.map = cookieTexture(); return m; })(),
    cookieSide: candy(0xd89a52, { rough: 0.85 }),
    choco: (() => { const m = candy(0xffffff, { rough: 0.35 }); m.map = chocoBarTexture(); m.map.repeat.set(3, 2); return m; })(),
    foil: toLambert({ color: 0xd8d8e4, roughness: 0.25, metalness: 0.9 }),
    paper: candy(0xe8283a, { rough: 0.6 }),
    waffle: (() => { const m = candy(0xffffff, { rough: 0.7 }); m.map = waffleTexture(); m.map.repeat.set(2, 2); return m; })(),
    cane: (() => { const m = candy(0xffffff, { rough: 0.18, clear: true }); m.map = stripeTexture(0xffffff, 0xe8182c, 3); m.map.repeat.set(1, 8); return m; })(),
    gum: candy(0xffffff, { rough: 0.12, clear: true }),
    cloud: candy(0xffffff, { rough: 0.95 }),
};
const swirlMat = (colors) => { const m = candy(0xffffff, { rough: 0.15, clear: true }).clone(); m.map = swirlTexture(colors, 3); return m; };
const mintMat = (color) => { const m = candy(0xffffff, { rough: 0.12, clear: true }).clone(); m.map = peppermintTexture(color); return m; };
const lolliMats = { rainbow: swirlMat([0xff4a6a, 0xffb84a, 0xffe85a, 0x6aff8a, 0x5ac8ff, 0xb88aff]), pink: swirlMat([0xff6ac8, 0xffffff, 0xff9ae0, 0xffffff]), blue: swirlMat([0x4ab8ff, 0xffffff, 0x8ae0ff, 0xffffff]) };
const mintMats = { red: mintMat(0xe8283a), green: mintMat(0x2ac85a), blue: mintMat(0x2a8aff) };

// type -> parts: { g, m, l: local matrix (or list), tint: 'variant' | palette array | fixed hex }
const TYPES = {
    donut: [
        { g: G.torus, m: MAT.dough, l: M(null, [Math.PI / 2, 0, 0]) },
        { g: G.frost, m: MAT.frost, l: M(new V3(0, 0.14, 0), [Math.PI / 2, 0, 0], new V3(1.03, 1.03, 0.72)), tint: 'variant' },
        { g: G.sprinkle, m: MAT.sprinkle, l: (() => { const r = rngFrom(5), out = []; for (let k = 0; k < 12; k++) { const a = r() * Math.PI * 2, d = 0.72 + r() * 0.56; out.push(M(new V3(Math.cos(a) * d, 0.5, Math.sin(a) * d), [Math.PI / 2, 0, r() * 3])); } return out; })(), tint: SPRINKLES },
    ],
    icecream: [
        { g: G.cone, m: MAT.cone, l: M(new V3(0, -1.3, 0), [Math.PI, 0, 0]) },
        { g: G.sphere, m: MAT.scoop, l: M(new V3(0, 0.3, 0), null, new V3(0.98, 0.9, 0.98)), tint: 'variant' },
        { g: G.torus, m: MAT.scoop, l: M(new V3(0, 0.02, 0), [Math.PI / 2, 0, 0], new V3(0.86, 0.86, 0.6)), tint: 'variant' },
        { g: G.sphere, m: MAT.scoop, l: M(new V3(0, 1.2, 0), null, new V3(0.78, 0.72, 0.78)), tint: SCOOPS },
        { g: G.sphereLo, m: MAT.cherry, l: M(new V3(0, 2.02, 0), null, new V3(0.24, 0.24, 0.24)) },
    ],
    lolliRainbow: [
        { g: G.disc, m: lolliMats.rainbow, l: M(null, [Math.PI / 2, 0, 0], new V3(1.5, 0.36, 1.5)) },
        { g: G.stick, m: MAT.stick, l: M(new V3(0, -2.6, 0), null, new V3(1, 3.2, 1)) },
    ],
    lolliPink: [
        { g: G.disc, m: lolliMats.pink, l: M(null, [Math.PI / 2, 0, 0], new V3(1.5, 0.36, 1.5)) },
        { g: G.stick, m: MAT.stick, l: M(new V3(0, -2.6, 0), null, new V3(1, 3.2, 1)) },
    ],
    lolliBlue: [
        { g: G.disc, m: lolliMats.blue, l: M(null, [Math.PI / 2, 0, 0], new V3(1.5, 0.36, 1.5)) },
        { g: G.stick, m: MAT.stick, l: M(new V3(0, -2.6, 0), null, new V3(1, 3.2, 1)) },
    ],
    mintRed: [
        { g: G.disc, m: mintMats.red, l: M(null, [Math.PI / 2, 0, 0], new V3(1.25, 0.5, 1.25)) },
        { g: G.wrap, m: MAT.wrap, l: M(new V3(1.55, 0, 0), [0, 0, -Math.PI / 2]) },
        { g: G.wrap, m: MAT.wrap, l: M(new V3(-1.55, 0, 0), [0, 0, Math.PI / 2]) },
    ],
    mintGreen: [
        { g: G.disc, m: mintMats.green, l: M(null, [Math.PI / 2, 0, 0], new V3(1.25, 0.5, 1.25)) },
        { g: G.wrap, m: MAT.wrap, l: M(new V3(1.55, 0, 0), [0, 0, -Math.PI / 2]) },
        { g: G.wrap, m: MAT.wrap, l: M(new V3(-1.55, 0, 0), [0, 0, Math.PI / 2]) },
    ],
    mintBlue: [
        { g: G.disc, m: mintMats.blue, l: M(null, [Math.PI / 2, 0, 0], new V3(1.25, 0.5, 1.25)) },
        { g: G.wrap, m: MAT.wrap, l: M(new V3(1.55, 0, 0), [0, 0, -Math.PI / 2]) },
        { g: G.wrap, m: MAT.wrap, l: M(new V3(-1.55, 0, 0), [0, 0, Math.PI / 2]) },
    ],
    bonbon: [
        { g: G.sphere, m: MAT.gum, l: M(null, null, new V3(1.1, 0.85, 0.85)), tint: 'variant' },
        { g: G.wrap, m: MAT.gum, l: M(new V3(1.35, 0, 0), [0, 0, Math.PI / 2], new V3(1, 0.8, 1)), tint: 'variant' },
        { g: G.wrap, m: MAT.gum, l: M(new V3(-1.35, 0, 0), [0, 0, -Math.PI / 2], new V3(1, 0.8, 1)), tint: 'variant' },
    ],
    macaron: [
        { g: G.sphere, m: MAT.scoop, l: M(new V3(0, 0.36, 0), null, new V3(1.2, 0.42, 1.2)), tint: 'variant' },
        { g: G.disc, m: MAT.frost, l: M(null, null, new V3(1.08, 0.3, 1.08)) },
        { g: G.sphere, m: MAT.scoop, l: M(new V3(0, -0.36, 0), null, new V3(1.2, 0.42, 1.2)), tint: 'variant' },
    ],
    cupcake: [
        { g: G.liner, m: MAT.liner, l: M(new V3(0, -0.6, 0)) },
        { g: G.torus, m: MAT.frost, l: M(new V3(0, 0.1, 0), [Math.PI / 2, 0, 0], new V3(0.78, 0.78, 0.9)), tint: 'variant' },
        { g: G.swirl, m: MAT.frost, l: M(new V3(0, 0.75, 0)), tint: 'variant' },
        { g: G.sphereLo, m: MAT.cherry, l: M(new V3(0, 1.6, 0), null, new V3(0.28, 0.28, 0.28)) },
    ],
    cookie: [
        { g: G.disc, m: [MAT.cookieSide, MAT.cookie, MAT.cookie], l: M(null, null, new V3(1.45, 0.36, 1.45)) },
    ],
    cane: [{ g: G.cane, m: MAT.cane, l: M() }],
    gumball: [{ g: G.sphere, m: MAT.gum, l: M(), tint: 'variant' }],
    gumdrop: [
        { g: G.drop, m: MAT.gum, l: M(new V3(0, -0.2, 0)), tint: 'variant' },
        { g: G.sphereLo, m: MAT.gum, l: M(new V3(0, 0.3, 0), null, new V3(0.55, 0.42, 0.55)), tint: 'variant' },
    ],
    chocobar: [
        { g: G.box, m: MAT.choco, l: M(null, null, new V3(3, 0.42, 1.6)) },
        { g: G.box, m: MAT.foil, l: M(new V3(0.9, -0.02, 0), null, new V3(1.3, 0.48, 1.66)) },
        { g: G.box, m: MAT.paper, l: M(new V3(1.05, -0.02, 0), null, new V3(1.0, 0.52, 1.7)) },
    ],
    waffle: [{ g: G.box, m: MAT.waffle, l: M(null, null, new V3(2.6, 0.42, 2.6)) }],
    cloud: [
        { g: G.sphereLo, m: MAT.cloud, l: [M(null, null, new V3(1.4, 1.1, 1.2)), M(new V3(1.3, -0.15, 0.2), null, new V3(1.05, 0.85, 0.95)), M(new V3(-1.35, -0.2, -0.1), null, new V3(1.1, 0.8, 1)), M(new V3(0.4, 0.6, -0.5), null, new V3(0.9, 0.8, 0.8)), M(new V3(-0.5, 0.45, 0.55), null, new V3(0.8, 0.7, 0.8))], tint: 'variant' },
    ],
};
export const DECOR_TYPES = Object.keys(TYPES);

// ----- batching per zone -----
const batches = new Map();
const tmpM = new T.Matrix4(), baseM = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), col = new T.Color();
let decoRng = rngFrom(4242);
// One candy at (x, y, z), rotated (rx, ry, rz), uniformly scaled s; tint picks the colour of the
// tintable parts (frosting, scoops ...). yaw turns the whole thing about y afterwards.
const qYaw = new T.Quaternion(), yAxis = new V3(0, 1, 0);
export function decor(zone, name, x, y, z, rx, ry, rz, s, tint, yaw) {
    const parts = TYPES[name];
    if (!parts) return;
    q.setFromEuler(e.set(rx || 0, ry || 0, rz || 0));
    if (yaw) q.premultiply(qYaw.setFromAxisAngle(yAxis, yaw));
    baseM.compose(new V3(x, y, z), q, new V3(s || 1, s || 1, s || 1));
    parts.forEach((p, i) => {
        const key = zone + '|' + name + '|' + i;
        let b = batches.get(key);
        if (!b) { b = { zone, part: p, mats: [], cols: [] }; batches.set(key, b); }
        const locals = Array.isArray(p.l) ? p.l : [p.l];
        for (const l of locals) {
            b.mats.push(tmpM.multiplyMatrices(baseM, l).clone());
            let c = 0xffffff;
            if (p.tint === 'variant') c = tint ?? 0xffffff;
            else if (Array.isArray(p.tint)) c = p.tint[Math.floor(decoRng() * p.tint.length)];
            else if (typeof p.tint === 'number') c = p.tint;
            b.cols.push(c);
        }
    });
}
export function flushDecor(parentFor) {
    for (const b of batches.values()) {
        const n = b.mats.length;
        if (!n) continue;
        const mesh = new T.InstancedMesh(b.part.g, b.part.m, n);
        for (let i = 0; i < n; i++) { mesh.setMatrixAt(i, b.mats[i]); mesh.setColorAt(i, col.set(b.cols[i])); }
        mesh.castShadow = false; mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        (parentFor ? parentFor(b.zone) : scene).add(mesh);
    }
    batches.clear();
}
// A single non-instanced candy (spinning displays, the floating sweets in the lobby)
export function candyModel(name, tint) {
    const g = new T.Group();
    for (const p of TYPES[name] || []) {
        const locals = Array.isArray(p.l) ? p.l : [p.l];
        for (const l of locals) {
            let m = p.m;
            if (p.tint === 'variant' && tint !== undefined) { m = (Array.isArray(m) ? m[0] : m).clone(); m.color.set(tint); }
            else if (Array.isArray(p.tint)) { m = m.clone(); m.color.set(p.tint[Math.floor(decoRng() * p.tint.length)]); }
            const mesh = new T.Mesh(p.g, m);
            mesh.applyMatrix4(l);
            mesh.castShadow = true;
            g.add(mesh);
        }
    }
    return g;
}

// =====================================================================================
// Wearable items: attached to a player's rig (anchor 'back' or 'head'), animated each frame
// =====================================================================================
// Feathered wings: three rows of feathers fanned out from a hinge on the back, in the plane
// behind the body (x-y), longest at the back
function featherWings(colors, rainbow) {
    const g = new T.Group(), wings = [];
    for (const side of [-1, 1]) {
        const w = new T.Group();
        w.position.set(side * 0.4, 0, 0);
        const rows = [[6, 2.1, 0.36], [6, 1.55, 0.33], [7, 1.05, 0.28]];
        rows.forEach(([n, len, wd], r) => {
            for (let k = 0; k < n; k++) {
                const a = -0.6 + (k / (n - 1)) * 1.55;
                const dx = side * Math.cos(a), dy = Math.sin(a), reach = 0.35 + len * 0.5;
                const c = rainbow ? new T.Color().setHSL((k / n + r * 0.14) % 1, 0.85, 0.66).getHex() : colors[r % colors.length];
                const f = new T.Mesh(G.sphereLo, candy(c, { rough: 0.6 }));
                f.scale.set(wd, len * 0.5, 0.09);
                f.position.set(dx * reach, dy * reach + 0.3 - r * 0.18, -0.06 * (2 - r));
                f.rotation.z = Math.atan2(-dx, dy);
                f.castShadow = true;
                w.add(f);
            }
        });
        g.add(w); wings.push(w);
    }
    return { g, wings };
}
// Bat wings: dark membranes between finger bones, red glowing edges
function batWings(color, edge) {
    const g = new T.Group(), wings = [];
    const shape = new T.Shape();
    shape.moveTo(0, 0); shape.lineTo(0.6, 0.9); shape.lineTo(2.2, 1.6); shape.lineTo(3.4, 1.2);
    shape.quadraticCurveTo(2.9, 0.6, 3.0, -0.2); shape.quadraticCurveTo(2.4, 0.2, 2.0, -0.6);
    shape.quadraticCurveTo(1.5, -0.1, 1.0, -0.7); shape.quadraticCurveTo(0.7, -0.2, 0, -0.3); shape.lineTo(0, 0);
    const geo = new T.ShapeGeometry(shape);
    const memM = toLambert({ color, roughness: 0.6, side: T.DoubleSide });
    const boneM = mat(edge, { neon: true });
    for (const side of [-1, 1]) {
        const w = new T.Group();
        w.position.set(side * 0.45, 0.3, 0);
        const mem = new T.Mesh(geo, memM);
        mem.scale.set(side, 1, 1); mem.castShadow = true;
        w.add(mem);
        for (const [x, y] of [[2.2, 1.6], [3.4, 1.2], [3.0, -0.2], [2.0, -0.6]]) {
            const len = Math.hypot(x, y), b = new T.Mesh(G.stick, boneM);
            b.scale.set(0.6, len, 0.6);
            b.position.set(side * x / 2, y / 2, 0.02);
            b.rotation.z = Math.atan2(-side * x, y);
            w.add(b);
        }
        g.add(w); wings.push(w);
    }
    return { g, wings };
}
// Golden keyboard wings: rows of little golden keycaps with glowing letters
function keyWings() {
    const g = new T.Group(), wings = [];
    const km = keyMaterial(0xffffff, true, false);
    for (const side of [-1, 1]) {
        const w = new T.Group();
        w.position.set(side * 0.5, 0, 0);
        const rows = [7, 6, 5, 4, 3];
        let n = 0; rows.forEach((r) => { n += r; });
        const mesh = new T.InstancedMesh(KEYCAP.clone(), km, n);
        const letters = new Float32Array(n);
        let i = 0;
        rows.forEach((r, row) => {
            for (let k = 0; k < r; k++) {
                const x = side * (0.5 + k * 0.62), y = 1.6 - row * 0.62 + k * 0.12;
                tmpM.compose(new V3(x, y, 0), q.setFromEuler(e.set(-Math.PI / 2, 0, 0)), new V3(0.18, 0.25, 0.18));
                mesh.setMatrixAt(i, tmpM);
                mesh.setColorAt(i, col.set(0xffc828));
                letters[i] = (i * 7) % 26;
                i++;
            }
        });
        mesh.geometry.setAttribute('aLetter', new T.InstancedBufferAttribute(letters, 1));
        mesh.castShadow = true;
        w.add(mesh);
        g.add(w); wings.push(w);
    }
    return { g, wings };
}
// Builds an item for a rig. Returns { group, anchor, update(t, air) }
export function buildItem(def) {
    const g = new T.Group();
    let anchor = 'back', wings = null, spin = null, glow = null;
    switch (def.kind) {
        case 'wings': {
            const r = featherWings([def.color, def.accent, 0xffffff], def.id === 'rainbow');
            g.add(r.g); wings = r.wings;
            break;
        }
        case 'bat': { const r = batWings(def.color, def.accent); g.add(r.g); wings = r.wings; break; }
        case 'keywings': { const r = keyWings(); g.add(r.g); wings = r.wings; break; }
        case 'halo': {
            anchor = 'head';
            if (def.id === 'halo') {
                const d = candyModel('donut', def.color);
                d.scale.setScalar(0.62);
                g.add(d); spin = d;
            } else {
                const ring = new T.Mesh(new T.TorusGeometry(0.85, 0.13, 10, 32), mat(def.color, { neon: true }));
                ring.rotation.x = Math.PI / 2; g.add(ring); spin = ring;
                for (let k = 0; k < 5; k++) {
                    const st = new T.Mesh(G.sphereLo, mat(def.accent, { neon: true }));
                    st.scale.setScalar(0.12);
                    const a = k / 5 * Math.PI * 2; st.position.set(Math.cos(a) * 0.85, 0, Math.sin(a) * 0.85);
                    ring.add(st);
                }
            }
            glow = new T.PointLight(def.color, 0.0, 6);
            break;
        }
        case 'crown': {
            anchor = 'head';
            const gold = toLambert({ color: 0xffc828, roughness: 0.25, metalness: 0.8 });
            const band = new T.Mesh(new T.CylinderGeometry(0.72, 0.68, 0.42, 16, 1, true), gold);
            band.material.side = T.DoubleSide; g.add(band);
            for (let k = 0; k < 6; k++) {
                const a = k / 6 * Math.PI * 2;
                const sp = new T.Mesh(new T.ConeGeometry(0.16, 0.5, 6), gold);
                sp.position.set(Math.cos(a) * 0.7, 0.42, Math.sin(a) * 0.7); g.add(sp);
                const gem = new T.Mesh(G.sphereLo, candy(PASTELS[k % PASTELS.length], { rough: 0.1, clear: true, emissive: PASTELS[k % PASTELS.length], emissiveIntensity: 0.4 }));
                gem.scale.setScalar(0.13); gem.position.set(Math.cos(a) * 0.74, 0.02, Math.sin(a) * 0.74); g.add(gem);
            }
            spin = null;
            break;
        }
        case 'jetpack': {
            for (const sx of [-0.45, 0.45]) {
                const tank = new T.Mesh(G.disc, [MAT.cookieSide, MAT.cookie, MAT.cookie]);
                tank.scale.set(0.42, 1.5, 0.42); tank.position.set(sx, 0, -0.1); tank.castShadow = true; g.add(tank);
                const noz = new T.Mesh(new T.ConeGeometry(0.28, 0.4, 10), toLambert({ color: 0x5a3418, roughness: 0.5 }));
                noz.position.set(sx, -0.95, -0.1); noz.rotation.x = Math.PI; g.add(noz);
                const choc = new T.Mesh(G.sphereLo, candy(0x5a2e14, { rough: 0.3 }));
                choc.scale.set(0.42, 0.25, 0.42); choc.position.set(sx, 0.78, -0.1); g.add(choc);
            }
            const strap = new T.Mesh(G.box, candy(0x7a4022, { rough: 0.6 }));
            strap.scale.set(1.5, 0.3, 0.2); strap.position.set(0, 0.3, 0.12); g.add(strap);
            g.userData.nozzles = [new V3(-0.45, -1.15, -0.1), new V3(0.45, -1.15, -0.1)];
            break;
        }
        default: break;
    }
    const update = (t, air) => {
        if (wings) {
            const flap = air ? Math.sin(t * 16) * 0.45 : Math.sin(t * 2.2) * 0.12;
            wings[0].rotation.y = 0.35 + flap; wings[1].rotation.y = -0.35 - flap;
        }
        if (spin) spin.rotation.y = t * (def.id === 'halo' ? 1.2 : 2);
        if (anchor === 'head') g.position.y = Math.sin(t * 2.4) * 0.06;
    };
    if (glow) g.add(glow);
    return { group: g, anchor, update, def };
}

// =====================================================================================
// Sneakers (the SHOES stand and the "+N Steps" pads): sole, upper, toe, collar, laces, stripe
// =====================================================================================
export function buildShoe(def) {
    const g = new T.Group();
    const body = candy(def.color, { rough: 0.35, clear: true });
    const acc = candy(def.accent, { rough: 0.3 });
    const white = candy(0xffffff, { rough: 0.55 });
    const part = (geo, m, x, y, z, sx, sy, sz, rx) => {
        const p = new T.Mesh(geo, m); p.position.set(x, y, z); p.scale.set(sx, sy, sz); if (rx) p.rotation.x = rx; p.castShadow = true; g.add(p); return p;
    };
    part(G.box, white, 0, 0.16, 0, 1.12, 0.32, 2.5);                          // sole
    part(G.sphereLo, white, 0, 0.16, 1.18, 0.56, 0.17, 0.2);                   // rounded toe of the sole
    part(G.box, body, 0, 0.62, -0.32, 1.02, 0.7, 1.66);                        // upper
    part(G.sphere, body, 0, 0.5, 0.6, 0.52, 0.36, 0.72);                       // toe box
    part(G.box, body, 0, 1.02, -0.72, 0.98, 0.32, 0.86);                       // ankle
    part(G.torus, acc, 0, 1.2, -0.72, 0.42, 0.42, 0.5, Math.PI / 2);           // collar
    for (let k = 0; k < 3; k++) part(G.box, white, 0, 0.98 - k * 0.08, 0.05 + k * 0.24, 0.62, 0.07, 0.09); // laces
    for (const s of [-1, 1]) part(G.box, acc, s * 0.52, 0.6, -0.15, 0.04, 0.22, 1.3); // side stripes
    part(G.box, acc, 0, 0.92, -1.2, 0.3, 0.5, 0.12);                           // heel tab
    if (def.glow) {
        const strip = new T.Mesh(G.box, mat(def.glow, { neon: true }));
        strip.scale.set(1.16, 0.08, 2.54); strip.position.set(0, 0.06, 0); g.add(strip);
    }
    if (def.wings) {
        const r = featherWings([def.accent === 0xff1e3c ? 0x2a2a34 : 0xffffff], false);
        r.g.scale.setScalar(0.32); r.g.position.set(0, 0.85, -0.5); r.g.rotation.y = Math.PI / 2;
        g.add(r.g);
    }
    return g;
}

// Rainbow material for trails / finale decor
export function rainbowMaterial() {
    const m = new T.MeshBasicMaterial({ map: rainbowTexture(), toneMapped: false });
    m.color.multiplyScalar(NEON_BOOST * 0.7);
    return m;
}

// Gold trophy over every Wins pad: one merged geometry (cup, handles, stem, base)
export const TROPHY_GEO = (() => {
    const prof = [[0, 1.0], [0.55, 1.0], [0.9, 1.25], [1.05, 1.7], [1.12, 2.25], [1.0, 2.32], [0.9, 2.15], [0.84, 1.8], [0.68, 1.42], [0.4, 1.16], [0, 1.16]].map(([r, y]) => new T.Vector2(r, y));
    const cup = new T.LatheGeometry(prof, 22);
    const stem = new T.CylinderGeometry(0.18, 0.3, 0.6, 12).translate(0, 0.72, 0);
    const base = new T.CylinderGeometry(0.75, 0.88, 0.45, 22).translate(0, 0.22, 0);
    const h1 = new T.TorusGeometry(0.42, 0.11, 8, 16, Math.PI).rotateZ(-Math.PI / 2).translate(1.06, 1.86, 0);
    const h2 = h1.clone().rotateY(Math.PI);
    const g = mergeGeometries([cup, stem, base, h1, h2]);
    g.computeVertexNormals();
    return g;
})();
export const GOLD = toLambert({ color: 0xffc828, roughness: 0.22, metalness: 0.85, emissive: 0x6a4000, emissiveIntensity: 0.25 });
