import { weapons } from './physics.js';

// A command can change aim or fire, never supply terrain, damage, or whose turn it is.
export function validCommand(command, state) {
  return command?.type === 'fire' && state.phase === 'aim' && state.active === 1 &&
    command.generation === state.generation && command.round === state.round &&
    Number.isInteger(command.angle) && command.angle >= 5 && command.angle <= 175 &&
    Number.isInteger(command.power) && command.power >= 10 && command.power <= 100 &&
    Object.hasOwn(weapons, command.weapon) && state.tanks[1].ammo[command.weapon] > 0;
}

export function inviteURL(url, id) {
  const invite = new URL(url);
  invite.hash = new URLSearchParams({ join: id }).toString();
  return invite.href;
}

// PeerJS 1.5.5 is vendored locally. Only signaling and STUN use public services;
// match state travels over an encrypted WebRTC data channel, not a game server.
export class OnlineMatch {
  constructor({ onStatus, onReady, onData, onInvite }) {
    Object.assign(this, { onStatus, onReady, onData, onInvite });
    this.ready = false;
    this.player = 0;
  }

  start(joinID, Peer = globalThis.Peer) {
    this.stop();
    this.player = joinID ? 1 : 0;
    this.onStatus(joinID ? 'Joining your friend…' : 'Creating your invite…');
    if (!Peer) { this.fail('Online play could not load. Reload the page to try again.'); return; }
    const peer = this.peer = new Peer(undefined, {
      secure: true,
      config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
    });
    this.timeout = setTimeout(() => this.fail('Connection timed out. Try another network or create a new invite.'), 25000);
    peer.on('open', id => {
      if (this.peer !== peer) return;
      // Binary serialization chunks battlefield snapshots past the channel's MTU.
      if (joinID) this.attach(peer.connect(joinID, { reliable: true, serialization: 'binary', metadata: { afterburn: 1 } }));
      else {
        clearTimeout(this.timeout);
        this.onInvite(id);
        this.onStatus('You are Player 01. Share the link and wait for Player 02.');
      }
    });
    peer.on('connection', connection => {
      if (this.peer !== peer || this.player !== 0 || this.connection || connection.metadata?.afterburn !== 1) {
        connection.on('open', () => { connection.send({ type: 'unavailable' }); setTimeout(() => connection.close(), 250); });
        return;
      }
      this.timeout = setTimeout(() => this.fail('Your opponent could not connect. Try another network or a new invite.'), 25000);
      this.attach(connection);
    });
    peer.on('error', error => {
      if (this.peer !== peer) return;
      // Losing signaling does not interrupt an established direct connection.
      if (this.ready && ['network', 'socket-error', 'socket-closed', 'server-error'].includes(error.type)) return;
      this.fail(error.type === 'peer-unavailable' ? 'This invite has expired. Ask your friend for a new link.' : 'Unable to connect. Try another network or create a new invite.');
    });
    peer.on('disconnected', () => {
      if (this.peer === peer && !this.ready) this.fail('Signaling disconnected. Try again to create or join a match.');
    });
  }

  attach(connection) {
    this.connection = connection;
    connection.on('open', () => {
      if (this.connection !== connection) return;
      clearTimeout(this.timeout);
      this.ready = true;
      this.lastReceived = Date.now();
      this.onStatus(`Connected · You are Player 0${this.player + 1}. ${this.player ? 'Player 01 starts and controls rematches.' : 'You start and control rematches.'}`);
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastReceived > 30000) this.fail('Connection lost. Start a new match to play again.');
        else this.send({ type: 'ping' });
      }, 2000);
      this.onReady(true);
    });
    connection.on('data', data => {
      if (this.connection !== connection) return;
      this.lastReceived = Date.now();
      if (data?.type === 'unavailable') { this.fail('This match is full or incompatible. Ask your friend for a new invite.'); return; }
      if (data?.type !== 'ping') this.onData(data);
    });
    connection.on('close', () => {
      if (this.connection === connection) this.fail('Your opponent disconnected. Start a new match to play again.');
    });
    connection.on('error', () => {
      if (this.connection === connection) this.fail('The direct connection failed. Try another network or a new invite.');
    });
  }

  send(data) {
    if (!this.ready || !this.connection?.open) return false;
    // Drop replaceable snapshots instead of accumulating a stale battlefield.
    if (data.type === 'state' && (this.connection.bufferSize > 0 || this.connection.dataChannel?.bufferedAmount > 65536)) return false;
    try { this.connection.send(data); return true; }
    catch { this.fail('Connection lost. Start a new match to play again.'); return false; }
  }

  fail(message) {
    this.stop();
    this.onStatus(message, true);
    this.onReady(false);
  }

  stop() {
    this.ready = false;
    clearTimeout(this.timeout);
    clearInterval(this.heartbeat);
    const peer = this.peer;
    this.peer = null;
    this.connection = null;
    peer?.destroy();
  }
}
