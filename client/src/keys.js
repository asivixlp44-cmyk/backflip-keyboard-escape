// Keyboard keycaps, the look of the whole game: glossy plastic keycaps with rounded tops and a
// letter printed on each, drawn as instanced meshes (thousands of keys, a few draw calls).
// A keycap's top face is at y = 0 in its own space. Floor keys are the tall sculpted caps from the
// reference: one per KEY.tallPitch (4) studs (about your shoulder width), 1.7 studs tall, steep
// tapered sides, rounded corners and a shallow dish. The keys you stand on press all the way down
// (they keep their colour) and you walk along at that pressed level, so running across the keyboard
// is smooth: the next key is already going down as you reach it, the last one pops back up behind.
// Space bars, wall keys and moving hazard keys keep the low flat cap so they match their colliders.
import { T, scene, toLambert } from './engine.js';

export const KEY = { pitch: 4, h: 1.0, tallPitch: 4, tallScale: 1, tallH: 1.7, press: 1.05 };
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789←↑→↓★♥+?!#@&$%✓☺';
export const letterIndex = (ch) => LETTERS.indexOf(ch);
const ALPHA = 'QWERTYUIOPASDFGHJKLZXCVBNM';

// ----- geometry: an octagon-cornered frustum with a rounded shoulder and a flat top -----
function keycapGeometry(rings) {
    // rings: [y, half size, corner chamfer]
    const outline = (a, c) => [[a - c, a], [a, a - c], [a, -(a - c)], [a - c, -a], [-(a - c), -a], [-a, -(a - c)], [-a, a - c], [-(a - c), a]];
    const pos = [], idx = [];
    for (const [y, a, c] of rings) for (const [x, z] of outline(a, c)) pos.push(x, y, z);
    for (let r = 0; r < rings.length - 1; r++) for (let k = 0; k < 8; k++) {
        const a = r * 8 + k, b = r * 8 + ((k + 1) % 8), c2 = a + 8, d = b + 8;
        idx.push(a, b, c2, b, d, c2);
    }
    const side = new T.BufferGeometry();
    side.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    side.setIndex(idx);
    side.computeVertexNormals();
    // Flat top face (its own vertices, so it stays crisp with a straight-up normal)
    const top = rings[rings.length - 1];
    const tp = [], tn = [], ti = [];
    tp.push(0, 0, 0); tn.push(0, 1, 0);
    for (const [x, z] of outline(top[1] - 0.001, top[2])) { tp.push(x, 0.0005, z); tn.push(0, 1, 0); }
    for (let k = 0; k < 8; k++) ti.push(0, 1 + k, 1 + ((k + 1) % 8));
    const sp = side.attributes.position.array, sn = side.attributes.normal.array;
    const P = [...sp, ...tp], N = [...sn, ...tn], I = [...idx, ...ti.map((v) => v + sp.length / 3)];
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new T.Float32BufferAttribute(N, 3));
    g.setIndex(I);
    g.computeBoundingSphere();
    return g;
}
export const KEYCAP = keycapGeometry([[-KEY.h, 1.86, 0.52], [-0.3, 1.7, 0.46], [-0.1, 1.6, 0.42], [-0.02, 1.53, 0.38], [0, 1.48, 0.36]]);
// Tall sculpted floor key (instances may be stretched a little to fill an area): a rounded
// rectangle swept through rings from a skirt hidden in the case up a gently curved side to a rounded
// top edge, then a shallow spherical dish across the top.
function tallKeyGeometry() {
    const SEG = 2;                                        // segments per rounded corner (kept low: thousands of keys)
    const outline = (a, r) => {
        const pts = [];
        const corners = [[a - r, a - r, 0], [-(a - r), a - r, 1], [-(a - r), -(a - r), 2], [a - r, -(a - r), 3]];
        for (const [cx, cz, q] of corners) for (let k = 0; k <= SEG; k++) {
            const ang = (q + k / SEG) * Math.PI / 2;
            pts.push([cx + Math.cos(ang) * r, cz + Math.sin(ang) * r]);
        }
        return pts;
    };
    // [y, half size, corner radius]
    const rings = [[-KEY.tallH, 1.83, 0.44], [-0.85, 1.6, 0.41], [-0.3, 1.43, 0.38], [-0.07, 1.34, 0.36], [0, 1.3, 0.355]];
    const M = 4 * (SEG + 1);
    const pos = [], idx = [];
    for (const [y, a, r] of rings) for (const [x, z] of outline(a, r)) pos.push(x, y, z);
    for (let i = 0; i < rings.length - 1; i++) for (let k = 0; k < M; k++) {
        const a = i * M + k, b = i * M + ((k + 1) % M), c = a + M, d = b + M;
        idx.push(a, c, b, b, c, d);
    }
    // The dish: rings shrinking to the centre, each a little lower
    const top = rings[rings.length - 1], DISH = 0.07, steps = [0.6];
    let prev = (rings.length - 1) * M;
    for (const f of steps) {
        const start = pos.length / 3, y = -DISH * (1 - f * f);
        for (const [x, z] of outline(top[1] * f, top[2] * f)) pos.push(x, y, z);
        for (let k = 0; k < M; k++) { const a = prev + k, b = prev + ((k + 1) % M), c = start + k, d = start + ((k + 1) % M); idx.push(a, c, b, b, c, d); }
        prev = start;
    }
    const centre = pos.length / 3; pos.push(0, -DISH, 0);
    for (let k = 0; k < M; k++) idx.push(prev + k, centre, prev + ((k + 1) % M));
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
}
export const KEYCAP_TALL = tallKeyGeometry();

// ----- letter atlas: 8 x 8 white glyphs -----
const ATLAS = (() => {
    const N = 1024, C = 128, c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d');
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff';
    [...LETTERS].forEach((ch, i) => {
        const cx = (i % 8) * C + C / 2, cy = Math.floor(i / 8) * C + C / 2;
        x.font = /[A-Z0-9]/.test(ch) ? '800 60px Montserrat, "Arial Black", Arial, sans-serif' : '700 58px Fredoka, "Segoe UI Symbol", sans-serif';
        x.fillText(ch, cx, cy + 4);
    });
    const t = new T.CanvasTexture(c);
    t.anisotropy = 8;
    t.generateMipmaps = true;
    return t;
})();
// The atlas is drawn after the font loads; call once fonts are ready
export function redrawAtlas() {
    const c = ATLAS.image, x = c.getContext('2d'), C = 128;
    x.clearRect(0, 0, c.width, c.height);
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff';
    [...LETTERS].forEach((ch, i) => {
        x.font = /[A-Z0-9]/.test(ch) ? '800 60px Montserrat, "Arial Black", Arial, sans-serif' : '700 58px Fredoka, "Segoe UI Symbol", sans-serif';
        x.fillText(ch, (i % 8) * C + C / 2, Math.floor(i / 8) * C + C / 2 + 4);
    });
    ATLAS.needsUpdate = true;
}

// ----- material: glossy plastic, letters printed on the top (or glowing, or RGB-backlit) -----
const uTime = { value: 0 };
export function tickKeys(t) { uTime.value = t; }
const keyMats = new Map();
export function keyMaterial(ink, glow, rgb) {
    const k = ink + '|' + (glow ? 1 : 0) + '|' + (rgb ? 1 : 0);
    if (keyMats.has(k)) return keyMats.get(k);
    const m = toLambert({ color: 0xffffff, roughness: 0.5, metalness: 0, envMapIntensity: 0.95 });
    const uInk = { value: new T.Color(ink) }, uGlow = { value: glow ? 1 : 0 }, uRgb = { value: rgb ? 1 : 0 };
    m.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, { uAtlas: { value: ATLAS }, uInk, uGlow, uRgb, uTime });
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nattribute float aLetter;\nvarying vec2 vKeyUv;\nvarying float vKeyTop;\nvarying float vLetter;\nvarying vec3 vKeyWorld;\nvarying float vKeyY;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                vKeyUv = vec2(0.5 - position.x / 3.0, 0.5 + position.z / 3.0);
                vKeyTop = normal.y;
                vKeyY = position.y;
                vLetter = aLetter;
                vKeyWorld = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;`);
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', `#include <common>
                uniform sampler2D uAtlas; uniform vec3 uInk; uniform float uGlow; uniform float uRgb; uniform float uTime;
                varying vec2 vKeyUv; varying float vKeyTop; varying float vLetter; varying vec3 vKeyWorld; varying float vKeyY;
                float kGlyph;
                vec3 kHue(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }`)
            .replace('#include <color_fragment>', `#include <color_fragment>
                float kCell = floor(vLetter + 0.5);
                vec2 kUv = (vec2(mod(kCell, 8.0), 7.0 - floor(kCell / 8.0)) + clamp(vKeyUv, 0.02, 0.98)) / 8.0;
                kGlyph = texture2D(uAtlas, kUv).a * step(0.8, vKeyTop) * step(-0.5, vLetter);
                diffuseColor.rgb = mix(diffuseColor.rgb, uInk, kGlyph * (1.0 - uGlow * 0.6));`)
            .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
                vec3 kRgb = kHue(fract(vKeyWorld.x * 0.012 + vKeyWorld.z * 0.006 - uTime * 0.22));
                vec3 kLit = mix(uInk, kRgb, uRgb);
                totalEmissiveRadiance += kLit * kGlyph * uGlow * 2.2;
                // RGB backlight bleeding out under the keycap edges
                totalEmissiveRadiance += kRgb * uRgb * smoothstep(-0.55, -1.35, vKeyY) * 1.4;`);
    };
    m.customProgramCacheKey = () => 'keycap';
    keyMats.set(k, m);
    return m;
}

// ----- static keys, batched per zone (lobby / stage) and per look -----
const batches = new Map();
// Adds one keycap: top centre at (x, top, z); size scales its width / depth (1 = a normal key);
// letter: index into LETTERS, -1 for none (space bars). wall: the key stands on a wall facing -z.
export function addKey(zone, look, x, top, z, color, letter, sx, sz, sy, wall, tall) {
    const k = zone + '|' + look.ink + '|' + (look.glow ? 1 : 0) + '|' + (look.rgb ? 1 : 0) + '|' + (wall ? 'w' : tall ? 't' : 'f');
    let b = batches.get(k);
    if (!b) { b = { zone, look, wall: !!wall, tall, list: [] }; batches.set(k, b); }
    b.list.push(x, top, z, sx || 1, sy || 1, sz || 1, color, letter ?? -1);
}
// A big sculpted floor key (see KEYCAP_TALL); sx / sz stretch it a little to fill an area exactly
export function addTallKey(zone, look, x, top, z, color, letter, sx, sz) {
    addKey(zone, look, x, top, z, color, letter, sx ?? KEY.tallScale, sz ?? KEY.tallScale, KEY.tallScale, false, true);
}
// A key set into a wall facing -z (the giant keyboard on the end walls): face at zFace
export function addWallKey(zone, look, x, y, zFace, color, letter, size) {
    addKey(zone, look, x, y, zFace, color, letter, size, size, 1, true);
}

// ----- keys you stand on press down and spring back, like a real keyboard -----
const CELL = 4;
const keyCells = new Map();
const pressed = new Set();
function registerKey(entry) {
    const c = Math.floor(entry.x / CELL) + '|' + Math.floor(entry.z / CELL);
    let list = keyCells.get(c);
    if (!list) { list = []; keyCells.set(c, list); }
    list.push(entry);
}
// The floor key under a point (feet at y), or null
export function keyAt(x, y, z) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let best = null, bd = 1e9;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const list = keyCells.get((cx + dx) + '|' + (cz + dz));
        if (!list) continue;
        for (const k of list) {
            if (Math.abs(k.top - y) > 0.45) continue;
            const ax = Math.abs(x - k.x), az = Math.abs(z - k.z);
            if (ax > k.hx || az > k.hz) continue;
            if (ax + az < bd) { bd = ax + az; best = k; }
        }
    }
    return best;
}
// The key under someone's feet: returns true when they just stepped onto it (that's when it clicks)
export function pressKey(k) {
    if (!k) return false;
    const fresh = !(k.t > 0);
    k.t = 0.1;
    if (k.tall) pressed.add(k);
    return fresh;
}
// Presses every tall key under a footprint of half-width r around (x, z) at foot height y, like feet
// touching them; returns true if any key is there (you're walking on the keyboard)
export function pressAround(x, y, z, r) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let any = false;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const list = keyCells.get((cx + dx) + '|' + (cz + dz));
        if (!list) continue;
        for (const k of list) {
            if (!k.tall || Math.abs(k.top - y) > 0.45) continue;
            if (Math.abs(x - k.x) > k.hx * 0.8 + r || Math.abs(z - k.z) > k.hz * 0.8 + r) continue;
            k.t = Math.max(k.t, 0.1); pressed.add(k);
            if (Math.abs(x - k.x) <= k.hx && Math.abs(z - k.z) <= k.hz) any = true;
        }
    }
    return any;
}
export function updatePressed(dt) {
    const sdt = Math.min(dt, 1 / 30);
    for (const k of pressed) {
        k.t -= dt;
        const down = k.t > 0;
        // Goes down fast with no bounce; comes back up quickly with a small springy overshoot
        if (down) { k.depth += (KEY.press - k.depth) * Math.min(1, sdt * 34); k.v = 0; }
        else { k.v += (0 - k.depth) * 900 * sdt; k.v *= Math.exp(-26 * sdt); k.depth += k.v * sdt; }
        if (!down && k.t < -0.8 && Math.abs(k.depth) < 0.003 && Math.abs(k.v) < 0.03) { k.depth = 0; k.v = 0; pressed.delete(k); }
        m4.compose(v0.set(k.x, k.top - k.depth, k.z), q0, s0.set(k.sx, k.sy, k.sz));
        k.mesh.setMatrixAt(k.i, m4);
        k.mesh.instanceMatrix.addUpdateRange(k.i * 16, 16);
        k.mesh.instanceMatrix.needsUpdate = true;
    }
}
// Fills a w x d area (centre x, z) with big keys whose tops are at `top`, as many as fit at about
// KEY.tallPitch, each stretched slightly so the rows fill the area edge to edge. pick(i, j, rng) -> colour
export function keyGrid(zone, look, x, z, w, d, top, rng, pick, opts) {
    opts = opts || {};
    const P = KEY.tallPitch, nx = Math.max(1, Math.round(w / P)), nz = Math.max(1, Math.round(d / P));
    const px = w / nx, pz = d / nz, sx = KEY.tallScale * px / P, sz = KEY.tallScale * pz / P;
    const x0 = x - (nx - 1) * px / 2, z0 = z - (nz - 1) * pz / 2;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        if (opts.skip && opts.skip(i, j)) continue;
        const color = pick ? pick(i, j, rng) : look.keys[Math.floor(rng() * look.keys.length)];
        const letter = opts.blank ? -1 : randomLetter(rng);
        addTallKey(zone, look, x0 + i * px, top, z0 + j * pz, color, letter, sx, sz);
    }
}
export const randomLetter = (rng) => letterIndex(ALPHA[Math.floor(rng() * ALPHA.length)]);
const m4 = new T.Matrix4(), q0 = new T.Quaternion(), v0 = new T.Vector3(), s0 = new T.Vector3(), c0 = new T.Color();
const qWall = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -Math.PI / 2);
// Builds the instanced meshes; parentFor(zone) gives the group each zone's keys go into
// Keys are split into CHUNK-stud blocks per batch so the camera only draws the blocks it can see
const CHUNK = 32;
export function flushKeys(parentFor) {
    const chunked = [];
    for (const b of batches.values()) {
        const groups = new Map(), L = b.list;
        for (let o = 0; o < L.length; o += 8) {
            const ck = Math.floor(L[o] / CHUNK) + '|' + Math.floor(L[o + 1] / CHUNK) + '|' + Math.floor(L[o + 2] / CHUNK);
            let g = groups.get(ck);
            if (!g) { g = []; groups.set(ck, g); }
            for (let j = 0; j < 8; j++) g.push(L[o + j]);
        }
        for (const list of groups.values()) chunked.push({ ...b, list });
    }
    for (const b of chunked) {
        const n = b.list.length / 8;
        if (!n) continue;
        const geo = b.tall ? KEYCAP_TALL : KEYCAP;
        const mesh = new T.InstancedMesh(geo, keyMaterial(b.look.ink, b.look.glow, b.look.rgb), n);
        const letters = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const o = i * 8, L = b.list;
            m4.compose(v0.set(L[o], L[o + 1], L[o + 2]), b.wall ? qWall : q0, s0.set(L[o + 3], L[o + 4], L[o + 5]));
            mesh.setMatrixAt(i, m4);
            mesh.setColorAt(i, c0.set(L[o + 6]));
            letters[i] = L[o + 7];
            if (!b.wall) registerKey({ mesh, i, tall: b.tall, x: L[o], top: L[o + 1], z: L[o + 2], sx: L[o + 3], sy: L[o + 4], sz: L[o + 5],
                // tall keys own their whole cell (no dead zone in the gaps), flat ones their cap
                hx: (b.tall ? KEY.tallPitch / 2 : 1.75) * L[o + 3], hz: (b.tall ? KEY.tallPitch / 2 : 1.75) * L[o + 5], t: 0, depth: 0, v: 0 });
        }
        mesh.geometry = geo.clone();
        mesh.geometry.setAttribute('aLetter', new T.InstancedBufferAttribute(letters, 1));
        mesh.receiveShadow = true;
        mesh.castShadow = false;
        mesh.computeBoundingSphere();
        (parentFor ? parentFor(b.zone) : scene).add(mesh);
    }
    batches.clear();
}

// ----- moving keys (pistons, blinking keys, sliders): an instanced mesh you update every frame -----
export function dynamicKeys(look, count, parent) {
    const mesh = new T.InstancedMesh(KEYCAP.clone(), keyMaterial(look.ink, look.glow, look.rgb), count);
    mesh.geometry.setAttribute('aLetter', new T.InstancedBufferAttribute(new Float32Array(count).fill(-1), 1));
    mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    mesh.receiveShadow = true; mesh.castShadow = true;
    mesh.frustumCulled = false;
    (parent || scene).add(mesh);
    const letters = mesh.geometry.attributes.aLetter;
    return {
        mesh,
        set(i, x, top, z, sx, sz, sy, hidden) {
            m4.compose(v0.set(x, top, z), q0, s0.set(hidden ? 0.0001 : sx || 1, hidden ? 0.0001 : sy || 1, hidden ? 0.0001 : sz || 1));
            mesh.setMatrixAt(i, m4);
        },
        color(i, c) { mesh.setColorAt(i, c0.set(c)); if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; },
        letter(i, l) { letters.array[i] = l; letters.needsUpdate = true; },
        done() { mesh.instanceMatrix.needsUpdate = true; },
    };
}
