// Founder Studio - live 3D arena of buyer bots (three.js r160).
import * as THREE from "../vendor/three.module.min.js";

const SEGMENT_COLORS = [0x6ea8fe, 0xf4a259, 0xb084f5, 0x5cc8a7, 0xf06595, 0xffd43b];
const BUY_COLOR = 0x37d67a;
const PASS_COLOR = 0xff5d73;
const THINK_COLOR = 0xffc94d;

function labelTexture(lines, { width = 512, height = 256, bg = "rgba(13,17,28,0.92)", fg = "#e8ecf6", accent = "#7aa2ff", big = false } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = bg;
  const r = 28;
  ctx.beginPath();
  ctx.roundRect(4, 4, width - 8, height - 8, r);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  if (big) {
    ctx.textBaseline = "middle";
    ctx.font = "bold 120px Inter, Segoe UI, sans-serif";
    ctx.fillStyle = accent;
    ctx.fillText(lines[0], width / 2, height / 2 + 6, width - 40);
    const bigTexture = new THREE.CanvasTexture(canvas);
    bigTexture.colorSpace = THREE.SRGBColorSpace;
    bigTexture.anisotropy = 4;
    return bigTexture;
  }
  lines.forEach((line, i) => {
    ctx.font = i === 0 ? "bold 52px Inter, Segoe UI, sans-serif" : "32px Inter, Segoe UI, sans-serif";
    ctx.fillStyle = i === 0 ? fg : "#aab4cc";
    ctx.fillText(line, width / 2, 90 + i * 64, width - 40);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function zoneDisc(color, label, x, z, radius) {
  const accent = "#" + color.toString(16).padStart(6, "0");
  const group = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 64),
    new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.16, roughness: 0.9 })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.01;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.08, radius, 96),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  const signMaterial = new THREE.MeshBasicMaterial({
    map: labelTexture([label], { accent, big: true }),
    transparent: true,
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.8), signMaterial);
  sign.position.set(0, 2.9, -radius + 0.4);
  group.add(disc, ring, sign);
  group.position.set(x, 0, z);
  // Redraws the sign with a live count, e.g. "BUY · 4".
  group.userData.setCount = (count) => {
    signMaterial.map?.dispose();
    signMaterial.map = labelTexture([count ? `${label} · ${count}` : label], { accent, big: true });
    signMaterial.needsUpdate = true;
  };
  return group;
}

class Bot {
  constructor(persona, color, spawn) {
    this.persona = persona;
    this.state = "queued";
    this.group = new THREE.Group();
    this.group.userData.botId = persona.id;
    const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.15 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.55, 6, 16), bodyMaterial);
    body.position.y = 0.72;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 24, 16),
      new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.3, metalness: 0.1 })
    );
    head.position.y = 1.45;
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.14, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.2 })
    );
    visor.position.set(0, 1.47, 0.24);
    this.eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x7dd3fc });
    const eyeLeft = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 8), this.eyeMaterial);
    const eyeRight = eyeLeft.clone();
    eyeLeft.position.set(-0.09, 1.47, 0.31);
    eyeRight.position.set(0.09, 1.47, 0.31);
    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.25),
      new THREE.MeshStandardMaterial({ color: 0x9aa4b8 })
    );
    antenna.position.y = 1.85;
    this.bulbMaterial = new THREE.MeshBasicMaterial({ color: 0x9aa4b8 });
    this.bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), this.bulbMaterial);
    this.bulb.position.y = 2.0;
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.035, 8, 48, Math.PI * 1.3),
      new THREE.MeshBasicMaterial({ color: THINK_COLOR, transparent: true, opacity: 0.95 })
    );
    this.ring.position.y = 2.25;
    this.ring.visible = false;
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.015;
    this.rig = new THREE.Group();
    this.rig.add(body, head, visor, eyeLeft, eyeRight, antenna, this.bulb, this.ring);
    this.group.add(this.rig, shadow);
    this.group.position.copy(spawn);
    this.target = spawn.clone();
    this.speed = 3.2;
    this.phase = Math.random() * Math.PI * 2;
    this.progress = 0;
  }

  walkTo(point) {
    this.target = point.clone();
    this.state = this.state === "queued" ? "walking" : this.state;
  }

  setThinking() {
    this.state = "thinking";
    this.ring.visible = true;
    this.bulbMaterial.color.setHex(THINK_COLOR);
    this.eyeMaterial.color.setHex(THINK_COLOR);
  }

  setDecision(buys) {
    this.state = buys ? "buy" : "pass";
    this.ring.visible = false;
    const color = buys ? BUY_COLOR : PASS_COLOR;
    this.bulbMaterial.color.setHex(color);
    this.eyeMaterial.color.setHex(color);
    this.jump = buys ? 1 : 0;
  }

  update(dt, time) {
    const position = this.group.position;
    const delta = new THREE.Vector3().subVectors(this.target, position);
    delta.y = 0;
    const distance = delta.length();
    const moving = distance > 0.05;
    if (moving) {
      const step = Math.min(distance, this.speed * dt);
      position.addScaledVector(delta.normalize(), step);
      const angle = Math.atan2(delta.x, delta.z);
      this.group.rotation.y += ((angle - this.group.rotation.y + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 10);
      this.rig.position.y = Math.abs(Math.sin(time * 10 + this.phase)) * 0.12;
      this.rig.rotation.z = Math.sin(time * 10 + this.phase) * 0.06;
    } else {
      this.rig.position.y = Math.sin(time * 2 + this.phase) * 0.03;
      this.rig.rotation.z *= 0.9;
    }
    if (this.state === "thinking") {
      this.ring.rotation.z -= dt * 5;
      this.ring.rotation.y = Math.sin(time * 2) * 0.3;
      this.bulb.scale.setScalar(1 + Math.sin(time * 12) * 0.3);
    } else {
      this.bulb.scale.setScalar(1);
    }
    if (this.jump > 0) {
      this.jump = Math.max(0, this.jump - dt * 1.4);
      this.rig.position.y += Math.sin((1 - this.jump) * Math.PI * 3) * 0.35 * this.jump;
    }
    return moving;
  }
}

export class Arena {
  constructor(container, { onSelect } = {}) {
    this.container = container;
    this.onSelect = onSelect;
    this.bots = new Map();
    this.labels = new Map();
    this.buySlots = 0;
    this.passSlots = 0;
    this.stallSlots = 0;
    this.speedFactor = 1;
    this.dragging = false;
    this.clock = new THREE.Clock();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false;
    container.appendChild(this.renderer.domElement);
    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "bot-labels";
    container.appendChild(this.labelLayer);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0f1a);
    this.scene.fog = new THREE.Fog(0x0b0f1a, 28, 60);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
    this.orbit = { azimuth: 0.0, elevation: 0.62, radius: 24, target: new THREE.Vector3(0, 0.5, 1.5) };
    this.updateCamera();

    this.scene.add(new THREE.HemisphereLight(0xbcd2ff, 0x1a1f2e, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(6, 14, 8);
    this.scene.add(sun);
    const rim = new THREE.PointLight(0x7aa2ff, 30, 30);
    rim.position.set(0, 5, -4);
    this.scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(40, 96),
      new THREE.MeshStandardMaterial({ color: 0x121829, roughness: 0.95 })
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(80, 80, 0x26304a, 0x1a2135);
    grid.position.y = 0.005;
    this.scene.add(grid);

    this.buildStall();
    this.buyZone = zoneDisc(BUY_COLOR, "BUY", 9, 5, 3.6);
    this.passZone = zoneDisc(PASS_COLOR, "PASS", -9, 5, 3.6);
    this.scene.add(this.buyZone, this.passZone);
    this.selectedId = null;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.bindControls();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
    this.renderer.setAnimationLoop(() => this.tick());
  }

  buildStall() {
    this.stall = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(2.3, 2.5, 0.25, 48),
      new THREE.MeshStandardMaterial({ color: 0x1d2640, roughness: 0.6, metalness: 0.2 })
    );
    base.position.y = 0.12;
    const glow = new THREE.Mesh(
      new THREE.RingGeometry(2.45, 2.6, 96),
      new THREE.MeshBasicMaterial({ color: 0x7aa2ff, transparent: true, opacity: 0.8 })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.26;
    const counter = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 1.0, 1.0),
      new THREE.MeshStandardMaterial({ color: 0x2b3658, roughness: 0.4, metalness: 0.3 })
    );
    counter.position.set(0, 0.75, 0);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x9aa4b8 })
    );
    pole.position.set(0, 2.2, -0.3);
    this.signMaterial = new THREE.MeshBasicMaterial({ map: labelTexture(["Your product", "pitch goes here"]), transparent: true });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 2.7), this.signMaterial);
    sign.position.set(0, 4.0, -0.3);
    this.stall.add(base, glow, counter, pole, sign);
    this.scene.add(this.stall);
  }

  setStall(title, subtitle) {
    this.signMaterial.map?.dispose();
    this.signMaterial.map = labelTexture([title.slice(0, 26), subtitle.slice(0, 40)]);
    this.signMaterial.needsUpdate = true;
  }

  bindControls() {
    const canvas = this.renderer.domElement;
    let moved = 0;
    let last = null;
    canvas.addEventListener("pointerdown", (event) => {
      this.dragging = true;
      moved = 0;
      last = [event.clientX, event.clientY];
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!this.dragging) return;
      const dx = event.clientX - last[0];
      const dy = event.clientY - last[1];
      moved += Math.abs(dx) + Math.abs(dy);
      last = [event.clientX, event.clientY];
      this.orbit.azimuth -= dx * 0.006;
      this.orbit.elevation = Math.min(1.35, Math.max(0.15, this.orbit.elevation + dy * 0.005));
      this.updateCamera();
    });
    canvas.addEventListener("pointerup", (event) => {
      this.dragging = false;
      if (moved < 6) this.pick(event);
    });
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.orbit.radius = Math.min(48, Math.max(8, this.orbit.radius * (1 + Math.sign(event.deltaY) * 0.08)));
      this.updateCamera();
    }, { passive: false });
  }

  pick(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.bots.values()].map((b) => b.group), true);
    for (const hit of hits) {
      let node = hit.object;
      while (node && !node.userData.botId) node = node.parent;
      if (node) {
        this.onSelect?.(node.userData.botId);
        return;
      }
    }
  }

  updateCamera() {
    const { azimuth, elevation, radius, target } = this.orbit;
    this.camera.position.set(
      target.x + radius * Math.sin(azimuth) * Math.cos(elevation),
      target.y + radius * Math.sin(elevation),
      target.z + radius * Math.cos(azimuth) * Math.cos(elevation)
    );
    this.camera.lookAt(target);
  }

  resize() {
    // Measure the canvas itself: on phones the HUD sits above it in the arena's flow.
    const canvas = this.renderer.domElement;
    const clientWidth = canvas.clientWidth || this.container.clientWidth;
    const clientHeight = canvas.clientHeight || this.container.clientHeight;
    if (!clientWidth || !clientHeight) return;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / clientHeight;
    // Keep both decision zones (x = +/-12.6) in frame on narrow screens.
    this.orbit.radius = Math.min(40, Math.max(24, 24 * (1.45 / this.camera.aspect)));
    this.updateCamera();
    this.camera.updateProjectionMatrix();
  }

  reset() {
    for (const bot of this.bots.values()) this.scene.remove(bot.group);
    this.bots.clear();
    this.labelLayer.innerHTML = "";
    this.labels.clear();
    this.buySlots = 0;
    this.passSlots = 0;
    this.stallSlots = 0;
    this.selectedId = null;
    this.buyZone.userData.setCount(0);
    this.passZone.userData.setCount(0);
  }

  spawn(persona, segmentIndex, index, total) {
    const spread = Math.min(22, 1.2 * total);
    const x = -spread / 2 + (spread * (index + 0.5)) / Math.max(1, total);
    const spawn = new THREE.Vector3(x, 0, -14 - (index % 3) * 1.2);
    const bot = new Bot(persona, SEGMENT_COLORS[segmentIndex % SEGMENT_COLORS.length], spawn);
    bot.speed = 3.2 * this.speedFactor;
    this.scene.add(bot.group);
    this.bots.set(persona.id, bot);
    const label = document.createElement("div");
    label.className = "bot-label";
    label.textContent = persona.name || persona.id;
    label.addEventListener("click", () => this.onSelect?.(persona.id));
    this.labelLayer.appendChild(label);
    this.labels.set(persona.id, label);
    return bot;
  }

  setSpeed(factor) {
    this.speedFactor = factor;
    for (const bot of this.bots.values()) bot.speed = 3.2 * factor;
  }

  // Milliseconds until the bot reaches its current target.
  travelMs(bot) {
    const dx = bot.target.x - bot.group.position.x;
    const dz = bot.target.z - bot.group.position.z;
    return (Math.hypot(dx, dz) / bot.speed) * 1000 + 120;
  }

  approach(id) {
    const bot = this.bots.get(id);
    if (!bot) return 0;
    const slot = this.stallSlots++;
    const angle = Math.PI * (0.15 + ((slot * 0.37) % 0.7));
    const radius = 3.3 + (slot % 2) * 0.9;
    bot.walkTo(new THREE.Vector3(Math.cos(angle) * radius * (slot % 2 ? -1 : 1), 0, -Math.sin(angle) * radius * 0.4 + 2.6));
    bot.state = "walking";
    return this.travelMs(bot);
  }

  think(id) {
    this.bots.get(id)?.setThinking();
    const label = this.labels.get(id);
    if (label) label.dataset.state = "thinking";
  }

  decide(id, buys, shortReason) {
    const bot = this.bots.get(id);
    if (!bot) return;
    bot.setDecision(buys);
    const index = buys ? this.buySlots++ : this.passSlots++;
    (buys ? this.buyZone : this.passZone).userData.setCount(buys ? this.buySlots : this.passSlots);
    const cx = buys ? 9 : -9;
    const col = index % 5;
    const row = Math.floor(index / 5);
    bot.walkTo(new THREE.Vector3(cx - 2.4 + col * 1.2, 0, 3.6 + row * 1.1));
    const label = this.labels.get(id);
    if (label) {
      label.dataset.state = buys ? "buy" : "pass";
      label.title = shortReason || "";
    }
  }

  highlight(id) {
    this.selectedId = id;
    for (const [botId, label] of this.labels) label.classList.toggle("selected", botId === id);
  }

  // Snap every bot to its target - used at the end of a run, because browsers
  // throttle animation frames in background tabs and the walk can lag behind.
  settle() {
    for (const bot of this.bots.values()) {
      bot.group.position.x = bot.target.x;
      bot.group.position.z = bot.target.z;
    }
  }

  tick() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const time = this.clock.elapsedTime;
    let anyMoving = false;
    for (const bot of this.bots.values()) anyMoving = bot.update(dt, time) || anyMoving;
    if (!anyMoving && !this.dragging) {
      this.orbit.azimuth += dt * 0.03;
      this.updateCamera();
    }
    this.renderer.render(this.scene, this.camera);
    const width = this.renderer.domElement.clientWidth;
    const height = this.renderer.domElement.clientHeight;
    const { offsetLeft, offsetTop } = this.renderer.domElement;
    const projected = new THREE.Vector3();
    for (const [id, bot] of this.bots) {
      const label = this.labels.get(id);
      // Queued bots stay unlabelled so the crowd at the entrance is readable.
      if (bot.state === "queued") {
        label.style.display = "none";
        continue;
      }
      projected.set(bot.group.position.x, 2.55, bot.group.position.z).project(this.camera);
      const visible = projected.z < 1;
      label.style.display = visible ? "block" : "none";
      label.style.transform = `translate(-50%, -100%) translate(${offsetLeft + ((projected.x + 1) / 2) * width}px, ${offsetTop + ((1 - projected.y) / 2) * height}px)`;
    }
  }
}
