// Keyboard keycaps, the look of the whole game: glossy plastic keycaps with rounded tops and a
// letter printed on each, drawn as instanced meshes (thousands of keys, a few draw calls).
// A keycap's top face is at y = 0 in its own space and 3 studs across at scale 1, so one key per
// KEY.pitch (4) studs, like the big keys in the reference.
import { T, scene } from './engine.js';

export const KEY = { pitch: 4, h: 1.0 };
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789←↑→↓★♥+?!#@&$%✓☺';
export const letterIndex = (ch) => LETTERS.indexOf(ch);
const ALPHA = 'QWERTYUIOPASDFGHJKLZXCVBNM';

// ----- geometry: an octagon-cornered frustum with a rounded shoulder and a flat top -----
function keycapGeometry() {
    // rings: [y, half size, corner chamfer]
    const rings = [[-KEY.h, 1.86, 0.52], [-0.3, 1.7, 0.46], [-0.1, 1.6, 0.42], [-0.02, 1.53, 0.38], [0, 1.48, 0.36]];
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
export const KEYCAP = keycapGeometry();

// ----- letter atlas: 8 x 8 white glyphs -----
const ATLAS = (() => {
    const N = 1024, C = 128, c = document.createElement('canvas'); c.width = c.height = N;
    const x = c.getContext('2d');
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff';
    [...LETTERS].forEach((ch, i) => {
        const cx = (i % 8) * C + C / 2, cy = Math.floor(i / 8) * C + C / 2;
        x.font = `700 ${/[A-Z0-9]/.test(ch) ? 74 : 66}px Fredoka, "Arial Rounded MT Bold", "Segoe UI Symbol", sans-serif`;
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
        x.font = `700 ${/[A-Z0-9]/.test(ch) ? 74 : 66}px Fredoka, "Arial Rounded MT Bold", "Segoe UI Symbol", sans-serif`;
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
    const m = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0, envMapIntensity: 0.95 });
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
                totalEmissiveRadiance += kRgb * uRgb * smoothstep(-0.45, -0.95, vKeyY) * 1.4;`);
    };
    m.customProgramCacheKey = () => 'keycap';
    keyMats.set(k, m);
    return m;
}

// ----- static keys, batched per zone (lobby / stage) and per look -----
const batches = new Map();
// Adds one keycap: top centre at (x, top, z); size scales its width / depth (1 = a normal key);
// letter: index into LETTERS, -1 for none (space bars). wall: the key stands on a wall facing -z.
export function addKey(zone, look, x, top, z, color, letter, sx, sz, sy, wall) {
    const k = zone + '|' + look.ink + '|' + (look.glow ? 1 : 0) + '|' + (look.rgb ? 1 : 0) + '|' + (wall ? 'w' : 'f');
    let b = batches.get(k);
    if (!b) { b = { zone, look, wall: !!wall, list: [] }; batches.set(k, b); }
    b.list.push(x, top, z, sx || 1, sy || 1, sz || 1, color, letter ?? -1);
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
            if (ax > 1.75 * k.sx || az > 1.75 * k.sz) continue;
            if (ax + az < bd) { bd = ax + az; best = k; }
        }
    }
    return best;
}
// Press a key (returns true when it wasn't already down)
export function pressKey(k) {
    if (!k) return false;
    const fresh = !pressed.has(k) || k.t < 0;
    k.t = 0.16;
    pressed.add(k);
    return fresh;
}
export function updatePressed(dt) {
    for (const k of pressed) {
        k.t -= dt;
        // Down while held, then a quick spring back with a little overshoot
        let depth = k.t > 0 ? 0.34 : 0.34 * Math.cos(Math.min(Math.PI, -k.t * 22)) * Math.exp(k.t * 18);
        if (k.t < -0.2) { depth = 0; pressed.delete(k); }
        m4.compose(v0.set(k.x, k.top - Math.max(-0.08, depth), k.z), q0, s0.set(k.sx, k.sy, k.sz));
        k.mesh.setMatrixAt(k.i, m4);
        k.mesh.instanceMatrix.addUpdateRange(k.i * 16, 16);
        k.mesh.instanceMatrix.needsUpdate = true;
    }
}
// Fills a w x d area (centre x, z) with keys whose tops are at `top`. pick(i, j, rng) -> colour
export function keyGrid(zone, look, x, z, w, d, top, rng, pick, opts) {
    opts = opts || {};
    const pitch = KEY.pitch, nx = Math.max(1, Math.floor(w / pitch)), nz = Math.max(1, Math.floor(d / pitch));
    const x0 = x - (nx - 1) * pitch / 2, z0 = z - (nz - 1) * pitch / 2;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        if (opts.skip && opts.skip(i, j)) continue;
        const color = pick ? pick(i, j, rng) : look.keys[Math.floor(rng() * look.keys.length)];
        const letter = opts.blank ? -1 : randomLetter(rng);
        addKey(zone, look, x0 + i * pitch, top, z0 + j * pitch, color, letter);
    }
}
export const randomLetter = (rng) => letterIndex(ALPHA[Math.floor(rng() * ALPHA.length)]);
const m4 = new T.Matrix4(), q0 = new T.Quaternion(), v0 = new T.Vector3(), s0 = new T.Vector3(), c0 = new T.Color();
const qWall = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -Math.PI / 2);
// Builds the instanced meshes; parentFor(zone) gives the group each zone's keys go into
export function flushKeys(parentFor) {
    for (const b of batches.values()) {
        const n = b.list.length / 8;
        if (!n) continue;
        const mesh = new T.InstancedMesh(KEYCAP, keyMaterial(b.look.ink, b.look.glow, b.look.rgb), n);
        const letters = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const o = i * 8, L = b.list;
            m4.compose(v0.set(L[o], L[o + 1], L[o + 2]), b.wall ? qWall : q0, s0.set(L[o + 3], L[o + 4], L[o + 5]));
            mesh.setMatrixAt(i, m4);
            mesh.setColorAt(i, c0.set(L[o + 6]));
            letters[i] = L[o + 7];
            if (!b.wall) registerKey({ mesh, i, x: L[o], top: L[o + 1], z: L[o + 2], sx: L[o + 3], sy: L[o + 4], sz: L[o + 5], t: -1 });
        }
        mesh.geometry = KEYCAP.clone();
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
