export const WIDTH = 1400, HEIGHT = 620;
export const WORLD_FLOOR = 1800;
export const weapons = {
  shell: { name: 'Standard shell', radius: 45, damage: 46, note: 'Clean trajectory. Dirty landing.' },
  heavy: { name: 'Heavy shell', radius: 74, damage: 68, note: 'A bigger blast. A louder statement.' },
  quake: { name: 'Earthshaker', radius: 115, damage: 35, note: 'Take the ground out from under them.' },
  cluster: { name: 'Cluster shell', radius: 32, damage: 22, note: 'Five bomblets. Splits at the top of the arc.' },
  bunker: { name: 'Bunker buster', radius: 65, damage: 52, depth: 3.8, note: 'A narrow blast that digs deep into the earth.' }
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
export function splitCluster(shot) {
  if (shot.weapon !== 'cluster' || shot.bomblet || shot.vy < 0) return null;
  return [-2, -1, 0, 1, 2].map(offset => ({ ...shot, bomblet: true,
    vx: shot.vx + offset * 65, vy: shot.vy - 35 + Math.abs(offset) * 12, age: 0 }));
}

export function cameraScale(scale, shot, dt, bottom = HEIGHT) {
  // Anticipate ascent slightly so easing never lets a fast shell leave the frame.
  // Reserve the top 100 canvas pixels for the fixed HUD and a little breathing room.
  const top = shot ? shot.y + Math.min(0, shot.vy) * .2 : HEIGHT;
  const target = Math.min(1, (HEIGHT - 100) / (bottom - Math.min(100, top)));
  return scale + (target - scale) * (1 - Math.exp(-10 * dt));
}

export function explode(terrain, tanks, x, y, weapon, velocity = { vx: 0, vy: 1 }) {
  const { radius, damage } = weapons[weapon];
  const hits = tanks.map(t => Math.max(0, Math.round(damage * (1 - Math.max(0, Math.hypot(t.x - x, t.y - 8 - y) - 16) / (radius * 1.45)))));
  const speed = Math.hypot(velocity.vx, velocity.vy) || 1;
  const ux = velocity.vx / speed, uy = velocity.vy / speed;
  const along = radius * (weapons[weapon].depth || 1.35), across = radius * .7;
  const cx = x + ux * radius * .35, cy = y + uy * radius * .35;
  // Intersect each terrain column with an ellipse aligned to the incoming shell.
  const a = uy * uy / along ** 2 + ux * ux / across ** 2;
  for (let i = Math.max(0, Math.floor(cx - along)); i <= Math.min(WIDTH, cx + along); i++) {
    const dx = i - cx;
    const b = 2 * dx * ux * uy * (1 / along ** 2 - 1 / across ** 2);
    const c = dx * dx * (ux * ux / along ** 2 + uy * uy / across ** 2) - 1;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) continue;
    const bottom = cy + (-b + Math.sqrt(discriminant)) / (2 * a);
    terrain[i] = Math.min(WORLD_FLOOR, Math.max(terrain[i], bottom));
  }
  tanks.forEach((t, i) => { t.hp = Math.max(0, t.hp - hits[i]); });
  return hits;
}

export function collapseTerrain(terrain, left, right) {
  const start = Math.max(0, Math.floor(left)), end = Math.min(WIDTH, Math.ceil(right));
  const delta = new Float64Array(end - start + 1);
  // Transfer, rather than delete, soil. Parallel updates avoid left/right bias.
  // Four-pixel neighbours let slides travel visibly without flattening stable hills.
  for (const gap of [1, 4]) for (let x = start; x + gap <= end; x++) {
    const difference = terrain[x + gap] - terrain[x];
    const excess = Math.abs(difference) - gap * .8;
    if (excess <= 0) continue;
    const flow = Math.sign(difference) * Math.min(1.2, excess * .12);
    delta[x - start] += flow;
    delta[x + gap - start] -= flow;
  }
  for (let x = start; x <= end; x++) terrain[x] += delta[x - start];
}

export function breakRocks(before, terrain, impactX, random = Math.random) {
  const rocks = [];
  for (let x = 5; x < WIDTH - 5; x += 7) {
    const depth = terrain[x] - before[x];
    if (depth < 5) continue;
    const radius = 3 + random() * Math.min(6, depth / 5);
    rocks.push({ x, y: before[x] - radius, radius,
      vx: Math.sign(x - impactX) * (15 + random() * 65),
      vy: -25 - random() * 100, angle: random() * Math.PI * 2,
      spin: (random() - .5) * 5, shade: random(), grounded: false });
  }
  return rocks;
}

function wakeRocks(rock) {
  for (const member of rock.sleepGroup || [rock]) {
    member.sleeping = false;
    member.restTime = 0;
    member.sleepGroup = null;
  }
}

export function stepRocks(rocks, terrain, dt) {
  // Advance the whole pile together before resolving its contacts.
  const steps = Math.ceil(dt / (1 / 120)), h = dt / steps;
  const maxRadius = rocks.reduce((max, rock) => Math.max(max, rock.radius), 0);
  const present = new Set(rocks);
  const checked = new Set();
  for (const rock of rocks) {
    if (!rock.sleeping || checked.has(rock.sleepGroup)) continue;
    const group = rock.sleepGroup;
    checked.add(group);
    if (group.some(r => !present.has(r) || Math.abs(terrain[Math.round(r.x)] - r.sleepGround) > .1)) wakeRocks(rock);
  }
  if (rocks.every(rock => rock.sleeping)) return;
  for (let step = 0; step < steps; step++) {
    const parents = new Map(rocks.map(r => [r, r]));
    const root = rock => {
      while (parents.get(rock) !== rock) rock = parents.get(rock);
      return rock;
    };
    for (const rock of rocks) {
      if (rock.sleeping) continue;
      const x = Math.max(4, Math.min(WIDTH - 4, Math.round(rock.x)));
      const slope = (terrain[x + 4] - terrain[x - 4]) / 8;
      const surface = terrain[x] - rock.radius;
      if (rock.grounded && surface - rock.y < 4) {
        rock.vx += 420 * slope / (1 + slope * slope) * h;
        rock.vx *= Math.exp(-2.4 * h);
        if (Math.abs(slope) < .08 && Math.abs(rock.vx) < 2) rock.vx = 0;
        rock.vy = 0;
        rock.x += rock.vx * h;
        rock.y = terrain[Math.max(0, Math.min(WIDTH, Math.round(rock.x)))] - rock.radius;
        rock.angle += rock.vx * h / rock.radius;
      } else {
        rock.grounded = false;
        rock.vy += 420 * h;
        rock.x += rock.vx * h; rock.y += rock.vy * h;
        rock.angle += rock.spin * h;
        const nextX = Math.max(4, Math.min(WIDTH - 4, Math.round(rock.x)));
        const ground = terrain[nextX] - rock.radius;
        if (rock.y >= ground) {
          rock.y = ground;
          const s = (terrain[nextX + 4] - terrain[nextX - 4]) / 8;
          const normalSpeed = (rock.vy - rock.vx * s) / Math.sqrt(1 + s * s);
          if (normalSpeed > 35) {
            const impulse = 1.28 * normalSpeed / Math.sqrt(1 + s * s);
            rock.vx += impulse * s; rock.vy -= impulse;
            rock.vx *= .75; rock.spin *= .7;
          } else {
            rock.grounded = true;
            rock.vx = (rock.vx + rock.vy * s) / (1 + s * s) * .7;
            rock.vy = 0;
          }
        }
      }
      if (rock.x < rock.radius || rock.x > WIDTH - rock.radius) {
        rock.x = Math.max(rock.radius, Math.min(WIDTH - rock.radius, rock.x));
        rock.vx *= -.3;
      }
    }
    // Repeated contacts propagate support up through a pile. A horizontal sweep
    // skips distant pairs, keeping the solver cheap as rubble accumulates.
    for (let pass = 0; pass < 10; pass++) {
      const sorted = [...rocks].sort((a, b) => a.x - b.x);
      for (let i = 0; i < sorted.length; i++) {
        const a = sorted[i];
        for (let j = i + 1; j < sorted.length; j++) {
          const b = sorted[j], dx = b.x - a.x, dy = b.y - a.y;
          if (dx > a.radius + maxRadius + .6) break;
          const distance = Math.hypot(dx, dy), reach = a.radius + b.radius;
          if (distance < reach + .6) parents.set(root(a), root(b));
          if (a.sleeping && b.sleeping) continue;
          if (distance >= reach) continue;
          const nx = distance > .0001 ? dx / distance : 1;
          const ny = distance > .0001 ? dy / distance : 0;
          const speed = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (speed < -12 || reach - distance > .7) {
            if (a.sleeping) wakeRocks(a);
            if (b.sleeping) wakeRocks(b);
          }
          const ma = a.sleeping ? 0 : 1 / a.radius ** 2;
          const mb = b.sleeping ? 0 : 1 / b.radius ** 2, mass = ma + mb;
          const correction = (reach - distance) * .9 / mass;
          a.x -= nx * correction * ma; a.y -= ny * correction * ma;
          b.x += nx * correction * mb; b.y += ny * correction * mb;
          if (speed < 0) {
            const impulse = -speed * (Math.abs(speed) > 40 ? 1.12 : 1) / mass;
            a.vx -= nx * impulse * ma; a.vy -= ny * impulse * ma;
            b.vx += nx * impulse * mb; b.vy += ny * impulse * mb;
            const tangent = (b.vx - a.vx) * -ny + (b.vy - a.vy) * nx;
            const friction = Math.max(-impulse * .65, Math.min(impulse * .65, -tangent / mass));
            a.vx += ny * friction * ma; a.vy -= nx * friction * ma;
            b.vx -= ny * friction * mb; b.vy += nx * friction * mb;
            a.spin *= .96; b.spin *= .96;
          }
        }
      }
      // The terrain must support the bottom layer after each contact pass;
      // otherwise the pile's weight would push those rocks below the surface.
      for (const rock of rocks) {
        if (rock.sleeping) continue;
        rock.x = Math.max(rock.radius, Math.min(WIDTH - rock.radius, rock.x));
        const ground = terrain[Math.round(rock.x)] - rock.radius;
        if (rock.y > ground) {
          rock.y = ground; rock.vy = Math.min(0, rock.vy); rock.grounded = true;
        }
      }
    }
    const groups = new Map();
    for (const rock of rocks) {
      if (!rock.restTime) { rock.restX = rock.x; rock.restY = rock.y; }
      // Measure drift over a window, not individual solver corrections: tiny
      // alternating contact corrections are precisely what sleeping must stop.
      const quiet = Math.hypot(rock.x - rock.restX, rock.y - rock.restY) < 2;
      rock.restTime = quiet ? (rock.restTime || 0) + h : 0;
      const key = root(rock);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(rock);
    }
    for (const group of groups.values()) {
      if (!group.every(r => r.sleeping || r.restTime > .75)) continue;
      for (const rock of group) {
        if (!rock.sleeping) rock.sleepGround = terrain[Math.round(rock.x)];
        rock.sleeping = true; rock.sleepGroup = group;
        rock.vx = 0; rock.vy = 0; rock.spin = 0;
      }
    }
  }
}

export function settleTanks(terrain, tanks, fall, dt) {
  tanks.forEach((tank, i) => {
    const ground = terrain[Math.round(tank.x)];
    fall[i].speed += 420 * dt;
    tank.y = Math.min(ground, tank.y + fall[i].speed * dt);
    if (tank.y === ground) fall[i].speed = 0;
    const damage = Math.max(0, Math.round((tank.y - fall[i].start - 24) * .3));
    if (damage > fall[i].damage) {
      tank.hp = Math.max(0, tank.hp - (damage - fall[i].damage));
      fall[i].damage = damage;
    }
  });
}
