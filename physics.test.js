import test from 'node:test';
import assert from 'node:assert/strict';
import { WIDTH, makeTerrain, launch, stepShot, explode } from './physics.js';
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
test('blast carves a circular crater, hurts nearby tanks, and leaves distant ground intact', () => {
  const terrain=Array(WIDTH+1).fill(400), tanks=[{x:400,y:400,hp:100},{x:900,y:400,hp:100}];
  const hits=explode(terrain,tanks,400,400,'shell');
  assert.equal(terrain[400],445);assert.equal(terrain[373],436);assert.equal(terrain[446],400);
  assert.equal(hits[0],52);assert.equal(tanks[0].hp,48);assert.equal(tanks[0].y,445);assert.equal(tanks[1].hp,100);
});
test('wind changes flight and all trajectories terminate', () => {
  const terrain=makeTerrain(5), t={x:200,y:terrain[200]};
  const a=launch(t,70,100), b=launch(t,70,100);
  for(let i=0;i<100;i++){stepShot(a,.01,-4,terrain);stepShot(b,.01,4,terrain);}assert.ok(b.x>a.x+30);
  let count=0;while(!stepShot(b,1/120,4,terrain)&&count<2000)count++;assert.ok(count<2000);
});
