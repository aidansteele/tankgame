import { WIDTH, HEIGHT, weapons, makeTerrain, launch, stepShot, explode } from './physics.js';
const $ = id => document.getElementById(id), canvas = $('battle'), ctx = canvas.getContext('2d');
const colors = ['#80d4c7', '#ffb17c'];
let terrain, tanks, active, round, wind, shot, phase, particles = [], rings = [], trail = [], timer = 0, generation = 0, sound = false, audio;
const stars = Array.from({length: 100}, () => ({x: Math.random() * WIDTH, y: Math.random() * 340, r: Math.random() * 1.1 + .3}));
const mountain = Array.from({length: 4}, (_, k) => Array.from({length: 141}, (_, i) => 300 + k * 45 + Math.sin(i * .09 + k * 2) * 30 + Math.sin(i * .27 + k) * 15 + Math.sin(i * 1.5 + k) * 5));
function tone(freq, duration, type = 'sine', volume = .04) {
  if (!sound) return;
  audio ??= new (window.AudioContext || window.webkitAudioContext)();
  audio.resume(); const o = audio.createOscillator(), g = audio.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, audio.currentTime); o.frequency.exponentialRampToValueAtTime(35, audio.currentTime + duration);
  g.gain.setValueAtTime(volume, audio.currentTime); g.gain.exponentialRampToValueAtTime(.001, audio.currentTime + duration);
  o.connect(g); g.connect(audio.destination); o.start(); o.stop(audio.currentTime + duration);
}
function isHuman() { return active === 0 || $('mode').value === 'local'; }
function sync() {
  tanks.forEach((t, i) => { $('hp' + i).textContent = t.hp + ' HP'; $('bar' + i).style.width = t.hp + '%'; });
  $('name0').textContent = $('mode').value === 'local' ? 'PLAYER 01' : 'YOU';
  $('name1').textContent = $('mode').value === 'local' ? 'PLAYER 02' : 'THE RIVAL';
  $('round').textContent = 'ROUND ' + String(round).padStart(2, '0');
  $('turn').textContent = phase === 'over' ? 'MATCH COMPLETE' : phase === 'flight' ? 'SHOT IN FLIGHT' : isHuman() ? ($('mode').value === 'local' ? `PLAYER 0${active + 1}'S TURN` : 'YOUR TURN') : 'RIVAL AIMING';
  $('wind').textContent = `WIND ${wind < 0 ? '←' : '→'} ${Math.abs(wind).toFixed(1)} M/S`;
  for (const id of ['angle', 'power', 'weapon', 'fire']) $(id).disabled = phase !== 'aim' || !isHuman();
  const t = tanks[active]; $('angle').value = t.angle; $('power').value = t.power;
  $('angle-value').textContent = t.angle + '°'; $('power-value').innerHTML = t.power + '<span>%</span>';
  for (const option of $('weapon').options) { option.textContent = `${weapons[option.value].name} · ${t.ammo[option.value] === Infinity ? '∞' : t.ammo[option.value]}`; option.disabled = !t.ammo[option.value]; }
  $('weapon').value = t.weapon; $('weapon-note').textContent = weapons[t.weapon].note;
}
function reset() {
  generation++; clearTimeout(timer); terrain = makeTerrain();
  tanks = [220, 1180].map((x, i) => ({x, y:terrain[x], hp:100, angle:i ? 135 : 45, power:65, weapon:'shell', ammo:{shell:Infinity, heavy:3, quake:2}}));
  active = 0; round = 1; wind = Math.random() * 6 - 3; phase = 'aim'; shot = null; trail = []; particles = []; rings = [];
  $('result').hidden = true; $('status').textContent = "You're up. Find your angle and let it fly."; sync();
}
function fire() {
  if (phase !== 'aim') return;
  const t = tanks[active]; if (!t.ammo[t.weapon]) return;
  t.ammo[t.weapon]--; shot = launch(t, t.angle, t.power); shot.weapon = t.weapon;
  trail = []; phase = 'flight'; $('status').textContent = 'Eyes on the sky.'; tone(180, .25, 'triangle'); sync();
}
function finishShot() {
  const x = shot.x, y = Math.min(shot.y, HEIGHT - 35), weapon = shot.weapon;
  const hits = explode(terrain, tanks, x, y, weapon);
  rings.push({x, y, r:0, max:weapons[weapon].radius * 1.5, life:1});
  for (let i = 0; i < 55; i++) { const a = Math.random() * Math.PI * 2, s = Math.random() * 220; particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-60,life:.6+Math.random(),color:i%3?'#eab082':'#fff0c6'}); }
  tone(90, .6, 'sawtooth', .07); shot = null; phase = 'settle';
  $('status').textContent = hits.some(Boolean) ? hits.map((h, i) => h ? `${i === 0 ? 'Player 01' : 'Player 02'} took ${h} damage` : '').filter(Boolean).join(' · ') : 'A fresh crater. Adjust and try again.';
  sync(); const gen = generation;
  timer = setTimeout(() => {
    if (gen !== generation) return;
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
  }, 1000);
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
  t.weapon = t.ammo.heavy && round % 3 === 0 ? 'heavy' : 'shell'; sync(); fire();
}
function polygon(points, fill) { ctx.beginPath(); ctx.moveTo(0, HEIGHT); points.forEach(([x,y]) => ctx.lineTo(x,y)); ctx.lineTo(WIDTH,HEIGHT); ctx.closePath(); ctx.fillStyle=fill; ctx.fill(); }
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
  const sky=ctx.createLinearGradient(0,0,0,HEIGHT);sky.addColorStop(0,'#251f33');sky.addColorStop(.48,'#6d3e50');sky.addColorStop(1,'#d58870');ctx.fillStyle=sky;ctx.fillRect(0,0,WIDTH,HEIGHT);
  stars.forEach(s=>{ctx.globalAlpha=.55;ctx.fillStyle='#f6dccd';ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,7);ctx.fill();});ctx.globalAlpha=1;
  const glow=ctx.createRadialGradient(855,285,30,855,285,210);glow.addColorStop(0,'#efa98250');glow.addColorStop(1,'#efa98200');ctx.fillStyle=glow;ctx.fillRect(600,30,510,510);
  ctx.fillStyle='#eeb18e';ctx.beginPath();ctx.arc(855,287,65,0,7);ctx.fill();
  mountain.forEach((m,k)=>polygon(m.map((y,i)=>[i*10,y]),['#694053','#573649','#452e42','#38283a'][k]));
  const ground=ctx.createLinearGradient(0,350,0,HEIGHT);ground.addColorStop(0,'#ba7965');ground.addColorStop(.4,'#855346');ground.addColorStop(1,'#382932');
  polygon(terrain.map((y,x)=>[x,y]),ground);
  ctx.strokeStyle='#edb48c';ctx.lineWidth=2;ctx.beginPath();terrain.forEach((y,x)=>x?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();
  ctx.save();ctx.beginPath();ctx.moveTo(0,HEIGHT);terrain.forEach((y,x)=>ctx.lineTo(x,y));ctx.lineTo(WIDTH,HEIGHT);ctx.clip();
  for(let layer=0;layer<8;layer++){ctx.strokeStyle=layer%2?'#f3b58b12':'#211d2925';ctx.lineWidth=1;ctx.beginPath();for(let x=0;x<=WIDTH;x+=5){const y=terrain[x]+25+layer*24+Math.sin(x*.012+layer)*12;x?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.stroke();}ctx.restore();
  ctx.strokeStyle='#f3c9b125';ctx.setLineDash([3,9]);ctx.beginPath();ctx.moveTo(5,110);ctx.lineTo(5,HEIGHT-50);ctx.moveTo(WIDTH-5,110);ctx.lineTo(WIDTH-5,HEIGHT-50);ctx.stroke();ctx.setLineDash([]);
  tanks.forEach(drawTank);
  if(phase==='aim' && isHuman()) {const preview=launch(tanks[active],tanks[active].angle,tanks[active].power);for(let i=0;i<40;i++){if(stepShot(preview,.025,wind,terrain,tanks))break;if(i%3===0){ctx.globalAlpha=(1-i/40)*.65;ctx.fillStyle=colors[active];ctx.beginPath();ctx.arc(preview.x,preview.y,2,0,7);ctx.fill();}}ctx.globalAlpha=1;}
  if(shot){for(let i=0;i<4 && shot;i++){if(stepShot(shot,dt/4,wind,terrain,tanks)){finishShot();break;}}if(shot){trail.push({x:shot.x,y:shot.y});if(trail.length>90)trail.shift();ctx.shadowColor='#fff0ce';ctx.shadowBlur=15;ctx.fillStyle='#fff4d4';ctx.beginPath();ctx.arc(shot.x,shot.y,4,0,7);ctx.fill();ctx.shadowBlur=0;if(shot.y<0){ctx.fillStyle='#f4c399';ctx.font='12px sans-serif';ctx.textAlign='center';ctx.fillText('↑ '+Math.round(-shot.y)+'m',shot.x,110);}}}
  if(trail.length){ctx.beginPath();trail.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.strokeStyle='#ffe0b75a';ctx.lineWidth=1.5;ctx.stroke();if(!shot)trail.splice(0,3);}
  particles.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=250*dt;p.life-=dt;ctx.globalAlpha=Math.max(0,Math.min(1,p.life));ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,3,3);});particles=particles.filter(p=>p.life>0);ctx.globalAlpha=1;
  rings.forEach(r=>{r.life-=dt*1.6;r.r+=(r.max-r.r)*dt*9;ctx.strokeStyle=`rgba(255,211,157,${Math.max(0,r.life)})`;ctx.lineWidth=3;ctx.beginPath();ctx.arc(r.x,r.y,r.r,0,7);ctx.stroke();});rings=rings.filter(r=>r.life>0);
}
for(const id of ['angle','power']) $(id).addEventListener('input',()=>{tanks[active][id]=Number($(id).value);sync();});
$('weapon').addEventListener('change',()=>{tanks[active].weapon=$('weapon').value;sync();});
$('fire').onclick=()=>{if(isHuman())fire();};
$('new').onclick=reset; $('again').onclick=reset; $('mode').onchange=reset;
$('help').onclick=()=>$('instructions').showModal(); $('close-help').onclick=$('ready').onclick=()=>$('instructions').close();
$('sound').onclick=()=>{sound=!sound;$('sound').textContent=sound?'Sound on':'Sound off';$('sound').setAttribute('aria-pressed',String(sound));if(sound)tone(400,.15);};
window.addEventListener('keydown',e=>{if($('instructions').open || phase!=='aim' || !isHuman() || /INPUT|SELECT|BUTTON/.test(document.activeElement.tagName))return;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(e.key)){e.preventDefault();const t=tanks[active];if(e.key===' ')fire();else{if(e.key==='ArrowLeft')t.angle=Math.min(175,t.angle+1);if(e.key==='ArrowRight')t.angle=Math.max(5,t.angle-1);if(e.key==='ArrowUp')t.power=Math.min(100,t.power+1);if(e.key==='ArrowDown')t.power=Math.max(10,t.power-1);sync();}}});
reset();let last=performance.now();function frame(now){draw(Math.min((now-last)/1000,.035));last=now;requestAnimationFrame(frame);}requestAnimationFrame(frame);
