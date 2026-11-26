'use strict';
const $ = id => document.getElementById(id);
const screenEl = $('screen');
const picture = $('picture');
const player = $('player');

const icons = {
  menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
  camera:'<rect x="3" y="7" width="18" height="13" rx="3"/><circle cx="12" cy="13" r="3.3"/><path d="m7 7 2-3h6l2 3"/>',
  sound:'<path d="M3 10h4l5-4v12l-5-4H3zM16 8q4 4 0 8m3-11q7 7 0 14"/>',
  muted:'<path d="M3 10h4l5-4v12l-5-4H3zM16 9l6 6m0-6-6 6"/>',
  car:'<path d="m4 12 2-6h12l2 6M3 12h18v6H3zM6 18v2m12-2v2M6 15h2m8 0h2"/>',
  exit:'<path d="M12 4H5v16h7M10 12h11m-4-4 4 4-4 4"/>',
  run:'<circle cx="15" cy="4.5" r="1.5"/><path d="m5 12 4-5 4 1 3 4h4m-8-3-2 6 4 2 1 5M10 15l-3 5H3"/>',
  aim:'<path d="M4 9V5h4m8 0h4v4m0 6v4h-4m-8 0H4v-4"/><circle cx="12" cy="12" r="2"/>',
  horn:'<path d="m3 10 4-1 8-5v16l-8-5-4-1zM18 8q4 4 0 8"/>',
  brake:'<path d="m4 6 8 13 8-13z" fill="currentColor" stroke="none"/>',
  gas:'<path d="m4 18 8-13 8 13z" fill="currentColor" stroke="none"/>'
};
function setIcon(button, name) {
  button.querySelector('svg')?.remove();
  button.insertAdjacentHTML('afterbegin','<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+icons[name]+'</svg>');
}
document.querySelectorAll('[data-icon]').forEach(button => setIcon(button, button.dataset.icon));

const route = ['opening.mp4', 'curbside.mp4', 'drive-0.mp4', 'drive-1.mp4', 'drive-2.mp4']
  .map(file => './' + file + '?v=4');
const WALK_START = 2.45;
const SEATED = 16.35;
const held = new Set();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

let track = 0, revision = 0, scene, mode = null;
let menuOpen = false, zoom = false, aimed = false, explicitlyMuted = false;
let panX = 0, panY = 0, stickX = 0, stickY = 0, audio;
let queuedClip = null, activeObjectUrl = null, retryTimer, retries = 0;
const playPrompt = $('play-prompt');
const still = $('between');
const stick = $('stick');

function updateSoundButton() {
  $('sound').setAttribute('aria-label', player.muted ? 'Enable sound' : 'Mute sound');
  $('sound').setAttribute('aria-pressed', String(!player.muted));
  setIcon($('sound'), player.muted ? 'muted' : 'sound');
}
function updateCamera() {
  const accelerating = held.has('gas') || held.has('sprint');
  const lens = aimed ? 1.32 : zoom ? 1.23 : 1.06;
  const bias = held.has('brake') ? -0.018 : accelerating ? 0.035 : 0;
  picture.style.setProperty('--zoom', mode ? lens + bias : 1);
  picture.style.setProperty('--pan-x', (mode ? clamp(panX + stickX * 1.2, -2.1, 2.1) : 0) + '%');
  picture.style.setProperty('--pan-y', (mode ? clamp(panY + stickY * 0.7, -1.6, 1.6) : 0) + '%');
  picture.style.setProperty('--tilt', (mode === 'car' ? -stickX * 0.65 : 0) + 'deg');
}
function resetInputs() {
  held.clear();
  stickX = stickY = 0;
  stick.style.removeProperty('--dx');
  stick.style.removeProperty('--dy');
  document.querySelectorAll('.down').forEach(button => button.classList.remove('down'));
  updateCamera();
}
function refreshView() {
  screenEl.classList.toggle('opening', track === 0);
  $('skip').hidden = track !== 0 || menuOpen;
  $('tools').hidden = menuOpen;
  $('menu-toggle').hidden = $('camera').hidden = !mode;
  $('hud').hidden = !mode || menuOpen;
  $('foot-controls').hidden = mode !== 'foot';
  $('car-controls').hidden = mode !== 'car';
  $('menu').hidden = !menuOpen;
  $('reticle').hidden = !aimed || mode !== 'foot';
  $('aim').setAttribute('aria-pressed', String(aimed));
  $('camera').setAttribute('aria-pressed', String(zoom));
  $('camera').setAttribute('aria-label', zoom ? 'Reset camera' : 'Zoom camera');
  updateSoundButton();
  updateCamera();
}
function setControls(nextMode) {
  mode = nextMode;
  aimed = zoom = false;
  panX = panY = 0;
  resetInputs();
  refreshView();
}
function updateScene(time = player.currentTime) {
  let nextScene = 'driving';
  if (track === 0) nextScene = 'intro';
  if (track === 1 && time < SEATED) nextScene = time < WALK_START ? 'arrival' : 'walking';
  if (nextScene === scene) return;
  scene = nextScene;
  setControls(scene === 'walking' ? 'foot' : scene === 'driving' ? 'car' : null);
}
function nextTrack() {
  return track + 1 < route.length ? track + 1 : 2;
}

// Warm one upcoming clip. Using the same visible video keeps the audio permission
// associated with the player's original sound gesture across the whole session.
function clearQueue() {
  if (!queuedClip) return;
  queuedClip.controller.abort();
  if (queuedClip.url) URL.revokeObjectURL(queuedClip.url);
  queuedClip = null;
}
async function warmNext() {
  const index = nextTrack();
  if (queuedClip?.index === index) return;
  clearQueue();
  const job = { index, controller: new AbortController(), url: null };
  queuedClip = job;
  try {
    const response = await fetch(route[index], { signal: job.controller.signal, priority: 'low' });
    if (!response.ok) return;
    const data = await response.blob();
    if (queuedClip === job && data.size) {
      job.url = URL.createObjectURL(data.type === 'video/mp4' ? data : new Blob([data], { type: 'video/mp4' }));
    }
  } catch {
    // The player can always stream the clip directly on demand.
  }
}
async function ensurePlaying() {
  if (document.hidden || !$('error').hidden) return;
  const id = revision;
  try {
    await player.play();
  } catch (err) {
    if (id !== revision || document.hidden || err.name === 'AbortError') return;
    if (err.name === 'NotAllowedError') {
      if (!player.muted) {
        player.muted = true;
        updateSoundButton();
        return ensurePlaying();
      }
      playPrompt.hidden = false;
    } else if (player.error) {
      handleMediaError();
    }
  }
}
function openTrack(index, position = 0, retry = false) {
  ++revision;
  clearTimeout(retryTimer);
  retryTimer = null;
  if (!retry) retries = 0;
  const previousUrl = activeObjectUrl;
  activeObjectUrl = !retry && queuedClip?.index === index ? queuedClip.url : null;
  if (activeObjectUrl) queuedClip.url = null;
  clearQueue();
  if (player.readyState >= 2 && player.videoWidth) {
    still.width = player.videoWidth;
    still.height = player.videoHeight;
    still.getContext('2d').drawImage(player, 0, 0);
    still.hidden = false;
  }
  track = index;
  $('error').hidden = playPrompt.hidden = true;
  player.poster = index === 0 ? './cover.jpg?v=4' : '';
  const id = revision;
  player.onloadedmetadata = () => {
    if (id === revision && position > 0) player.currentTime = Math.min(position, player.duration);
  };
  player.src = activeObjectUrl || route[index];
  player.load();
  if (previousUrl) URL.revokeObjectURL(previousUrl);
  updateScene(position);
  refreshView();
  ensurePlaying();
}
function handleMediaError() {
  if (!player.error || retryTimer != null) return;
  const position = player.currentTime || 0;
  if (activeObjectUrl || (player.error.code === 2 && retries < 2)) {
    const id = revision;
    retries++;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (id === revision) openTrack(track, position, true);
    }, activeObjectUrl ? 0 : retries * 600);
    return;
  }
  $('error').hidden = false;
  playPrompt.hidden = true;
}
player.addEventListener('timeupdate', () => updateScene());
player.addEventListener('playing', () => {
  still.hidden = playPrompt.hidden = true;
  warmNext();
});
player.addEventListener('ended', () => {
  if (player.ended) openTrack(nextTrack());
});
player.addEventListener('error', handleMediaError);
function returnToApp() {
  if (document.hidden) return;
  if (player.ended) openTrack(nextTrack());
  else if (player.paused) ensurePlaying();
}
document.addEventListener('visibilitychange', returnToApp);
window.addEventListener('pageshow', returnToApp);
window.addEventListener('online', () => {
  if (!$('error').hidden) openTrack(track, player.currentTime || 0, true);
});
playPrompt.onclick = ensurePlaying;
$('retry').onclick = () => openTrack(track, player.currentTime || 0, true);

// Gameplay gestures only affect the overlay and camera. Clip navigation is
// explicit in the menu, or automatic when the current clip reaches its end.
function setMenu(open) {
  menuOpen = open;
  resetInputs();
  refreshView();
  if (open) $('resume').focus();
}
function navigate(index) {
  menuOpen = false;
  scene = undefined;
  openTrack(index);
}
$('menu-toggle').onclick = () => setMenu(true);
$('resume').onclick = () => setMenu(false);
$('restart').onclick = $('skip').onclick = () => navigate(1);
$('quit').onclick = () => navigate(0);
$('enter').onclick = () => setControls('car');
$('exit').onclick = () => setControls('foot');
$('aim').onclick = () => { aimed = !aimed; refreshView(); };
$('camera').onclick = () => { zoom = !zoom; refreshView(); };
$('sound').onclick = () => {
  player.muted = !player.muted;
  explicitlyMuted = player.muted;
  updateSoundButton();
  if (player.paused) ensurePlaying();
};
$('horn').onclick = () => {
  if (explicitlyMuted) return;
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return;
  audio ||= new Context();
  audio.resume().then(() => {
    [349.2, 440].forEach(frequency => {
      const oscillator = audio.createOscillator(), gain = audio.createGain(), t = audio.currentTime;
      oscillator.type = 'sawtooth'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(.001, t); gain.gain.exponentialRampToValueAtTime(.045, t + .025);
      gain.gain.exponentialRampToValueAtTime(.001, t + .38);
      oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(t); oscillator.stop(t + .4);
    });
  }).catch(() => {});
};
function hold(action, down) {
  if (down) held.add(action); else held.delete(action);
  $(action).classList.toggle('down', down);
  updateCamera();
}
document.querySelectorAll('[data-hold]').forEach(button => {
  const action = button.dataset.hold;
  button.onpointerdown = event => { button.setPointerCapture(event.pointerId); hold(action, true); };
  button.onlostpointercapture = () => hold(action, false);
  button.onkeydown = event => {
    if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); hold(action, true); }
  };
  button.onkeyup = event => {
    if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); hold(action, false); }
  };
  button.onblur = () => hold(action, false);
});
function localVector(x, y) {
  return matchMedia('(orientation:portrait)').matches ? [y, -x] : [x, y];
}
function moveStick(event) {
  const rect = stick.getBoundingClientRect(), r = rect.width * .34;
  const [x, y] = localVector(event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
  const factor = Math.min(1, r / (Math.hypot(x, y) || 1));
  stickX = x * factor / r; stickY = y * factor / r;
  stick.style.setProperty('--dx', x * factor + 'px'); stick.style.setProperty('--dy', y * factor + 'px');
  updateCamera();
}
stick.onpointerdown = event => { stick.setPointerCapture(event.pointerId); moveStick(event); };
stick.onpointermove = event => { if (stick.hasPointerCapture(event.pointerId)) moveStick(event); };
stick.onlostpointercapture = () => {
  stickX = stickY = 0;
  stick.style.removeProperty('--dx'); stick.style.removeProperty('--dy');
  updateCamera();
};
let lookFrom;
$('look').onpointerdown = event => {
  event.currentTarget.setPointerCapture(event.pointerId);
  lookFrom = [event.clientX, event.clientY, panX, panY];
};
$('look').onpointermove = event => {
  if (!lookFrom || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
  const [x, y] = localVector(event.clientX - lookFrom[0], event.clientY - lookFrom[1]);
  panX = clamp(lookFrom[2] + x * .025, -2, 2); panY = clamp(lookFrom[3] + y * .025, -1.6, 1.6);
  updateCamera();
};
$('look').onlostpointercapture = () => { lookFrom = null; };
window.addEventListener('keydown', event => {
  if (!$('error').hidden || !mode) return;
  if (event.key === 'Escape' && !event.repeat) { setMenu(!menuOpen); return; }
  if (menuOpen) return;
  if (event.key.toLowerCase() === 'e' && !event.repeat) setControls(mode === 'foot' ? 'car' : 'foot');
  if (event.key === 'ArrowUp') { event.preventDefault(); hold(mode === 'car' ? 'gas' : 'sprint', true); }
  if (mode === 'car' && event.key === 'ArrowDown') { event.preventDefault(); hold('brake', true); }
});
window.addEventListener('keyup', event => {
  if (event.key === 'ArrowUp') { hold('gas', false); hold('sprint', false); }
  if (event.key === 'ArrowDown') hold('brake', false);
});
window.addEventListener('blur', resetInputs);
player.muted = true;
updateScene(0);
refreshView();
if (player.error) handleMediaError(); else ensurePlaying();
if (player.readyState >= 3) warmNext();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
