import { WIDTH, HEIGHT, WORLD_FLOOR, weapons, makeTerrain, launch, stepShot, splitCluster, explode, collapseTerrain, settleTanks, breakRocks, stepRocks, cameraScale } from './physics.js';
const $ = id => document.getElementById(id), canvas = $('battle'), ctx = canvas.getContext('2d');
const colors = ['#80d4c7', '#ffb17c'];
let zoom = 1, cameraBottom = HEIGHT;
let terrain, tanks, active, round, wind, shots = [], phase, settling, rocks = [], particles = [], rings = [], trail = [], timer = 0, generation = 0, sound = false, audio;
let musicBus, backingBus, musicTimer, musicStep = 0, nextNote = 0, noise, accents = [];
const sixteenth = 60 / 138 / 4;
const progression = [45, 41, 48, 43]; // A minor / F / C / G, two bars each.
const melody = [12, 19, 24, 19, 15, 19, 22, 19, 12, 19, 24, 27, 24, 22, 19, 15];
const stars = Array.from({length: 100}, () => ({x: Math.random() * WIDTH, y: Math.random() * 340, r: Math.random() * 1.1 + .3}));
const mountain = Array.from({length: 4}, (_, k) => Array.from({length: 141}, (_, i) => 300 + k * 45 + Math.sin(i * .09 + k * 2) * 30 + Math.sin(i * .27 + k) * 15 + Math.sin(i * 1.5 + k) * 5));

function synthNote(time, midi, duration, type, volume, destination = backingBus, endFrequency) {
  const oscillator = audio.createOscillator(), envelope = audio.createGain();
  const frequency = 440 * 2 ** ((midi - 69) / 12);
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, time);
  if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, time + duration);
  envelope.gain.setValueAtTime(0, time);
  envelope.gain.linearRampToValueAtTime(volume, time + .004);
  envelope.gain.exponentialRampToValueAtTime(.0001, time + duration);
  oscillator.connect(envelope); envelope.connect(destination);
  oscillator.start(time); oscillator.stop(time + duration + .01);
  oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
}

function percussion(time, duration, volume, cutoff, destination = backingBus) {
  const source = audio.createBufferSource(), filter = audio.createBiquadFilter(), envelope = audio.createGain();
  source.buffer = noise; filter.type = 'highpass'; filter.frequency.value = cutoff;
  envelope.gain.setValueAtTime(volume, time);
  envelope.gain.exponentialRampToValueAtTime(.0001, time + duration);
  source.connect(filter); filter.connect(envelope); envelope.connect(destination);
  source.start(time); source.stop(time + duration);
  source.onended = () => { source.disconnect(); filter.disconnect(); envelope.disconnect(); };
}

function scheduleMusic() {
  if (!sound || document.hidden) return;
  // Look ahead on the audio clock; animation frame jitter cannot change the beat.
  if (nextNote < audio.currentTime) nextNote = audio.currentTime + .02;
  while (nextNote < audio.currentTime + .15) {
    const step = musicStep % 16, bar = Math.floor(musicStep / 16) % 16;
    const root = progression[Math.floor(bar / 2) % 4], time = nextNote;
    // Keep the original groove and clock uninterrupted beneath shot phrases.
    accents = accents.filter(accent => musicStep < accent.start + 8);
    for (const accent of accents) {
      if (musicStep >= accent.start) shotMusicStep(accent, time, root, musicStep - accent.start);
    }
    if (step % 4 === 0) synthNote(time, 50, .16, 'sine', .55, backingBus, 42);
    if (step === 4 || step === 12) { percussion(time, .12, .17, 1400); synthNote(time, 43, .09, 'triangle', .12); }
    if (step % 2 === 0) percussion(time, step % 4 === 2 ? .085 : .035, .065, 6500);
    if (step % 2 === 0) synthNote(time, root - 12 + (step === 14 ? 12 : 0), .16, 'sawtooth', .12);
    // Bright pulse arpeggios and a second-half octave lift give the loop an arcade feel.
    const minor = root === 45;
    const arp = [0, minor ? 3 : 4, 7, 12][step % 4];
    synthNote(time, root + 12 + arp, .075, 'square', .032);
    if (bar % 4 !== 3 || step < 12) {
      let note = melody[step];
      if (!minor && note % 12 === 3) note++;
      if (!minor && note % 12 === 10) note--;
      synthNote(time, root + note + (bar >= 8 ? 12 : 0), .11, 'square', .038);
    }
    musicStep++; nextNote += sixteenth;
  }
}

function setSound(enabled) {
  sound = enabled;
  $('sound').textContent = sound ? 'Sound on' : 'Sound off';
  $('sound').setAttribute('aria-pressed', String(sound));
  clearInterval(musicTimer);
  if (!audio && !sound) return;
  if (!audio) {
    audio = new (window.AudioContext || window.webkitAudioContext)();
    musicBus = audio.createGain(); musicBus.gain.value = 0; musicBus.connect(audio.destination);
    backingBus = audio.createGain(); backingBus.connect(musicBus);
    noise = audio.createBuffer(1, audio.sampleRate * .2, audio.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }
  accents = [];
  musicBus.gain.cancelScheduledValues(audio.currentTime);
  musicBus.gain.setTargetAtTime(sound && !document.hidden ? .28 : 0, audio.currentTime, .02);
  if (sound && !document.hidden) {
    audio.resume(); nextNote = audio.currentTime + .04;
    scheduleMusic(); musicTimer = setInterval(scheduleMusic, 25);
  }
}

function shotMusicStep(accent, time, root, step) {
  const fade = 1 - step / 10;
  if (accent.impact) {
    // A soft descending tom fill, not a new bass drop or a restarted drum loop.
    if ([0, 3, 6].includes(step)) {
      synthNote(time, root + (step === 0 ? 12 : 0), .18, 'sine', .16 * fade, musicBus);
      percussion(time, .06, .075 * fade, 1800, musicBus);
    }
  } else if (step % 2 === 0) {
    const pattern = accent.weapon === 'quake' ? [0, 7, 0, 12]
      : accent.weapon === 'heavy' ? [12, 7, 0, 7] : [0, 7, 12, 7];
    synthNote(time, root + 12 + pattern[step / 2], .22, 'triangle', .16 * fade, musicBus);
  }
}

function firingSound(weapon, impact = false) {
  if (!sound || document.hidden) return;
  const now = audio.currentTime;
  // musicStep points past the lookahead queue; recover the chord actually playing.
  const step = Math.max(0, musicStep + Math.floor((now - nextNote) / sixteenth));
  const root = progression[Math.floor(step / 32) % 4];
  const weight = weapon === 'shell' ? 1 : weapon === 'heavy' ? 1.4 : 1.7;
  // Let an existing phrase finish when its shell lands; never cut it mid-note.
  accents.push({ weapon, impact, start: Math.ceil(musicStep / 2) * 2 });
  // Restrained immediate feedback; the musical response enters on an eighth note.
  percussion(now, .09 * weight, impact ? .14 : .1, impact ? 450 : 1000, musicBus);
  synthNote(now, root - 12, .18 * weight, 'triangle', impact ? .2 : .14, musicBus);
}

document.addEventListener('visibilitychange', () => setSound(sound));
function isHuman() { return active === 0 || $('mode').value === 'local'; }
function sync() {
  tanks.forEach((t, i) => { $('hp' + i).textContent = t.hp + ' HP'; $('bar' + i).style.width = t.hp + '%'; });
  $('name0').textContent = $('mode').value === 'local' ? 'PLAYER 01' : 'YOU';
  $('name1').textContent = $('mode').value === 'local' ? 'PLAYER 02' : 'THE RIVAL';
  $('round').textContent = 'ROUND ' + String(round).padStart(2, '0');
  $('turn').textContent = phase === 'over' ? 'MATCH COMPLETE' : phase === 'flight' ? 'SHOT IN FLIGHT' : phase === 'settle' ? 'GROUND SETTLING' : isHuman() ? ($('mode').value === 'local' ? `PLAYER 0${active + 1}'S TURN` : 'YOUR TURN') : 'RIVAL AIMING';
  $('wind').textContent = `WIND ${wind < 0 ? '←' : '→'} ${Math.abs(wind).toFixed(1)} M/S`;
  for (const id of ['angle', 'power', 'weapon', 'fire']) $(id).disabled = phase !== 'aim' || !isHuman();
  const t = tanks[active]; $('angle').value = t.angle; $('power').value = t.power;
  $('angle-value').textContent = t.angle + '°'; $('power-value').innerHTML = t.power + '<span>%</span>';
  for (const option of $('weapon').options) { option.textContent = `${weapons[option.value].name} · ${t.ammo[option.value] === Infinity ? '∞' : t.ammo[option.value]}`; option.disabled = !t.ammo[option.value]; }
  $('weapon').value = t.weapon; $('weapon-note').textContent = weapons[t.weapon].note;
}
function reset() {
  generation++; clearTimeout(timer); terrain = makeTerrain();
  zoom = 1; cameraBottom = HEIGHT;
  accents = [];
  tanks = [220, 1180].map((x, i) => ({x, y:terrain[x], hp:100, angle:i ? 135 : 45, power:65, weapon:'shell', ammo:{shell:Infinity, heavy:3, quake:2, cluster:3, bunker:3}}));
  active = 0; round = 1; wind = Math.random() * 6 - 3; phase = 'aim'; shots = []; settling = null; rocks = []; trail = []; particles = []; rings = [];
  $('result').hidden = true; $('status').textContent = "You're up. Find your angle and let it fly."; sync();
}
function fire() {
  if (phase !== 'aim') return;
  const t = tanks[active]; if (!t.ammo[t.weapon]) return;
  t.ammo[t.weapon]--; shots = [{ ...launch(t, t.angle, t.power), weapon: t.weapon, trail: [] }];
  trail = [shots[0].trail]; phase = 'flight'; $('status').textContent = 'Eyes on the sky.'; firingSound(t.weapon); sync();
}
function finishShot(shot) {
  const x = shot.x, y = Math.min(shot.y, WORLD_FLOOR), weapon = shot.weapon;
  const before = terrain.slice();
  const hits = explode(terrain, tanks, x, y, weapon, shot);
  rocks.push(...breakRocks(before, terrain, x));
  rocks = rocks.slice(-450);
  const radius = weapons[weapon].radius * 2.5;
  if (settling) {
    settling.left = Math.min(settling.left, x - radius);
    settling.right = Math.max(settling.right, x + radius);
    settling.hits = settling.hits.map((hit, i) => hit + hits[i]);
    settling.ticks = 0;
    settling.rockSurface = terrain.slice();
  } else settling = { x, hits, rockSurface: terrain.slice(), left: x - radius, right: x + radius, ticks: 0, time: 0, fall: tanks.map(t => ({ start: t.y, damage: 0, speed: 0 })) };
  settling.limit = Math.max(240, ...tanks.map(t => Math.ceil(Math.sqrt(Math.max(0, terrain[Math.round(t.x)] - t.y) * 2 / 420) * 120) + 60));
  rings.push({x, y, r:0, max:weapons[weapon].radius * 1.5, life:1});
  for (let i = 0; i < 55; i++) { const a = Math.random() * Math.PI * 2, s = Math.random() * 220; particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-60,life:.6+Math.random(),color:i%3?'#eab082':'#fff0c6'}); }
  // A salvo shares one musical landing phrase, rather than stacking five fills.
  if (!shot.bomblet || !accents.some(accent => accent.impact)) firingSound(weapon, true);
  if (shots.length) return;
  phase = 'settle';
  $('status').textContent = hits.some(Boolean) ? hits.map((h, i) => h ? `${i === 0 ? 'Player 01' : 'Player 02'} took ${h} damage` : '').filter(Boolean).join(' · ') : 'A fresh crater. Adjust and try again.';
  sync(); const gen = generation;
  timer = setTimeout(() => {
    if (gen !== generation) return;
    // Finish the fixed simulation even if this tab was briefly in the background.
    while (settling && settling.ticks < settling.limit) settleGround();
    settling = null;
    if (tanks.some(t => t.hp <= 0)) {
      phase = 'over'; $('result').hidden = false;
      $('winner').textContent = tanks.every(t => t.hp <= 0) ? 'Mutual destruction.' : $('mode').value === 'local' ? `Player 0${tanks[0].hp > 0 ? 1 : 2} wins.` : tanks[0].hp > 0 ? 'Sweet victory.' : 'Outgunned. Not outdone.';
      $('result-description').textContent = `${round} rounds. A thoroughly rearranged desert. Ready for another?`; sync(); return;
    }
    active = 1 - active; if (active === 0) round++;
    wind = Math.random() * 8 - 4; phase = 'aim';
    if (!tanks[active].ammo[tanks[active].weapon]) tanks[active].weapon = 'shell';
    $('status').textContent = isHuman() ? 'Your turn. Read the wind, find your range.' : 'The rival is lining up a shot…'; sync();
    if (!isHuman()) timer = setTimeout(computerTurn, 900);
  }, settling.limit / 120 * 1000 + 400);
}

function settleGround() {
  const s = settling;
  collapseTerrain(terrain, s.left, s.right);
  settleTanks(terrain, tanks, s.fall, 1 / 120);
  s.ticks++;
  if (s.ticks % 24 === 0) {
    const loosened = breakRocks(s.rockSurface, terrain, s.x);
    for (const rock of loosened) {
      rock.vx = Math.sign(s.x - rock.x) * 20;
      rock.vy = 0;
    }
    rocks.push(...loosened);
    rocks = rocks.slice(-450);
    s.rockSurface = terrain.slice();
  }
  if (s.ticks % 12 === 0) {
    const damage = s.hits.map((hit, i) => hit + s.fall[i].damage);
    $('status').textContent = damage.some(Boolean)
      ? damage.map((hit, i) => hit ? `Player 0${i + 1}: ${hit} damage${s.fall[i].damage ? ' (including fall)' : ''}` : '').filter(Boolean).join(' · ')
      : 'Crater walls are collapsing. Wait for the dust to settle.';
    sync();
  }
}
function computerTurn() {
  if (phase !== 'aim' || isHuman()) return;
  const t = tanks[1]; let best = {distance:Infinity, angle:135, power:65};
  for (let angle = 100; angle <= 165; angle += 3) for (let power = 30; power <= 100; power += 2) {
    const s = launch(t, angle, power);
    while (!stepShot(s, 1/120, wind, terrain, tanks)) {}
    const distance = Math.hypot(s.x - tanks[0].x, s.y - tanks[0].y);
    if (distance < best.distance) best = {distance, angle, power};
  }
  t.angle = best.angle; t.power = Math.max(10, Math.min(100, Math.round(best.power + (Math.random() - .5) * 7)));
  const special = ['heavy', 'cluster', 'bunker', 'quake'][round % 4];
  t.weapon = t.ammo[special] ? special : 'shell'; sync(); fire();
}
function polygon(points, fill) { ctx.beginPath(); ctx.moveTo(-WIDTH * 2, WORLD_FLOOR + 200); ctx.lineTo(-WIDTH * 2, points[0][1]); points.forEach(([x,y]) => ctx.lineTo(x,y)); ctx.lineTo(WIDTH * 3, points.at(-1)[1]); ctx.lineTo(WIDTH * 3,WORLD_FLOOR + 200); ctx.closePath(); ctx.fillStyle=fill; ctx.fill(); }
function drawTank(t, i) {
  ctx.save(); ctx.translate(t.x, t.y - 5); ctx.globalAlpha = t.hp > 0 ? 1 : .35;
  ctx.fillStyle='#211e29'; ctx.beginPath(); ctx.ellipse(0,6,28,6,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle=colors[i]; ctx.beginPath(); ctx.roundRect(-21,-7,42,13,6); ctx.fill();
  ctx.fillStyle='#263333'; ctx.beginPath(); ctx.roundRect(-17,-3,34,7,4); ctx.fill();
  for(let k=-12;k<=12;k+=8){ctx.beginPath();ctx.arc(k,0,2,0,Math.PI*2);ctx.fillStyle=colors[i];ctx.fill();}
  ctx.fillStyle=colors[i];ctx.beginPath();ctx.roundRect(-12,-17,24,12,[7,7,0,0]);ctx.fill();
  ctx.strokeStyle=colors[i];ctx.lineWidth=5;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(0,-12);ctx.lineTo(Math.cos(t.angle*Math.PI/180)*27,-12-Math.sin(t.angle*Math.PI/180)*27);ctx.stroke();
  if (active===i && phase==='aim'){ctx.fillStyle=colors[i];ctx.beginPath();ctx.moveTo(-4,-47);ctx.lineTo(4,-47);ctx.lineTo(0,-41);ctx.fill();}
  ctx.font='9px "DM Sans", sans-serif';ctx.textAlign='center';ctx.fillStyle=colors[i];ctx.fillText(i===0?'01 / NOMAD':'02 / BANDIT',0,29);ctx.restore();
}
function draw(dt) {
  if (settling && settling.ticks < settling.limit) {
    settling.time += dt;
    while (settling.time >= 1 / 120 && settling.ticks < settling.limit) {
      settling.time -= 1 / 120;
      settleGround();
    }
  }
  stepRocks(rocks, terrain, dt);
  for (let i = 0; i < 4; i++) {
    for (const shot of [...shots]) {
      const hit = stepShot(shot, dt / 4, wind, terrain, tanks);
      const children = hit ? null : splitCluster(shot);
      if (hit || children) shots.splice(shots.indexOf(shot), 1);
      if (hit) finishShot(shot);
      else if (children) {
        for (const child of children) { child.trail = []; trail.push(child.trail); }
        shots.push(...children);
        rings.push({x: shot.x, y: shot.y, r: 0, max: 28, life: 1});
        $('status').textContent = 'Cluster deployed. Five incoming.';
      } else { shot.trail.push({x: shot.x, y: shot.y}); if (shot.trail.length > 90) shot.trail.shift(); }
    }
  }
  const bottom = Math.max(HEIGHT, Math.max(...terrain) + 55);
  cameraBottom += (bottom - cameraBottom) * (1 - Math.exp(-6 * dt));
  const highest = shots.reduce((top, shot) => !top || shot.y + Math.min(0, shot.vy) * .2 < top.y + Math.min(0, top.vy) * .2 ? shot : top, null);
  zoom = cameraScale(zoom, highest, dt, cameraBottom);
  const sky=ctx.createLinearGradient(0,0,0,HEIGHT);sky.addColorStop(0,'#251f33');sky.addColorStop(.48,'#6d3e50');sky.addColorStop(1,'#d58870');ctx.fillStyle=sky;ctx.fillRect(0,0,WIDTH,HEIGHT);
  stars.forEach(s=>{ctx.globalAlpha=.55;ctx.fillStyle='#f6dccd';ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,7);ctx.fill();});ctx.globalAlpha=1;
  ctx.save();
  ctx.translate(WIDTH / 2, HEIGHT);
  ctx.scale(zoom, zoom);
  ctx.translate(-WIDTH / 2, -cameraBottom);
  const glow=ctx.createRadialGradient(855,285,30,855,285,210);glow.addColorStop(0,'#efa98250');glow.addColorStop(1,'#efa98200');ctx.fillStyle=glow;ctx.fillRect(600,30,510,510);
  ctx.fillStyle='#eeb18e';ctx.beginPath();ctx.arc(855,287,65,0,7);ctx.fill();
  mountain.forEach((m,k)=>polygon(m.map((y,i)=>[i*10,y]),['#694053','#573649','#452e42','#38283a'][k]));
  const ground=ctx.createLinearGradient(0,350,0,WORLD_FLOOR);ground.addColorStop(0,'#ba7965');ground.addColorStop(.4,'#855346');ground.addColorStop(1,'#382932');
  polygon(terrain.map((y,x)=>[x,y]),ground);
  ctx.strokeStyle='#edb48c';ctx.lineWidth=2;ctx.beginPath();terrain.forEach((y,x)=>x?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();
  ctx.save();ctx.beginPath();ctx.moveTo(0,WORLD_FLOOR + 200);terrain.forEach((y,x)=>ctx.lineTo(x,y));ctx.lineTo(WIDTH,WORLD_FLOOR + 200);ctx.clip();
  for(let layer=0;layer<8;layer++){ctx.strokeStyle=layer%2?'#f3b58b12':'#211d2925';ctx.lineWidth=1;ctx.beginPath();for(let x=0;x<=WIDTH;x+=5){const y=terrain[x]+25+layer*24+Math.sin(x*.012+layer)*12;x?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.stroke();}ctx.restore();
  ctx.strokeStyle='#f3c9b125';ctx.setLineDash([3,9]);ctx.beginPath();ctx.moveTo(5,110);ctx.lineTo(5,HEIGHT-50);ctx.moveTo(WIDTH-5,110);ctx.lineTo(WIDTH-5,HEIGHT-50);ctx.stroke();ctx.setLineDash([]);
  for (const rock of rocks) {
    ctx.save(); ctx.translate(rock.x, rock.y); ctx.rotate(rock.angle);
    const r = rock.radius;
    ctx.beginPath(); ctx.moveTo(-r, -.25*r); ctx.lineTo(-.45*r, -.9*r);
    ctx.lineTo(.55*r, -.7*r); ctx.lineTo(r, .2*r); ctx.lineTo(.25*r, .85*r);
    ctx.lineTo(-.7*r, .65*r); ctx.closePath();
    ctx.fillStyle = rock.shade > .5 ? '#bc8a70' : '#8c6454'; ctx.fill();
    ctx.strokeStyle = '#49313a'; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r, -.25*r); ctx.lineTo(-.45*r, -.9*r); ctx.lineTo(.55*r, -.7*r);
    ctx.lineTo(.05*r, .05*r); ctx.closePath(); ctx.fillStyle = '#e5b492'; ctx.fill();
    ctx.restore();
  }
  tanks.forEach(drawTank);
  if(phase==='aim' && isHuman()) {const preview=launch(tanks[active],tanks[active].angle,tanks[active].power);for(let i=0;i<40;i++){if(stepShot(preview,.025,wind,terrain,tanks))break;if(i%3===0){ctx.globalAlpha=(1-i/40)*.65;ctx.fillStyle=colors[active];ctx.beginPath();ctx.arc(preview.x,preview.y,2,0,7);ctx.fill();}}ctx.globalAlpha=1;}
  for(const shot of shots){ctx.shadowColor='#fff0ce';ctx.shadowBlur=15;ctx.fillStyle=shot.bomblet?'#a9f2df':'#fff4d4';ctx.beginPath();ctx.arc(shot.x,shot.y,4 / Math.sqrt(zoom),0,7);ctx.fill();ctx.shadowBlur=0;}
  for(const path of trail){ctx.beginPath();path.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.strokeStyle='#ffe0b790';ctx.lineWidth=1.5 / zoom;ctx.stroke();if(!shots.some(s=>s.trail===path))path.splice(0,3);}
  particles.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=250*dt;p.life-=dt;ctx.globalAlpha=Math.max(0,Math.min(1,p.life));ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,3,3);});particles=particles.filter(p=>p.life>0);ctx.globalAlpha=1;
  rings.forEach(r=>{r.life-=dt*1.6;r.r+=(r.max-r.r)*dt*9;ctx.strokeStyle=`rgba(255,211,157,${Math.max(0,r.life)})`;ctx.lineWidth=3;ctx.beginPath();ctx.arc(r.x,r.y,r.r,0,7);ctx.stroke();});rings=rings.filter(r=>r.life>0);
  ctx.restore();
}
// Build the arsenal from the same definitions used by the simulation.
$('weapon').replaceChildren(...Object.entries(weapons).map(([key, weapon]) => new Option(weapon.name, key)));
for(const id of ['angle','power']) $(id).addEventListener('input',()=>{tanks[active][id]=Number($(id).value);sync();});
$('weapon').addEventListener('change',()=>{tanks[active].weapon=$('weapon').value;sync();});
$('fire').onclick=()=>{if(isHuman())fire();};
$('new').onclick=reset; $('again').onclick=reset; $('mode').onchange=reset;
$('help').onclick=()=>$('instructions').showModal(); $('close-help').onclick=$('ready').onclick=()=>$('instructions').close();
$('sound').onclick=()=>setSound(!sound);
window.addEventListener('keydown',e=>{if($('instructions').open || phase!=='aim' || !isHuman() || /INPUT|SELECT|BUTTON/.test(document.activeElement.tagName))return;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(e.key)){e.preventDefault();const t=tanks[active];if(e.key===' ')fire();else{if(e.key==='ArrowLeft')t.angle=Math.min(175,t.angle+1);if(e.key==='ArrowRight')t.angle=Math.max(5,t.angle-1);if(e.key==='ArrowUp')t.power=Math.min(100,t.power+1);if(e.key==='ArrowDown')t.power=Math.max(10,t.power-1);sync();}}});
reset();let last=performance.now();function frame(now){draw(Math.min((now-last)/1000,.035));last=now;requestAnimationFrame(frame);}requestAnimationFrame(frame);
