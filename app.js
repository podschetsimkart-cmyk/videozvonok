'use strict';

/*
 * Видеозвонок: каждый участник напрямую соединён с каждым (mesh WebRTC, до 6 человек).
 * Поиск собеседников — бесплатный облачный сервер PeerJS (0.peerjs.com), обход NAT — STUN.
 * Участник комнаты занимает ID «<префикс>-<комната>-<слот>», новичок сам подключается
 * ко всем занятым слотам.
 */

const ID_PREFIX = 'alikvz';
const MAX_SLOTS = 6;
const OPEN_TIMEOUT_MS = 15000;     // ждём ответа сервера при занятии слота
const CONNECT_TIMEOUT_MS = 20000;  // ждём открытия канала до собеседника
const TICK_MS = 4000;              // пинг собеседникам и переподключение к серверу
const STALE_MS = 60000;            // молчит дольше и медиасвязь мертва — считаем вышедшим
const PROBE_EVERY_MS = 45000;      // как часто перепроверять пустые слоты (самолечение сетки)
const MAX_CALL_RETRIES = 3;
const QUIET_AFTER_JOIN_MS = 5000;  // не сыпать «X во встрече» сразу после своего входа

// TURN-серверы PeerJS по умолчанию мертвы (не резолвятся), поэтому только STUN.
// Свой TURN добавлять сюда же: { urls: 'turn:host:3478', username, credential }.
const PEER_OPTIONS = {
  debug: 1,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ],
  },
};

const AUDIO_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
const VIDEO_CONSTRAINTS = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } };

const ICONS = {
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
  micOff: '<line x1="2" x2="22" y1="2" y2="22"/><path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2"/><path d="M5 10v2a7 7 0 0 0 12 5"/><path d="M15 9.34V5a3 3 0 0 0-5.68-1.33"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12"/><line x1="12" x2="12" y1="19" y2="22"/>',
  video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  videoOff: '<path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196"/><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/><path d="m2 2 20 20"/>',
  screen: '<path d="m9 10 3-3 3 3"/><path d="M12 13V7"/><rect width="20" height="14" x="2" y="3" rx="2"/><path d="M12 17v4"/><path d="M8 21h8"/>',
  screenOff: '<path d="M17 17H4a2 2 0 0 1-2-2V5c0-1.5 1-2 1-2"/><path d="M22 15V5a2 2 0 0 0-2-2H9"/><path d="M8 21h8"/><path d="M12 17v4"/><path d="m2 2 20 20"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/>',
  leave: '<path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><line x1="22" x2="2" y1="2" y2="22"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" x2="19" y1="8" y2="14"/><line x1="22" x2="16" y1="11" y2="11"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  pin: '<line x1="12" x2="12" y1="17" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/>',
};

const $ = (sel) => document.querySelector(sel);

/* ---------- состояние ---------- */

const media = {
  mic: null,     // настоящий микрофон
  cam: null,     // настоящая камера
  screen: null,  // показ экрана
  blank: null,   // заглушка-видео, если камеры нет (чтобы было куда подставить показ экрана)
  silent: null,  // заглушка-звук, если микрофона нет
  micOn: true,
  camOn: true,
};

const session = {
  room: null,
  name: '',
  nonce: randomToken(12), // отличает эту вкладку от прошлой после перезагрузки
  peer: null,
  myId: null,
  slot: -1,
  joining: false,
  joined: false,
  joinedAt: 0,
  leaving: false,
  timer: null,
  lastProbe: 0,
  netOk: true,
  sharePending: false,
};

const peers = new Map(); // id собеседника -> запись
let selfTile = null;
let pinnedTile = null;        // плитка, закреплённая вручную
let suppressedAutoTile = null; // показ экрана, который пользователь открепил
let unread = 0;
let acquiring = null;

/* ---------- мелочи ---------- */

function randomToken(len) {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function loadPref(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function savePref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* приватный режим — не страшно */ }
}

function cleanName(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function initialOf(name) {
  const ch = cleanName(name).charAt(0);
  return ch ? ch.toUpperCase() : '?';
}

function icon(name) {
  return `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

function setIcon(el, name) {
  const badge = el.querySelector(':scope > .badge');
  el.innerHTML = icon(name);
  if (badge) el.appendChild(badge);
}

function toast(text, kind) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = kind === 'err' ? 'toast err' : 'toast';
  el.textContent = text;
  box.appendChild(el);
  while (box.children.length > 4) box.firstElementChild.remove();
  setTimeout(() => el.remove(), kind === 'err' ? 6000 : 3500);
}

function parseRoom(input) {
  let s = String(input || '').trim();
  const hashAt = s.lastIndexOf('#');
  if (hashAt >= 0) s = s.slice(hashAt + 1);
  else if (/[/.]/.test(s)) return null; // ссылка без кода комнаты
  s = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return /^[a-z0-9]{4,24}$/.test(s) ? s : null;
}

function roomLink(room) {
  return `${location.origin}${location.pathname}#${room}`;
}

function peerIdFor(room, slot) {
  return `${ID_PREFIX}-${room}-${slot}`;
}

function slotOf(id) {
  return Number(String(id).slice(String(id).lastIndexOf('-') + 1));
}

function isRoomPeer(id) {
  if (typeof id !== 'string' || !session.room) return false;
  if (!id.startsWith(`${ID_PREFIX}-${session.room}-`)) return false;
  const slot = slotOf(id);
  return Number.isInteger(slot) && slot >= 0 && slot < MAX_SLOTS && slot !== session.slot;
}

function alive(e) {
  return peers.get(e.id) === e;
}

/* ---------- камера и микрофон ---------- */

function acquireMedia() {
  if (!acquiring) acquiring = doAcquireMedia().finally(() => { acquiring = null; });
  return acquiring;
}

async function doAcquireMedia() {
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) return 'unsupported';
  const wantAudio = !media.mic;
  const wantVideo = !media.cam;
  if (!wantAudio && !wantVideo) return 'ok';
  try {
    const stream = await md.getUserMedia({
      audio: wantAudio ? AUDIO_CONSTRAINTS : false,
      video: wantVideo ? VIDEO_CONSTRAINTS : false,
    });
    adoptTracks(stream);
  } catch (err) {
    console.warn('getUserMedia', err && err.name, err);
    if (wantAudio && wantVideo) {
      // Одного из устройств может не быть или оно занято — пробуем по отдельности.
      for (const constraints of [{ audio: AUDIO_CONSTRAINTS }, { video: VIDEO_CONSTRAINTS }]) {
        try { adoptTracks(await md.getUserMedia(constraints)); } catch { /* нет устройства */ }
      }
    }
    if (!media.mic && !media.cam) return (err && err.name) || 'error';
  }
  return 'ok';
}

function adoptTracks(stream) {
  const audio = stream.getAudioTracks()[0];
  const video = stream.getVideoTracks()[0];
  if (audio && !media.mic) {
    media.mic = audio;
    audio.enabled = media.micOn;
    audio.addEventListener('ended', () => onDeviceEnded('mic', audio));
  }
  if (video && !media.cam) {
    media.cam = video;
    video.enabled = media.camOn;
    video.addEventListener('ended', () => onDeviceEnded('cam', video));
  }
}

function onDeviceEnded(kind, track) {
  if (media[kind] !== track) return;
  media[kind] = null;
  toast(kind === 'mic' ? 'Микрофон отключился' : 'Камера отключилась', 'err');
  pushTracks();
  syncControls();
  broadcastState();
}

function makeBlankVideoTrack() {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  if (!canvas.captureStream) return null;
  const ctx = canvas.getContext('2d');
  const paint = () => {
    ctx.fillStyle = '#14171c';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
  paint();
  setInterval(paint, 1000);
  return canvas.captureStream(1).getVideoTracks()[0] || null;
}

function makeSilentAudioTrack() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  try {
    const ctx = new Ctx();
    return ctx.createMediaStreamDestination().stream.getAudioTracks()[0] || null;
  } catch {
    return null;
  }
}

function ensureFallbackTracks() {
  if (!media.blank) media.blank = makeBlankVideoTrack();
  if (!media.silent) media.silent = makeSilentAudioTrack();
}

function outAudio() {
  return media.mic || media.silent;
}

function outVideo() {
  return media.screen || media.cam || media.blank;
}

function outStream() {
  return new MediaStream([outAudio(), outVideo()].filter(Boolean));
}

function myState() {
  return {
    mic: !!(media.mic && media.micOn),
    cam: !!(media.cam && media.camOn),
    share: !!media.screen,
  };
}

// Подменяет отправляемые дорожки во всех звонках без пересоединения.
function pushTracks() {
  if (session.joined) ensureFallbackTracks();
  const audio = outAudio();
  const video = outVideo();
  for (const e of peers.values()) {
    const pc = e.call && e.call.peerConnection;
    if (!pc || !pc.getTransceivers) continue;
    for (const tr of pc.getTransceivers()) {
      const kind = tr.receiver && tr.receiver.track && tr.receiver.track.kind;
      const want = kind === 'audio' ? audio : kind === 'video' ? video : null;
      if (want && tr.sender && tr.sender.track !== want) {
        tr.sender.replaceTrack(want).catch((err) => console.warn('replaceTrack', err));
      }
    }
  }
  renderSelf();
}

async function toggleMic() {
  if (!media.mic) {
    await acquireMedia();
    if (!media.mic) {
      toast('Микрофон недоступен — разрешите его в настройках сайта (значок слева от адреса)', 'err');
      return;
    }
    media.micOn = true;
    media.mic.enabled = true;
    pushTracks();
  } else {
    media.micOn = !media.micOn;
    media.mic.enabled = media.micOn;
  }
  syncControls();
  renderSelf();
  broadcastState();
  if (!session.joined) updatePreviewNote();
}

async function toggleCam() {
  if (!media.cam) {
    await acquireMedia();
    if (!media.cam) {
      toast('Камера недоступна — разрешите её в настройках сайта (значок слева от адреса)', 'err');
      return;
    }
    media.camOn = true;
    media.cam.enabled = true;
    pushTracks();
  } else {
    media.camOn = !media.camOn;
    media.cam.enabled = media.camOn;
  }
  syncControls();
  renderSelf();
  broadcastState();
  if (!session.joined) updatePreviewNote();
}

async function toggleShare() {
  if (media.screen) {
    stopShare();
    return;
  }
  const md = navigator.mediaDevices;
  if (!md || !md.getDisplayMedia) {
    toast('В этом браузере нельзя показать экран. Откройте встречу на компьютере в Chrome, Edge или Firefox.', 'err');
    return;
  }
  if (session.sharePending) return;
  session.sharePending = true;
  let stream;
  try {
    stream = await md.getDisplayMedia({ video: { frameRate: { ideal: 15, max: 30 } }, audio: false });
  } catch (err) {
    if (err && err.name !== 'NotAllowedError' && err.name !== 'AbortError') {
      toast('Не удалось начать показ экрана', 'err');
    }
    return;
  } finally {
    session.sharePending = false;
  }
  const track = stream.getVideoTracks()[0];
  if (!track) return;
  if (session.leaving) {
    track.stop();
    return;
  }
  try { track.contentHint = 'detail'; } catch { /* старый браузер */ }
  // Кнопка «Закрыть доступ» в панели браузера останавливает дорожку сама.
  track.addEventListener('ended', () => { if (media.screen === track) stopShare(); });
  media.screen = track;
  pushTracks();
  syncControls();
  broadcastState();
  toast('Вы показываете экран');
}

function stopShare() {
  const track = media.screen;
  if (!track) return;
  media.screen = null;
  track.stop();
  pushTracks();
  syncControls();
  broadcastState();
}

function syncControls() {
  const micOn = !!(media.mic && media.micOn);
  const camOn = !!(media.cam && media.camOn);
  for (const btn of [$('#pvMic'), $('#micBtn')]) {
    setIcon(btn, micOn ? 'mic' : 'micOff');
    btn.classList.toggle('off', !micOn);
    btn.title = micOn ? 'Выключить микрофон' : 'Включить микрофон';
    btn.setAttribute('aria-pressed', String(micOn));
  }
  for (const btn of [$('#pvCam'), $('#camBtn')]) {
    setIcon(btn, camOn ? 'video' : 'videoOff');
    btn.classList.toggle('off', !camOn);
    btn.title = camOn ? 'Выключить камеру' : 'Включить камеру';
    btn.setAttribute('aria-pressed', String(camOn));
  }
  const share = $('#shareBtn');
  const canShare = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  share.hidden = !canShare;
  setIcon(share, media.screen ? 'screenOff' : 'screen');
  share.classList.toggle('on', !!media.screen);
  share.title = media.screen ? 'Остановить показ экрана' : 'Показать экран';
}

/* ---------- плитки ---------- */

function createTile(isSelf) {
  const el = document.createElement('div');
  el.className = 'tile no-video';
  el.innerHTML =
    '<video autoplay playsinline></video>' +
    '<div class="avatar"><span></span></div>' +
    '<div class="status"></div>' +
    `<div class="label">${icon('micOff')}<span class="name"></span></div>` +
    '<div class="tile-tools">' +
    `<button type="button" class="pin" title="Крупно / обратно" aria-label="Крупно">${icon('pin')}</button>` +
    `<button type="button" class="fs" title="На весь экран" aria-label="На весь экран">${icon('maximize')}</button>` +
    '</div>';
  if (isSelf) {
    el.classList.add('self');
    el.querySelector('video').muted = true;
  }
  el.querySelector('.pin').addEventListener('click', () => togglePin(el));
  el.querySelector('.fs').addEventListener('click', () => toggleFullscreen(el));
  el.addEventListener('dblclick', () => toggleFullscreen(el));
  return el;
}

function paintTile(el, o) {
  const video = el.querySelector('video');
  if (video.srcObject !== o.stream) {
    video.srcObject = o.stream || null;
    if (o.stream) playVideo(video);
  }
  el.classList.toggle('no-video', !o.showVideo);
  el.classList.toggle('mirror', !!o.mirror);
  el.classList.toggle('screen', !!o.screen);
  el.classList.toggle('muted', !!o.muted);
  el.classList.toggle('connecting', !!o.status);
  const nameEl = el.querySelector('.name');
  if (nameEl) nameEl.textContent = o.name;
  const avatar = el.querySelector('.avatar span');
  if (avatar) avatar.textContent = initialOf(o.name);
  const status = el.querySelector('.status');
  if (status) status.textContent = o.status || '';
}

function playVideo(video) {
  const p = video.play();
  if (p && p.catch) {
    p.catch((err) => {
      if (err && err.name === 'NotAllowedError' && !video.muted) $('#unmuteAll').hidden = false;
    });
  }
}

function renderSelf() {
  const el = session.joined ? selfTile : $('#preview');
  if (!el) return;
  const track = media.screen || (media.cam && media.camOn ? media.cam : null);
  let stream = null;
  if (track) {
    if (!el._stream || el._stream.getVideoTracks()[0] !== track) el._stream = new MediaStream([track]);
    stream = el._stream;
  }
  const typed = cleanName($('#nameInput').value);
  paintTile(el, {
    stream,
    showVideo: !!track,
    mirror: !!track && !media.screen,
    screen: !!media.screen,
    muted: !(media.mic && media.micOn),
    name: session.joined ? `${session.name} (вы)` : typed || 'Вы',
  });
}

function renderPeer(e) {
  if (!alive(e) || session.leaving) return;
  if (!e.tile) {
    e.tile = createTile(false);
    $('#grid').appendChild(e.tile);
  }
  let status = '';
  if (!e.stream) status = 'Подключение…';
  else if (e.weak) status = 'Связь нестабильна';
  paintTile(e.tile, {
    stream: e.stream,
    showVideo: !!e.stream && (e.cam || e.share),
    mirror: false,
    screen: e.share,
    muted: !e.mic,
    name: e.name,
    status,
  });
  updateCount();
  updateSpotlight();
}

function updateCount() {
  let n = 1;
  for (const e of peers.values()) if (e.tile) n += 1;
  $('#peopleCount').textContent = `${n} в звонке`;
  document.title = n > 1 ? `Видеозвонок · ${n}` : 'Видеозвонок';
}

function togglePin(el) {
  if (el.parentElement === $('#mainSlot')) {
    pinnedTile = null;
    suppressedAutoTile = el;
  } else {
    pinnedTile = el;
    suppressedAutoTile = null;
  }
  updateSpotlight();
}

function updateSpotlight() {
  if (!session.joined) return;
  const stage = $('#stage');
  const slot = $('#mainSlot');
  const grid = $('#grid');
  let main = pinnedTile && pinnedTile.isConnected ? pinnedTile : null;
  if (!main) {
    pinnedTile = null;
    for (const e of peers.values()) {
      if (e.share && e.stream && e.tile && e.tile !== suppressedAutoTile) { main = e.tile; break; }
    }
  }
  const current = slot.firstElementChild;
  if (current && current !== main) {
    grid.appendChild(current);
    playVideo(current.querySelector('video'));
  }
  if (main && main.parentElement !== slot) {
    slot.appendChild(main);
    playVideo(main.querySelector('video'));
  }
  stage.classList.toggle('spotlight', !!main);
  layout();
}

function layout() {
  const stage = $('#stage');
  const grid = $('#grid');
  if (!stage || stage.classList.contains('spotlight')) return;
  const n = grid.children.length;
  if (!n) return;
  const W = grid.clientWidth;
  const H = grid.clientHeight;
  const gap = 10;
  let best = 0;
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    let w = (W - gap * (cols - 1)) / cols;
    const maxH = (H - gap * (rows - 1)) / rows;
    if ((w * 9) / 16 > maxH) w = (maxH * 16) / 9;
    if (w > best) best = w;
  }
  grid.style.setProperty('--tile-w', `${Math.max(120, Math.floor(best))}px`);
}

function toggleFullscreen(el) {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
    return;
  }
  if (el.requestFullscreen) {
    el.requestFullscreen().catch(() => {});
    return;
  }
  const video = el.querySelector('video');
  if (video && video.webkitEnterFullscreen) video.webkitEnterFullscreen(); // iPhone
}

/* ---------- вход в комнату ---------- */

function openPeer(id) {
  return new Promise((resolve) => {
    let peer;
    try {
      peer = new Peer(id, PEER_OPTIONS);
    } catch (err) {
      resolve({ error: err });
      return;
    }
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      peer.off('open', onOpen);
      peer.off('error', onError);
      if (!result.peer) peer.destroy();
      resolve(result);
    };
    const onOpen = () => finish({ peer });
    const onError = (err) => finish(err && err.type === 'unavailable-id' ? { taken: true } : { error: err });
    const timer = setTimeout(() => finish({ error: new Error('timeout') }), OPEN_TIMEOUT_MS);
    peer.on('open', onOpen);
    peer.on('error', onError);
  });
}

async function claimSlot(room) {
  for (let slot = 0; slot < MAX_SLOTS; slot++) {
    const res = await openPeer(peerIdFor(room, slot));
    if (res.peer) {
      session.peer = res.peer;
      session.myId = peerIdFor(room, slot);
      session.slot = slot;
      return;
    }
    if (!res.taken) {
      console.warn('claimSlot', res.error);
      throw new Error('network');
    }
  }
  throw new Error('full');
}

async function join() {
  if (session.joining || session.joined) return;
  if (!window.Peer || !window.RTCPeerConnection) {
    showLobbyError('Этот браузер не умеет видеозвонки. Откройте ссылку в Chrome, Edge, Safari или Firefox.');
    return;
  }
  const name = cleanName($('#nameInput').value) || 'Гость';
  savePref('vz.name', name);
  session.name = name;
  if (!session.room) {
    session.room = randomToken(8);
    history.replaceState(null, '', `#${session.room}`);
  }
  session.joining = true;
  hideLobbyError();
  const btn = $('#joinBtn');
  btn.disabled = true;
  btn.textContent = 'Подключаюсь…';
  ensureFallbackTracks();
  try {
    await claimSlot(session.room);
  } catch (err) {
    session.joining = false;
    btn.disabled = false;
    updateLobbyMode();
    showLobbyError(err.message === 'full'
      ? `В комнате уже ${MAX_SLOTS} человек — это максимум.`
      : 'Не удалось подключиться к серверу звонков. Проверьте интернет и попробуйте ещё раз.');
    return;
  }
  session.joining = false;
  enterRoom();
}

function enterRoom() {
  session.joined = true;
  session.joinedAt = Date.now();
  $('#previewVideo').srcObject = null;
  $('#lobby').hidden = true;
  $('#room').hidden = false;
  $('#roomCode').textContent = `Комната ${session.room}`;
  selfTile = createTile(true);
  $('#grid').appendChild(selfTile);
  syncControls();
  renderSelf();
  updateCount();
  layout();

  wirePeer(session.peer);
  for (let s = 0; s < MAX_SLOTS; s++) {
    if (s !== session.slot) connectTo(peerIdFor(session.room, s));
  }
  session.lastProbe = Date.now();
  session.timer = setInterval(tick, TICK_MS);
  window.addEventListener('pagehide', onPageHide);
  toast('Вы во встрече. «Пригласить» — скопировать ссылку для остальных.');
}

function wirePeer(peer) {
  peer.on('connection', onIncomingConn);
  peer.on('call', onIncomingCall);
  peer.on('open', () => setNet(true)); // после переподключения
  peer.on('disconnected', () => setNet(false));
  peer.on('error', onPeerError);
}

function onPeerError(err) {
  const type = err && err.type;
  if (type === 'peer-unavailable') {
    // Пустой слот — обычное дело: тихо убираем несостоявшееся подключение.
    const m = /peer\s+(\S+)\s*$/.exec((err && err.message) || '');
    const e = m && peers.get(m[1]);
    if (e && !e.opened) dropPeer(e.id, false);
    return;
  }
  if (type === 'disconnected') return; // попытка соединиться без сервера — повторим позже
  if (type === 'network' || type === 'socket-error' || type === 'socket-closed' || type === 'server-error') {
    setNet(false);
    return;
  }
  if (type === 'unavailable-id') {
    setNet(false);
    toast('Связь с сервером терялась надолго. Новые участники вас не увидят — перезайдите во встречу.', 'err');
    return;
  }
  console.warn('peer error', type, err);
}

function setNet(ok) {
  if (session.netOk === ok) return;
  session.netOk = ok;
  const dot = $('#netDot');
  dot.classList.toggle('bad', !ok);
  dot.title = ok ? 'Связь с сервером есть' : 'Нет связи с сервером — переподключаюсь';
  if (!session.leaving) toast(ok ? 'Связь с сервером восстановлена' : 'Пропала связь с сервером, переподключаюсь…', ok ? '' : 'err');
}

/* ---------- соединения с собеседниками ---------- */

function newEntry(id) {
  const e = {
    id,
    name: 'Гость',
    nonce: null,
    conn: null,
    call: null,
    stream: null,
    mic: true,
    cam: true,
    share: false,
    weak: false,
    outgoing: false,
    opened: false,
    greeted: false,
    lastSeen: Date.now(),
    connTimer: null,
    callRetries: 0,
    tile: null,
  };
  peers.set(id, e);
  return e;
}

function connectTo(remoteId) {
  const peer = session.peer;
  if (!peer || peer.destroyed || peer.disconnected || session.leaving || peers.has(remoteId)) return;
  let conn;
  try {
    conn = peer.connect(remoteId, { reliable: true, metadata: { name: session.name, nonce: session.nonce } });
  } catch (err) {
    console.warn('connect', err);
    return;
  }
  if (!conn) return;
  const e = newEntry(remoteId);
  e.outgoing = true;
  attachConn(e, conn);
}

function onIncomingConn(conn) {
  const rid = conn.peer;
  if (!isRoomPeer(rid) || session.leaving) {
    conn.close();
    return;
  }
  const meta = conn.metadata || {};
  let e = peers.get(rid);
  if (e) {
    const sameInstance = !e.nonce || e.nonce === meta.nonce;
    // Двое подключились друг к другу одновременно: оставляем канал от младшего слота.
    if (sameInstance && e.outgoing && session.slot < slotOf(rid)) {
      conn.close();
      return;
    }
    if (!sameInstance) {
      dropPeer(rid, false); // собеседник перезагрузил страницу — старое соединение мёртвое
      e = null;
    }
  }
  if (!e) {
    e = newEntry(rid);
  } else if (e.conn && e.conn !== conn) {
    const old = e.conn;
    e.conn = null;
    try { old.close(); } catch { /* уже закрыт */ }
  }
  e.outgoing = false;
  const name = cleanName(meta.name);
  if (name) e.name = name;
  if (typeof meta.nonce === 'string') e.nonce = meta.nonce;
  attachConn(e, conn);
}

function attachConn(e, conn) {
  e.conn = conn;
  e.opened = false;
  clearTimeout(e.connTimer);
  e.connTimer = setTimeout(() => {
    if (e.conn === conn && !conn.open) dropPeer(e.id, false);
  }, CONNECT_TIMEOUT_MS);

  conn.on('open', () => {
    if (e.conn !== conn || !alive(e)) return;
    clearTimeout(e.connTimer);
    e.opened = true;
    e.lastSeen = Date.now();
    send(conn, { t: 'hello', name: session.name, nonce: session.nonce, ...myState() });
    renderPeer(e);
    // Медиазвонок всегда начинает младший слот — так не бывает двух звонков на пару.
    if (session.slot < slotOf(e.id)) startCall(e);
  });
  conn.on('data', (data) => {
    if (e.conn === conn && alive(e)) onData(e, data);
  });
  conn.on('close', () => {
    if (e.conn === conn && alive(e)) dropPeer(e.id, e.greeted);
  });
  conn.on('error', (err) => console.warn('conn', e.id, err && err.type, err));
}

function startCall(e) {
  const peer = session.peer;
  if (!alive(e) || session.leaving || !peer || peer.destroyed || peer.disconnected) return;
  if (e.call) return;
  let call;
  try {
    call = peer.call(e.id, outStream(), { metadata: { nonce: session.nonce } });
  } catch (err) {
    console.warn('call', err);
  }
  if (!call) {
    scheduleRecall(e);
    return;
  }
  attachCall(e, call);
}

function onIncomingCall(call) {
  const rid = call.peer;
  if (!isRoomPeer(rid) || session.leaving) {
    call.close();
    return;
  }
  const e = peers.get(rid) || newEntry(rid);
  try {
    call.answer(outStream());
  } catch (err) {
    console.warn('answer', err);
    return;
  }
  attachCall(e, call);
}

function attachCall(e, call) {
  if (e.call && e.call !== call) {
    const old = e.call;
    e.call = null;
    try { old.close(); } catch { /* уже закрыт */ }
  }
  e.call = call;
  e.weak = false;
  call.on('stream', (stream) => {
    if (e.call !== call || !alive(e)) return;
    e.stream = stream;
    e.callRetries = 0;
    renderPeer(e);
  });
  call.on('close', () => {
    if (e.call !== call) return;
    e.call = null;
    e.stream = null;
    if (alive(e)) {
      renderPeer(e);
      scheduleRecall(e);
    }
  });
  call.on('error', (err) => console.warn('call', e.id, err && err.type, err));
  const pc = call.peerConnection;
  if (pc) {
    pc.addEventListener('iceconnectionstatechange', () => {
      if (e.call !== call || !alive(e)) return;
      const weak = pc.iceConnectionState === 'disconnected';
      if (weak !== e.weak) {
        e.weak = weak;
        renderPeer(e);
      }
    });
  }
}

function scheduleRecall(e) {
  if (session.leaving || session.slot > slotOf(e.id) || e.callRetries >= MAX_CALL_RETRIES) return;
  if (!e.conn || !e.conn.open) return;
  e.callRetries += 1;
  setTimeout(() => {
    if (alive(e) && !e.call && e.conn && e.conn.open) startCall(e);
  }, 1500 * e.callRetries);
}

function dropPeer(id, announce) {
  const e = peers.get(id);
  if (!e) return;
  peers.delete(id);
  clearTimeout(e.connTimer);
  const { call, conn } = e;
  e.call = null;
  e.conn = null;
  try { if (call) call.close(); } catch { /* уже закрыт */ }
  try { if (conn) conn.close(); } catch { /* уже закрыт */ }
  if (e.tile) {
    if (pinnedTile === e.tile) pinnedTile = null;
    if (suppressedAutoTile === e.tile) suppressedAutoTile = null;
    e.tile.remove();
    e.tile = null;
  }
  if (announce && !session.leaving) toast(`${e.name} вышел(а) из встречи`);
  if (session.joined) {
    updateCount();
    updateSpotlight();
  }
}

function onData(e, d) {
  if (!d || typeof d !== 'object' || typeof d.t !== 'string') return;
  e.lastSeen = Date.now();
  switch (d.t) {
    case 'hello': {
      if (typeof d.nonce === 'string') e.nonce = d.nonce;
      const name = cleanName(d.name);
      if (name) e.name = name;
      applyState(e, d);
      if (!e.greeted) {
        e.greeted = true;
        if (Date.now() - session.joinedAt > QUIET_AFTER_JOIN_MS) toast(`${e.name} во встрече`);
      }
      renderPeer(e);
      break;
    }
    case 'state': {
      const wasSharing = e.share;
      applyState(e, d);
      if (e.share && !wasSharing && suppressedAutoTile === e.tile) suppressedAutoTile = null;
      renderPeer(e);
      break;
    }
    case 'chat': {
      const text = typeof d.text === 'string' ? d.text.trim().slice(0, 1000) : '';
      if (text) addChatMessage(e.name, text, false);
      break;
    }
    case 'bye':
      dropPeer(e.id, true);
      break;
    default:
      break; // ping и неизвестное
  }
}

function applyState(e, d) {
  if (typeof d.mic === 'boolean') e.mic = d.mic;
  if (typeof d.cam === 'boolean') e.cam = d.cam;
  if (typeof d.share === 'boolean') e.share = d.share;
}

function send(conn, msg) {
  if (!conn || !conn.open) return;
  try { conn.send(msg); } catch (err) { console.warn('send', err); }
}

function broadcast(msg) {
  for (const e of peers.values()) send(e.conn, msg);
}

function broadcastState() {
  if (session.joined && !session.leaving) broadcast({ t: 'state', ...myState() });
}

function callConnected(e) {
  const pc = e.call && e.call.peerConnection;
  return !!pc && (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed');
}

function tick() {
  if (session.leaving) return;
  const now = Date.now();
  for (const e of [...peers.values()]) {
    send(e.conn, { t: 'ping' });
    if (e.opened && now - e.lastSeen > STALE_MS && !callConnected(e)) dropPeer(e.id, true);
    else if (!e.conn && !e.call) dropPeer(e.id, false);
  }
  const peer = session.peer;
  if (peer && !peer.destroyed && peer.disconnected) {
    try { peer.reconnect(); } catch (err) { console.warn('reconnect', err); }
    return;
  }
  // Самолечение: если с кем-то разошлись, повторно стучимся в пустые для нас слоты.
  if (peer && now - session.lastProbe > PROBE_EVERY_MS) {
    session.lastProbe = now;
    for (let s = 0; s < MAX_SLOTS; s++) {
      const id = peerIdFor(session.room, s);
      if (s !== session.slot && !peers.has(id)) connectTo(id);
    }
  }
}

/* ---------- чат и приглашение ---------- */

function sendChat(text) {
  const clean = String(text || '').trim().slice(0, 1000);
  if (!clean) return;
  broadcast({ t: 'chat', text: clean });
  addChatMessage(`${session.name} (вы)`, clean, true);
}

function addChatMessage(who, text, mine) {
  const list = $('#chatList');
  const empty = $('#chatEmpty');
  if (empty) empty.remove();
  const item = document.createElement('div');
  item.className = 'msg';
  const head = document.createElement('div');
  head.className = 'who';
  head.textContent = who;
  const time = document.createElement('time');
  time.textContent = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  head.appendChild(time);
  const body = document.createElement('div');
  body.className = 'text';
  appendLinkified(body, text);
  item.append(head, body);
  list.appendChild(item);
  list.scrollTop = list.scrollHeight;
  if (!mine && $('#chat').hidden) {
    unread += 1;
    const badge = $('#chatBadge');
    badge.textContent = unread > 9 ? '9+' : String(unread);
    badge.hidden = false;
    toast(`${who}: ${text.length > 80 ? `${text.slice(0, 80)}…` : text}`);
  }
}

function appendLinkified(el, text) {
  const re = /https?:\/\/[^\s<>"']+/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
    const a = document.createElement('a');
    a.href = m[0];
    a.textContent = m[0];
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    el.appendChild(a);
    last = m.index + m[0].length;
  }
  if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
}

function toggleChat(open) {
  const chat = $('#chat');
  const show = typeof open === 'boolean' ? open : chat.hidden;
  chat.hidden = !show;
  $('#chatBtn').classList.toggle('on', show);
  if (show) {
    unread = 0;
    $('#chatBadge').hidden = true;
    $('#chatInput').focus();
  }
  layout();
}

async function invite() {
  const url = roomLink(session.room);
  if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ title: 'Видеозвонок', text: 'Подключайся к встрече:', url });
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('Ссылка скопирована — отправьте её участникам');
  } catch {
    window.prompt('Скопируйте ссылку на встречу:', url);
  }
}

/* ---------- выход ---------- */

function stopAllTracks() {
  for (const t of [media.mic, media.cam, media.screen, media.blank, media.silent]) {
    try { if (t) t.stop(); } catch { /* уже остановлен */ }
  }
}

function leave() {
  if (session.leaving) return;
  session.leaving = true;
  broadcast({ t: 'bye' });
  clearInterval(session.timer);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  // Небольшая пауза, чтобы «bye» успел уйти по каналам.
  setTimeout(() => {
    for (const id of [...peers.keys()]) dropPeer(id, false);
    try { if (session.peer) session.peer.destroy(); } catch { /* уже закрыт */ }
    stopAllTracks();
    $('#room').hidden = true;
    $('#left').hidden = false;
    document.title = 'Видеозвонок';
  }, 200);
}

function onPageHide(event) {
  if (session.leaving || !session.joined || event.persisted) return;
  broadcast({ t: 'bye' });
  try { if (session.peer) session.peer.destroy(); } catch { /* уже закрыт */ }
}

/* ---------- экран входа ---------- */

function showLobbyError(text) {
  const el = $('#lobbyError');
  el.textContent = text;
  el.hidden = false;
}

function hideLobbyError() {
  $('#lobbyError').hidden = true;
}

function updateLobbyMode() {
  const hasRoom = !!session.room;
  $('#lobbyTitle').textContent = hasRoom ? 'Вход во встречу' : 'Новая встреча';
  $('#lobbyLead').textContent = hasRoom
    ? `Комната ${session.room}. Проверьте камеру и микрофон и входите.`
    : 'Камера, микрофон и показ экрана прямо в браузере. Ничего устанавливать не нужно.';
  if (!session.joining) $('#joinBtn').textContent = hasRoom ? 'Войти во встречу' : 'Создать встречу';
  $('#orBlock').hidden = hasRoom;
  $('#codeForm').hidden = hasRoom;
}

function updatePreviewNote(result) {
  const note = $('#previewNote');
  if (result === 'unsupported') {
    note.textContent = 'Браузер не даёт доступ к камере. Откройте ссылку в Chrome, Safari или Edge (не во встроенном браузере мессенджера).';
  } else if (!media.mic && !media.cam) {
    note.textContent = 'Нет доступа к камере и микрофону — разрешите их в настройках сайта (значок слева от адреса). Войти можно и так.';
  } else if (!media.cam) {
    note.textContent = 'Камера не найдена — вас будут только слышать.';
  } else if (!media.mic) {
    note.textContent = 'Микрофон не найден — вас будут только видеть.';
  } else {
    note.textContent = '';
  }
}

async function startPreview() {
  const result = await acquireMedia();
  if (session.leaving) return;
  if (session.joined) {
    // Разрешение на камеру дали уже после входа — отдаём её собеседникам.
    pushTracks();
    syncControls();
    broadcastState();
    return;
  }
  updatePreviewNote(result);
  syncControls();
  renderSelf();
}

function init() {
  document.querySelectorAll('[data-icon]').forEach((el) => setIcon(el, el.dataset.icon));
  session.room = parseRoom(location.hash);
  $('#nameInput').value = loadPref('vz.name') || '';
  updateLobbyMode();
  syncControls();
  renderSelf();

  if (!window.isSecureContext) {
    showLobbyError('Страница открыта не по https:// — браузер не даст камеру и микрофон.');
  } else if (!window.Peer || !window.RTCPeerConnection) {
    showLobbyError('Этот браузер не умеет видеозвонки. Откройте ссылку в Chrome, Edge, Safari или Firefox.');
  }
  startPreview();

  $('#nameInput').addEventListener('input', renderSelf);
  $('#nameInput').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') join(); });
  $('#joinBtn').addEventListener('click', join);
  $('#codeForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const room = parseRoom($('#codeInput').value);
    if (!room) {
      showLobbyError('Не похоже на ссылку встречи. Скопируйте её целиком — с частью после знака #.');
      return;
    }
    session.room = room;
    history.replaceState(null, '', `#${room}`);
    updateLobbyMode();
    join();
  });
  window.addEventListener('hashchange', () => {
    if (session.joining || session.joined) return;
    session.room = parseRoom(location.hash);
    updateLobbyMode();
  });

  $('#pvMic').addEventListener('click', toggleMic);
  $('#pvCam').addEventListener('click', toggleCam);
  $('#micBtn').addEventListener('click', toggleMic);
  $('#camBtn').addEventListener('click', toggleCam);
  $('#shareBtn').addEventListener('click', toggleShare);
  $('#chatBtn').addEventListener('click', () => toggleChat());
  $('#chatClose').addEventListener('click', () => toggleChat(false));
  $('#chatForm').addEventListener('submit', (ev) => {
    ev.preventDefault();
    sendChat($('#chatInput').value);
    $('#chatInput').value = '';
  });
  $('#inviteBtn').addEventListener('click', invite);
  $('#leaveBtn').addEventListener('click', leave);
  $('#rejoinBtn').addEventListener('click', () => location.reload());
  $('#unmuteAll').addEventListener('click', () => {
    document.querySelectorAll('#room video').forEach((v) => playVideo(v));
    $('#unmuteAll').hidden = true;
  });

  window.addEventListener('resize', layout);
  if (window.ResizeObserver) new ResizeObserver(() => layout()).observe($('#stage'));
  // Страница восстановлена из кэша «назад/вперёд» с закрытыми соединениями — начинаем заново.
  window.addEventListener('pageshow', (ev) => { if (ev.persisted && session.joined) location.reload(); });
}

init();
