/* ===========================================================
 *  match.js — Three.js(WebGL) 3D 축구 엔진
 *  · 시뮬레이션은 필드 좌표(FIELD)에서 처리, 렌더는 3D 월드로 매핑
 *  · 롤(LoL)식 클릭 이동, 마킹/프레싱/오프더볼 지능 AI
 *  · 원근 카메라 + 방향성 조명 + 그림자로 실사형 연출
 * =========================================================== */
(function (global) {
  "use strict";

  const THREE = global.THREE;

  // ----- 시뮬레이션 좌표계 (게임 로직) -----
  const FIELD = { w: 1050, h: 680 };
  const GOAL_H = 170;
  const PLAYER_R = 13;
  const BALL_R = 8;
  const FRICTION = 0.86;        // 선수 감속 (정지력)
  const BALL_FRICTION = 0.985;
  const HALF_SECONDS = 90;

  // ----- 3D 월드 좌표계 (미터 단위 느낌) -----
  const WORLD = { w: 105, h: 68 };
  const fx2wx = (fx) => (fx / FIELD.w - 0.5) * WORLD.w;
  const fy2wz = (fy) => (fy / FIELD.h - 0.5) * WORLD.h;
  const wx2fx = (wx) => (wx / WORLD.w + 0.5) * FIELD.w;
  const wz2fy = (wz) => (wz / WORLD.h + 0.5) * FIELD.h;

  // 4-3-3 비슷한 5인(필드4+GK) 포메이션. x:0=자기 골라인, 1=상대 골라인
  const FORMATION = [
    { role: "GK", x: 0.06, y: 0.50 },
    { role: "DF", x: 0.26, y: 0.27 },
    { role: "DF", x: 0.26, y: 0.73 },
    { role: "MF", x: 0.50, y: 0.50 },
    { role: "FW", x: 0.74, y: 0.50 },
  ];

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function len(x, y) { return Math.hypot(x, y); }

  class MatchEngine {
    constructor(canvas, home, away, opts = {}) {
      this.canvas = canvas;
      this.home = home;
      this.away = away;
      this.opts = opts;
      this.onGoal = opts.onGoal || function () {};
      this.onEnd = opts.onEnd || function () {};
      this.onClock = opts.onClock || function () {};

      this.score = { home: 0, away: 0 };
      this.half = 1;
      this.clock = 0;
      this.running = false;
      this.message = null;
      this.messageTimer = 0;
      this.goalFlash = 0;

      this.input = { pass: false, shoot: false };
      this.shootCharge = 0;
      this.controlled = null;

      this._resolveKits();
      this._buildPlayers();
      this._resetPositions("home");
      this._initThree();
      this._bind();
    }

    /* ============ 유니폼 색 충돌 처리 (어웨이 대체 키트) ============ */
    _resolveKits() {
      const homeJ = this.home.colors[0];
      let awayJ = this.away.colors[0];
      let awayS = this.away.colors[1];
      // 홈/어웨이 주색이 너무 비슷하면 어웨이는 보조색을 메인으로
      if (this._colorDist(homeJ, awayJ) < 110) {
        awayJ = this.away.colors[1];
        awayS = this.away.colors[0];
        // 보조색마저 비슷하면 어두운 대체색
        if (this._colorDist(homeJ, awayJ) < 110) { awayJ = "#222831"; awayS = "#cccccc"; }
      }
      this.kit = {
        home: { jersey: homeJ, shorts: this.home.colors[1] },
        away: { jersey: awayJ, shorts: awayS },
      };
    }
    _hex2rgb(h) {
      const s = h.replace("#", "");
      return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
    }
    _colorDist(a, b) {
      const x = this._hex2rgb(a), y = this._hex2rgb(b);
      return Math.sqrt((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2);
    }

    /* ============ 선수/공 데이터 ============ */
    _buildPlayers() {
      this.players = [];
      const mk = (team, f, idx) => {
        const rating = (team === "home" ? this.home.rating : this.away.rating) / 100;
        return {
          team, role: f.role, base: { x: f.x, y: f.y }, idx,
          x: 0, y: 0, vx: 0, vy: 0,
          speed: 1.8 + rating * 1.2 + (f.role === "FW" ? 0.25 : 0),
          rating,
          moveTarget: null, _touchCd: 0, faceX: team === "home" ? 1 : -1, faceY: 0,
          runPhase: Math.random() * Math.PI * 2,
        };
      };
      FORMATION.forEach((f, i) => this.players.push(mk("home", f, i)));
      FORMATION.forEach((f, i) => this.players.push(mk("away", f, i)));
      this.ball = { x: FIELD.w / 2, y: FIELD.h / 2, vx: 0, vy: 0, owner: null };
    }

    _formationPos(p) {
      const bx = p.team === "home" ? p.base.x : 1 - p.base.x;
      const by = p.team === "home" ? p.base.y : 1 - p.base.y;
      return { x: bx * FIELD.w, y: by * FIELD.h };
    }

    _resetPositions(kickoffTeam) {
      for (const p of this.players) {
        const fp = this._formationPos(p);
        p.x = fp.x; p.y = fp.y; p.vx = 0; p.vy = 0; p.moveTarget = null;
      }
      this.ball.x = FIELD.w / 2; this.ball.y = FIELD.h / 2;
      this.ball.vx = 0; this.ball.vy = 0; this.ball.owner = null;
      const mid = this.players.find((p) => p.team === kickoffTeam && p.role === "MF");
      if (mid) { mid.x = FIELD.w / 2 - (kickoffTeam === "home" ? 26 : -26); mid.y = FIELD.h / 2; }
    }

    /* ============ Three.js 초기화 ============ */
    _initThree() {
      const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer = renderer;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x88c6ff);
      scene.fog = new THREE.Fog(0x88c6ff, 120, 240);
      this.scene = scene;

      this.camera = new THREE.PerspectiveCamera(48, 16 / 9, 0.5, 500);
      this.camera.position.set(0, 60, 80);
      this.camera.lookAt(0, 0, 0);

      // 조명
      const hemi = new THREE.HemisphereLight(0xddeeff, 0x335522, 0.85);
      scene.add(hemi);
      const sun = new THREE.DirectionalLight(0xffffff, 1.25);
      sun.position.set(40, 90, 30);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      const s = 80;
      sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
      sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
      sun.shadow.camera.near = 10; sun.shadow.camera.far = 220;
      sun.shadow.bias = -0.0004;
      scene.add(sun);
      scene.add(new THREE.AmbientLight(0xffffff, 0.25));

      this._buildPitch();
      this._buildStadium();
      this._buildGoals();
      this._buildPlayerMeshes();
      this._buildBallMesh();

      this._raycaster = new THREE.Raycaster();
      this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      this._tmpV = new THREE.Vector3();
      this._camTarget = new THREE.Vector3();

      // 메시지 배너 (킥오프/골/하프타임)
      const banner = document.createElement("div");
      banner.className = "match-banner";
      banner.style.display = "none";
      this.canvas.parentElement.appendChild(banner);
      this._banner = banner;

      this._resize = () => this._onResize();
      this._onResize();
      window.addEventListener("resize", this._resize);
    }

    _onResize() {
      const wrap = this.canvas.parentElement;
      const w = wrap.clientWidth, h = wrap.clientHeight;
      this.renderer.setSize(w, h, true);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }

    // 잔디 + 라인 텍스처(캔버스)
    _makePitchTexture() {
      const c = document.createElement("canvas");
      c.width = 2100; c.height = 1360;
      const g = c.getContext("2d");
      const stripes = 14, sw = c.width / stripes;
      for (let i = 0; i < stripes; i++) {
        g.fillStyle = i % 2 ? "#2faa55" : "#279a4b";
        g.fillRect(i * sw, 0, sw, c.height);
      }
      g.strokeStyle = "rgba(255,255,255,0.92)";
      g.lineWidth = 6;
      const m = 40; // 여백
      g.strokeRect(m, m, c.width - 2 * m, c.height - 2 * m);
      g.beginPath(); g.moveTo(c.width / 2, m); g.lineTo(c.width / 2, c.height - m); g.stroke();
      g.beginPath(); g.arc(c.width / 2, c.height / 2, 150, 0, Math.PI * 2); g.stroke();
      g.beginPath(); g.arc(c.width / 2, c.height / 2, 8, 0, Math.PI * 2); g.fillStyle = "#fff"; g.fill();
      const boxH = 560, boxW = 280, gy = c.height / 2;
      g.strokeRect(m, gy - boxH / 2, boxW, boxH);
      g.strokeRect(c.width - m - boxW, gy - boxH / 2, boxW, boxH);
      const sixH = 280, sixW = 120;
      g.strokeRect(m, gy - sixH / 2, sixW, sixH);
      g.strokeRect(c.width - m - sixW, gy - sixH / 2, sixW, sixH);
      const tex = new THREE.CanvasTexture(c);
      tex.anisotropy = 8;
      if ("colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }

    _buildPitch() {
      const tex = this._makePitchTexture();
      const geo = new THREE.PlaneGeometry(WORLD.w, WORLD.h);
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 });
      const pitch = new THREE.Mesh(geo, mat);
      pitch.rotation.x = -Math.PI / 2;
      pitch.receiveShadow = true;
      this.scene.add(pitch);
      // 잔디 바깥 외곽(짙은 잔디 + 트랙 느낌)
      const outer = new THREE.Mesh(
        new THREE.PlaneGeometry(WORLD.w + 30, WORLD.h + 24),
        new THREE.MeshStandardMaterial({ color: 0x18632f, roughness: 1 })
      );
      outer.rotation.x = -Math.PI / 2;
      outer.position.y = -0.05;
      outer.receiveShadow = true;
      this.scene.add(outer);
    }

    _crowdTexture() {
      const c = document.createElement("canvas");
      c.width = 256; c.height = 64;
      const g = c.getContext("2d");
      g.fillStyle = "#0c1320"; g.fillRect(0, 0, c.width, c.height);
      const cols = ["#e74c3c", "#ecf0f1", "#3498db", "#f1c40f", "#2ecc71", "#e67e22", "#9b59b6"];
      for (let i = 0; i < 1400; i++) {
        g.fillStyle = cols[(Math.random() * cols.length) | 0];
        g.globalAlpha = 0.5 + Math.random() * 0.5;
        g.fillRect(Math.random() * c.width, Math.random() * c.height, 2, 2);
      }
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(20, 3);
      return tex;
    }

    _buildStadium() {
      const crowd = this._crowdTexture();
      const standMat = new THREE.MeshStandardMaterial({ map: crowd, roughness: 1 });
      const baseMat = new THREE.MeshStandardMaterial({ color: 0x222a35, roughness: 1 });
      const standH = 11, standD = 22;
      const mk = (w, d, x, z, ry) => {
        const grp = new THREE.Group();
        const tier = new THREE.Mesh(new THREE.BoxGeometry(w, standH, d), standMat);
        tier.position.y = standH / 2 + 1;
        tier.rotation.x = -0.32;
        grp.add(tier);
        const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 3, 2), baseMat);
        wall.position.set(0, 1.5, -d / 2 + 1);
        grp.add(wall);
        grp.position.set(x, 0, z);
        grp.rotation.y = ry;
        this.scene.add(grp);
      };
      mk(WORLD.w + 30, standD, 0, -(WORLD.h / 2 + standD / 2 + 4), 0);
      mk(WORLD.w + 30, standD, 0, (WORLD.h / 2 + standD / 2 + 4), Math.PI);
      mk(WORLD.h + 20, standD, -(WORLD.w / 2 + standD / 2 + 4), 0, Math.PI / 2);
      mk(WORLD.h + 20, standD, (WORLD.w / 2 + standD / 2 + 4), 0, -Math.PI / 2);
    }

    _buildGoals() {
      const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
      const goalW = (GOAL_H / FIELD.h) * WORLD.h; // z 방향 폭
      const half = goalW / 2, barH = 4, postR = 0.25, depth = 3;
      const netMat = new THREE.MeshStandardMaterial({
        color: 0xffffff, transparent: true, opacity: 0.18, side: THREE.DoubleSide,
      });
      const mkGoal = (sign) => {
        const grp = new THREE.Group();
        const xEnd = sign * (WORLD.w / 2);
        for (const z of [-half, half]) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(postR, postR, barH, 10), postMat);
          post.position.set(0, barH / 2, z); post.castShadow = true; grp.add(post);
        }
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(postR, postR, goalW, 10), postMat);
        bar.rotation.x = Math.PI / 2; bar.position.set(0, barH, 0); bar.castShadow = true; grp.add(bar);
        const net = new THREE.Mesh(new THREE.PlaneGeometry(goalW, barH), netMat);
        net.position.set(-sign * depth, barH / 2, 0); net.rotation.y = Math.PI / 2; grp.add(net);
        const top = new THREE.Mesh(new THREE.PlaneGeometry(depth, goalW), netMat);
        top.position.set(-sign * depth / 2, barH, 0); top.rotation.x = Math.PI / 2; grp.add(top);
        grp.position.x = xEnd;
        this.scene.add(grp);
      };
      mkGoal(1); mkGoal(-1);
    }

    _buildPlayerMeshes() {
      for (const p of this.players) {
        const kit = this.kit[p.team];
        const jersey = p.role === "GK" ? "#1a1a1a" : kit.jersey;
        const shorts = p.role === "GK" ? "#333333" : kit.shorts;
        const grp = new THREE.Group();
        // 다리
        const legMat = new THREE.MeshStandardMaterial({ color: shorts, roughness: 0.8 });
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.3, 1.4, 8), legMat);
        leg.position.y = 0.7; leg.castShadow = true; grp.add(leg);
        // 상체
        const torsoMat = new THREE.MeshStandardMaterial({ color: jersey, roughness: 0.7 });
        const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.5, 1.5, 10), torsoMat);
        torso.position.y = 2.05; torso.castShadow = true; grp.add(torso);
        // 머리
        const head = new THREE.Mesh(
          new THREE.SphereGeometry(0.42, 12, 12),
          new THREE.MeshStandardMaterial({ color: 0xe8b88a, roughness: 0.6 })
        );
        head.position.y = 3.1; head.castShadow = true; grp.add(head);
        // 조작 표시 링
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(1.2, 0.13, 8, 28),
          new THREE.MeshStandardMaterial({ color: 0xffe23a, emissive: 0x886600, roughness: 0.4 })
        );
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; ring.visible = false;
        grp.add(ring);
        p._ring = ring;
        // 이동 목표 마커(클릭 위치)
        this.scene.add(grp);
        p.mesh = grp;
      }
      // 클릭 목적지 표시기(홈 조작 선수용)
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(0.6, 1.0, 24),
        new THREE.MeshBasicMaterial({ color: 0x33ff88, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
      );
      marker.rotation.x = -Math.PI / 2; marker.position.y = 0.08; marker.visible = false;
      this.scene.add(marker);
      this._moveMarker = marker;
    }

    _buildBallMesh() {
      const ball = new THREE.Mesh(
        new THREE.SphereGeometry(0.55, 18, 18),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.05 })
      );
      ball.castShadow = true;
      this.scene.add(ball);
      this.ballMesh = ball;
    }

    /* ============ 입력 (클릭 이동 + 패스/슛) ============ */
    _bind() {
      // 키보드(보조): J 패스, K 슛
      this._keydown = (e) => this._key(e, true);
      this._keyup = (e) => this._key(e, false);
      window.addEventListener("keydown", this._keydown);
      window.addEventListener("keyup", this._keyup);
      // 포인터(클릭/터치) 이동
      this._ptrDown = (e) => { this._pointerActive = true; this._moveTo(e); };
      this._ptrMove = (e) => { if (this._pointerActive) this._moveTo(e); };
      this._ptrUp = () => { this._pointerActive = false; };
      this.canvas.addEventListener("pointerdown", this._ptrDown);
      this.canvas.addEventListener("pointermove", this._ptrMove);
      window.addEventListener("pointerup", this._ptrUp);
      this.canvas.style.touchAction = "none";
    }
    destroy() {
      this.running = false;
      window.removeEventListener("keydown", this._keydown);
      window.removeEventListener("keyup", this._keyup);
      window.removeEventListener("pointerup", this._ptrUp);
      this.canvas.removeEventListener("pointerdown", this._ptrDown);
      this.canvas.removeEventListener("pointermove", this._ptrMove);
      window.removeEventListener("resize", this._resize);
      if (this._banner && this._banner.parentElement) this._banner.parentElement.removeChild(this._banner);
      if (this.renderer) this.renderer.dispose();
    }
    _key(e, down) {
      const k = e.key.toLowerCase();
      if (k === "j") { this.input.pass = down; e.preventDefault(); }
      else if (k === "k" || k === " ") { this.input.shoot = down; e.preventDefault(); }
    }
    setInput(name, val) { if (name in this.input) this.input[name] = val; }

    _moveTo(e) {
      if (!this.controlled || !this.controlled.team || this.controlled.team !== "home") return;
      const rect = this.canvas.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this._raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
      const hit = this._raycaster.ray.intersectPlane(this._groundPlane, this._tmpV);
      if (!hit) return;
      const fx = clamp(wx2fx(hit.x), 10, FIELD.w - 10);
      const fy = clamp(wz2fy(hit.z), 10, FIELD.h - 10);
      this.controlled.moveTarget = { x: fx, y: fy };
    }

    /* ============ 루프 ============ */
    start() {
      this.running = true;
      this.message = `${this.home.name}  VS  ${this.away.name}`;
      this.messageTimer = 1.8;
      this.lastTs = performance.now();
      const loop = (ts) => {
        if (!this.running) return;
        let dt = (ts - this.lastTs) / 1000;
        this.lastTs = ts;
        if (dt > 0.05) dt = 0.05;
        this._update(dt);
        this._sync();
        this.renderer.render(this.scene, this.camera);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    _update(dt) {
      if (this.messageTimer > 0) {
        this.messageTimer -= dt;
        if (this.messageTimer <= 0) this.message = null;
        this._updateCamera(dt);
        return; // 메시지 중에는 시계/플레이 정지
      }
      this.clock += dt;
      this.onClock(this._clockLabel());
      if (this.clock >= HALF_SECONDS) { this._endHalf(); return; }

      this._chooseControlled();
      this._handleInput(dt);
      this._ai(dt);
      this._integrate(dt);
      this._ballPhysics(dt);
      this._collisions();
      this._checkGoal();
      this._updateCamera(dt);
      if (this.goalFlash > 0) this.goalFlash -= dt * 1.5;
    }

    _clockLabel() {
      const base = this.half === 1 ? 0 : 45;
      const t = base + (this.clock / HALF_SECONDS) * 45;
      const minute = Math.floor(t);
      const sec = Math.floor((t - minute) * 60);
      return `${String(minute).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    }

    _endHalf() {
      if (this.half === 1) {
        this.half = 2; this.clock = 0;
        this.message = "하프타임 — 후반 시작!";
        this.messageTimer = 1.8;
        this._resetPositions(this.score.home <= this.score.away ? "home" : "away");
      } else {
        this.running = false;
        this.onEnd({ ...this.score });
      }
    }

    /* ============ 조작 선수 ============ */
    _chooseControlled() {
      let prev = this.controlled;
      if (this.ball.owner && this.ball.owner.team === "home") {
        this.controlled = this.ball.owner;
      } else {
        let best = null, bd = Infinity;
        for (const p of this.players) {
          if (p.team !== "home" || p.role === "GK") continue;
          const d = dist2(p.x, p.y, this.ball.x, this.ball.y);
          if (d < bd) { bd = d; best = p; }
        }
        this.controlled = best;
      }
      if (prev && prev !== this.controlled) prev.moveTarget = null;
    }

    _handleInput(dt) {
      const p = this.controlled;
      if (!p) return;
      // 클릭 이동 목표로 이동
      if (p.moveTarget) {
        const dx = p.moveTarget.x - p.x, dy = p.moveTarget.y - p.y;
        const d = len(dx, dy);
        if (d < 8) { p.moveTarget = null; }
        else { p.vx = (dx / d) * p.speed; p.vy = (dy / d) * p.speed; p.faceX = dx / d; p.faceY = dy / d; }
      }
      // 슛 차징/발사
      if (this.input.shoot && this.ball.owner === p) {
        this.shootCharge = Math.min(this.shootCharge + dt, 1);
      } else if (!this.input.shoot && this.shootCharge > 0) {
        if (this.ball.owner === p) this._shoot(p, this.shootCharge);
        this.shootCharge = 0;
      }
      if (this.input.pass && this.ball.owner === p) { this._pass(p); this.input.pass = false; }
    }

    _shoot(p, charge) {
      const goalX = p.team === "home" ? FIELD.w : 0;
      const goalY = FIELD.h / 2 + (Math.random() - 0.5) * GOAL_H * 0.65;
      let dx = goalX - this.ball.x, dy = goalY - this.ball.y;
      const l = len(dx, dy) || 1;
      const power = 9 + charge * 9;
      this.ball.vx = (dx / l) * power;
      this.ball.vy = (dy / l) * power;
      this.ball.owner = null;
      p._touchCd = 0.5;
    }

    _pass(p) {
      // 전방·열린 동료 우선 (상대가 길목에 없는 패스)
      let best = null, bScore = -Infinity;
      const fwd = p.team === "home" ? 1 : -1;
      for (const m of this.players) {
        if (m === p || m.team !== p.team || m.role === "GK") continue;
        const ahead = (m.x - p.x) * fwd;
        const d = Math.sqrt(dist2(p.x, p.y, m.x, m.y));
        if (d < 40) continue;
        const open = this._laneOpen(p, m) ? 60 : -40;
        const score = ahead * 1.0 - d * 0.25 + open;
        if (score > bScore) { bScore = score; best = m; }
      }
      if (!best) return;
      let dx = best.x - this.ball.x, dy = best.y - this.ball.y;
      const l = len(dx, dy) || 1;
      const power = clamp(l / 32, 5.5, 12);
      this.ball.vx = (dx / l) * power;
      this.ball.vy = (dy / l) * power;
      this.ball.owner = null;
      p._touchCd = 0.3;
    }

    _laneOpen(from, to) {
      // 패스 경로 상에 상대 선수가 있으면 막힘
      for (const o of this.players) {
        if (o.team === from.team) continue;
        const t = this._projT(from, to, o);
        if (t > 0.1 && t < 0.95) {
          const px = from.x + (to.x - from.x) * t, py = from.y + (to.y - from.y) * t;
          if (dist2(px, py, o.x, o.y) < 45 * 45) return false;
        }
      }
      return true;
    }
    _projT(a, b, o) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const l2 = dx * dx + dy * dy || 1;
      return ((o.x - a.x) * dx + (o.y - a.y) * dy) / l2;
    }

    /* ============ 지능 AI ============ */
    _ai(dt) {
      // 팀별 볼 소유/프레서 계산
      const ball = this.ball;
      const presser = {
        home: this._closestToBall("home"),
        away: this._closestToBall("away"),
      };

      for (const p of this.players) {
        if (p._touchCd > 0) p._touchCd -= dt;
        if (p === this.controlled) continue;

        const home = this._formationPos(p);
        const ownsBall = ball.owner === p;
        const teamHasBall = ball.owner && ball.owner.team === p.team;
        const goalX = p.team === "home" ? FIELD.w : 0;
        const ownGoalX = p.team === "home" ? 0 : FIELD.w;
        let tx = home.x, ty = home.y;
        let sp = p.speed;

        if (p.role === "GK") {
          const lineX = p.team === "home" ? FIELD.w * 0.045 : FIELD.w * 0.955;
          tx = lineX;
          ty = clamp(ball.y, FIELD.h / 2 - GOAL_H / 2 + 8, FIELD.h / 2 + GOAL_H / 2 - 8);
          // 가까운 루즈볼은 적극 처리
          const near = Math.abs(ball.x - lineX) < FIELD.w * 0.14;
          if (near && !ball.owner && dist2(p.x, p.y, ball.x, ball.y) < 130 * 130) { tx = ball.x; ty = ball.y; }
          sp = p.speed * 0.95;
        } else if (ownsBall) {
          // 드리블: 골 방향, 압박 받으면 패스
          tx = goalX; ty = FIELD.h / 2 * 0.4 + ball.y * 0.6;
          const distGoal = Math.abs(goalX - p.x);
          const pressed = this._nearestOpp(p) < 55;
          if (distGoal < FIELD.w * 0.26 && p._touchCd <= 0 && Math.random() < 0.04) {
            this._shoot(p, 0.6 + Math.random() * 0.4);
          } else if (pressed && p._touchCd <= 0 && Math.random() < 0.06) {
            this._pass(p);
          }
          sp = p.speed * 0.82;
        } else if (teamHasBall) {
          // 오프더볼: 전진 + 폭 벌리기 + 침투 런
          p.runPhase += dt * 1.4;
          const push = (p.team === "home" ? 1 : -1) * (p.role === "FW" ? 0.16 : p.role === "MF" ? 0.08 : -0.02);
          const widen = (home.y < FIELD.h / 2 ? -1 : 1) * 24 * Math.sin(p.runPhase) * (p.role === "DF" ? 0.3 : 1);
          tx = clamp(home.x + push * FIELD.w, 50, FIELD.w - 50);
          ty = clamp(home.y * 0.55 + ball.y * 0.25 + widen + FIELD.h / 2 * 0.2, 40, FIELD.h - 40);
          sp = p.speed * 0.92;
        } else {
          // 수비: 프레서 1명만 볼 압박, 나머지는 마킹/지역 수비
          if (p === presser[p.team] && p.role !== "DF") {
            tx = ball.x; ty = ball.y; sp = p.speed * 0.98;
          } else if (p === presser[p.team]) {
            tx = ball.x; ty = ball.y; sp = p.speed * 0.95;
          } else {
            const mark = this._markTarget(p);
            if (mark) {
              // 상대와 자기 골 사이(골사이드)에 위치
              const gx = ownGoalX, gy = FIELD.h / 2;
              tx = mark.x * 0.7 + gx * 0.3;
              ty = mark.y * 0.78 + gy * 0.22;
            } else {
              tx = home.x * 0.55 + ball.x * 0.25 + ownGoalX * 0.2;
              ty = home.y * 0.6 + ball.y * 0.4;
            }
            sp = p.speed * 0.85;
          }
        }

        // 이동 적용 (NPC는 전체적으로 느리게)
        sp *= 0.82;
        const dx = tx - p.x, dy = ty - p.y;
        const d = len(dx, dy);
        if (d > 5) {
          p.vx = (dx / d) * sp; p.vy = (dy / d) * sp;
          p.faceX = dx / d; p.faceY = dy / d;
        } else { p.vx = 0; p.vy = 0; }
      }
    }

    _closestToBall(team) {
      let best = null, bd = Infinity;
      for (const p of this.players) {
        if (p.team !== team || p.role === "GK") continue;
        const d = dist2(p.x, p.y, this.ball.x, this.ball.y);
        if (d < bd) { bd = d; best = p; }
      }
      return best;
    }
    _nearestOpp(p) {
      let bd = Infinity;
      for (const o of this.players) {
        if (o.team === p.team) continue;
        const d = dist2(p.x, p.y, o.x, o.y);
        if (d < bd) bd = d;
      }
      return Math.sqrt(bd);
    }
    // 가장 위협적인(자기 골에 가까운) 미마킹 상대 선택
    _markTarget(p) {
      const ownGoalX = p.team === "home" ? 0 : FIELD.w;
      let best = null, bScore = Infinity;
      for (const o of this.players) {
        if (o.team === p.team || o.role === "GK") continue;
        if (o === this.ball.owner) continue;
        const threat = Math.abs(o.x - ownGoalX); // 작을수록 위협적
        const near = Math.sqrt(dist2(p.x, p.y, o.x, o.y));
        const score = threat + near * 0.6;
        if (score < bScore) { bScore = score; best = o; }
      }
      return best;
    }

    /* ============ 물리 ============ */
    _integrate(dt) {
      const step = dt * 60;
      for (const p of this.players) {
        p.x += p.vx * step; p.y += p.vy * step;
        p.vx *= FRICTION; p.vy *= FRICTION;
        p.x = clamp(p.x, PLAYER_R, FIELD.w - PLAYER_R);
        p.y = clamp(p.y, PLAYER_R, FIELD.h - PLAYER_R);
      }
    }

    _ballPhysics(dt) {
      const b = this.ball, step = dt * 60;
      if (b.owner) {
        const fl = len(b.owner.faceX, b.owner.faceY) || 1;
        b.x = b.owner.x + (b.owner.faceX / fl) * (PLAYER_R + 7);
        b.y = b.owner.y + (b.owner.faceY / fl) * (PLAYER_R + 7);
        b.vx = 0; b.vy = 0; return;
      }
      b.x += b.vx * step; b.y += b.vy * step;
      b.vx *= BALL_FRICTION; b.vy *= BALL_FRICTION;
      if (b.y < BALL_R) { b.y = BALL_R; b.vy *= -0.7; }
      if (b.y > FIELD.h - BALL_R) { b.y = FIELD.h - BALL_R; b.vy *= -0.7; }
      const inGoalY = b.y > FIELD.h / 2 - GOAL_H / 2 && b.y < FIELD.h / 2 + GOAL_H / 2;
      if (b.x < BALL_R && !inGoalY) { b.x = BALL_R; b.vx *= -0.7; }
      if (b.x > FIELD.w - BALL_R && !inGoalY) { b.x = FIELD.w - BALL_R; b.vx *= -0.7; }
    }

    _collisions() {
      const b = this.ball;
      for (const p of this.players) {
        if (p._touchCd > 0) continue;
        const rr = (PLAYER_R + BALL_R + 5) ** 2;
        if (dist2(p.x, p.y, b.x, b.y) < rr) {
          if (!b.owner) { b.owner = p; }
          else if (b.owner.team !== p.team) {
            const steal = 0.5 + (p.rating - b.owner.rating) * 0.5;
            if (Math.random() < steal * 0.18) { b.owner = p; p._touchCd = 0.25; }
          }
        }
      }
      for (let i = 0; i < this.players.length; i++) {
        for (let j = i + 1; j < this.players.length; j++) {
          const a = this.players[i], c = this.players[j];
          const dx = c.x - a.x, dy = c.y - a.y;
          const d = len(dx, dy), min = PLAYER_R * 2;
          if (d > 0 && d < min) {
            const push = (min - d) / 2, nx = dx / d, ny = dy / d;
            a.x -= nx * push; a.y -= ny * push;
            c.x += nx * push; c.y += ny * push;
          }
        }
      }
    }

    _checkGoal() {
      const b = this.ball;
      const inGoalY = b.y > FIELD.h / 2 - GOAL_H / 2 && b.y < FIELD.h / 2 + GOAL_H / 2;
      if (b.x <= BALL_R + 2 && inGoalY) this._goal("away");
      else if (b.x >= FIELD.w - BALL_R - 2 && inGoalY) this._goal("home");
    }

    _goal(scorer) {
      this.score[scorer]++;
      this.onGoal(scorer, { ...this.score });
      const name = scorer === "home" ? this.home.name : this.away.name;
      this.message = `⚽ GOAL!  —  ${name}`;
      this.messageTimer = 1.9;
      this.goalFlash = 1;
      this._resetPositions(scorer === "home" ? "away" : "home");
    }

    /* ============ 3D 동기화 ============ */
    _sync() {
      for (const p of this.players) {
        p.mesh.position.set(fx2wx(p.x), 0, fy2wz(p.y));
        const ang = Math.atan2(fx2wx(p.x + p.faceX) - fx2wx(p.x), fy2wz(p.y + p.faceY) - fy2wz(p.y));
        p.mesh.rotation.y = ang;
        if (p._ring) p._ring.visible = (p === this.controlled);
      }
      // 공 (튀는 높이 약간)
      const bh = 0.55 + Math.abs(Math.sin((this.ball.x + this.ball.y) * 0.02)) * 0.15 * (this.ball.owner ? 0 : 1);
      this.ballMesh.position.set(fx2wx(this.ball.x), bh, fy2wz(this.ball.y));
      // 이동 마커
      const c = this.controlled;
      if (c && c.moveTarget) {
        this._moveMarker.visible = true;
        this._moveMarker.position.set(fx2wx(c.moveTarget.x), 0.08, fy2wz(c.moveTarget.y));
      } else { this._moveMarker.visible = false; }
      // 메시지 배너
      if (this._banner) {
        if (this.message) {
          if (this._banner.textContent !== this.message) this._banner.textContent = this.message;
          this._banner.style.display = "block";
          this._banner.classList.toggle("goal", this.goalFlash > 0);
        } else {
          this._banner.style.display = "none";
        }
      }
    }

    _updateCamera(dt) {
      // 방송형 추적 카메라: 공을 따라 측면 상공에서
      const bx = fx2wx(this.ball.x), bz = fy2wz(this.ball.y);
      // 높고 가파른 방송형 카메라: 측면 추적은 약하게 해서 피치를 항상 화면에 유지
      const desired = this._tmpV.set(bx * 0.32, 70, bz * 0.18 + WORLD.h / 2 + 26);
      const k = 1 - Math.pow(0.0015, dt);
      this.camera.position.lerp(desired, Math.min(k * 2.0, 1));
      this._camTarget.set(bx * 0.4, 0, bz * 0.32 - 4);
      this.camera.lookAt(this._camTarget);
    }
  }

  global.MatchEngine = MatchEngine;
})(window);
