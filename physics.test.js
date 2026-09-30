import test from 'node:test';
import assert from 'node:assert/strict';
import { WIDTH, HEIGHT, WORLD_FLOOR, makeTerrain, launch, stepShot, splitCluster, explode, collapseTerrain, settleTanks, breakRocks, stepRocks, cameraScale } from './physics.js';
test('launch follows angle and power, with left and right aiming', () => {
  const t={x:200,y:400}; const right=launch(t,30,70), left=launch(t,150,70);
  assert.ok(right.vx>0 && left.vx<0); assert.ok(Math.abs(right.vy-left.vy)<1e-9);
  assert.ok(Math.abs(right.vy+259)<1e-9); assert.ok(right.y<400);
});
test('walls reflect shots inward on both boundaries', () => {
  const terrain=Array(WIDTH+1).fill(500);
  for(const [x,vx,sign] of [[4,-100,1],[WIDTH-4,100,-1]]){
    const s={x,y:100,vx,vy:0,age:1};assert.equal(stepShot(s,.1,0,terrain),false);
    assert.equal(Math.sign(s.vx),sign);assert.ok(s.x>0&&s.x<WIDTH);
  }
});
test('shots cross the old roof without bouncing, including at a side wall', () => {
  const terrain=Array(WIDTH+1).fill(500);
  const s={x:200,y:4,vx:80,vy:-126,age:1};
  assert.equal(stepShot(s,.1,0,terrain),false);
  assert.equal(s.x,208);assert.equal(s.y,-6);assert.equal(s.vx,80);assert.equal(s.vy,-100);
  const down={x:200,y:4,vx:80,vy:100,age:1};
  stepShot(down,.1,0,terrain);assert.equal(down.vy,126);assert.equal(down.y,16.6);
  const corner={x:4,y:4,vx:-100,vy:-126,age:1};
  stepShot(corner,.1,0,terrain);assert.equal(corner.vx,85);assert.equal(corner.vy,-100);
});
test('camera smoothly follows a full high arc at different frame rates, then returns home', () => {
  for(const fps of [30,60,144]) {
    const terrain=Array(WIDTH+1).fill(450), s=launch({x:500,y:450},85,100);
    let zoom=1, smallest=1, highest=450, hit=false, zoomedIn=false;
    for(let i=0;i<fps*10&&!hit;i++){
      for(let j=0;j<4&&!hit;j++)hit=stepShot(s,1/fps/4,0,terrain);
      const prior=zoom;zoom=cameraScale(zoom,s,1/fps);
      assert.ok(Math.abs(zoom-prior)<.05,'no zoom jumps');
      const screenY=HEIGHT+(s.y-HEIGHT)*zoom;
      assert.ok(screenY>65&&screenY<HEIGHT,'shell stays in frame with margin');
      smallest=Math.min(smallest,zoom);highest=Math.min(highest,s.y);
      if(s.vy>0&&zoom>prior)zoomedIn=true;
    }
    assert.ok(hit&&highest<-500&&smallest<.5&&zoomedIn);
    for(let i=0;i<fps;i++)zoom=cameraScale(zoom,null,1/fps);
    assert.ok(zoom>.999);
  }
  assert.equal(cameraScale(1,{y:300,vy:-100},1/60),1,'low shots leave camera alone');
});
test('vertical blast digs deep, damages nearby tanks, and leaves distant ground intact', () => {
  const terrain=Array(WIDTH+1).fill(400), tanks=[{x:400,y:400,hp:100},{x:900,y:400,hp:100}];
  const hits=explode(terrain,tanks,400,400,'shell');
  assert.equal(terrain[400],476.5);assert.equal(terrain[432],400);
  assert.equal(hits[0],46);assert.equal(tanks[0].hp,54);assert.equal(tanks[0].y,400);assert.equal(tanks[1].hp,100);
});
test('wind changes flight and all trajectories terminate', () => {
  const terrain=makeTerrain(5), t={x:200,y:terrain[200]};
  const a=launch(t,70,100), b=launch(t,70,100);
  for(let i=0;i<100;i++){stepShot(a,.01,-4,terrain);stepShot(b,.01,4,terrain);}assert.ok(b.x>a.x+30);
  let count=0;while(!stepShot(b,1/120,4,terrain)&&count<2000)count++;assert.ok(count<2000);
});

test('shallow impacts gouge wider and shallower, in the direction of travel', () => {
  const steep=Array(WIDTH+1).fill(350), low=steep.slice(), reverse=steep.slice();
  explode(steep,[],700,350,'heavy',{vx:0,vy:500});
  explode(low,[],700,350,'heavy',{vx:500,vy:60});
  explode(reverse,[],700,350,'heavy',{vx:-500,vy:60});
  assert.ok(Math.max(...steep)>Math.max(...low)+50);
  assert.ok(low.filter(y=>y>350).length>steep.filter(y=>y>350).length*1.5);
  assert.ok(low[770]>low[630]+20);
  for(let x=0;x<=WIDTH;x++) assert.ok(Math.abs(low[x]-reverse[WIDTH-x])<1e-8);
});

test('collapse lowers crater rims, deposits soil, conserves volume, and stays local', () => {
  const terrain=Array(WIDTH+1).fill(350);
  explode(terrain,[],700,350,'heavy');
  const before=terrain.slice(), volume=terrain.reduce((a,b)=>a+b,0);
  for(let i=0;i<240;i++) collapseTerrain(terrain,500,900);
  assert.ok(terrain[648]>before[648]+5, 'rim must fall');
  assert.ok(terrain[660]<before[660]-5, 'soil must accumulate inside crater');
  assert.ok(Math.abs(terrain.reduce((a,b)=>a+b,0)-volume)<1e-6);
  assert.deepEqual(terrain.slice(0,500),before.slice(0,500));
  for(let x=500;x<=900;x++) assert.ok(Math.abs(terrain[x]-terrain[WIDTH-x])<1e-8);
  assert.ok(terrain.every(Number.isFinite));
});

test('stable slopes do not collapse and edge blasts remain bounded', () => {
  const stable=Array.from({length:WIDTH+1},(_,x)=>300+x*.1), before=stable.slice();
  collapseTerrain(stable,0,WIDTH);assert.deepEqual(stable,before);
  for(const x of [0,WIDTH]){
    const terrain=Array(WIDTH+1).fill(550);
    explode(terrain,[],x,550,'quake',{vx:x?500:-500,vy:80});
    for(let i=0;i<240;i++)collapseTerrain(terrain,x-288,x+288);
    assert.ok(terrain.every(y=>Number.isFinite(y)&&y>=550&&y<=WORLD_FLOOR));
  }
});

test('fall damage accumulates across small steps, without charging twice or hurting rising tanks', () => {
  const terrain=Array(WIDTH+1).fill(460), tanks=[{x:100,y:400,hp:100},{x:900,y:500,hp:80}];
  const fall=tanks.map(t=>({start:t.y,damage:0,speed:0}));
  for(let i=0;i<240;i++)settleTanks(terrain,tanks,fall,1/120);
  assert.equal(tanks[0].y,460);assert.equal(tanks[0].hp,89);assert.equal(tanks[1].hp,80);
  for(let i=0;i<240;i++)settleTanks(terrain,tanks,fall,1/120);
  assert.equal(tanks[0].hp,89);
});

test('repeated excavation passes the old floor but stops at deep bedrock', () => {
  const terrain = Array(WIDTH + 1).fill(400);
  explode(terrain, [], 700, 400, 'bunker');
  assert.equal(terrain[700], 669.75);
  assert.equal(terrain[750], 400, 'deep weapon remains narrow');
  for (let i = 0; i < 10; i++) explode(terrain, [], 700, terrain[700], 'bunker');
  assert.equal(terrain[700], 1800);
  assert.ok(terrain.every(y => y <= 1800));
  const shot = {x:700,y:700,vx:0,vy:100,age:1};
  assert.equal(stepShot(shot, .1, 0, terrain), false, 'shell travels below old screen bottom');
  let zoom = 1;
  for (let i = 0; i < 120; i++) zoom = cameraScale(zoom, null, 1/60, 1855);
  assert.ok(Math.abs(zoom - 520/1755) < 1e-8);
  assert.ok(HEIGHT + (1800 - 1855) * zoom < HEIGHT - 15);
});

test('cluster splits only at apex, spreads into five independent landing sites, and never splits again', () => {
  const parent = {x:700,y:40,vx:45,vy:-1,age:2,weapon:'cluster'};
  assert.equal(splitCluster(parent), null);
  parent.vy = 0;
  const children = splitCluster(parent);
  assert.equal(children.length, 5);
  assert.deepEqual(children.map(s => s.vx), [-85,-20,45,110,175]);
  const terrain = Array(WIDTH + 1).fill(450);
  const landings = children.map(s => {
    for (let i = 0; i < 2000; i++) if (stepShot(s, 1/120, 0, terrain)) break;
    assert.ok(s.y >= 450 && s.age < 16);
    assert.equal(splitCluster(s), null);
    return s.x;
  });
  assert.ok(landings[4] - landings[0] > 400);
  assert.equal(new Set(landings.map(Math.round)).size, 5);
  assert.equal(parent.x, 700, 'children cannot mutate parent');
  assert.equal(splitCluster({...parent, weapon:'shell'}), null);
});

test('rocks break only from removed earth and launch away from impact', () => {
  const before=Array(WIDTH+1).fill(350), terrain=before.slice();
  assert.deepEqual(breakRocks(before,terrain,700),[]);
  explode(terrain,[],700,350,'heavy');
  const rocks=breakRocks(before,terrain,700,()=>.5);
  assert.ok(rocks.length>10);
  for(const r of rocks){
    assert.ok(terrain[r.x]-before[r.x]>=5);
    assert.equal(Math.sign(r.vx),Math.sign(r.x-700));assert.ok(r.vy<0);
    assert.equal(r.y+r.radius,350);
  }
});

test('rocks slide downhill on both crater walls and stop on a flat floor', () => {
  const terrain=Array.from({length:WIDTH+1},(_,x)=>500-Math.max(0,Math.abs(x-700)-35)*.6);
  const rocks=[620,780].map(x=>({x,y:terrain[x]-5,radius:5,vx:0,vy:0,angle:0,spin:0,grounded:true}));
  for(let i=0;i<120;i++)stepRocks(rocks,terrain,1/120);
  assert.ok(rocks[0].x>650);assert.ok(rocks[1].x<750);
  for(let i=0;i<2400;i++)stepRocks(rocks,terrain,1/120);
  for(const r of rocks){assert.ok(Math.abs(r.x-700)<35);assert.equal(r.vx,0);assert.equal(r.y,495);}
});

test('falling rocks bounce, settle, and fall again when their support is removed', () => {
  const terrain=Array(WIDTH+1).fill(400);
  const r={x:500,y:393,radius:5,vx:0,vy:160,angle:0,spin:2,grounded:false};
  stepRocks([r],terrain,.02);assert.ok(r.vy<0);
  for(let i=0;i<600;i++)stepRocks([r],terrain,1/120);
  assert.equal(r.y,395);assert.equal(r.grounded,true);
  terrain.fill(470);stepRocks([r],terrain,.03);
  assert.equal(r.grounded,false);assert.ok(r.y>395&&r.y<465);
});

test('unequal rocks collide and transfer momentum rather than pass through each other', () => {
  const terrain=Array(WIDTH+1).fill(600);
  const a={x:500,y:200,radius:8,vx:80,vy:0,angle:0,spin:0,grounded:false};
  const b={...a,x:513,radius:5,vx:-20};
  stepRocks([a,b],terrain,1/120);
  assert.ok(b.vx>0);assert.ok(a.vx<80);
  assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>12.9);
  assert.ok(Math.abs(64*a.vx+25*b.vx-(64*80-25*20))<1e-6);
});

test('mixed-size rubble forms a supported, non-overlapping pile and collapses when excavated', () => {
  const terrain=Array.from({length:WIDTH+1},(_,x)=>500-Math.max(0,Math.abs(x-700)-20)*1.5);
  const rocks=Array.from({length:30},(_,i)=>({x:679+(i%6)*8.1,y:340-Math.floor(i/6)*18,
    radius:5+i%4,vx:0,vy:0,angle:0,spin:0,grounded:false}));
  for(let i=0;i<1200;i++)stepRocks(rocks,terrain,1/120);
  assert.ok(rocks.filter(r=>terrain[Math.round(r.x)]-r.y-r.radius>8).length>8,'rocks must rest on other rocks');
  for(let i=0;i<rocks.length;i++){
    const a=rocks[i];assert.ok(a.y+a.radius<=terrain[Math.round(a.x)]+.1);
    for(let j=i+1;j<rocks.length;j++){
      const b=rocks[j];assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>=a.radius+b.radius-.6,'pile cannot overlap');
    }
  }
  const before=rocks.map(r=>({x:r.x,y:r.y,angle:r.angle}));
  for(let i=0;i<120;i++)stepRocks(rocks,terrain,1/120);
  assert.deepEqual(rocks.map(r=>({x:r.x,y:r.y,angle:r.angle})),before,'settled pile must be completely still');
  terrain.fill(580);
  for(let i=0;i<240;i++)stepRocks(rocks,terrain,1/120);
  assert.ok(rocks.reduce((sum,r,i)=>sum+r.y-before[i].y,0)/rocks.length>30,'unsupported pile must fall');
});

test('sleeping rocks wake on incoming impacts and removal of a supporting rock', () => {
  const terrain=Array(WIDTH+1).fill(500);
  const lower={x:700,y:492,radius:8,vx:0,vy:0,angle:0,spin:0,grounded:true};
  const upper={...lower,y:476,grounded:false};
  for(let i=0;i<240;i++)stepRocks([lower,upper],terrain,1/120);
  assert.ok(lower.sleeping&&upper.sleeping);
  stepRocks([upper],terrain,1/60);
  assert.equal(upper.sleeping,false);assert.ok(upper.y>476);
  const incoming={...lower,x:682,vx:180,sleeping:false,sleepGroup:null,restTime:0};
  for(let i=0;i<240;i++)stepRocks([lower],terrain,1/120);
  assert.ok(lower.sleeping);
  for(let i=0;i<8;i++)stepRocks([lower,incoming],terrain,1/120);
  assert.equal(lower.sleeping,false);assert.ok(lower.x>700);
});
