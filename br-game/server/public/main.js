const socket = io();

let selfId = null;
let lastSeq = 0;
let knownPlayers = new Map(); // id -> sprite/state
let zone = { x: 0, y: 0, radius: 1000 };
let shotFx = [];

class BRScene extends Phaser.Scene {
  constructor() {
    super('br');
  }

  preload() {}

  create() {
    this.cameras.main.setBackgroundColor(0x0b0f16);
    this.worldSize = 2048;

    this.playerGraphics = this.add.graphics();
    this.otherGraphics = this.add.graphics();
    this.fxGraphics = this.add.graphics();
    this.zoneGraphics = this.add.graphics();

    socket.on('init', (data) => {
      selfId = data.self.id;
      knownPlayers.set(data.self.id, { ...data.self });
      for (const p of data.others) knownPlayers.set(p.id, { ...p });
      if (data.zone) zone = data.zone;
      document.getElementById('hud').textContent = `Players: ${knownPlayers.size}`;
    });

    socket.on('player:join', (p) => {
      knownPlayers.set(p.id, { ...p });
      document.getElementById('hud').textContent = `Players: ${knownPlayers.size}`;
    });

    socket.on('player:leave', ({ id }) => {
      if (id) knownPlayers.delete(id);
      document.getElementById('hud').textContent = `Players: ${knownPlayers.size}`;
    });

    socket.on('state', (snapshot) => {
      for (const p of snapshot.players) {
        const existing = knownPlayers.get(p.id);
        if (existing && p.id === selfId) {
          // client-side prediction reconciliation could go here
        }
        knownPlayers.set(p.id, { ...existing, ...p });
      }
      if (snapshot.zone) zone = snapshot.zone;
      const me = knownPlayers.get(selfId);
      if (me) {
        document.getElementById('hud').textContent = `Players: ${knownPlayers.size} | HP: ${Math.round(me.hp ?? 0)} | Zone r: ${Math.round(zone.radius ?? 0)}`;
      }
      this.renderPlayers();
    });

    socket.on('effect:shot', ({ from, to, hitId }) => {
      shotFx.push({ from, to, t: 0, hit: Boolean(hitId) });
    });

    socket.on('player:down', ({ id }) => {
      const p = knownPlayers.get(id);
      if (p) p.alive = false;
    });

    socket.on('player:respawn', ({ id, x, y }) => {
      const p = knownPlayers.get(id);
      if (p) { p.alive = true; p.hp = 100; p.x = x; p.y = y; }
    });

    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys('W,A,S,D');
  }

  update(_, dtMs) {
    if (!selfId) return;
    const dt = dtMs / 1000;

    const up = this.cursors.up.isDown || this.keys.W.isDown;
    const down = this.cursors.down.isDown || this.keys.S.isDown;
    const left = this.cursors.left.isDown || this.keys.A.isDown;
    const right = this.cursors.right.isDown || this.keys.D.isDown;
    const pointer = this.input.activePointer;
    const rot = Math.atan2(pointer.worldY - this.scale.height/2, pointer.worldX - this.scale.width/2);

    socket.emit('input', { up, down, left, right, rot, seq: ++lastSeq });

    if (pointer.isDown && pointer.leftButtonDown()) {
      socket.emit('shoot', { rot, seq: ++lastSeq });
    }

    // update transient shot effects
    shotFx = shotFx.filter(fx => {
      fx.t += dt;
      return fx.t < 0.08;
    });
  }

  renderPlayers() {
    this.playerGraphics.clear();
    this.otherGraphics.clear();
    this.fxGraphics.clear();
    this.zoneGraphics.clear();

    for (const p of knownPlayers.values()) {
      const isSelf = p.id === selfId;
      const g = isSelf ? this.playerGraphics : this.otherGraphics;
      const color = isSelf ? 0x3ccf4e : 0x5aa9e6;
      g.fillStyle(color, 1);
      g.save();
      g.translate(this.scale.width/2, this.scale.height/2);

      // naive: render all players relative to self as centered
      const self = knownPlayers.get(selfId);
      const dx = p.x - self.x;
      const dy = p.y - self.y;
      g.translate(dx, dy);
      g.rotate(p.rot || 0);
      if (p.alive !== false) {
        g.fillTriangle(-12, -8, -12, 8, 16, 0);
      } else {
        g.fillStyle(0x9b2226, 1);
        g.fillCircle(0, 0, 8);
      }
      g.restore();
    }

    // zone (relative to self)
    const self = knownPlayers.get(selfId);
    if (self && zone) {
      this.zoneGraphics.save();
      this.zoneGraphics.translate(this.scale.width/2 + (zone.x - self.x), this.scale.height/2 + (zone.y - self.y));
      this.zoneGraphics.lineStyle(2, 0xffc300, 0.8);
      this.zoneGraphics.strokeCircle(0, 0, zone.radius);
      this.zoneGraphics.restore();
    }

    // shot effects
    for (const fx of shotFx) {
      this.fxGraphics.save();
      const me = knownPlayers.get(selfId);
      const from = { x: fx.from.x - me.x + this.scale.width/2, y: fx.from.y - me.y + this.scale.height/2 };
      const to = { x: fx.to.x - me.x + this.scale.width/2, y: fx.to.y - me.y + this.scale.height/2 };
      this.fxGraphics.lineStyle(2, fx.hit ? 0xff595e : 0x94d2bd, 1);
      this.fxGraphics.beginPath();
      this.fxGraphics.moveTo(from.x, from.y);
      this.fxGraphics.lineTo(to.x, to.y);
      this.fxGraphics.strokePath();
      this.fxGraphics.restore();
    }
  }
}

const config = {
  type: Phaser.AUTO,
  parent: document.body,
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: '#0b0f16',
  physics: { default: 'arcade' },
  scene: [BRScene],
};

new Phaser.Game(config);
