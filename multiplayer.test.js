import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { OnlineMatch, inviteURL, validCommand } from './multiplayer.js';

test('invite preserves the static hosting path and keeps the room out of HTTP requests', () => {
  const url = new URL(inviteURL('https://awsteele.com/tankgame/?test=1#old', 'room-123'));
  assert.equal(url.href, 'https://awsteele.com/tankgame/?test=1#join=room-123');
  assert.equal(new URLSearchParams(url.hash.slice(1)).get('join'), 'room-123');
});

test('only current, in-range guest fire commands with available ammo are accepted', () => {
  const state = { phase: 'aim', active: 1, generation: 7, round: 3, tanks: [{}, { ammo: { shell: Infinity, heavy: 1, cluster: 0 } }] };
  const command = { type: 'fire', generation: 7, round: 3, angle: 147, power: 83, weapon: 'heavy' };
  assert.equal(validCommand(command, state), true);
  for (const patch of [null, {type: 'reset'}, {generation: 6}, {round: 2}, {round: 4}, {angle: 4}, {angle: 176}, {angle: 45.5}, {angle: '45'}, {power: 9}, {power: 101}, {power: NaN}, {weapon: 'cluster'}, {weapon: 'toString'}, {weapon: 'unknown'}]) {
    assert.equal(validCommand(patch === null ? null : {...command, ...patch}, state), false, JSON.stringify(patch));
  }
  for (const patch of [{phase: 'flight'}, {phase: 'settle'}, {phase: 'over'}, {active: 0}]) assert.equal(validCommand(command, {...state, ...patch}), false);
  for (const [angle, power] of [[5, 10], [175, 100]]) assert.equal(validCommand({...command, angle, power, weapon: 'shell'}, state), true);
});

class Connection extends EventEmitter {
  metadata = { afterburn: 1 };
  sent = [];
  open = false;
  send(data) { this.sent.push(data); }
  close() { this.open = false; this.emit('close'); }
  connect() { this.open = true; this.emit('open'); }
}
class Peer extends EventEmitter {
  connect(id, options) { this.target = id; this.options = options; return this.outgoing = new Connection(); }
  destroy() { this.destroyed = true; this.emit('disconnected'); this.outgoing?.close(); }
}
function match(t) {
  const events = { status: [], ready: [], data: [], invites: [] };
  const online = new OnlineMatch({ onStatus: (...args) => events.status.push(args), onReady: value => events.ready.push(value), onData: data => events.data.push(data), onInvite: id => events.invites.push(id) });
  t.after(() => online.stop());
  return { online, events };
}

test('host invites, accepts exactly one opponent, and ignores stale events after leaving', t => {
  const {online, events} = match(t);
  online.start(null, Peer);
  const peer = online.peer;
  peer.emit('open', 'host-id');
  assert.deepEqual(events.invites, ['host-id']);
  assert.equal(online.ready, false);
  const first = new Connection();
  peer.emit('connection', first); first.connect();
  assert.equal(online.ready, true);
  const third = new Connection();
  peer.emit('connection', third); third.connect();
  assert.deepEqual(third.sent, [{type: 'unavailable'}]);
  assert.equal(online.connection, first);
  first.emit('data', {type: 'fire'});
  assert.deepEqual(events.data, [{type: 'fire'}]);
  online.stop();
  first.emit('data', {type: 'fire'}); first.close(); peer.emit('open', 'stale');
  assert.equal(events.data.length, 1);
  assert.deepEqual(events.ready, [true]);
  assert.deepEqual(events.invites, ['host-id']);
  assert.equal(peer.destroyed, true);
});

test('guest connects using compatible protocol and freezes on disconnect', t => {
  const {online, events} = match(t);
  online.start('friend-id', Peer);
  const peer = online.peer;
  peer.emit('open', 'guest-id');
  assert.equal(online.player, 1);
  assert.equal(peer.target, 'friend-id');
  assert.equal(peer.options.serialization, 'binary', 'large crater/cluster snapshots require chunking');
  assert.deepEqual(peer.options.metadata, {afterburn: 1});
  peer.outgoing.connect();
  peer.emit('disconnected');
  assert.equal(online.ready, true, 'established data channel survives signaling loss');
  peer.outgoing.emit('data', {type: 'ping'});
  assert.deepEqual(events.data, []);
  peer.outgoing.close();
  assert.equal(online.ready, false);
  assert.deepEqual(events.ready, [true, false]);
  assert.match(events.status.at(-1)[0], /disconnected/);
  assert.equal(online.send({type: 'fire'}), false);
});

test('expired invites and full matches produce retryable errors', t => {
  const {online, events} = match(t);
  online.start('expired', Peer);
  online.peer.emit('error', {type: 'peer-unavailable'});
  assert.match(events.status.at(-1)[0], /expired/);
  assert.equal(events.status.at(-1)[1], true);
  online.start('full', Peer);
  online.peer.emit('open', 'guest');
  online.connection.connect();
  online.connection.emit('data', {type: 'unavailable'});
  assert.match(events.status.at(-1)[0], /full/);
  assert.equal(online.ready, false);
});

test('slow links discard replaceable snapshots, not fire commands', t => {
  const {online} = match(t);
  online.start('host', Peer); online.peer.emit('open', 'guest'); online.connection.connect();
  const connection = online.connection;
  connection.dataChannel = { bufferedAmount: 100000 };
  assert.equal(online.send({type: 'state'}), false);
  assert.equal(online.send({type: 'fire'}), true);
  connection.dataChannel.bufferedAmount = 0;
  assert.equal(online.send({type: 'state'}), true);
  assert.deepEqual(connection.sent.map(data => data.type), ['fire', 'state']);
});

test('unanswered joins time out and release their peer', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const {online, events} = match(t);
  online.start('unreachable', Peer);
  const peer = online.peer;
  t.mock.timers.tick(25000);
  assert.equal(peer.destroyed, true);
  assert.equal(online.ready, false);
  assert.match(events.status.at(-1)[0], /timed out/);
});
