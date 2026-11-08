// Founder Studio - live 3D arena of buyer bots (three.js r160).
import * as THREE from "../vendor/three.module.min.js";

// Every scene colour comes from the CSS design tokens (styles.css :root), so one token set themes page and arena.
const rootStyle = getComputedStyle(document.documentElement);
const token = (name, fallback) => rootStyle.getPropertyValue(name).trim() || fallback;
const tokenHex = (name, fallback) => parseInt(token(name, fallback).replace("#", ""), 16);
const THEME = {
  sceneBg: tokenHex("--scene-bg", "#eef1f5"),
  floor: tokenHex("--scene-floor", "#e4e8ee"),
  grid: tokenHex("--scene-grid", "#c9d0da"),
  gridMinor: tokenHex("--scene-grid-minor", "#d9dee5"),
  stall: tokenHex("--scene-stall", "#cbd3de"),
  stallTop: tokenHex("--scene-stall-top", "#9aa6b6"),
  accent: tokenHex("--accent", "#1d4ed8"),
  sky: tokenHex("--scene-sky", "#ffffff"),
  ground: tokenHex("--scene-ground", "#b9c1cc"),
  labelBg: token("--scene-label-bg", "rgba(255,255,255,0.96)"),
  labelFg: token("--scene-label-fg", "#14181f"),
  labelSub: token("--scene-label-sub", "#4b5563"),
  font: token("--font-ui", "Segoe UI, Arial, sans-serif"),
};
const SEGMENT_COLORS = [1, 2, 3, 4, 5, 6].map((i) => tokenHex(`--seg-${i}`, "#475569"));
const BUY_COLOR = tokenHex("--buy", "#15803d");
const PASS_COLOR = tokenHex("--pass", "#c0262d");
const THINK_COLOR = tokenHex("--think", "#b45309");
// Waiting line behind the stall (between the stall and the far edge of the frame).
const QUEUE_Z = -6.2;
// Depth of the BUY / PASS zone centres; kept shallow so overlays at the bottom never cover a pile.
const ZONE_Z = 3.6;
const ZONE_R = 4.4;
const QUEUE_WIDTH = 15;

function labelTexture(lines, { width = 512, height = 256, bg = THEME.labelBg, fg = THEME.labelFg, accent = "#" + THEME.accent.toString(16).padStart(6, "0"), big = false } = {}) {
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
    ctx.font = `600 120px ${THEME.font}`;
    ctx.fillStyle = accent;
    ctx.fillText(lines[0], width / 2, height / 2 + 6, width - 40);
    const bigTexture = new THREE.CanvasTexture(canvas);
    bigTexture.colorSpace = THREE.SRGBColorSpace;
    bigTexture.anisotropy = 4;
    return bigTexture;
  }
  lines.forEach((line, i) => {
    ctx.font = i === 0 ? `600 52px ${THEME.font}` : `32px ${THEME.font}`;
    ctx.fillStyle = i === 0 ? fg : THEME.labelSub;
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
    new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.11, roughness: 0.9 })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.01;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius - 0.08, radius, 96),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  const signMaterial = new THREE.MeshBasicMaterial({
    map: labelTexture([label], { accent, big: true }),
    transparent: true,
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.8), signMaterial);
  sign.position.set(0, 2.6, -radius - 0.2);
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

// The waiting line behind the stall: a soft floor strip with a "QUEUE" sign, so the idle
// scene already reads left to right as queue -> stall -> BUY / PASS.
function queueArea(width, z) {
  const group = new THREE.Group();
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(width, 3.4),
    new THREE.MeshStandardMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.08, roughness: 0.9 })
  );
  strip.rotation.x = -Math.PI / 2;
  strip.position.y = 0.012;
  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(width, 3.4)),
    new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.45 })
  );
  edge.rotation.x = -Math.PI / 2;
  edge.position.y = 0.02;
  const signMaterial = new THREE.MeshBasicMaterial({
    map: labelTexture(["QUEUE"], { accent: "#94a3b8", big: true }),
    transparent: true,
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.5), signMaterial);
  sign.position.set(width / 2 + 1.9, 1.2, 0);
  group.add(strip, edge, sign);
  group.position.set(0, 0, z);
  group.userData.setCount = (count) => {
    signMaterial.map?.dispose();
    signMaterial.map = labelTexture([count ? `QUEUE · ${count}` : "QUEUE"], { accent: "#94a3b8", big: true });
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
      new THREE.TorusGeometry(0.66, 0.09, 10, 48, Math.PI * 1.5),
      new THREE.MeshBasicMaterial({ color: THINK_COLOR, transparent: true, opacity: 0.95 })
    );
    this.ring.position.y = 2.35;
    this.ring.visible = false;
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.015;
    this.decisionMaterial = new THREE.MeshBasicMaterial({ color: BUY_COLOR, transparent: true, opacity: 0.7 });
    this.decisionDisc = new THREE.Mesh(new THREE.RingGeometry(0.38, 0.46, 32), this.decisionMaterial);
    this.decisionDisc.rotation.x = -Math.PI / 2;
    this.decisionDisc.position.y = 0.03;
    this.decisionDisc.visible = false;
    this.rig = new THREE.Group();
    this.rig.add(body, head, visor, eyeLeft, eyeRight, antenna, this.bulb, this.ring);
    this.group.add(this.rig, shadow, this.decisionDisc);
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
    this.decisionMaterial.color.setHex(THINK_COLOR);
    this.decisionDisc.visible = true;
    this.bulbMaterial.color.setHex(THINK_COLOR);
    this.eyeMaterial.color.setHex(THINK_COLOR);
  }

  setDecision(buys) {
    this.state = buys ? "buy" : "pass";
    this.ring.visible = false;
    const color = buys ? BUY_COLOR : PASS_COLOR;
    this.bulbMaterial.color.setHex(color);
    this.eyeMaterial.color.setHex(color);
    this.decisionMaterial.color.setHex(color);
    this.decisionMaterial.opacity = 0.7;
    this.decisionDisc.visible = true;
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
      this.decisionMaterial.opacity = 0.55 + Math.sin(time * 6) * 0.35;
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

// Reviewer bots apply one board lens each. They look different from buyers on purpose:
// light body, accent cap and a clipboard, and an accent ring on the floor.
const REVIEW_COLORS = { fix: THEME.accent, ok: BUY_COLOR, you: 0x94a3b8 };

class ReviewerBot extends Bot {
  constructor(reviewer, spawn) {
    super({ id: reviewer.id, name: reviewer.name }, 0xcbd5e1, spawn);
    this.reviewer = reviewer;
    const accent = new THREE.MeshStandardMaterial({ color: THEME.accent, roughness: 0.4, metalness: 0.1 });
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.33, 0.1, 24), accent);
    cap.position.y = 1.7;
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 0.18), accent);
    brim.position.set(0, 1.66, 0.3);
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.48, 0.04),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 })
    );
    board.position.set(0.18, 0.85, 0.36);
    board.rotation.x = -0.35;
    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.05), accent);
    clip.position.set(0.18, 1.08, 0.3);
    this.rig.add(cap, brim, board, clip);
    this.homeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.5, 32),
      new THREE.MeshBasicMaterial({ color: THEME.accent, transparent: true, opacity: 0.8 })
    );
    this.homeRing.rotation.x = -Math.PI / 2;
    this.homeRing.position.y = 0.03;
    this.group.add(this.homeRing);
    this.state = "idle";
  }

  setVerdict(verdict) {
    this.state = "reviewed";
    this.ring.visible = false;
    const color = REVIEW_COLORS[verdict] ?? REVIEW_COLORS.ok;
    this.bulbMaterial.color.setHex(color);
    this.eyeMaterial.color.setHex(color);
    this.homeRing.material.color.setHex(color);
    this.jump = verdict === "fix" ? 1 : 0;
  }

  clearVerdict() {
    this.state = "idle";
    this.bulbMaterial.color.setHex(0x9aa4b8);
    this.eyeMaterial.color.setHex(0x7dd3fc);
    this.homeRing.material.color.setHex(THEME.accent);
  }
}

export class Arena {
  constructor(container, { onSelect } = {}) {
    this.container = container;
    this.onSelect = onSelect;
    this.bots = new Map();
    this.labels = new Map();
    this.reviewers = new Map();
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
    this.scene.background = new THREE.Color(THEME.sceneBg);
    this.scene.fog = new THREE.Fog(THEME.sceneBg, 28, 60);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 200);
    this.orbit = { azimuth: 0.0, elevation: 0.86, radius: 24, target: new THREE.Vector3(0, 1.4, 1.5) };
    this.updateCamera();

    this.scene.add(new THREE.HemisphereLight(THEME.sky, THEME.ground, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(6, 14, 8);
    this.scene.add(sun);
    const rim = new THREE.PointLight(THEME.accent, 12, 30);
    rim.position.set(0, 5, -4);
    this.scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(40, 96),
      new THREE.MeshStandardMaterial({ color: THEME.floor, roughness: 0.95 })
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(80, 80, THEME.grid, THEME.gridMinor);
    grid.position.y = 0.005;
    this.scene.add(grid);

    this.buildStall();
    this.buyZone = zoneDisc(BUY_COLOR, "BUY", 9, ZONE_Z, ZONE_R);
    this.passZone = zoneDisc(PASS_COLOR, "PASS", -9, ZONE_Z, ZONE_R);
    this.scene.add(this.buyZone, this.passZone);
    this.queueZone = queueArea(QUEUE_WIDTH, QUEUE_Z);
    this.scene.add(this.queueZone);
    this.previewBots = [];
    this.selectedId = null;
    this.lastDecidedId = null;

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
      new THREE.MeshStandardMaterial({ color: THEME.stall, roughness: 0.6, metalness: 0.1 })
    );
    base.position.y = 0.12;
    const glow = new THREE.Mesh(
      new THREE.RingGeometry(2.45, 2.6, 96),
      new THREE.MeshBasicMaterial({ color: THEME.accent, transparent: true, opacity: 0.5 })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.26;
    const counter = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 1.0, 1.0),
      new THREE.MeshStandardMaterial({ color: THEME.stallTop, roughness: 0.4, metalness: 0.1 })
    );
    counter.position.set(0, 0.75, 0);
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x9aa4b8 })
    );
    pole.position.set(0, 1.9, -0.3);
    this.signMaterial = new THREE.MeshBasicMaterial({ map: labelTexture(["Your product", "pitch goes here"]), transparent: true });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.0, 2.5), this.signMaterial);
    sign.position.set(0, 3.2, -0.3);
    this.stall.add(base, glow, counter, pole, sign);
    this.scene.add(this.stall);
  }

  setStall(title, subtitle) {
    const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
    const shortTitle = title.replace(/\s*\(.*$/, "").split(/ - | – /)[0].trim() || title;
    this.signMaterial.map?.dispose();
    this.signMaterial.map = labelTexture([clip(shortTitle, 22), clip(subtitle, 36)]);
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
    const hits = this.raycaster.intersectObjects([...this.bots.values(), ...this.reviewers.values()].map((b) => b.group), true);
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
    this.orbit.radius = Math.min(42, Math.max(27, 27 * (1.45 / this.camera.aspect)));
    // The HUD covers the top of the canvas, so aim a little behind the stall: the queue
    // clears the HUD and both zones stay in frame. Phones have the HUD above the canvas.
    this.orbit.target.z = clientWidth < 600 ? 1.5 : -1.2;
    this.orbit.target.y = clientWidth < 600 ? 1.4 : 3.2;
    this.updateCamera();
    this.camera.updateProjectionMatrix();
  }

  reset() {
    for (const bot of this.bots.values()) this.scene.remove(bot.group);
    this.bots.clear();
    // Buyer labels go; reviewer labels stay with their bots.
    for (const label of this.labels.values()) label.remove();
    this.labels.clear();
    this.buySlots = 0;
    this.passSlots = 0;
    this.stallSlots = 0;
    this.selectedId = null;
    this.lastDecidedId = null;
    this.buyZone.userData.setCount(0);
    this.passZone.userData.setCount(0);
  }

  spawn(persona, segmentIndex, index, total) {
    if (this.previewBots.length) this.clearPreview();
    this.panelSize = total;
    const spawn = this.queueSlot(index, total);
    const bot = new Bot(persona, SEGMENT_COLORS[segmentIndex % SEGMENT_COLORS.length], spawn);
    bot.speed = 3.2 * this.speedFactor;
    this.scene.add(bot.group);
    this.bots.set(persona.id, bot);
    const label = document.createElement("div");
    label.className = "bot-label";
    const name = persona.name || persona.id;
    // Decided bots in a pile show a 2-letter chip; hover, select or a feed hover expands it to the name.
    label.innerHTML = `<span class="ini"></span><span class="nm"></span>`;
    label.querySelector(".ini").textContent = name.slice(0, 2);
    label.querySelector(".nm").textContent = name;
    label.setAttribute("aria-label", name);
    label.addEventListener("click", () => this.onSelect?.(persona.id));
    this.labelLayer.appendChild(label);
    this.labels.set(persona.id, label);
    return bot;
  }

  // Two staggered rows inside the queue strip.
  queueSlot(index, total) {
    const perRow = Math.max(1, Math.ceil(total / 2));
    const row = index % 2;
    const col = Math.floor(index / 2);
    const gap = Math.min(1.3, (QUEUE_WIDTH - 1.2) / Math.max(1, perRow - 1));
    const x = (col - (perRow - 1) / 2) * gap + (row ? gap / 2 : 0);
    return new THREE.Vector3(x, 0, QUEUE_Z - 0.75 + row * 1.5);
  }

  // Idle preview: anonymous buyers waiting in the queue, coloured by segment share.
  preview(total, shares) {
    this.clearPreview();
    if (this.bots.size || !total) return;
    const weights = shares.length ? shares : [1];
    const sum = weights.reduce((a, b) => a + (b || 0), 0) || 1;
    let segment = 0;
    let used = 0;
    for (let i = 0; i < total; i++) {
      while (segment < weights.length - 1 && i >= Math.round(((used + (weights[segment] || 0)) / sum) * total)) {
        used += weights[segment] || 0;
        segment++;
      }
      const bot = new Bot({ id: `preview-${i}` }, SEGMENT_COLORS[segment % SEGMENT_COLORS.length], this.queueSlot(i, total));
      bot.group.rotation.y = 0;
      this.scene.add(bot.group);
      this.previewBots.push(bot);
    }
    this.queueZone.userData.setCount(total);
  }

  clearPreview() {
    for (const bot of this.previewBots) this.scene.remove(bot.group);
    this.previewBots = [];
  }

  // Number of buyers still waiting in the queue (shown on the queue sign).
  updateQueueCount() {
    let waiting = 0;
    for (const bot of this.bots.values()) if (bot.state === "queued") waiting++;
    this.queueZone.userData.setCount(waiting);
  }

  setSpeed(factor) {
    this.speedFactor = factor;
    for (const bot of [...this.bots.values(), ...this.reviewers.values()]) bot.speed = 3.2 * factor;
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
    this.updateQueueCount();
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
    this.lastDecidedId = id;
    const index = buys ? this.buySlots++ : this.passSlots++;
    (buys ? this.buyZone : this.passZone).userData.setCount(buys ? this.buySlots : this.passSlots);
    const cx = buys ? 9 : -9;
    const columns = this.panelSize > 30 ? 8 : 5;
    const gap = columns === 8 ? 0.95 : 1.85;
    const col = index % columns;
    const row = Math.floor(index / columns);
    bot.walkTo(new THREE.Vector3(cx + (col - (columns - 1) / 2) * gap, 0, ZONE_Z - 2.5 + row * gap));
    const label = this.labels.get(id);
    if (label) {
      label.dataset.state = buys ? "buy" : "pass";
      label.title = shortReason || "";
    }
  }

  // ---------- reviewer bots ----------
  reviewerHome(index, total) {
    const gap = 1.6;
    return new THREE.Vector3((index - (total - 1) / 2) * gap, 0, 5.4);
  }

  spawnReviewers(reviewers) {
    reviewers.forEach((reviewer, index) => {
      if (this.reviewers.has(reviewer.id)) {
        this.reviewers.get(reviewer.id).clearVerdict();
        return;
      }
      const home = this.reviewerHome(index, reviewers.length);
      const bot = new ReviewerBot(reviewer, new THREE.Vector3(home.x, 0, 16));
      bot.home = home;
      bot.speed = 3.2 * this.speedFactor;
      bot.walkTo(home);
      this.scene.add(bot.group);
      this.reviewers.set(reviewer.id, bot);
      const label = document.createElement("div");
      label.className = "bot-label reviewer";
      label.innerHTML = '<span class="nm"></span>';
      label.querySelector(".nm").textContent = reviewer.name;
      label.setAttribute("aria-label", `${reviewer.name} (reviewer)`);
      label.addEventListener("click", () => this.onSelect?.(reviewer.id));
      this.labelLayer.appendChild(label);
      this.reviewerLabels ||= new Map();
      this.reviewerLabels.set(reviewer.id, label);
    });
  }

  // Walk up to the stall to read the pitch. Returns the walk time in ms.
  reviewerInspect(id) {
    const bot = this.reviewers.get(id);
    if (!bot) return 0;
    bot.clearVerdict();
    bot.state = "walking";
    bot.walkTo(new THREE.Vector3(bot.home.x * 0.55, 0, 3.4));
    return this.travelMs(bot);
  }

  reviewerThink(id) {
    const bot = this.reviewers.get(id);
    if (!bot) return;
    bot.setThinking();
    const label = this.reviewerLabels?.get(id);
    if (label) label.dataset.state = "thinking";
  }

  // Post the verdict (fix / ok / you) and walk back to the reviewers' row.
  reviewerVerdict(id, verdict) {
    const bot = this.reviewers.get(id);
    if (!bot) return 0;
    bot.setVerdict(verdict);
    bot.walkTo(bot.home);
    const label = this.reviewerLabels?.get(id);
    if (label) label.dataset.state = verdict;
    return this.travelMs(bot);
  }

  clearReviewers() {
    for (const bot of this.reviewers.values()) this.scene.remove(bot.group);
    this.reviewers.clear();
    for (const label of this.reviewerLabels?.values() || []) label.remove();
    this.reviewerLabels?.clear();
  }

  highlight(id) {
    this.selectedId = id;
    for (const [botId, label] of this.labels) label.classList.toggle("selected", botId === id);
    for (const [botId, label] of this.reviewerLabels || []) label.classList.toggle("selected", botId === id);
  }

  // Snap every bot to its target - used at the end of a run, because browsers
  // throttle animation frames in background tabs and the walk can lag behind.
  settle() {
    for (const bot of [...this.bots.values(), ...this.reviewers.values()]) {
      bot.group.position.x = bot.target.x;
      bot.group.position.z = bot.target.z;
    }
  }

  tick() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const time = this.clock.elapsedTime;
    let anyMoving = false;
    for (const bot of [...this.bots.values(), ...this.reviewers.values()]) anyMoving = bot.update(dt, time) || anyMoving;
    for (const bot of this.previewBots) bot.update(dt, time);
    if (!anyMoving && !this.dragging) {
      this.orbit.azimuth += dt * 0.03;
      this.updateCamera();
    }
    this.renderer.render(this.scene, this.camera);
    const width = this.renderer.domElement.clientWidth;
    const height = this.renderer.domElement.clientHeight;
    const { offsetLeft, offsetTop } = this.renderer.domElement;
    const projected = new THREE.Vector3();
    const rank = { thinking: 1, walking: 2, buy: 3, pass: 4 };
    const candidates = [];
    for (const [id, bot] of this.bots) {
      const label = this.labels.get(id);
      const selected = id === this.selectedId;
      // Queued bots stay unlabelled. Settled bots in a pile drop their tag (the zone sign
      // carries the count); only the latest decision and the selected bot keep a name.
      const settled = bot.state === "buy" || bot.state === "pass";
      // Settled bots drop their tag (the roster and the zone sign carry identity and count);
      // only the latest decision and the selected bot keep a name.
      const compact = false;
      label.classList.toggle("compact", compact);
      if (!selected && (!(bot.state in rank) || (settled && id !== this.lastDecidedId))) {
        label.style.display = "none";
        continue;
      }
      projected.set(bot.group.position.x, compact ? 2.3 : 2.75, bot.group.position.z).project(this.camera);
      if (projected.z >= 1) {
        label.style.display = "none";
        continue;
      }
      candidates.push({
        label,
        bot,
        compact,
        w: compact ? 24 : 64,
        h: compact ? 18 : 26,
        priority: selected ? 0 : rank[bot.state],
        x: offsetLeft + ((projected.x + 1) / 2) * width,
        y: offsetTop + ((1 - projected.y) / 2) * height,
      });
    }
    // Reviewer labels always show (5 at most) and win over buyer labels.
    for (const [id, bot] of this.reviewers) {
      const label = this.reviewerLabels.get(id);
      projected.set(bot.group.position.x, 2.75, bot.group.position.z).project(this.camera);
      if (projected.z >= 1) {
        label.style.display = "none";
        continue;
      }
      candidates.push({
        label,
        bot,
        compact: false,
        w: 92,
        h: 24,
        priority: id === this.selectedId ? 0 : bot.state === "thinking" ? 0.5 : 0.8,
        x: offsetLeft + ((projected.x + 1) / 2) * width,
        y: offsetTop + ((1 - projected.y) / 2) * height,
      });
    }
    // The stall sign is reserved space; labels never sit on top of it.
    const toScreen = (x, y, z) => {
      projected.set(x, y, z).project(this.camera);
      return [offsetLeft + ((projected.x + 1) / 2) * width, offsetTop + ((1 - projected.y) / 2) * height];
    };
    // Reserved screen boxes: the stall sign and both zone count signs ("PASS · 16").
    const signBox = (left, top, right, bottom, z) => {
      const [x1, y1] = toScreen(left, top, z);
      const [x2, y2] = toScreen(right, bottom, z);
      return { left: Math.min(x1, x2), right: Math.max(x1, x2), top: Math.min(y1, y2), bottom: Math.max(y1, y2) };
    };
    const reserved = [
      signBox(-2.5, 4.45, 2.5, 1.95, -0.3),
      signBox(9 - 1.9, 3.6, 9 + 1.9, 1.6, ZONE_Z - ZONE_R - 0.2),
      signBox(-9 - 1.9, 3.6, -9 + 1.9, 1.6, ZONE_Z - ZONE_R - 0.2),
    ];
    const onSign = (x, y, w = 80, h = 22) => reserved.some((box) =>
      x + w / 2 > box.left && x - w / 2 < box.right && y > box.top && y - h < box.bottom);
    // Hide a label when a higher-priority one already sits on the same spot.
    candidates.sort((a, b) => a.priority - b.priority);
    const placed = [];
    const clashes = (item) => onSign(item.x, item.y, item.w, item.h) || placed.some((p) =>
      Math.abs(p.x - item.x) < (p.w + item.w) / 2 && Math.abs(p.y - item.y) < (p.h + item.h) / 2);
    for (const item of candidates) {
      if (!item.compact && clashes(item)) {
        const [footX, footY] = toScreen(item.bot.group.position.x, -0.1, item.bot.group.position.z);
        item.x = footX;
        item.y = footY + 26;
      }
      const clash = clashes(item);
      item.label.style.display = clash ? "none" : "block";
      if (clash) continue;
      placed.push(item);
      item.x = Math.min(offsetLeft + width - item.w / 2 - 4, Math.max(offsetLeft + item.w / 2 + 4, item.x));
      item.label.style.transform = `translate(-50%, -100%) translate(${item.x}px, ${item.y}px)`;
    }
  }
}
