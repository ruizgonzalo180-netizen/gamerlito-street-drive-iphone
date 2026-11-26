'use strict';
const $ = id => document.getElementById(id);
const screenEl = $('screen');
const picture = $('picture');
const player = $('player');
const buffer = $('buffer');
const icons = {
  pause:'<path d="M8 5v14M16 5v14" stroke-width="3.5"/>',
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

const route = ['opening.mp4','curbside.mp4','drive-0.mp4','drive-1.mp4','drive-2.mp4'].map(file => './'+file+'?v=4');
const WALK_START = 2.45;
const DOOR = 12.3;
const held = new Set();
let phase = 'home', track = 0, paused = false, muted = false, zoom = false, aimed = false;
let moving = false, stopped = false, ready = false, revision = 0, hintTimer;
let panX = 0, panY = 0, steer = 0, audio;
const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
function hint(message, duration = 2000) {
  clearTimeout(hintTimer);
  $('notice').textContent = message;
  $('notice').hidden = !message;
  if(message) hintTimer = setTimeout(() => { $('notice').hidden = true; },duration);
}
function refreshView() {
  const foot = phase === 'foot', car = phase === 'car';
  screenEl.classList.toggle('opening', phase === 'home' || phase === 'intro');
  $('home').hidden = phase !== 'home';
  $('skip').hidden = phase !== 'intro' || paused;
  $('hud').hidden = !(foot || car) || paused;
  $('foot-controls').hidden = !foot;
  $('car-controls').hidden = !car;
  $('menu').hidden = !paused;
  $('reticle').hidden = !(foot && aimed);
  $('aim').setAttribute('aria-pressed',String(aimed));
  $('camera').setAttribute('aria-pressed',String(zoom));
  $('camera').setAttribute('aria-label',zoom?'Reset camera':'Zoom camera');
  $('sound').setAttribute('aria-pressed',String(muted));
  $('sound').setAttribute('aria-label',muted?'Enable sound':'Mute sound');
  setIcon($('sound'),muted?'muted':'sound');
  updateCamera();
}
function updateCamera() {
  const interactive = phase === 'foot' || phase === 'car';
  const scale = interactive ? (aimed ? 1.32 : zoom ? 1.23 : 1.06) : 1;
  picture.style.setProperty('--zoom',scale);
  picture.style.setProperty('--pan-x',(interactive ? clamp(panX + steer*1.2,-2.25,2.25) : 0)+'%');
  picture.style.setProperty('--pan-y',(interactive ? panY : 0)+'%');
  picture.style.setProperty('--tilt',(phase === 'car' ? -steer*.65 : 0)+'deg');
}
function resetInputs() {
  held.clear(); moving=false; steer=0;
  $('stick').style.removeProperty('--dx'); $('stick').style.removeProperty('--dy');
  document.querySelectorAll('.down').forEach(b=>b.classList.remove('down'));
  updateCamera();
}
function expectedPlayback() {
  if(paused || !ready || phase === 'home' || !$('error').hidden) return false;
  if(phase === 'foot') return (moving || held.has('sprint')) && player.currentTime < DOOR-.05;
  return phase !== 'car' || !stopped;
}
function playClip() {
  const id = revision;
  const result = player.play();
  if(result) result.catch(err => {
    if(id !== revision || err.name === 'AbortError' || !expectedPlayback()) return;
    if(err.name === 'NotAllowedError'){ setPaused(true); }
    else showError();
  });
}
function syncPlayback() {
  player.playbackRate = phase === 'car' && held.has('gas') ? 1.45 : phase === 'foot' && held.has('sprint') ? 1.4 : 1;
  if(expectedPlayback()) { if(player.paused) playClip(); }
  else player.pause();
}
function preloadNext(index) {
  const next = route[index+1] || route[2];
  if(buffer.getAttribute('src') !== next) {
    buffer.preload = 'auto'; buffer.src = next; buffer.load();
  }
}
function openTrack(index, nextPhase, position=0) {
  const id = ++revision;
  const still=$('between');
  if(phase!=='home' && player.readyState>=2 && player.videoWidth){
    still.width=player.videoWidth; still.height=player.videoHeight;
    still.getContext('2d').drawImage(player,0,0); still.hidden=false;
  } else still.hidden=true;
  const continuingDrive = phase === 'car' && nextPhase === 'car';
  ready=false; track=index; phase=nextPhase;
  if(!continuingDrive) resetInputs();
  refreshView();
  player.onloadedmetadata = () => {
    if(id !== revision) return;
    if(position) player.currentTime = position;
    ready=true; syncPlayback();
  };
  player.oncanplay = () => {
    if(id !== revision) return;
    player.classList.add('active');
    still.hidden=true;
    preloadNext(index);
  };
  player.ontimeupdate = tick;
  player.src = route[index]; player.muted=muted; player.load();
  // Starting on the tap also authorizes inline media on iPhone.
  if(!paused && ['intro','arrival','entry','car'].includes(nextPhase) && !(nextPhase==='car' && stopped)) playClip();
}
function showError() {
  if(phase==='home') return;
  player.pause(); $('error').hidden=false; $('notice').hidden=true;
}
player.addEventListener('error',showError);
$('retry').onclick=()=>{ $('error').hidden=true; openTrack(track,phase,player.currentTime || 0); };
function startSession(skipIntro=false) {
  paused=false; stopped=false; zoom=false; aimed=false; panX=panY=0; hint('');
  $('error').hidden=true;
  if(skipIntro) openTrack(1,'arrival'); else openTrack(0,'intro');
}
function beginFoot() {
  phase='foot'; ready=true; resetInputs(); refreshView(); syncPlayback();
  hint('Move with the stick · Tap Enter to drive',2800);
}
function enterCar() {
  if(phase!=='foot' || !ready) return;
  phase='entry'; resetInputs(); panX=panY=0; zoom=aimed=false; hint('');
  player.currentTime=DOOR; refreshView(); syncPlayback();
}
function exitCar() {
  if(phase!=='car') return;
  stopped=false; aimed=zoom=false; panX=panY=0; hint('');
  openTrack(1,'foot',WALK_START);
}
function tick() {
  if(!ready || paused) return;
  if(phase==='arrival' && player.currentTime>=WALK_START) beginFoot();
  if(phase==='foot' && player.currentTime>=DOOR-.05 && !player.paused){
    player.pause(); player.currentTime=DOOR-.025; hint('Tap Enter to get in');
  }
}
player.addEventListener('ended',()=>{
  if(phase==='intro') openTrack(1,'arrival');
  else if(phase==='entry') {stopped=false; openTrack(2,'car'); hint('Gas to accelerate · Brake to stop',2600);}
  else if(phase==='car') openTrack(track===route.length-1?2:track+1,'car');
});
function setPaused(value) {
  if(phase==='home') return;
  paused=value; resetInputs(); hint(''); refreshView(); syncPlayback();
}
function quit() {
  ++revision; phase='home'; paused=false; ready=false; player.pause(); buffer.pause(); resetInputs(); hint('');
  $('error').hidden=true; refreshView(); $('start').focus();
}
$('start').onclick=()=>startSession();
$('skip').onclick=()=>openTrack(1,'arrival');
$('enter').onclick=enterCar; $('exit').onclick=exitCar;
$('pause').onclick=()=>setPaused(true); $('resume').onclick=()=>setPaused(false);
$('restart').onclick=()=>startSession(true); $('quit').onclick=quit;
$('aim').onclick=()=>{aimed=!aimed; refreshView();};
$('camera').onclick=()=>{zoom=!zoom; panX=panY=0; refreshView();};
$('sound').onclick=()=>{muted=!muted; player.muted=muted; refreshView();};
$('horn').onclick=()=>{
  if(muted) return;
  const Context=window.AudioContext || window.webkitAudioContext;
  if(!Context) return;
  audio ||= new Context();
  audio.resume().then(()=>{
    [349.2,440].forEach(frequency=>{
      const oscillator=audio.createOscillator(), gain=audio.createGain(), t=audio.currentTime;
      oscillator.type='sawtooth'; oscillator.frequency.value=frequency;
      gain.gain.setValueAtTime(.001,t); gain.gain.exponentialRampToValueAtTime(.045,t+.025);
      gain.gain.exponentialRampToValueAtTime(.001,t+.38);
      oscillator.connect(gain);gain.connect(audio.destination);oscillator.start(t);oscillator.stop(t+.4);
    });
  }).catch(()=>{});
};
function hold(action, down) {
  if(down) held.add(action); else held.delete(action);
  if(action==='brake' && down) stopped=true;
  if(action==='gas' && down) stopped=false;
  $(action).classList.toggle('down',down); syncPlayback();
}
document.querySelectorAll('[data-hold]').forEach(button=>{
  const action=button.dataset.hold;
  button.onpointerdown=e=>{button.setPointerCapture(e.pointerId); hold(action,true);};
  button.onlostpointercapture=()=>hold(action,false);
  button.onkeydown=e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();hold(action,true);}};
  button.onkeyup=e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();hold(action,false);}};
});
function localVector(x,y) {
  return matchMedia('(orientation:portrait)').matches ? [y,-x] : [x,y];
}
const stick=$('stick');
function moveStick(e) {
  const rect=stick.getBoundingClientRect(), r=rect.width*.34;
  const [x,y]=localVector(e.clientX-rect.left-rect.width/2,e.clientY-rect.top-rect.height/2);
  const distance=Math.hypot(x,y), factor=Math.min(1,r/(distance||1));
  stick.style.setProperty('--dx',x*factor+'px'); stick.style.setProperty('--dy',y*factor+'px');
  moving=distance>r*.14; steer=x*factor/r;
  if(phase==='foot' && moving && player.currentTime>=DOOR-.09) hint('Tap Enter to get in');
  updateCamera(); syncPlayback();
}
stick.onpointerdown=e=>{stick.setPointerCapture(e.pointerId);moveStick(e);};
stick.onpointermove=e=>{if(stick.hasPointerCapture(e.pointerId)) moveStick(e);};
stick.onlostpointercapture=()=>{moving=false;steer=0;stick.style.removeProperty('--dx');stick.style.removeProperty('--dy');updateCamera();syncPlayback();};
let lookFrom;
$('look').onpointerdown=e=>{e.currentTarget.setPointerCapture(e.pointerId);lookFrom=[e.clientX,e.clientY,panX,panY];};
$('look').onpointermove=e=>{
  if(!lookFrom || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
  const [x,y]=localVector(e.clientX-lookFrom[0],e.clientY-lookFrom[1]);
  panX=clamp(lookFrom[2]+x*.025,-2,2); panY=clamp(lookFrom[3]+y*.025,-2,2); updateCamera();
};
$('look').onlostpointercapture=()=>{lookFrom=null;};
window.addEventListener('keydown',e=>{
  if(phase==='home' || !$('error').hidden) return;
  if(e.key==='Escape' && !e.repeat){setPaused(!paused); return;}
  if(paused || e.target.tagName==='BUTTON' && e.key==='Enter') return;
  if(e.key.toLowerCase()==='e' && !e.repeat) {if(phase==='foot') enterCar(); else if(phase==='car') exitCar();}
  if(phase==='car' && (e.key==='ArrowUp' || e.key==='ArrowDown')) {e.preventDefault();hold(e.key==='ArrowUp'?'gas':'brake',true);}
  if(phase==='foot' && e.key==='ArrowUp'){e.preventDefault();moving=true;syncPlayback();}
});
window.addEventListener('keyup',e=>{
  if(e.key==='ArrowUp'){moving=false;hold('gas',false);}
  if(e.key==='ArrowDown') hold('brake',false);
});
document.addEventListener('visibilitychange',()=>{if(document.hidden && phase!=='home') setPaused(true);});
let cueFrame=0;
function watchCue() {
  if(player.paused || (phase!=='foot' && phase!=='arrival')) return;
  tick();
  if(!player.paused) cueFrame=requestAnimationFrame(watchCue);
}
player.addEventListener('playing',()=>{cancelAnimationFrame(cueFrame);watchCue();});
player.addEventListener('pause',()=>cancelAnimationFrame(cueFrame));
refreshView();
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).catch(()=>{});
