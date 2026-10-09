import { T, texFrom } from './engine.js';

// Canvas-generated candy textures: lollipop swirls, peppermint wedges, candy-cane stripes,
// waffle cones, cookies, chocolate bars, the arrow-key conveyor belt, the chocolate river,
// and a cotton-candy cloud sprite. Everything is drawn once and cached.
const cache = new Map();
const once = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };
const css = (h) => '#' + h.toString(16).padStart(6, '0');
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h || w; return c; }
function seeded(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; }

// Lollipop: spiral bands of the given colours out from the centre, with a glossy rim
export function swirlTexture(colors, arms) {
    return once('swirl|' + colors.join(',') + '|' + arms, () => {
        const N = 256, c = canvas(N), x = c.getContext('2d'), img = x.createImageData(N, N), d = img.data;
        const cols = colors.map((h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255]);
        for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
            const dx = (px - N / 2) / (N / 2), dy = (py - N / 2) / (N / 2), r = Math.hypot(dx, dy);
            const a = Math.atan2(dy, dx) / (Math.PI * 2) + 0.5;
            const band = Math.floor((a * arms + r * 2.6) * 1) % cols.length;
            const k = cols[(band + cols.length) % cols.length];
            const shade = 1 - 0.18 * Math.max(0, r - 0.82) / 0.18;
            const i = (py * N + px) * 4;
            d[i] = k[0] * shade; d[i + 1] = k[1] * shade; d[i + 2] = k[2] * shade; d[i + 3] = 255;
        }
        x.putImageData(img, 0, 0);
        return texFrom(c);
    });
}
// Peppermint: red and white wedges with a white middle
export function peppermintTexture(color) {
    return once('mint|' + color, () => {
        const N = 256, c = canvas(N), x = c.getContext('2d');
        x.fillStyle = '#ffffff'; x.fillRect(0, 0, N, N);
        x.translate(N / 2, N / 2);
        for (let k = 0; k < 8; k++) {
            x.fillStyle = k % 2 ? '#ffffff' : css(color);
            x.beginPath(); x.moveTo(0, 0);
            const a0 = k * Math.PI / 4, a1 = a0 + Math.PI / 4;
            // Curved wedges, like a real peppermint swirl
            for (let s = 0; s <= 12; s++) { const a = a0 + (a1 - a0) * s / 12, r = N / 2; x.lineTo(Math.cos(a + 0.35) * r, Math.sin(a + 0.35) * r); }
            x.quadraticCurveTo(Math.cos(a0 + 0.2) * N * 0.2, Math.sin(a0 + 0.2) * N * 0.2, 0, 0);
            x.fill();
        }
        x.fillStyle = '#ffffff'; x.beginPath(); x.arc(0, 0, N * 0.11, 0, Math.PI * 2); x.fill();
        return texFrom(c);
    });
}
// Candy cane / barber stripes running diagonally (repeat along the tube)
export function stripeTexture(c1, c2, n) {
    return once('stripe|' + c1 + c2 + n, () => {
        const N = 128, c = canvas(N), x = c.getContext('2d');
        x.fillStyle = css(c1); x.fillRect(0, 0, N, N);
        x.fillStyle = css(c2);
        const w = N / (n * 2);
        for (let k = -n * 2; k < n * 4; k++) {
            if (k % 2) continue;
            x.beginPath(); x.moveTo(k * w, 0); x.lineTo(k * w + w, 0); x.lineTo(k * w + w + N, N); x.lineTo(k * w + N, N); x.fill();
        }
        const t = texFrom(c); t.wrapS = t.wrapT = T.RepeatWrapping;
        return t;
    });
}
// Waffle cone: golden with a darker diamond grid
export function waffleTexture() {
    return once('waffle', () => {
        const N = 128, c = canvas(N), x = c.getContext('2d');
        x.fillStyle = '#e8b064'; x.fillRect(0, 0, N, N);
        x.strokeStyle = '#b8783a'; x.lineWidth = 6;
        for (let k = -N; k < N * 2; k += 24) {
            x.beginPath(); x.moveTo(k, 0); x.lineTo(k + N, N); x.stroke();
            x.beginPath(); x.moveTo(k, N); x.lineTo(k + N, 0); x.stroke();
        }
        const t = texFrom(c); t.wrapS = t.wrapT = T.RepeatWrapping;
        return t;
    });
}
// Chocolate-chip cookie top
export function cookieTexture() {
    return once('cookie', () => {
        const N = 256, c = canvas(N), x = c.getContext('2d'), rnd = seeded(77);
        const g = x.createRadialGradient(N / 2, N / 2, 10, N / 2, N / 2, N / 2);
        g.addColorStop(0, '#e8b46a'); g.addColorStop(0.8, '#d89a52'); g.addColorStop(1, '#b8783a');
        x.fillStyle = g; x.fillRect(0, 0, N, N);
        for (let k = 0; k < 140; k++) { x.fillStyle = `rgba(150,90,40,${0.15 + rnd() * 0.2})`; x.beginPath(); x.arc(rnd() * N, rnd() * N, 1 + rnd() * 3, 0, Math.PI * 2); x.fill(); }
        for (let k = 0; k < 16; k++) {
            const px = N * 0.15 + rnd() * N * 0.7, py = N * 0.15 + rnd() * N * 0.7, r = 7 + rnd() * 8;
            x.fillStyle = '#4a2410'; x.beginPath(); x.ellipse(px, py, r, r * 0.8, rnd() * 3, 0, Math.PI * 2); x.fill();
            x.fillStyle = 'rgba(255,255,255,0.18)'; x.beginPath(); x.arc(px - r * 0.3, py - r * 0.3, r * 0.3, 0, Math.PI * 2); x.fill();
        }
        return texFrom(c);
    });
}
// Chocolate bar: bevelled squares
export function chocoBarTexture() {
    return once('chocobar', () => {
        const N = 128, c = canvas(N), x = c.getContext('2d');
        x.fillStyle = '#5a2e14'; x.fillRect(0, 0, N, N);
        const s = N / 2;
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
            const ox = i * s, oy = j * s;
            x.fillStyle = '#7a4222'; x.fillRect(ox + 5, oy + 5, s - 10, s - 10);
            x.fillStyle = '#8e5230'; x.fillRect(ox + 9, oy + 9, s - 18, s - 18);
            x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(ox + 9, oy + 9, s - 18, 4);
        }
        const t = texFrom(c); t.wrapS = t.wrapT = T.RepeatWrapping;
        return t;
    });
}
// Arrow-key conveyor belt: chevrons pointing along +v (scrolled by world.js)
export function arrowBeltTexture(base, arrow) {
    return once('belt|' + base + arrow, () => {
        const N = 128, c = canvas(N), x = c.getContext('2d');
        x.fillStyle = css(base); x.fillRect(0, 0, N, N);
        x.fillStyle = 'rgba(0,0,0,0.12)'; for (let k = 0; k < N; k += 16) x.fillRect(0, k, N, 3);
        x.fillStyle = css(arrow);
        x.beginPath(); x.moveTo(N * 0.5, N * 0.12); x.lineTo(N * 0.86, N * 0.5); x.lineTo(N * 0.66, N * 0.5); x.lineTo(N * 0.66, N * 0.88);
        x.lineTo(N * 0.34, N * 0.88); x.lineTo(N * 0.34, N * 0.5); x.lineTo(N * 0.14, N * 0.5); x.closePath(); x.fill();
        const t = texFrom(c); t.wrapS = t.wrapT = T.RepeatWrapping;
        return t;
    });
}
// Chocolate river: glossy brown swirls (scrolled by world.js)
export function chocoRiverTexture() {
    return once('river', () => {
        const N = 256, c = canvas(N), x = c.getContext('2d'), rnd = seeded(9);
        x.fillStyle = '#5a2c12'; x.fillRect(0, 0, N, N);
        x.lineCap = 'round';
        for (let k = 0; k < 40; k++) {
            x.strokeStyle = `rgba(${140 + rnd() * 60},${80 + rnd() * 30},${40 + rnd() * 20},${0.25 + rnd() * 0.35})`;
            x.lineWidth = 3 + rnd() * 8;
            const px = rnd() * N, py = rnd() * N, a = 40 * (rnd() - 0.5), b = 40 * (rnd() - 0.5), e = 20 * (rnd() - 0.5);
            // Drawn at every wrapped offset so the tile repeats seamlessly
            for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) {
                x.beginPath(); x.moveTo(px + ox, py + oy);
                x.bezierCurveTo(px + ox + a, py + oy + 30, px + ox + b, py + oy + 60, px + ox + e, py + oy + 90);
                x.stroke();
            }
        }
        const t = texFrom(c); t.wrapS = t.wrapT = T.RepeatWrapping;
        return t;
    });
}
// Soft round puff for cotton-candy cloud sprites and glows
export function puffTexture() {
    return once('puff', () => {
        const N = 128, c = canvas(N), x = c.getContext('2d');
        const g = x.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
        g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.55, 'rgba(255,255,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(0, 0, N, N);
        return texFrom(c);
    });
}
// Laser beam: bright core fading to the edges across v
export function beamTexture() {
    return once('beam', () => {
        const c = canvas(4, 64), x = c.getContext('2d');
        const g = x.createLinearGradient(0, 0, 0, 64);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.4, 'rgba(255,255,255,0.7)'); g.addColorStop(0.5, 'rgba(255,255,255,1)');
        g.addColorStop(0.6, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(0, 0, 4, 64);
        return texFrom(c);
    });
}
// Glittery rainbow (finale floors, rainbow wings)
export function rainbowTexture() {
    return once('rainbow', () => {
        const N = 256, c = canvas(N, 16), x = c.getContext('2d');
        const g = x.createLinearGradient(0, 0, N, 0);
        ['#ff5a7a', '#ffb84a', '#ffe85a', '#6aff8a', '#5ac8ff', '#b88aff', '#ff5a7a'].forEach((col, i, a) => g.addColorStop(i / (a.length - 1), col));
        x.fillStyle = g; x.fillRect(0, 0, N, 16);
        const t = texFrom(c); t.wrapS = T.RepeatWrapping;
        return t;
    });
}
// Wooden lattice beams in the chocolate lobby (brown planks with grain)
export function woodTexture() {
    return once('wood', () => {
        const N = 128, c = canvas(N), x = c.getContext('2d'), rnd = seeded(3);
        x.fillStyle = '#7a4a2a'; x.fillRect(0, 0, N, N);
        for (let k = 0; k < 30; k++) { x.fillStyle = `rgba(${60 + rnd() * 40},${30 + rnd() * 20},${15},${0.2 + rnd() * 0.3})`; x.fillRect(0, rnd() * N, N, 1 + rnd() * 2); }
        const t = texFrom(c); t.wrapS = t.wrapT = T.RepeatWrapping;
        return t;
    });
}

// Animated textures (offsets scrolled every frame)
export const scrolling = [];
export function updateMaterials(dt) {
    for (const s of scrolling) { s.tex.offset.x += s.u * dt; s.tex.offset.y += s.v * dt; }
}
