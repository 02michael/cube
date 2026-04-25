// --- CONFIGURATION ---
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const FLOOR_Y = 550; // Where the shapes bounce
const GRAVITY = 0.4;
const BOUNCE_DAMPENING = -0.75;
const FRICTION = 0.99;
const MIN_RADIUS = 20; // Shapes smaller than this shatter instead of slicing
const MORPH_DURATION = 400;

const SHAPE_LIBRARY = [3, 4, 5, 6, 8]; // Allowed sides

// --- ENGINE ---
class KineticReactor {
  constructor() {
    this.canvas = document.getElementById('kineticCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;

    this.entities = [];
    this.particles = [];
    this.cutMarks = [];

    this.isCutting = false;
    this.cutStart = { x: 0, y: 0 };
    this.cutEnd = { x: 0, y: 0 };

    this.addListeners();
    this.spawnInterval = setInterval(() => this.spawnFloater(), 2500);
    this.spawnFloater(); // Spawn first one immediately
    this.loop();
  }

  getRandomHue() { return Math.floor(Math.random() * 360); }

  // Spawns a shape floating upwards in zero-G
  spawnFloater() {
    const sides = SHAPE_LIBRARY[Math.floor(Math.random() * SHAPE_LIBRARY.length)];
    const startX = 150 + Math.random() * (CANVAS_WIDTH - 300);
    
    let ent = this.createEntity(sides, startX, CANVAS_HEIGHT + 100, 80);
    ent.gravityOn = false;
    ent.vel.y = -2 - Math.random() * 1.5; // Float slowly up
    ent.vel.x = (Math.random() - 0.5) * 1;
    this.entities.push(ent);
  }

  createEntity(sides, x, y, radius, customVertices = null) {
    const baseVertices = customVertices || this.generateRegularPolygon(sides, radius);
    return {
      sides: sides,
      hue: this.getRandomHue(),
      radius: radius,
      pos: { x: x, y: y },
      vel: { x: 0, y: 0 },
      rot: Math.random() * Math.PI * 2,
      vRot: (Math.random() - 0.5) * 0.05,
      gravityOn: true,
      
      // Metamorphosis state
      isMorphing: customVertices !== null,
      morphProgress: customVertices !== null ? 0 : 1,
      startVertices: customVertices ? [...customVertices] : [...baseVertices],
      goalVertices: [...baseVertices],
      currentVertices: [...(customVertices || baseVertices)]
    };
  }

  // --- CORE SLICING LOGIC ---
  performSlice() {
    let entitiesToSpawn = [];
    let entitiesToKeep = [];
    let cutVector = { dx: this.cutEnd.x - this.cutStart.x, dy: this.cutEnd.y - this.cutStart.y };
    let cutLength = Math.hypot(cutVector.dx, cutVector.dy);
    
    if (cutLength < 10) return; 
    
    // Normal vector for explosive push outward
    let normal = { x: -cutVector.dy / cutLength, y: cutVector.dx / cutLength };
    this.cutMarks.push({ p1: this.cutStart, p2: this.cutEnd, life: 1.0 });

    this.entities.forEach(entity => {
      let absVertices = entity.currentVertices.map(v => {
        let rx = v.x * Math.cos(entity.rot) - v.y * Math.sin(entity.rot);
        let ry = v.x * Math.sin(entity.rot) + v.y * Math.cos(entity.rot);
        return { x: rx + entity.pos.x, y: ry + entity.pos.y };
      });

      let intersections = [];
      for (let i = 0; i < absVertices.length; i++) {
        const p1 = absVertices[i];
        const p2 = absVertices[(i + 1) % absVertices.length];
        const intersect = this.checkIntersection(p1, p2, this.cutStart, this.cutEnd);
        if (intersect) intersections.push({ point: intersect, edgeIndex: i });
      }

      if (intersections.length === 2) {
        // If it's too small, shatter it instead of slicing infinitely
        if (entity.radius < MIN_RADIUS) {
          this.spawnParticles(entity.pos.x, entity.pos.y, entity.hue, 40, 10);
          this.shakeScreen(4);
          return; // Do not keep or spawn new entities
        }

        const sorted = intersections.sort((a, b) => a.edgeIndex - b.edgeIndex);
        const splitA = sorted[0], splitB = sorted[1];

        let absA = [splitA.point];
        for (let i = splitA.edgeIndex + 1; i <= splitB.edgeIndex; i++) absA.push(absVertices[i]);
        absA.push(splitB.point);

        let absB = [splitB.point];
        for (let i = splitB.edgeIndex + 1; i < absVertices.length; i++) absB.push(absVertices[i]);
        for (let i = 0; i <= splitA.edgeIndex; i++) absB.push(absVertices[i]);
        absB.push(splitA.point);

        const centerA = this.getPolygonCenter(absA);
        const centerB = this.getPolygonCenter(absB);
        const localA = absA.map(v => ({ x: v.x - centerA.x, y: v.y - centerA.y }));
        const localB = absB.map(v => ({ x: v.x - centerB.x, y: v.y - centerB.y }));

        // Randomize the new shape!
        const nextSidesA = SHAPE_LIBRARY[Math.floor(Math.random() * SHAPE_LIBRARY.length)];
        const nextSidesB = SHAPE_LIBRARY[Math.floor(Math.random() * SHAPE_LIBRARY.length)];

        const maxVerticesA = Math.max(localA.length, nextSidesA);
        const maxVerticesB = Math.max(localB.length, nextSidesB);
        const normLocalA = this.normalizePolygon(localA, maxVerticesA);
        const normLocalB = this.normalizePolygon(localB, maxVerticesB);

        // Child pieces have roughly half the radius
        let entA = this.createEntity(nextSidesA, centerA.x, centerA.y, entity.radius * 0.65, normLocalA);
        let entB = this.createEntity(nextSidesB, centerB.x, centerB.y, entity.radius * 0.65, normLocalB);

        // Turn ON Gravity for the sliced pieces
        entA.gravityOn = true;
        entB.gravityOn = true;

        // Explosive outward velocity from the cut line
        const explodeForce = 4;
        entA.vel.x = entity.vel.x + normal.x * explodeForce;
        entA.vel.y = entity.vel.y + normal.y * explodeForce - 2; // slight upward bump
        entB.vel.x = entity.vel.x - normal.x * explodeForce;
        entB.vel.y = entity.vel.y - normal.y * explodeForce - 2;

        // Add some wild spin
        entA.vRot = entity.vRot + (Math.random() - 0.5) * 0.2;
        entB.vRot = entity.vRot + (Math.random() - 0.5) * 0.2;

        entitiesToSpawn.push(entA, entB);
        this.spawnParticles(intersections[0].point.x, intersections[0].point.y, entity.hue, 15, 5);
        this.shakeScreen(3);
      } else {
        entitiesToKeep.push(entity);
      }
    });

    this.entities = [...entitiesToKeep, ...entitiesToSpawn];
  }

  // --- PHYSICS ENGINE ---
  update(dt) {
    for (let i = this.entities.length - 1; i >= 0; i--) {
      let ent = this.entities[i];

      // Metamorphosis
      if (ent.isMorphing) {
        ent.morphProgress += dt / MORPH_DURATION;
        if (ent.morphProgress >= 1) {
          ent.morphProgress = 1;
          ent.isMorphing = false;
        }
        const eased = this.easeOutBack(ent.morphProgress);
        for (let j = 0; j < ent.currentVertices.length; j++) {
          ent.currentVertices[j] = {
            x: ent.startVertices[j].x + (ent.goalVertices[j].x - ent.startVertices[j].x) * eased,
            y: ent.startVertices[j].y + (ent.goalVertices[j].y - ent.startVertices[j].y) * eased
          };
        }
      }

      // Physics Integration
      if (ent.gravityOn) {
        ent.vel.y += GRAVITY;
      }
      ent.vel.x *= FRICTION;
      
      ent.pos.x += ent.vel.x;
      ent.pos.y += ent.vel.y;
      ent.rot += ent.vRot;

      // Wall Collisions
      if (ent.pos.x - ent.radius < 0) {
        ent.pos.x = ent.radius;
        ent.vel.x *= BOUNCE_DAMPENING;
      } else if (ent.pos.x + ent.radius > CANVAS_WIDTH) {
        ent.pos.x = CANVAS_WIDTH - ent.radius;
        ent.vel.x *= BOUNCE_DAMPENING;
      }

      // Floor Collision
      if (ent.pos.y + ent.radius > FLOOR_Y && ent.gravityOn) {
        ent.pos.y = FLOOR_Y - ent.radius;
        ent.vel.y *= BOUNCE_DAMPENING;
        
        // Friction on floor
        ent.vel.x *= 0.8;
        ent.vRot *= 0.9; 

        // If it's barely bouncing, shatter it to clean up the board
        if (Math.abs(ent.vel.y) < 1.5) {
           this.spawnParticles(ent.pos.x, ent.pos.y, ent.hue, 20, 3);
           this.entities.splice(i, 1);
        }
      }

      // Cleanup floaters that went too high off screen
      if (!ent.gravityOn && ent.pos.y < -100) {
        this.entities.splice(i, 1);
      }
    }

    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      let p = this.particles[i];
      p.vel.y += GRAVITY; // Particles always have gravity
      p.x += p.vel.x; p.y += p.vel.y;
      
      if (p.y > FLOOR_Y) {
        p.y = FLOOR_Y;
        p.vel.y *= BOUNCE_DAMPENING;
      }
      
      p.life -= 0.02;
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    // Cut Marks
    for (let i = this.cutMarks.length - 1; i >= 0; i--) {
      this.cutMarks[i].life -= 0.05;
      if (this.cutMarks[i].life <= 0) this.cutMarks.splice(i, 1);
    }
  }

  // --- RENDERING ---
  draw() {
    this.ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw Neon Floor Line
    this.ctx.beginPath();
    this.ctx.moveTo(0, FLOOR_Y);
    this.ctx.lineTo(CANVAS_WIDTH, FLOOR_Y);
    this.ctx.strokeStyle = '#1e293b';
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    // Draw Entities
    this.entities.forEach(ent => {
      this.ctx.save();
      this.ctx.translate(ent.pos.x, ent.pos.y);
      this.ctx.rotate(ent.rot);

      this.ctx.beginPath();
      this.ctx.moveTo(ent.currentVertices[0].x, ent.currentVertices[0].y);
      for (let i = 1; i < ent.currentVertices.length; i++) {
        this.ctx.lineTo(ent.currentVertices[i].x, ent.currentVertices[i].y);
      }
      this.ctx.closePath();

      // Flashing white effect while morphing
      let colorStr = ent.isMorphing ? `hsl(${ent.hue}, 0%, 100%)` : `hsl(${ent.hue}, 80%, 65%)`;
      let fillStr = ent.isMorphing ? `hsla(${ent.hue}, 0%, 100%, 0.5)` : `hsla(${ent.hue}, 80%, 20%, 0.7)`;

      this.ctx.strokeStyle = colorStr;
      this.ctx.lineWidth = 3;
      this.ctx.shadowColor = `hsl(${ent.hue}, 100%, 50%)`;
      this.ctx.shadowBlur = ent.isMorphing ? 20 : 0;
      this.ctx.stroke();
      this.ctx.fillStyle = fillStr;
      this.ctx.fill();
      this.ctx.restore();
    });

    // Draw Particles
    this.particles.forEach(p => {
      this.ctx.fillStyle = `hsla(${p.hue}, 100%, 70%, ${p.life})`;
      this.ctx.fillRect(p.x, p.y, 4, 4);
    });

    // Draw Fading Cut Marks
    this.cutMarks.forEach(mark => {
      this.ctx.beginPath();
      this.ctx.moveTo(mark.p1.x, mark.p1.y);
      this.ctx.lineTo(mark.p2.x, mark.p2.y);
      this.ctx.strokeStyle = `rgba(255, 0, 85, ${mark.life})`;
      this.ctx.lineWidth = 3;
      this.ctx.stroke();
    });

    // Draw Active Cut Line
    if (this.isCutting) {
      this.ctx.beginPath();
      this.ctx.moveTo(this.cutStart.x, this.cutStart.y);
      this.ctx.lineTo(this.cutEnd.x, this.cutEnd.y);
      this.ctx.strokeStyle = 'var(--laser)';
      this.ctx.lineWidth = 2;
      this.ctx.stroke();
    }
  }

  // --- LOOP ---
  lastTime = performance.now();
  loop(timestamp = performance.now()) {
    const dt = timestamp - this.lastTime;
    this.lastTime = timestamp;
    this.update(dt);
    this.draw();
    requestAnimationFrame((t) => this.loop(t));
  }

  // --- UTILS & MATH ---
  generateRegularPolygon(sides, radius) {
    let points = [];
    for (let i = 0; i < sides; i++) {
      const angle = (i * 2 * Math.PI) / sides;
      points.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
    }
    return points;
  }

  normalizePolygon(vertices, targetCount) {
    let normalized = [...vertices];
    while (normalized.length < targetCount) {
      normalized.push({ ...normalized[normalized.length - 1] });
    }
    return normalized;
  }

  getPolygonCenter(vertices) {
    let x = 0, y = 0;
    vertices.forEach(v => { x += v.x; y += v.y; });
    return { x: x / vertices.length, y: y / vertices.length };
  }

  checkIntersection(p1, p2, p3, p4) {
    const denom = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);
    if (denom === 0) return null;
    const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denom;
    const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denom;
    if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
      return { x: p1.x + ua * (p2.x - p1.x), y: p1.y + ua * (p2.y - p1.y) };
    }
    return null;
  }

  spawnParticles(x, y, hue, count, speed) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: x, y: y,
        vel: {
          x: (Math.random() - 0.5) * speed,
          y: (Math.random() - 0.5) * speed - 2 // Burst upwards
        },
        life: 1.0, hue: hue
      });
    }
  }

  shakeScreen(intensity) {
    this.canvas.style.transform = `translate(${(Math.random()-0.5)*intensity}px, ${(Math.random()-0.5)*intensity}px)`;
    setTimeout(() => this.canvas.style.transform = 'translate(0,0)', 50);
  }

  easeOutBack(x) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  }

  // --- INPUT ---
  addListeners() {
    this.canvas.addEventListener('mousedown', (e) => {
      this.isCutting = true;
      this.cutStart = this.getMousePos(e);
      this.cutEnd = this.cutStart;
    });
    this.canvas.addEventListener('mousemove', (e) => {
      if (!this.isCutting) return;
      this.cutEnd = this.getMousePos(e);
    });
    window.addEventListener('mouseup', () => {
      if (!this.isCutting) return;
      this.isCutting = false;
      this.performSlice();
    });
  }

  getMousePos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
}

// Boot
const reactor = new KineticReactor();