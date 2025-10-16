import Phaser from 'phaser';

export class GameScene extends Phaser.Scene {
  private player!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key };
  private bullets!: Phaser.Physics.Arcade.Group;
  private lastFired = 0;
  private enemies!: Phaser.Physics.Arcade.Group;
  private safeCircle!: Phaser.GameObjects.Graphics;
  private safeCenter!: Phaser.Math.Vector2;
  private safeRadius = 500;
  private shrinkRate = 5; // pixels per second
  private hp = 100;
  private hpText!: Phaser.GameObjects.Text;
  private aliveText!: Phaser.GameObjects.Text;
  private messageText!: Phaser.GameObjects.Text;
  private ground!: Phaser.GameObjects.TileSprite;
  private medkits!: Phaser.Physics.Arcade.Group;
  private ammoPacks!: Phaser.Physics.Arcade.Group;
  private ammo = 200;
  private ammoText!: Phaser.GameObjects.Text;

  constructor() {
    super('GameScene');
  }

  preload() {
    // No external assets; generate simple textures at runtime
  }

  create() {
    this.createGeneratedTextures();

    const worldSize = 3000;
    this.physics.world.setBounds(0, 0, worldSize, worldSize);

    this.ground = this.add.tileSprite(worldSize / 2, worldSize / 2, worldSize, worldSize, 'tile');

    this.player = this.physics.add
      .sprite(worldSize / 2, worldSize / 2, 'player')
      .setCollideWorldBounds(true)
      .setCircle(12, 4, 4);

    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
    this.cameras.main.setZoom(1.2);

    const keyboard = this.input.keyboard!;
    this.cursors = keyboard.createCursorKeys();
    this.wasd = keyboard.addKeys('W,A,S,D') as unknown as typeof this.wasd;

    this.bullets = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Image,
      maxSize: 120,
      runChildUpdate: true,
    });

    this.enemies = this.physics.add.group({
      classType: Phaser.Physics.Arcade.Sprite,
      runChildUpdate: true,
    });

    for (let i = 0; i < 20; i += 1) {
      const enemy = this.enemies.create(
        Phaser.Math.Between(200, worldSize - 200),
        Phaser.Math.Between(200, worldSize - 200),
        'enemy'
      ) as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
      enemy.setCollideWorldBounds(true).setCircle(12, 4, 4);
      enemy.setData('hp', 50);
    }

    this.safeCenter = new Phaser.Math.Vector2(worldSize / 2, worldSize / 2);
    this.safeCircle = this.add.graphics();
    this.drawSafeZone();

    this.hpText = this.add.text(16, 16, 'HP: 100', { fontSize: '18px', color: '#ffffff', fontFamily: 'monospace' }).setScrollFactor(0);
    this.aliveText = this.add
      .text(16, 40, `Alive: ${this.enemies.getChildren().length + 1}`, { fontSize: '18px', color: '#ffffff', fontFamily: 'monospace' })
      .setScrollFactor(0);
    this.ammoText = this.add.text(16, 64, `Ammo: ${this.ammo}`, { fontSize: '18px', color: '#ffffff', fontFamily: 'monospace' }).setScrollFactor(0);
    this.messageText = this.add.text(0, 0, 'WASD/Arrows to move, Mouse to aim/shoot', { fontSize: '20px', color: '#ffffff', fontFamily: 'monospace' }).setScrollFactor(0);
    this.messageText.setPosition(this.scale.width / 2 - this.messageText.width / 2, 80);

    this.input.on('pointerdown', () => this.shoot());

    this.physics.add.overlap(this.bullets, this.enemies, (b, e) => {
      const bullet = b as Phaser.Physics.Arcade.Image;
      const enemy = e as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
      bullet.destroy();
      enemy.setData('hp', (enemy.getData('hp') as number) - 25);
      if ((enemy.getData('hp') as number) <= 0) {
        enemy.destroy();
        this.aliveText.setText(`Alive: ${this.enemies.getChildren().length + 1}`);
        if (this.enemies.getChildren().length === 0) {
          this.showMessage('Victory! Press R to restart');
          this.scene.pause();
          this.input.keyboard!.once('keydown-R', () => this.scene.restart());
        }
      }
    });

    this.physics.add.overlap(this.player, this.enemies, () => {
      this.damagePlayer(15);
    });
    this.physics.add.overlap(this.player, this.bullets, (p, b) => {
      const bullet = b as Phaser.Physics.Arcade.Image;
      if (bullet.tintTopLeft === 0xff6b6b) {
        bullet.destroy();
        this.damagePlayer(20);
      }
    });

    // Loot groups
    this.medkits = this.physics.add.group({ classType: Phaser.Physics.Arcade.Image });
    this.ammoPacks = this.physics.add.group({ classType: Phaser.Physics.Arcade.Image });
    for (let i = 0; i < 10; i += 1) {
      const mk = this.medkits.create(
        Phaser.Math.Between(100, worldSize - 100),
        Phaser.Math.Between(100, worldSize - 100),
        'medkit'
      ) as Phaser.Physics.Arcade.Image;
      mk.setImmovable(true);
      const am = this.ammoPacks.create(
        Phaser.Math.Between(100, worldSize - 100),
        Phaser.Math.Between(100, worldSize - 100),
        'ammo'
      ) as Phaser.Physics.Arcade.Image;
      am.setImmovable(true);
    }
    this.physics.add.overlap(this.player, this.medkits, (_p, m) => {
      (m as Phaser.Physics.Arcade.Image).destroy();
      this.hp = Math.min(100, this.hp + 30);
      this.hpText.setText(`HP: ${Math.round(this.hp)}`);
    });
    this.physics.add.overlap(this.player, this.ammoPacks, (_p, a) => {
      (a as Phaser.Physics.Arcade.Image).destroy();
      this.ammo = Math.min(400, this.ammo + 50);
      this.ammoText.setText(`Ammo: ${this.ammo}`);
    });
  }

  private createGeneratedTextures() {
    const g = this.add.graphics();

    // Ground tile 64x64 with subtle grid
    g.fillStyle(0x222a33, 1);
    g.fillRect(0, 0, 64, 64);
    g.lineStyle(2, 0x1c232b, 1);
    g.strokeRect(1, 1, 62, 62);
    g.lineStyle(1, 0x2d3844, 1);
    for (let i = 8; i < 64; i += 8) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 64);
      g.strokePath();
      g.beginPath();
      g.moveTo(0, i);
      g.lineTo(64, i);
      g.strokePath();
    }
    g.generateTexture('tile', 64, 64);
    g.clear();

    // Player: cyan triangle pointing right
    g.fillStyle(0x40e0b0, 1);
    g.beginPath();
    g.moveTo(28, 16);
    g.lineTo(6, 6);
    g.lineTo(6, 26);
    g.closePath();
    g.fillPath();
    g.generateTexture('player', 32, 32);
    g.clear();

    // Enemy: red circle
    g.fillStyle(0xff4d4f, 1);
    g.fillCircle(16, 16, 12);
    g.generateTexture('enemy', 32, 32);
    g.clear();

    // Bullet: yellow rectangle
    g.fillStyle(0xffd166, 1);
    g.fillRect(0, 0, 12, 4);
    g.generateTexture('bullet', 12, 4);
    g.clear();

    // Medkit: green cross
    g.fillStyle(0x2ecc71, 1);
    g.fillRect(6, 0, 12, 24);
    g.fillRect(0, 6, 24, 12);
    g.generateTexture('medkit', 24, 24);
    g.clear();

    // Ammo pack: blue box
    g.fillStyle(0x3498db, 1);
    g.fillRect(0, 0, 22, 16);
    g.lineStyle(2, 0x1f5a82, 1);
    g.strokeRect(1, 1, 20, 14);
    g.generateTexture('ammo', 22, 16);
    g.destroy();
  }

  private showMessage(text: string) {
    this.messageText.setText(text);
    this.messageText.setPosition(this.scale.width / 2 - this.messageText.width / 2, 80);
  }

  private drawSafeZone() {
    this.safeCircle.clear();
    this.safeCircle.lineStyle(4, 0x00ff88, 1);
    this.safeCircle.strokeCircle(this.safeCenter.x, this.safeCenter.y, this.safeRadius);
  }

  update(time: number, delta: number) {
    const speed = 260;
    this.player.setVelocity(0);

    const left = this.cursors.left?.isDown || this.wasd.A?.isDown;
    const right = this.cursors.right?.isDown || this.wasd.D?.isDown;
    const up = this.cursors.up?.isDown || this.wasd.W?.isDown;
    const down = this.cursors.down?.isDown || this.wasd.S?.isDown;

    if (left) this.player.setVelocityX(-speed);
    else if (right) this.player.setVelocityX(speed);

    if (up) this.player.setVelocityY(-speed);
    else if (down) this.player.setVelocityY(speed);

    const pointer = this.input.activePointer!;
    const angle = Phaser.Math.Angle.Between(
      this.player.x,
      this.player.y,
      pointer.worldX,
      pointer.worldY
    );
    this.player.setRotation(angle);

    if (pointer.isDown) this.shoot(time);

    // Shrink safe zone
    this.safeRadius = Math.max(100, this.safeRadius - (this.shrinkRate * delta) / 1000);
    this.drawSafeZone();

    // Damage outside safe zone
    const distanceFromCenter = Phaser.Math.Distance.Between(
      this.player.x,
      this.player.y,
      this.safeCenter.x,
      this.safeCenter.y
    );
    if (distanceFromCenter > this.safeRadius) {
      this.damagePlayer(10 * (delta / 1000));
    }

    // Simple enemy AI: move toward player and occasionally shoot
    this.enemies.getChildren().forEach((e) => {
      const enemy = e as Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
      const dir = new Phaser.Math.Vector2(this.player.x - enemy.x, this.player.y - enemy.y)
        .normalize()
        .scale(110);
      enemy.setVelocity(dir.x, dir.y);

      if (!enemy.getData('lastShot')) enemy.setData('lastShot', 0);
      const lastShot = enemy.getData('lastShot') as number;
      if (this.time.now - lastShot > 800 && Phaser.Math.Between(0, 100) > 70) {
        enemy.setData('lastShot', this.time.now);
        const b = this.bullets.get(enemy.x, enemy.y, 'bullet') as Phaser.Physics.Arcade.Image | null;
        if (b) {
          b.setTint(0xff6b6b);
          b.setActive(true).setVisible(true);
          (b.body as Phaser.Physics.Arcade.Body | null)?.reset(enemy.x, enemy.y);
          const v = this.physics.velocityFromRotation(
            Phaser.Math.Angle.Between(enemy.x, enemy.y, this.player.x, this.player.y),
            600
          );
          b.setVelocity(v.x, v.y);
          this.time.delayedCall(1500, () => b.destroy());
        }
      }
    });
  }

  private damagePlayer(amount: number) {
    this.hp = Math.max(0, this.hp - amount);
    this.hpText.setText(`HP: ${Math.round(this.hp)}`);
    if (this.hp <= 0) {
      this.showMessage('Game Over! Press R to restart');
      this.scene.pause();
      this.input.keyboard!.once('keydown-R', () => this.scene.restart());
    }
  }

  private shoot(time?: number) {
    if (!time) time = this.time.now;
    if (this.ammo <= 0) return;
    if (time < this.lastFired + 120) return;
    this.lastFired = time;
    this.ammo -= 1;
    this.ammoText.setText(`Ammo: ${this.ammo}`);

    const bullet = this.bullets.get(
      this.player.x,
      this.player.y,
      'bullet'
    ) as Phaser.Physics.Arcade.Image | null;

    if (!bullet) return;

    bullet.setActive(true).setVisible(true);
    (bullet.body as Phaser.Physics.Arcade.Body | null)?.reset(this.player.x, this.player.y);

    const velocity = this.physics.velocityFromRotation(this.player.rotation, 800);
    bullet.setVelocity(velocity.x, velocity.y);

    this.time.delayedCall(1500, () => bullet.destroy());
  }
}
