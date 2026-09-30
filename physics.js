export const WIDTH = 1400, HEIGHT = 620;
export const weapons = {
  shell: { name: 'Standard shell', radius: 45, damage: 46, note: 'Clean trajectory. Dirty landing.' },
  heavy: { name: 'Heavy shell', radius: 74, damage: 68, note: 'A bigger blast. A louder statement.' },
  quake: { name: 'Earthshaker', radius: 115, damage: 35, note: 'Take the ground out from under them.' }
};
export function makeTerrain(seed = Math.random() * 100) {
  return Array.from({length: WIDTH + 1}, (_, x) => 419 + Math.sin(x * .005 + seed) * 49 + Math.sin(x * .013 + seed * 2) * 24 + Math.sin(x * .028 + seed) * 7);
}
export function launch(tank, angle, power) {
  const a = angle * Math.PI / 180, speed = power * 7.4;
  return { x: tank.x + Math.cos(a) * 25, y: tank.y - 12 - Math.sin(a) * 25, vx: Math.cos(a) * speed, vy: -Math.sin(a) * speed, age: 0 };
}
export function stepShot(shot, dt, wind, terrain, tanks = []) {
  shot.vx += wind * 9 * dt; shot.vy += 260 * dt;
  shot.x += shot.vx * dt; shot.y += shot.vy * dt; shot.age += dt;
  if (shot.x < 3) { shot.x = 6 - shot.x; shot.vx = Math.abs(shot.vx) * .85; }
  if (shot.x > WIDTH - 3) { shot.x = 2 * (WIDTH - 3) - shot.x; shot.vx = -Math.abs(shot.vx) * .85; }
  if (shot.age > .12 && tanks.some(t => t.hp > 0 && Math.hypot(t.x - shot.x, t.y - 8 - shot.y) < 17)) return true;
  return shot.y >= terrain[Math.max(0, Math.min(WIDTH, Math.round(shot.x)))] || shot.age > 16;
}
export function explode(terrain, tanks, x, y, weapon) {
  const { radius, damage } = weapons[weapon];
  const hits = tanks.map(t => Math.max(0, Math.round(damage * (1 - Math.max(0, Math.hypot(t.x - x, t.y - 8 - y) - 16) / (radius * 1.45)))));
  for (let i = Math.max(0, Math.floor(x - radius)); i <= Math.min(WIDTH, x + radius); i++) {
    terrain[i] = Math.min(HEIGHT - 35, Math.max(terrain[i], y + Math.sqrt(Math.max(0, radius * radius - (i - x) ** 2))));
  }
  tanks.forEach((t, i) => {
    const ground = terrain[Math.round(t.x)];
    hits[i] += Math.max(0, Math.round((ground - t.y - 24) * .3));
    t.y = ground; t.hp = Math.max(0, t.hp - hits[i]);
  });
  return hits;
}
