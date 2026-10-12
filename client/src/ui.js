import { $ } from './engine.js';
import { S, actions, net } from './state.js';
import * as BX from './bloxity.js';
import { sfx, getVolumes, setVolume, toggleMusic, musicMuted, setMusicDuck } from './audio.js';
import { QUALITIES, getQuality, setQuality } from './fx.js';
import {
    CFG, STAGES, SHOES, TREADMILLS, ITEMS, itemById, TRAILS, BOOSTS, FREE, DAILY, QUESTS,
    xpFor, maxSpeedFor, jumpsFor, rebirthLevel, rebirthMult, multipliers, eventState, levelCost, packAmount, packCost,
    questProgress, dailyStatus, rewardText, fmt, fmt1, fmtK, clock, clock3, clamp, trailById,
} from '../../shared/config.js';

const W = (n) => '🏆 ' + fmt(n);
function setHtml(node, html) { if (node && node.innerHTML !== html) node.innerHTML = html; }
function setText(node, t) { if (node && node.textContent !== t) node.textContent = t; }

const el = {
    wins: $('#winsVal'), speed: $('#speedVal'), rebCur: $('#rebCur'), reb: $('#rebVal'),
    xpFill: $('#xpFill'), levelTxt: $('#levelTxt'), xpTxt: $('#xpTxt'),
    maxSpeed: $('#maxSpeedTxt'), input: $('#speedInput'), slider: $('#speedSlider'), price2x: $('#price2x'),
    freeBadge: $('#freeBadge'), dailyBadge: $('#dailyBadge'), questBadge: $('#questBadge'), rebPct: $('#rebirthPct'),
    mGlobal: $('#mGlobal'), mPass: $('#mPass'), mItems: $('#mItems'), mTrail: $('#mTrail'), mRebirth: $('#mRebirth'),
    event: $('#eventBox'), quest: $('#quest'), questTxt: $('#questTxt'), starter: $('#starter'), starterTime: $('#starterTime'),
    starterPrice: $('#starterPrice'), lvlPrice: $('#lvlPrice'), jump: $('#jumpCount'),
    prompt: $('#promptBtn'), promptTxt: $('#promptTxt'),
};
export const promptEl = el.prompt, promptTxtEl = el.promptTxt;
const packBtns = [...document.querySelectorAll('[data-pack]')];

// ----- counters -----
const shown = { wins: null, speed: null };
export function animateCounters(dt) {
    for (const key of ['wins', 'speed']) {
        const target = S[key];
        if (shown[key] === null) shown[key] = target;
        if (shown[key] === target) continue;
        if (target > shown[key] && key === 'wins') { const c = $('#winsCur'); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
        const diff = target - shown[key];
        shown[key] = Math.abs(diff) < 1 ? target : shown[key] + diff * Math.min(1, dt * 7);
        if (Math.abs(target - shown[key]) < Math.max(1, target * 0.002)) shown[key] = target;
        el[key].textContent = key === 'speed' ? fmtK(shown[key]) : fmt(shown[key]);
    }
}

// ----- HUD, ten times a second -----
let lastQuestKey = '';
export function updateHud() {
    const now = net.now();
    el.rebCur.hidden = !S.rebirths;
    setText(el.reb, String(S.rebirths));
    const need = xpFor(Math.min(S.level, CFG.maxLevel));
    el.xpFill.style.width = clamp(S.xp / need * 100, 0, 100) + '%';
    setText(el.levelTxt, S.level >= CFG.maxLevel ? 'Level MAX' : 'Level ' + S.level);
    setText(el.xpTxt, fmt1(S.xp) + '/' + fmt1(need));
    const max = maxSpeedFor(S.level, S.rebirths);
    setText(el.maxSpeed, 'MAX: ' + max);
    el.slider.max = max; el.slider.min = CFG.minWalk;
    const cur = S.customSpeed > 0 && S.customSpeed <= max ? S.customSpeed : max;
    if (document.activeElement !== el.input) el.input.value = cur;
    if (document.activeElement !== el.slider) el.slider.value = cur;
    setHtml(el.price2x, S.pass2x ? '✅ OWNED' : 'ONLY ' + W(BOOSTS.pass2x.cost));
    // Multipliers, as the reference lists them under the Speed
    const m = multipliers(S, now, S.friends);
    setText(el.mGlobal, 'Multiplier x' + m.global + ' (Global)');
    setText(el.mPass, 'Multiplier x' + (m.pass) + ' (x2 Speed)');
    setText(el.mItems, 'Multiplier x' + m.items + ' (Items)');
    setText(el.mTrail, 'Multiplier x' + m.trail + ' (Trail)');
    setText(el.mRebirth, 'Multiplier x' + m.rebirth + ' (Rebirth)');
    // Rebirth progress badge ("10%")
    const rl = rebirthLevel(S.rebirths);
    setText(el.rebPct, S.level >= rl ? 'READY' : Math.floor(Math.min(99, (S.level - 1) / Math.max(1, rl - 1) * 100)) + '%');
    // Event timer
    const ev = eventState(now);
    setText(el.event, ev.on ? '🍭 SUGAR RUSH x2 ' + clock3(ev.left) : 'Event In ' + clock3(ev.left));
    el.event.classList.toggle('on', ev.on);
    // Badges
    const mins = (now - S.joinedAt) / 60000;
    el.freeBadge.hidden = !FREE.some((r, i) => mins >= r.min && !S.freeClaimed[i]);
    el.dailyBadge.hidden = !(S.daily && dailyStatus(S.daily, now).can);
    // Quest line
    const q = QUESTS[S.quest || 0];
    const qText = q ? (q.text + ' (' + fmt(Math.min(q.n, questProgress(q, S))) + '/' + fmt(q.n) + ')') : 'All quests done! 👑';
    if (qText !== lastQuestKey) { lastQuestKey = qText; el.questTxt.textContent = qText; }
    // OP Starter Pack: the first 15 minutes after you first play
    const left = CFG.starterPackMinutes * 60 - (now - S.firstPlay) / 1000;
    el.starter.hidden = S.starterPack || left <= 0;
    if (!el.starter.hidden) { setText(el.starterTime, clock(left)); setText(el.starterPrice, 'ONLY ' + W(BOOSTS.starter.cost)); }
    // Bottom buy row
    setText(el.lvlPrice, W(levelCost(S.level)));
    packBtns.forEach((b, i) => {
        setText(b.querySelector('b'), '+' + fmt(packAmount(i, S.level)));
        setText(b.querySelector('.p'), W(packCost(i, S.level)));
    });
    $('#btnSounds').classList.toggle('off', musicMuted());
    if (!$('#modal').hidden && (modalKind === 'free' || modalKind === 'rebirth')) renderModal();
    if (!$('#daily').hidden) renderDaily();
    if (teleBack.until) updateTeleBack();
}

// "Jump: 12/13" while you're in the air
let jumpShown = '';
export function jumpCounter(left, max, air) {
    const t = 'Jump: ' + left + '/' + max;
    el.jump.classList.toggle('show', !!air);
    if (t !== jumpShown) {
        jumpShown = t; el.jump.textContent = t;
        el.jump.classList.toggle('low', left > 0 && left <= Math.max(1, Math.floor(max * 0.2)));
        el.jump.classList.toggle('out', left === 0);
        el.jump.classList.remove('pop'); void el.jump.offsetWidth; el.jump.classList.add('pop');
    }
}

export function toast(text, color) {
    const d = document.createElement('div');
    d.className = 'toast o'; d.textContent = text; d.style.color = color || '#fff';
    const box = $('#toasts');
    box.appendChild(d);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => d.remove(), 2600);
}
export function showGoal(n, escape) {
    const g = $('#goalBanner');
    g.querySelector('.goal').textContent = escape ? '👑 ESCAPED! 👑' : '+' + fmt(n) + ' WIN' + (n > 1 ? 'S' : '') + '!';
    $('#goalSub').textContent = escape ? '+' + fmt(n) + ' Wins' : 'Back to the lobby…';
    g.hidden = false;
    g.classList.remove('show'); void g.offsetWidth; g.classList.add('show');
    clearTimeout(showGoal.t);
    showGoal.t = setTimeout(() => { g.hidden = true; }, 2700);
}
export function showOof() {
    const o = $('#oof');
    o.textContent = ['OOF!', 'OOPS!', 'BONK!', 'OUCH!'][Math.floor(Math.random() * 4)];
    o.hidden = false; o.classList.remove('show'); void o.offsetWidth; o.classList.add('show');
    const f = $('#flash'); f.classList.remove('show'); f.classList.add('dead'); void f.offsetWidth; f.classList.add('show');
    clearTimeout(showOof.t); showOof.t = setTimeout(() => { o.hidden = true; f.classList.remove('dead'); }, 1300);
}
// "LEVEL UP!" / "Level 2" / "Speed 11 (+3) • Jump 2 (+1)"
export function levelUp(m) {
    const f = $('#flash'); f.classList.remove('show', 'dead'); void f.offsetWidth; f.classList.add('show');
    $('#lvlL').textContent = 'Level ' + m.to;
    const dw = m.walk[1] - m.walk[0], dj = m.jump[1] - m.jump[0];
    $('#lvlD').textContent = 'Speed ' + m.walk[1] + ' (+' + dw + ') • Jump ' + m.jump[1] + ' (+' + dj + ')';
    const d = $('#levelPop');
    d.classList.remove('show'); void d.offsetWidth; d.classList.add('show');
}
let titleTimer;
export function showStageTitle(s) {
    $('#stageName').textContent = s.name.toUpperCase();
    const sub = $('#stageSub'); sub.textContent = s.sub || ''; sub.style.color = '#' + s.theme.accent.toString(16).padStart(6, '0');
    const t = $('#stageTitle'); t.style.opacity = 1;
    t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
    clearTimeout(titleTimer);
    titleTimer = setTimeout(() => { t.style.opacity = 0; }, 2600);
}
export function showOffline(m) {
    const h = Math.floor(m.secs / 3600), mm = Math.floor((m.secs % 3600) / 60);
    $('#offlineText').textContent = 'Your x' + m.mult + ' treadmill kept running for ' + (h ? h + 'h ' : '') + mm + 'm while you were away!';
    $('#offlineGain').textContent = '+' + fmt(m.speed) + ' Speed';
    $('#offlinePop').hidden = false;
    sfx('buy');
}
$('#offlineOk').addEventListener('click', () => { $('#offlinePop').hidden = true; });
export function questDone(m) {
    el.quest.classList.remove('done'); void el.quest.offsetWidth; el.quest.classList.add('done');
    toast('✅ ' + m.done + '!  ' + m.reward, '#7dff6b');
    sfx('quest');
}

// ----- "Teleport Back" after a Wins pad: back to the stage you came from -----
const teleBack = { until: 0, stage: -1 };
export function showTeleBack(stage) {
    teleBack.until = performance.now() + CFG.teleportBackSecs * 1000; teleBack.stage = stage;
    $('#teleBack').hidden = false;
    updateTeleBack();
}
export function hideTeleBack() { teleBack.until = 0; $('#teleBack').hidden = true; }
function updateTeleBack() {
    const left = (teleBack.until - performance.now()) / 1000;
    if (left <= 0) { hideTeleBack(); return; }
    $('#teleNum').textContent = Math.ceil(left);
    $('#teleRing').style.setProperty('--p', (left / CFG.teleportBackSecs * 100).toFixed(0) + '%');
}
$('#teleBack').addEventListener('click', () => { const s = teleBack.stage; hideTeleBack(); actions.teleportStage(s); });

// ----- buying with Wins -----
let pendingConfirm = null;
export function confirmBuy(o) {
    if (S.wins < o.cost) { toast('Not Enough Wins! (need ' + fmt(o.cost - S.wins) + ' more)', '#ff5a5a'); sfx('denied'); return; }
    // Cheap things (under a tenth of your Wins) are bought straight away
    if (o.quick && o.cost <= Math.max(3, S.wins * 0.1)) { o.onYes(); return; }
    pendingConfirm = o;
    $('#confirmIc').textContent = o.ic || '🛒';
    $('#confirmTitle').textContent = o.title || 'Buy?';
    $('#confirmText').textContent = o.text || '';
    $('#confirmCost').textContent = '🏆 ' + fmt(o.cost) + ' Wins';
    $('#confirm').hidden = false;
}
$('#confirmYes').addEventListener('click', () => { $('#confirm').hidden = true; if (pendingConfirm) pendingConfirm.onYes(); pendingConfirm = null; });
for (const id of ['#confirmNo', '#confirmClose']) $(id).addEventListener('click', () => { $('#confirm').hidden = true; pendingConfirm = null; });

export function buyBoost(id) {
    const b = BOOSTS[id];
    if (id === 'pass2x' && S.pass2x) { toast('x2 Speed is already yours!', '#6fe0ff'); return; }
    confirmBuy({ ic: b.ic, title: b.name, text: b.desc, cost: b.cost, onYes: () => net.send('boost', { id }) });
}
function buyLevel() { confirmBuy({ ic: '⬆️', title: '+1 Level', text: 'Level ' + S.level + ' → ' + (S.level + 1) + ' (+3 Speed, +1 Jump)', cost: levelCost(S.level), quick: true, onYes: () => net.send('level') }); }
function buyPack(i) { confirmBuy({ ic: '👟', title: '+' + fmt(packAmount(i, S.level)) + ' Speed', text: 'Instant Speed (counts toward your level)', cost: packCost(i, S.level), quick: true, onYes: () => net.send('pack', { i }) }); }
export function buyItem(d) {
    if (S.items[d.id]) { net.send('item', { id: d.id }); return; }
    confirmBuy({ ic: d.ic, title: d.name, text: 'x' + d.mult + ' Speed while you wear it', cost: d.cost, onYes: () => net.send('item', { id: d.id }) });
}
export function buyShoe(d) {
    if (S.shoes[d.id]) { net.send('shoe', { id: d.id }); return; }
    confirmBuy({ ic: '👟', title: d.name, text: '+' + fmt(d.bonus) + ' Steps on every step', cost: d.cost, quick: true, onYes: () => net.send('shoe', { id: d.id }) });
}
export function buyTread(d) {
    confirmBuy({ ic: '🏃', title: 'x' + d.mult + ' Treadmill', text: 'Every step on it counts x' + d.mult, cost: d.cost, onYes: () => net.send('tread', { id: d.id }) });
}

// ----- custom speed -----
const sendCustom = (v) => net.send('custom', { v: Number(v) || 0 });
el.input.addEventListener('change', () => sendCustom(el.input.value));
el.slider.addEventListener('input', () => { el.input.value = el.slider.value; });
el.slider.addEventListener('change', () => sendCustom(el.slider.value));

// ----- buttons -----
$('#btnShop').addEventListener('click', () => openModal('shop', 'boosts'));
$('#btnMore').addEventListener('click', () => openModal('shop', 'boosts'));
$('#btnTrade').addEventListener('click', () => openModal('trade'));
$('#btn2x').addEventListener('click', () => buyBoost('pass2x'));
$('#starter').addEventListener('click', () => buyBoost('starter'));
$('#btnLevel').addEventListener('click', buyLevel);
packBtns.forEach((b, i) => b.addEventListener('click', () => buyPack(i)));
$('#btnRebirth').addEventListener('click', () => openModal('rebirth'));
$('#btnInventory').addEventListener('click', () => openModal('inventory', 'items'));
$('#btnSounds').addEventListener('click', () => openModal('sounds'));
$('#btnFree').addEventListener('click', () => openModal('free'));
$('#btnTeleport').addEventListener('click', () => openModal('teleport'));
$('#btnTreadmill').addEventListener('click', () => actions.autoTrain());
$('#btnCodes').addEventListener('click', () => openModal('codes'));
$('#btnQuests').addEventListener('click', () => openModal('quests'));
$('#btnDaily').addEventListener('click', () => openDaily());
$('#btnFriends').addEventListener('click', () => openModal('friends'));
$('#btnSettings').addEventListener('click', () => openModal('settings'));
// Every chunky button clicks like a key
// Every button, tile, tab and shop card clicks (pointerdown, so it feels instant)
document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest('button, .btn, .rbx, .ib, #starter, [role="button"], .tab, .card, .slot, .item, input[type="range"]');
    if (b && !b.disabled) sfx(b.matches('.g-green, .buy, .claim') ? 'clickBuy' : 'click');
}, true);

// ----- panels -----
let modalKind = null, modalTab = null;
export function openModal(kind, tab) { modalKind = kind; modalTab = tab || null; renderModal(); $('#modal').hidden = false; setMusicDuck(true); }
export function closeModal() { $('#modal').hidden = true; modalKind = null; setMusicDuck(false); }
export function refreshModal() { if (!$('#modal').hidden) renderModal(); if (!$('#tradeWin').hidden) renderTrade(); }
export const modalOpen = () => !$('#modal').hidden;
$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal') closeModal(); });

function rowCard(ic, name, desc, btnText, btnClass, onClick, disabled, on) {
    const d = document.createElement('div');
    d.className = 'row-card' + (on ? ' on' : '');
    d.innerHTML = '<div class="ic"></div><div><div class="nm o1"></div><div class="ds"></div></div><button class="btn o1"></button>';
    d.querySelector('.ic').textContent = ic;
    d.querySelector('.nm').textContent = name;
    d.querySelector('.ds').textContent = desc;
    const b = d.querySelector('button');
    b.classList.add(btnClass);
    b.textContent = btnText; b.disabled = !!disabled;
    b.addEventListener('click', onClick);
    return d;
}
function sec(text) { const d = document.createElement('div'); d.className = 'sec'; d.textContent = text; return d; }
function note(body, text) { const p = document.createElement('p'); p.className = 'note'; p.textContent = text; body.appendChild(p); return p; }
function tabs(list) {
    const t = $('#modalTabs');
    t.innerHTML = '';
    t.hidden = !list;
    if (!list) return;
    for (const [key, label] of list) {
        const b = document.createElement('button');
        b.className = 'btn o1 ' + (modalTab === key ? 'g-yellow' : 'g-grey');
        b.textContent = label;
        b.addEventListener('click', () => { modalTab = key; renderModal(); });
        t.appendChild(b);
    }
}

function renderModal() {
    const body = $('#modalBody'), title = $('#modalTitle');
    body.innerHTML = '';
    tabs(null);
    const k = modalKind;
    if (k === 'shop') {
        title.textContent = 'Shop';
        tabs([['boosts', '⚡ Boosts'], ['items', '🪽 Items'], ['shoes', '👟 Shoes'], ['treads', '🏃 Treadmills']]);
        note(body, 'Everything here is bought with Wins 🏆. Get Wins on the stage pads!');
        if (modalTab === 'boosts') renderBoosts(body);
        else if (modalTab === 'items') renderItems(body, false);
        else if (modalTab === 'shoes') renderShoes(body, false);
        else renderTreads(body);
    } else if (k === 'inventory') {
        title.textContent = 'Inventory';
        tabs([['items', '🪽 Items'], ['shoes', '👟 Shoes'], ['trails', '✨ Trails']]);
        if (modalTab === 'items') renderItems(body, true);
        else if (modalTab === 'shoes') renderShoes(body, true);
        else renderTrails(body);
    } else if (k === 'rebirth') {
        title.textContent = 'Rebirth';
        renderRebirth(body);
    } else if (k === 'free') {
        title.textContent = 'FREE Rewards';
        renderFree(body);
    } else if (k === 'teleport') {
        title.textContent = 'Teleport';
        renderTeleport(body);
    } else if (k === 'codes') {
        title.textContent = 'Codes';
        renderCodes(body);
    } else if (k === 'quests') {
        title.textContent = 'Quests';
        renderQuests(body);
    } else if (k === 'trade') {
        title.textContent = 'Trade';
        renderTradeList(body);
    } else if (k === 'gift') {
        title.textContent = 'Gift Shop';
        renderGift(body);
    } else if (k === 'friends') {
        title.textContent = 'Friends';
        renderFriends(body);
    } else if (k === 'settings') {
        title.textContent = 'Settings';
        renderSettings(body);
    } else if (k === 'sounds') {
        title.textContent = 'Sounds';
        renderSounds(body);
    }
}

function renderBoosts(body) {
    const b = BOOSTS;
    body.appendChild(rowCard(b.pass2x.ic, b.pass2x.name + ' (forever)', b.pass2x.desc, S.pass2x ? 'OWNED' : W(b.pass2x.cost), S.pass2x ? 'g-grey' : 'g-green', () => buyBoost('pass2x'), S.pass2x));
    const boostLeft = (S.boostUntil - net.now()) / 1000;
    body.appendChild(rowCard(b.boost.ic, b.boost.name, boostLeft > 0 ? 'Active: ' + clock(boostLeft) + ' left (adds 15 min)' : b.boost.desc, W(b.boost.cost), 'g-yellow', () => buyBoost('boost')));
    const left = CFG.starterPackMinutes * 60 - (net.now() - S.firstPlay) / 1000;
    if (!S.starterPack && left > 0) body.appendChild(rowCard(b.starter.ic, b.starter.name, b.starter.desc + ' · ' + clock(left) + ' left', W(b.starter.cost), 'g-pink', () => buyBoost('starter')));
    body.appendChild(sec('Levels & Speed'));
    body.appendChild(rowCard('⬆️', '+1 Level', 'Level ' + S.level + ' → ' + (S.level + 1) + ': +3 Speed, +1 Jump', W(levelCost(S.level)), 'g-blue', buyLevel));
    [0, 1, 2].forEach((i) => body.appendChild(rowCard('👟', '+' + fmt(packAmount(i, S.level)) + ' Speed', 'Instant Speed for this level', W(packCost(i, S.level)), ['g-green', 'g-blue', 'g-purple'][i], () => buyPack(i))));
}
function renderItems(body, owned) {
    const list = owned ? ITEMS.filter((d) => S.items[d.id]) : ITEMS;
    if (owned && !list.length) { note(body, 'No items yet. Buy wings, halos and more in the Shop or the Items Shop in the lobby!'); return; }
    for (const d of list) {
        const has = !!S.items[d.id], on = S.item === d.id;
        let btn, cls, fn;
        if (on) { btn = 'Unequip'; cls = 'g-grey'; fn = () => net.send('item', { off: true }); }
        else if (has) { btn = 'Equip'; cls = 'g-green'; fn = () => net.send('item', { id: d.id }); }
        else { btn = W(d.cost); cls = S.wins >= d.cost ? 'g-green' : 'g-grey'; fn = () => buyItem(d); }
        body.appendChild(rowCard(d.ic, d.name, 'x' + d.mult + ' Speed' + (has ? ' · owned' : ''), btn, cls, fn, false, on));
    }
}
function renderShoes(body, owned) {
    const list = owned ? SHOES.filter((d) => S.shoes[d.id]) : SHOES;
    if (owned && !list.length) { note(body, 'No shoes yet. Step on a pad at the SHOES stand in the lobby!'); return; }
    for (const d of list) {
        const has = !!S.shoes[d.id], on = S.shoe === d.id;
        const btn = on ? 'EQUIPPED' : has ? 'Equip' : W(d.cost);
        body.appendChild(rowCard('👟', d.name, '+' + fmt(d.bonus) + ' Steps per step', btn, on ? 'g-grey' : has || S.wins >= d.cost ? 'g-green' : 'g-grey', () => buyShoe(d), on, on));
    }
}
function renderTreads(body) {
    for (const d of TREADMILLS) {
        const owned = d.cost === 0 && !d.daily ? true : !!S.treads[d.id];
        let btn, cls, fn;
        if (owned) { btn = 'Go train'; cls = 'g-blue'; fn = () => { closeModal(); actions.trainOn(d); }; }
        else if (d.daily) { btn = 'Day 7 reward'; cls = 'g-grey'; fn = () => openDaily(); }
        else { btn = W(d.cost); cls = S.wins >= d.cost ? 'g-green' : 'g-grey'; fn = () => buyTread(d); }
        body.appendChild(rowCard('🏃', (d.label ? d.label + ' ' : '') + 'x' + d.mult + ' Treadmill', 'Every step on it counts x' + d.mult + (d.tag ? ' ' + d.tag : ''), btn, cls, fn));
    }
}
function renderTrails(body) {
    for (const d of TRAILS) {
        const ok = d.daily ? !!S.trails[d.id] : S.rebirths >= d.reb, on = S.trail === d.id;
        const how = d.daily ? 'Daily Reward Day 3' : d.reb ? d.reb + ' Rebirth' + (d.reb > 1 ? 's' : '') : 'Free';
        body.appendChild(rowCard('✨', d.name + ' Trail', 'x' + d.mult + ' Steps · ' + how, on ? 'EQUIPPED' : ok ? 'Equip' : '🔒 Locked', on || !ok ? 'g-grey' : 'g-green', () => net.send('trail', { id: d.id }), on || !ok, on));
    }
}
function renderRebirth(body) {
    const need = rebirthLevel(S.rebirths), ready = S.level >= need;
    const cur = rebirthMult(S.rebirths), next = rebirthMult(S.rebirths + 1);
    const w = document.createElement('div');
    w.className = 'rebirth-box';
    const pct = Math.min(100, (S.level - 1) / Math.max(1, need - 1) * 100);
    w.innerHTML = `<div class="big o">🔄 ${S.rebirths} Rebirth${S.rebirths === 1 ? '' : 's'}</div>
        <div class="mult o"><span style="color:#6fe0ff">x${cur}</span><span>➜</span><span style="color:#7dff6b">x${next}</span></div>
        <div class="prog"><i style="width:${pct.toFixed(0)}%"></i><span class="o1">Level ${S.level} / ${need}</span></div>
        <p>Rebirth: your Level goes back to 1, but you keep it all for good: <b>+50% Speed</b>, <b>+25% Wins</b>, <b>+1 Jump</b> and <b>+2 walk speed</b>, plus new Trails by the treadmills. You keep your Wins, Speed, shoes, items and treadmills.</p>`;
    const b = document.createElement('button');
    b.className = 'btn o ' + (ready ? 'g-green' : 'g-grey');
    b.textContent = ready ? 'REBIRTH!' : 'Reach Level ' + need;
    b.disabled = !ready;
    b.addEventListener('click', () => { net.send('rebirth'); });
    w.appendChild(b);
    body.appendChild(w);
}
let freeSig = '';
function renderFree(body) {
    const mins = (net.now() - S.joinedAt) / 60000;
    const sig = FREE.map((r, i) => (S.freeClaimed[i] ? 'c' : mins >= r.min ? 'r' : Math.ceil(r.min * 60 - mins * 60))).join(',');
    if (sig === freeSig && body.children.length) return;
    freeSig = sig;
    body.innerHTML = '';
    FREE.forEach((r, i) => {
        const claimed = !!S.freeClaimed[i], ready = mins >= r.min;
        const btn = claimed ? 'Claimed' : ready ? 'CLAIM' : clock(r.min * 60 - mins * 60);
        body.appendChild(rowCard(r.speed ? '👟' : r.wins ? '🏆' : '⚡', rewardText(r), 'Play for ' + r.min + ' min', btn,
            claimed ? 'g-grey' : ready ? 'g-green' : 'g-blue', () => { if (!claimed && ready) net.send('free', { i }); }, claimed || !ready));
    });
}
function renderTeleport(body) {
    const grid = document.createElement('div'); grid.className = 'tele-grid';
    const btn = (label, small, cls, fn, disabled) => {
        const b = document.createElement('button');
        b.className = 'btn o1 ' + cls; b.disabled = !!disabled;
        b.innerHTML = '<span></span><small></small>';
        b.firstChild.textContent = label; b.lastChild.textContent = small;
        b.addEventListener('click', () => { closeModal(); fn(); });
        grid.appendChild(b);
    };
    btn('🏠 Lobby', 'Spawn', 'g-pink', () => actions.teleportLobby());
    btn('🏃 Treadmills', 'Train Speed', 'g-orange', () => actions.teleportSpot('treads'));
    btn('👟 Shoes', '+Steps', 'g-red', () => actions.teleportSpot('shoes'));
    const jumps = jumpsFor(S.level, S.rebirths);
    STAGES.forEach((s, i) => {
        const open = i <= (S.maxStage || 0);
        btn((open ? '' : '🔒 ') + s.name, open ? s.sub : 'Need ' + s.need + ' jumps (you: ' + jumps + ')', open ? 'g-blue' : 'g-grey', () => actions.teleportStage(i), !open);
    });
    body.appendChild(grid);
}
export function codeResult(m) {
    toast(m.ok ? '🎉 Code redeemed! ' + m.text : '❌ ' + m.text, m.ok ? '#7dff6b' : '#ff5a5a');
    if (m.ok) sfx('buy'); else sfx('denied');
    const i = document.querySelector('#codeInput');
    if (i && m.ok) i.value = '';
}
function renderCodes(body) {
    const row = document.createElement('div'); row.className = 'code-row';
    row.innerHTML = '<input id="codeInput" maxlength="20" placeholder="Enter code" aria-label="Code" autocomplete="off"><button class="btn g-green o1" id="codeGo">Redeem</button>';
    body.appendChild(row);
    const go = () => { const v = row.querySelector('input').value.trim(); if (v) net.send('code', { code: v }); };
    row.querySelector('button').addEventListener('click', go);
    row.querySelector('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); e.stopPropagation(); });
    note(body, 'Codes give free Speed, Wins and boosts. Try BACKFLIP and KEYBOARD! New codes come with every update.');
}
function renderQuests(body) {
    QUESTS.forEach((q, i) => {
        const done = i < (S.quest || 0), cur = i === (S.quest || 0);
        if (i > (S.quest || 0) + 3) return;
        const prog = Math.min(q.n, questProgress(q, S));
        body.appendChild(rowCard(done ? '✅' : cur ? '⭐' : '🔒', q.text, done ? 'Done!' : fmt(prog) + '/' + fmt(q.n) + ' · Reward: ' + rewardText(q.reward), done ? 'DONE' : cur ? 'In progress' : 'Next', done ? 'g-grey' : cur ? 'g-yellow' : 'g-grey', () => {}, true, cur));
    });
}
// ----- Trade & Gift -----
function playersHere() {
    const room = net.room, list = [];
    if (room && room.state && room.state.players) room.state.players.forEach((p, id) => { if (id !== room.sessionId) list.push({ id, name: p.name, level: p.level }); });
    return list;
}
function renderTradeList(body) {
    const list = playersHere();
    note(body, 'Trade Items and Wins with other players in this server. Both of you check the offer and press Ready.');
    const gift = document.createElement('button');
    gift.className = 'btn g-pink o1'; gift.textContent = '🎁 Gift Shop: buy an item for a friend';
    gift.addEventListener('click', () => openModal('gift'));
    body.appendChild(gift);
    if (!list.length) { note(body, 'Nobody else is here right now. Invite your friends!'); return; }
    for (const p of list) body.appendChild(rowCard('🧑', p.name, 'Level ' + p.level, 'Trade', 'g-yellow', () => { net.send('tradeReq', { to: p.id }); closeModal(); }));
}
function renderGift(body) {
    const list = playersHere();
    if (!list.length) { note(body, 'Nobody else is here to gift to. Invite your friends!'); return; }
    const row = document.createElement('div'); row.className = 'gift-row';
    const sel = document.createElement('select'); sel.setAttribute('aria-label', 'Player');
    for (const p of list) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name; sel.appendChild(o); }
    row.innerHTML = '<b class="o1">Gift to:</b>'; row.appendChild(sel);
    body.appendChild(row);
    for (const d of ITEMS) body.appendChild(rowCard(d.ic, d.name, 'x' + d.mult + ' Speed · they keep it', '🎁 ' + W(d.cost), S.wins >= d.cost ? 'g-pink' : 'g-grey', () => {
        const to = sel.value, name = sel.options[sel.selectedIndex].textContent;
        confirmBuy({ ic: '🎁', title: 'Gift ' + d.name, text: 'to ' + name, cost: d.cost, onYes: () => net.send('gift', { to, item: d.id }) });
    }));
}
let trade = null, tradeAskFrom = null;
export function showTradeAsk(m) {
    tradeAskFrom = m.from;
    $('#tradeAskText').textContent = m.name + ' wants to trade with you!';
    $('#tradeAsk').hidden = false;
    sfx('quest');
}
$('#tradeAccept').addEventListener('click', () => { $('#tradeAsk').hidden = true; net.send('tradeAns', { from: tradeAskFrom, ok: true }); });
$('#tradeDecline').addEventListener('click', () => { $('#tradeAsk').hidden = true; net.send('tradeAns', { from: tradeAskFrom, ok: false }); });
export function showTrade(m) {
    trade = m;
    $('#tradeWin').hidden = false;
    renderTrade();
}
export function tradeDone() { trade = null; $('#tradeWin').hidden = true; }
function sendOffer(items, wins) { net.send('tradeSet', { items, wins }); }
function renderTrade() {
    if (!trade) return;
    $('#tradeTitle').textContent = 'Trade with ' + trade.name;
    $('#tradeTheirName').textContent = trade.name + "'s offer";
    const mine = $('#tradeMyItems'); mine.innerHTML = '';
    const sel = new Set(trade.mine.items);
    const owned = ITEMS.filter((d) => S.items[d.id]);
    if (!owned.length) mine.innerHTML = '<span class="note">No items to trade</span>';
    for (const d of owned) {
        const c = document.createElement('button');
        c.className = 'chip' + (sel.has(d.id) ? ' sel' : ''); c.textContent = d.ic + ' ' + d.name;
        c.addEventListener('click', () => { if (sel.has(d.id)) sel.delete(d.id); else sel.add(d.id); sendOffer([...sel], Number($('#tradeWins').value) || 0); });
        mine.appendChild(c);
    }
    const winsIn = $('#tradeWins');
    if (document.activeElement !== winsIn) winsIn.value = trade.mine.wins;
    const theirs = $('#tradeTheirItems'); theirs.innerHTML = '';
    if (!trade.theirs.items.length) theirs.innerHTML = '<span class="note">Nothing yet</span>';
    for (const id of trade.theirs.items) { const d = itemById[id]; if (!d) continue; const c = document.createElement('span'); c.className = 'chip sel'; c.textContent = d.ic + ' ' + d.name + ' (x' + d.mult + ')'; theirs.appendChild(c); }
    $('#tradeTheirWins').textContent = '🏆 ' + fmt(trade.theirs.wins);
    $('#tradeMine').classList.toggle('ready', trade.ready);
    $('#tradeTheirs').classList.toggle('ready', trade.theyReady);
    const rb = $('#tradeReady');
    rb.textContent = trade.ready ? 'Not ready' : 'Ready';
    rb.className = 'btn o ' + (trade.ready ? 'g-grey' : 'g-green');
    let st = 'Pick what to offer, then press Ready.';
    if (trade.confirmAt) st = 'Trading in ' + Math.max(0, Math.ceil((trade.confirmAt - net.now()) / 1000)) + '…';
    else if (trade.ready && !trade.theyReady) st = 'Waiting for ' + trade.name + '…';
    else if (!trade.ready && trade.theyReady) st = trade.name + ' is ready!';
    $('#tradeStatus').textContent = st;
}
$('#tradeWins').addEventListener('change', () => { if (trade) sendOffer(trade.mine.items, Number($('#tradeWins').value) || 0); });
$('#tradeWins').addEventListener('keydown', (e) => e.stopPropagation());
$('#tradeReady').addEventListener('click', () => { if (trade) net.send('tradeReady', { on: !trade.ready }); });
for (const id of ['#tradeCancel', '#tradeClose']) $(id).addEventListener('click', () => { net.send('tradeCancel'); tradeDone(); });
setInterval(() => { if (trade && trade.confirmAt) renderTrade(); }, 250);

// ----- Daily Rewards -----
let dailyAuto = false;
export function openDailyOnJoin() {
    if (dailyAuto || !S.daily || !net.room) return;
    dailyAuto = true;
    if (dailyStatus(S.daily, net.now()).can) setTimeout(openDaily, 1500);
}
function openDaily() { renderDaily(true); $('#daily').hidden = false; }
$('#dailyClose').addEventListener('click', () => { $('#daily').hidden = true; });
$('#daily').addEventListener('pointerdown', (e) => { if (e.target.id === 'daily') $('#daily').hidden = true; });
$('#dailyClaim').addEventListener('click', () => { net.send('daily'); setTimeout(() => { $('#daily').hidden = true; }, 700); });
let dailySig = '';
function renderDaily(force) {
    const st = dailyStatus(S.daily, net.now());
    const sig = st.can + '|' + st.streak + '|' + st.day;
    if (force || sig !== dailySig) {
        dailySig = sig;
        const cards = $('#dailyCards');
        cards.innerHTML = '';
        DAILY.forEach((r, i) => {
            const done = i < (st.streak % DAILY.length) && (i < st.day || !st.can);
            const today = i === st.day && st.can;
            const d = document.createElement('div');
            d.className = 'dcard' + (done ? ' done' : '') + (today ? ' today' : '');
            const ic = r.trail ? '🌙' : r.tread ? '🌊' : r.wins ? '🏆' : '👟';
            const label = r.trail ? trailById[r.trail].name : r.tread ? 'Aqua Treadmill' : '+' + fmt(r.speed || r.wins) + (r.wins ? ' Wins' : ' Speed');
            d.innerHTML = '<span class="dn o1"></span><span class="di"></span><span class="dr o1"></span><span class="st o1"></span>';
            d.querySelector('.dn').textContent = 'DAY ' + (i + 1);
            d.querySelector('.di').textContent = ic;
            d.querySelector('.dr').textContent = label;
            d.querySelector('.st').textContent = today ? 'CLAIM!' : done ? 'CLAIMED' : 'LOCKED';
            cards.appendChild(d);
        });
        const b = $('#dailyClaim');
        b.disabled = !st.can;
        b.textContent = st.can ? 'CLAIM' : 'CLAIMED!';
    }
    const now = net.now(), next = Math.ceil((now + 1) / 86400000) * 86400000;
    $('#dailyLeft').textContent = st.can ? 'Your daily reward is ready!' : 'Next reward in ' + clock((next - now) / 1000);
}

// ----- Friends, Settings -----
function renderFriends(body) {
    if (!BX.bloxity.ready) { note(body, 'Bloxity is not available right now.'); return; }
    const id = BX.identity();
    const link = document.createElement('div');
    link.className = 'invite-row';
    link.innerHTML = '<input id="inviteLink" readonly aria-label="Invite link"><button class="btn g-green o1">Copy link</button>';
    body.appendChild(link);
    const input = link.querySelector('input');
    input.value = BX.getInviteLink();
    link.querySelector('button').addEventListener('click', async () => {
        input.select();
        try { await navigator.clipboard.writeText(input.value); toast('Invite link copied!', '#7dff6b'); } catch (e) { toast('Select the link and copy it', '#ffb51c'); }
    });
    if (!id.loggedIn) {
        note(body, 'Log in with Bloxity to see your friends and invite them into this server. Friends here give +10% Speed each!');
        const b = document.createElement('button');
        b.className = 'btn g-blue o1'; b.textContent = 'Log in with Bloxity';
        b.addEventListener('click', () => BX.login());
        body.appendChild(b);
        return;
    }
    const loading = note(body, 'Loading friends…');
    BX.getFriends().then((friends) => {
        if (modalKind !== 'friends') return;
        loading.remove();
        if (!friends.length) { note(body, 'No friends yet. Share the invite link above!'); return; }
        const order = { 'in-game': 0, online: 1, away: 2, offline: 3 };
        friends.sort((a, b) => (order[a.presence && a.presence.status] ?? 4) - (order[b.presence && b.presence.status] ?? 4));
        for (const f of friends) {
            const st = (f.presence && f.presence.status) || 'offline';
            const where = st === 'in-game' && f.presence.gameName ? 'Playing ' + f.presence.gameName : st;
            body.appendChild(rowCard(st === 'offline' ? '⚫' : st === 'away' ? '🟡' : '🟢', f.displayName || f.username, where, 'Invite', 'g-green', async (e) => {
                e.currentTarget.disabled = true;
                const ok = await BX.inviteFriend(f._id);
                toast(ok ? 'Invite sent to ' + (f.displayName || f.username) : 'Could not send the invite', ok ? '#7dff6b' : '#ff5a5a');
            }));
        }
    });
}
// Music on / off and the two volumes
function renderSounds(body) {
    const on = !musicMuted(), vols = getVolumes();
    const b = document.createElement('button');
    b.className = 'btn o ' + (on ? 'g-green' : 'g-grey');
    b.style.fontSize = '1.6rem'; b.style.padding = '0.5rem';
    b.textContent = on ? '🎵 Music: ON' : '🔇 Music: OFF';
    b.addEventListener('click', () => { toggleMusic(); renderModal(); });
    body.appendChild(b);
    const w = document.createElement('div');
    w.className = 'settings';
    w.innerHTML = `
        <label class="set-row o1" for="sndMusic"><span>🎵 Music volume</span><input id="sndMusic" type="range" min="0" max="100" value="${Math.round(vols.music * 100)}"></label>
        <label class="set-row o1" for="sndSfx"><span>🔊 Sound effects</span><input id="sndSfx" type="range" min="0" max="100" value="${Math.round(vols.sfx * 100)}"></label>
        <p class="note">Now playing: "Sugar Keys", the keyboard's own candy-pop theme 🍭</p>`;
    w.querySelector('#sndMusic').addEventListener('input', (e) => setVolume('music', e.target.value / 100));
    w.querySelector('#sndSfx').addEventListener('input', (e) => setVolume('sfx', e.target.value / 100));
    body.appendChild(w);
}
function renderSettings(body) {
    const vols = getVolumes();
    const w = document.createElement('div');
    w.className = 'settings';
    w.innerHTML = `
        <label class="set-row o1" for="volMusic"><span>🎵 Music</span><input id="volMusic" type="range" min="0" max="100" value="${Math.round(vols.music * 100)}"></label>
        <label class="set-row o1" for="volSfx"><span>🔊 Sounds</span><input id="volSfx" type="range" min="0" max="100" value="${Math.round(vols.sfx * 100)}"></label>
        <div class="set-row o1"><span>✨ Graphics</span><div class="seg" role="radiogroup" aria-label="Graphics quality"></div></div>
        <p class="note">Low turns off glow and shadows for older phones.</p>`;
    w.querySelector('#volMusic').addEventListener('input', (e) => setVolume('music', e.target.value / 100));
    w.querySelector('#volSfx').addEventListener('input', (e) => setVolume('sfx', e.target.value / 100));
    const seg = w.querySelector('.seg');
    for (const [key, q] of Object.entries(QUALITIES)) {
        const b = document.createElement('button');
        b.className = 'btn o1 ' + (getQuality() === key ? 'g-green' : 'g-grey');
        b.textContent = q.label;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(getQuality() === key));
        b.addEventListener('click', () => { setQuality(key); renderModal(); });
        seg.appendChild(b);
    }
    body.appendChild(w);
}
