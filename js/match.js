/* ===========================================================
 *  match.js — Three.js(WebGL) 3D 축구 엔진 · 11 vs 11 · 풀 룰
 *  · 실제 축구 규칙: 스로인/코너/골킥/킥오프, 오프사이드, 파울·프리킥,
 *    페널티킥, 옐로/레드 카드, GK 선방, 체력(스태미너)
 *  · 롤(LoL)식 클릭 이동, 지능 AI(프레싱/마킹/오프더볼/패스 길목)
 *  · 실시간 스탯(점유율·슈팅), 추가시간, 사운드·해설
 * =========================================================== */
(function (global) {
  "use strict";
  const THREE = global.THREE;

  // ----- 시뮬레이션 좌표계 -----
  const FIELD = { w: 1050, h: 680 };
  const GOAL_H = 150;                 // 골문 폭(y)
  const PLAYER_R = 12, BALL_R = 8;
  const FRICTION = 0.86, BALL_FRICTION = 0.987;
  const HALF_SECONDS = 90;            // 전/후반 실초(=45분 표시)
  // 페널티 박스
  const PBOX_DX = 165, PBOX_HY = 200, PEN_SPOT = 110;
  const cy = FIELD.h / 2;

  // ----- 3D 월드 좌표계 -----
  const WORLD = { w: 105, h: 68 };
  const fx2wx = (fx) => (fx / FIELD.w - 0.5) * WORLD.w;
  const fy2wz = (fy) => (fy / FIELD.h - 0.5) * WORLD.h;
  const wx2fx = (wx) => (wx / WORLD.w + 0.5) * FIELD.w;
  const wz2fy = (wz) => (wz / WORLD.h + 0.5) * FIELD.h;

  // ----- 포메이션 (x:0 자기 골라인 → 1 상대 골라인) -----
  const FORMATIONS = {
    "4-3-3": [
      { role: "GK", x: 0.05, y: 0.50 },
      { role: "DF", x: 0.20, y: 0.16 }, { role: "DF", x: 0.17, y: 0.38 },
      { role: "DF", x: 0.17, y: 0.62 }, { role: "DF", x: 0.20, y: 0.84 },
      { role: "MF", x: 0.40, y: 0.30 }, { role: "MF", x: 0.38, y: 0.50 }, { role: "MF", x: 0.40, y: 0.70 },
      { role: "FW", x: 0.68, y: 0.22 }, { role: "FW", x: 0.74, y: 0.50 }, { role: "FW", x: 0.68, y: 0.78 },
    ],
    "4-4-2": [
      { role: "GK", x: 0.05, y: 0.50 },
      { role: "DF", x: 0.20, y: 0.16 }, { role: "DF", x: 0.17, y: 0.38 },
      { role: "DF", x: 0.17, y: 0.62 }, { role: "DF", x: 0.20, y: 0.84 },
      { role: "MF", x: 0.42, y: 0.18 }, { role: "MF", x: 0.40, y: 0.42 },
      { role: "MF", x: 0.40, y: 0.58 }, { role: "MF", x: 0.42, y: 0.82 },
      { role: "FW", x: 0.70, y: 0.38 }, { role: "FW", x: 0.70, y: 0.62 },
    ],
    "3-5-2": [
      { role: "GK", x: 0.05, y: 0.50 },
      { role: "DF", x: 0.18, y: 0.28 }, { role: "DF", x: 0.16, y: 0.50 }, { role: "DF", x: 0.18, y: 0.72 },
      { role: "MF", x: 0.40, y: 0.12 }, { role: "MF", x: 0.42, y: 0.34 }, { role: "MF", x: 0.40, y: 0.50 },
      { role: "MF", x: 0.42, y: 0.66 }, { role: "MF", x: 0.40, y: 0.88 },
      { role: "FW", x: 0.72, y: 0.40 }, { role: "FW", x: 0.72, y: 0.60 },
    ],
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function len(x, y) { return Math.hypot(x, y); }
  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[(Math.random() * a.length) | 0]; }

  class MatchEngine {
    constructor(canvas, home, away, opts = {}) {
      this.canvas = canvas;
      this.home = home; this.away = away; this.opts = opts;
      this.onGoal = opts.onGoal || function () {};
      this.onEnd = opts.onEnd || function () {};
      this.onClock = opts.onClock || function () {};
      this.onStats = opts.onStats || function () {};
      this.userFormation = opts.userFormation || "4-3-3";
      this.awayFormation = pick(Object.keys(FORMATIONS));

      this.score = { home: 0, away: 0 };
      this.scorers = [];
      this.half = 1; this.clock = 0; this.addedTime = 0;
      this.running = false; this.message = null; this.messageTimer = 0;
      this.goalFlash = 0;
      this.phase = "kickoff";        // kickoff | play | dead | penalty
      this.dead = null;              // 데드볼 정보
      this.lastTouch = null;
      this.pendingOffside = null;
      this.stats = {
        home: { poss: 0, shots: 0, sot: 0, corners: 0, fouls: 0, yellow: 0, red: 0 },
        away: { poss: 0, shots: 0, sot: 0, corners: 0, fouls: 0, yellow: 0, red: 0 },
      };

      this.input = { pass: false, shoot: false };
      this.shootCharge = 0; this.controlled = null;

      this._resolveKits();
      this._buildPlayers();
      this._kickoffReset("home");
      this._initThree();
      this._bind();
    }

    /* ===== 유니폼 충돌 ===== */
    _resolveKits() {
      const hJ = this.home.colors[0];
      let aJ = this.away.colors[0], aS = this.away.colors[1];
      if (this._cdist(hJ, aJ) < 110) {
        aJ = this.away.colors[1]; aS = this.away.colors[0];
        if (this._cdist(hJ, aJ) < 110) { aJ = "#23304a"; aS = "#dfe6ee"; }
      }
      this.kit = { home: { jersey: hJ, shorts: this.home.colors[1] }, away: { jersey: aJ, shorts: aS } };
    }
    _hex(h) { const s = h.replace("#", ""); return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]; }
    _cdist(a, b) { const x = this._hex(a), y = this._hex(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); }

    /* ===== 선수 구성 (이름·능력치) ===== */
    _buildPlayers() {
      this.players = [];
      const mkTeam = (team, teamData, formationName) => {
        const form = FORMATIONS[formationName];
        const pool = (global.NamePool ? global.NamePool.get(teamData.id) : null) || [];
        const usedNums = new Set();
        form.forEach((f, i) => {
          const r = teamData.rating;
          const bias = f.role === "GK" ? 2 : 0;
          const base = clamp(r + bias + rnd(-5, 5), 55, 96);
          const attr = this._attrs(f.role, base);
          let num = f.role === "GK" ? 1 : (Math.random() * 25 + 2) | 0;
          while (usedNums.has(num)) num = (Math.random() * 30 + 2) | 0;
          usedNums.add(num);
          const name = pool.length ? pool[(i + (team === "away" ? 5 : 0)) % pool.length] : "선수";
          this.players.push({
            team, role: f.role, base: { x: f.x, y: f.y }, idx: i, name, number: num,
            attr, rating: base / 100,
            x: 0, y: 0, vx: 0, vy: 0, faceX: team === "home" ? 1 : -1, faceY: 0,
            speedBase: 1.45 + (attr.pace / 100) * 1.7 + (f.role === "FW" ? 0.2 : 0),
            stamina: 100, yellow: 0, sentOff: false,
            moveTarget: null, _touchCd: 0, runPhase: Math.random() * 6.28,
          });
        });
      };
      mkTeam("home", this.home, this.userFormation);
      mkTeam("away", this.away, this.awayFormation);
      this.ball = { x: FIELD.w / 2, y: cy, vx: 0, vy: 0, owner: null, h: 0, vh: 0 };
    }

    _attrs(role, base) {
      const j = () => clamp(base + rnd(-8, 8), 45, 97);
      let pace = j(), shoot = j(), pass = j(), defend = j();
      if (role === "FW") { shoot = clamp(shoot + 8, 45, 99); pace = clamp(pace + 5, 45, 99); }
      else if (role === "MF") { pass = clamp(pass + 8, 45, 99); }
      else if (role === "DF") { defend = clamp(defend + 9, 45, 99); }
      else if (role === "GK") { defend = clamp(base + 6, 45, 99); pace = clamp(pace - 8, 40, 90); }
      return { pace: Math.round(pace), shoot: Math.round(shoot), pass: Math.round(pass), defend: Math.round(defend) };
    }

    _formationPos(p) {
      const bx = p.team === "home" ? p.base.x : 1 - p.base.x;
      const by = p.team === "home" ? p.base.y : 1 - p.base.y;
      return { x: bx * FIELD.w, y: by * FIELD.h };
    }

    _kickoffReset(kickoffTeam) {
      for (const p of this.players) {
        if (p.sentOff) continue;
        const fp = this._formationPos(p);
        // 킥오프엔 자기 진영으로 (상대 진영 침범 금지 느낌)
        p.x = fp.x; p.y = fp.y; p.vx = 0; p.vy = 0; p.moveTarget = null;
      }
      this.ball.x = FIELD.w / 2; this.ball.y = cy; this.ball.vx = 0; this.ball.vy = 0;
      this.ball.owner = null; this.ball.h = 0; this.ball.vh = 0;
      const mid = this.players.find((p) => p.team === kickoffTeam && p.role === "MF" && !p.sentOff);
      if (mid) { mid.x = FIELD.w / 2 - (kickoffTeam === "home" ? 22 : -22); mid.y = cy; this.ball.owner = mid; this.lastTouch = mid; }
      this.phase = "kickoff";
      this.kickoffTeam = kickoffTeam;
      this._kickWhistled = false;
    }

    /* ===== Three.js ===== */
    _initThree() {
      const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      if ("outputColorSpace" in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;
      if ("toneMapping" in renderer) { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; }
      this.renderer = renderer;

      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog(0xbcd9f0, 170, 320);
      this.scene = scene;

      this.camera = new THREE.PerspectiveCamera(46, 16 / 9, 0.5, 800);
      this.camera.position.set(0, 70, 86); this.camera.lookAt(0, 0, 0);

      this._buildSky();

      scene.add(new THREE.HemisphereLight(0xcfe6ff, 0x2c5a30, 0.7));
      const sun = new THREE.DirectionalLight(0xfff4e0, 2.0);
      sun.position.set(60, 120, 40); sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      const s = 85;
      sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
      sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
      sun.shadow.camera.near = 10; sun.shadow.camera.far = 280; sun.shadow.bias = -0.0004; sun.shadow.radius = 3;
      scene.add(sun);
      const fill = new THREE.DirectionalLight(0xbfd4ff, 0.4); fill.position.set(-50, 60, -30); scene.add(fill);
      scene.add(new THREE.AmbientLight(0xffffff, 0.18));

      this._buildPitch(); this._buildStadium(); this._buildGoals();
      this._buildPlayerMeshes(); this._buildBallMesh();

      this._raycaster = new THREE.Raycaster();
      this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      this._tmpV = new THREE.Vector3(); this._camTarget = new THREE.Vector3();
      this._projV = new THREE.Vector3();

      const banner = document.createElement("div");
      banner.className = "match-banner"; banner.style.display = "none";
      this.canvas.parentElement.appendChild(banner); this._banner = banner;

      const nameTag = document.createElement("div");
      nameTag.className = "player-tag"; nameTag.style.display = "none";
      this.canvas.parentElement.appendChild(nameTag); this._nameTag = nameTag;

      this._resize = () => this._onResize(); this._onResize();
      window.addEventListener("resize", this._resize);
    }
    _onResize() {
      const wrap = this.canvas.parentElement;
      const w = wrap.clientWidth, h = wrap.clientHeight;
      this.renderer.setSize(w, h, true);
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    }

    _buildSky() {
      const c = document.createElement("canvas"); c.width = 16; c.height = 256;
      const g = c.getContext("2d");
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, "#2b6fc4"); grad.addColorStop(0.45, "#6fa8e0");
      grad.addColorStop(0.78, "#bcd9f0"); grad.addColorStop(1, "#e8f2fb");
      g.fillStyle = grad; g.fillRect(0, 0, 16, 256);
      const tex = new THREE.CanvasTexture(c);
      if ("colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
      const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 24, 16),
        new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false }));
      this.scene.add(sky);
    }
    _grassNormal() {
      const c = document.createElement("canvas"); c.width = 256; c.height = 256;
      const g = c.getContext("2d"); g.fillStyle = "#8080ff"; g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 9000; i++) {
        const v = 110 + Math.random() * 90;
        g.fillStyle = `rgb(${v},${v},255)`;
        g.fillRect(Math.random() * 256, Math.random() * 256, 1, 2 + Math.random() * 2);
      }
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(18, 12);
      return t;
    }
    _makePitchTexture() {
      const c = document.createElement("canvas"); c.width = 2100; c.height = 1360;
      const g = c.getContext("2d");
      const stripes = 16, sw = c.width / stripes;
      for (let i = 0; i < stripes; i++) { g.fillStyle = i % 2 ? "#2fa954" : "#289a4a"; g.fillRect(i * sw, 0, sw, c.height); }
      g.strokeStyle = "rgba(255,255,255,0.92)"; g.lineWidth = 6;
      const m = 40, W = c.width, H = c.height;
      const sx = (W - 2 * m) / FIELD.w, sy = (H - 2 * m) / FIELD.h;
      const X = (fx) => m + fx * sx, Y = (fy) => m + fy * sy;
      g.strokeRect(m, m, W - 2 * m, H - 2 * m);
      g.beginPath(); g.moveTo(W / 2, m); g.lineTo(W / 2, H - m); g.stroke();
      g.beginPath(); g.arc(W / 2, H / 2, 150, 0, 6.2832); g.stroke();
      g.beginPath(); g.arc(W / 2, H / 2, 8, 0, 6.2832); g.fillStyle = "#fff"; g.fill();
      // 페널티/골 박스 (양쪽)
      const boxW = PBOX_DX * sx, boxH = PBOX_HY * 2 * sy;
      g.strokeRect(m, H / 2 - boxH / 2, boxW, boxH);
      g.strokeRect(W - m - boxW, H / 2 - boxH / 2, boxW, boxH);
      const sixW = 60 * sx, sixH = 110 * 2 * sy;
      g.strokeRect(m, H / 2 - sixH / 2, sixW, sixH);
      g.strokeRect(W - m - sixW, H / 2 - sixH / 2, sixW, sixH);
      // 페널티 스폿 + 아크
      for (const sgn of [1, -1]) {
        const psx = sgn === 1 ? X(PEN_SPOT) : X(FIELD.w - PEN_SPOT);
        g.beginPath(); g.arc(psx, H / 2, 6, 0, 6.2832); g.fillStyle = "#fff"; g.fill();
        g.beginPath(); g.arc(psx, H / 2, 90, sgn === 1 ? -1.0 : Math.PI - 1.0, sgn === 1 ? 1.0 : Math.PI + 1.0); g.stroke();
      }
      const tex = new THREE.CanvasTexture(c); tex.anisotropy = 8;
      if ("colorSpace" in tex) tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }
    _buildPitch() {
      const nrm = this._grassNormal();
      const pitch = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.w, WORLD.h, 1, 1),
        new THREE.MeshStandardMaterial({ map: this._makePitchTexture(), normalMap: nrm, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.92, metalness: 0 }));
      pitch.rotation.x = -Math.PI / 2; pitch.receiveShadow = true; this.scene.add(pitch);
      const outer = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.w + 34, WORLD.h + 26),
        new THREE.MeshStandardMaterial({ color: 0x18632f, roughness: 1 }));
      outer.rotation.x = -Math.PI / 2; outer.position.y = -0.05; outer.receiveShadow = true; this.scene.add(outer);
    }
    _crowdTexture() {
      const c = document.createElement("canvas"); c.width = 256; c.height = 64;
      const g = c.getContext("2d"); g.fillStyle = "#0c1320"; g.fillRect(0, 0, 256, 64);
      const cols = ["#e74c3c", "#ecf0f1", "#3498db", "#f1c40f", "#2ecc71", "#e67e22", "#9b59b6"];
      for (let i = 0; i < 1500; i++) { g.fillStyle = cols[(Math.random() * cols.length) | 0]; g.globalAlpha = .5 + Math.random() * .5; g.fillRect(Math.random() * 256, Math.random() * 64, 2, 2); }
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(22, 3); return t;
    }
    _buildStadium() {
      const standMat = new THREE.MeshStandardMaterial({ map: this._crowdTexture(), roughness: 1 });
      const baseMat = new THREE.MeshStandardMaterial({ color: 0x222a35, roughness: 1 });
      const standH = 11, standD = 22;
      const mk = (w, d, x, z, ry) => {
        const grp = new THREE.Group();
        const tier = new THREE.Mesh(new THREE.BoxGeometry(w, standH, d), standMat);
        tier.position.y = standH / 2 + 1; tier.rotation.x = -0.32; grp.add(tier);
        const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 3, 2), baseMat);
        wall.position.set(0, 1.5, -d / 2 + 1); grp.add(wall);
        grp.position.set(x, 0, z); grp.rotation.y = ry; this.scene.add(grp);
      };
      mk(WORLD.w + 34, standD, 0, -(WORLD.h / 2 + standD / 2 + 4), 0);
      mk(WORLD.w + 34, standD, 0, (WORLD.h / 2 + standD / 2 + 4), Math.PI);
      mk(WORLD.h + 22, standD, -(WORLD.w / 2 + standD / 2 + 4), 0, Math.PI / 2);
      mk(WORLD.h + 22, standD, (WORLD.w / 2 + standD / 2 + 4), 0, -Math.PI / 2);
    }
    _buildGoals() {
      const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
      const netMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, side: THREE.DoubleSide });
      const goalW = (GOAL_H / FIELD.h) * WORLD.h, half = goalW / 2, barH = 4, pr = 0.22, depth = 3;
      const mk = (sign) => {
        const grp = new THREE.Group(); grp.position.x = sign * (WORLD.w / 2);
        for (const z of [-half, half]) { const po = new THREE.Mesh(new THREE.CylinderGeometry(pr, pr, barH, 10), postMat); po.position.set(0, barH / 2, z); po.castShadow = true; grp.add(po); }
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(pr, pr, goalW, 10), postMat); bar.rotation.x = Math.PI / 2; bar.position.y = barH; grp.add(bar);
        const back = new THREE.Mesh(new THREE.PlaneGeometry(goalW, barH), netMat); back.position.set(-sign * depth, barH / 2, 0); back.rotation.y = Math.PI / 2; grp.add(back);
        const top = new THREE.Mesh(new THREE.PlaneGeometry(depth, goalW), netMat); top.position.set(-sign * depth / 2, barH, 0); top.rotation.x = Math.PI / 2; grp.add(top);
        this.scene.add(grp);
      };
      mk(1); mk(-1);
    }
    _buildPlayerMeshes() {
      const skins = [0xf1c9a5, 0xe8b88a, 0xc68642, 0x8d5524, 0xffdbac, 0xa9714b];
      for (const p of this.players) {
        const kit = this.kit[p.team];
        const jersey = p.role === "GK" ? "#222831" : kit.jersey;
        const shorts = p.role === "GK" ? "#1a1a1a" : kit.shorts;
        const jMat = new THREE.MeshStandardMaterial({ color: jersey, roughness: 0.62, metalness: 0.02 });
        const sMat = new THREE.MeshStandardMaterial({ color: shorts, roughness: 0.78 });
        const skinMat = new THREE.MeshStandardMaterial({ color: skins[(p.number + (p.team === "home" ? 0 : 3)) % skins.length], roughness: 0.55 });
        const sockMat = new THREE.MeshStandardMaterial({ color: jersey, roughness: 0.8 });
        const grp = new THREE.Group();
        // 다리(좌우) — 애니메이션용
        const legGeo = new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.17, 0.6, 3, 6) : new THREE.CylinderGeometry(0.17, 0.15, 0.9, 6);
        const lL = new THREE.Mesh(legGeo, sMat); lL.position.set(-0.17, 0.6, 0); lL.castShadow = true; grp.add(lL);
        const lR = new THREE.Mesh(legGeo, sMat); lR.position.set(0.17, 0.6, 0); lR.castShadow = true; grp.add(lR);
        p._legL = lL; p._legR = lR;
        // 양말
        const sockGeo = new THREE.CylinderGeometry(0.16, 0.13, 0.4, 6);
        const skL = new THREE.Mesh(sockGeo, sockMat); skL.position.set(-0.17, 0.22, 0); grp.add(skL);
        const skR = new THREE.Mesh(sockGeo, sockMat); skR.position.set(0.17, 0.22, 0); grp.add(skR);
        // 몸통
        const torsoGeo = new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.42, 0.7, 3, 8) : new THREE.CylinderGeometry(0.46, 0.42, 1.2, 9);
        const torso = new THREE.Mesh(torsoGeo, jMat); torso.position.y = 1.55; torso.scale.z = 0.7; torso.castShadow = true; grp.add(torso);
        // 팔(좌우)
        const armGeo = new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.13, 0.6, 3, 6) : new THREE.CylinderGeometry(0.13, 0.11, 0.8, 6);
        const aL = new THREE.Mesh(armGeo, skinMat); aL.position.set(-0.56, 1.55, 0); aL.rotation.z = 0.18; aL.castShadow = true; grp.add(aL);
        const aR = new THREE.Mesh(armGeo, skinMat); aR.position.set(0.56, 1.55, 0); aR.rotation.z = -0.18; aR.castShadow = true; grp.add(aR);
        p._armL = aL; p._armR = aR;
        // 머리 + 목
        const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.2, 6), skinMat); neck.position.y = 2.12; grp.add(neck);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 12), skinMat); head.position.y = 2.45; head.castShadow = true; grp.add(head);
        const hair = new THREE.Mesh(new THREE.SphereGeometry(0.345, 12, 10, 0, 6.283, 0, 1.5), new THREE.MeshStandardMaterial({ color: 0x1b1206, roughness: 0.9 }));
        hair.position.y = 2.5; grp.add(hair);
        // 조작 링
        const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.11, 8, 24), new THREE.MeshStandardMaterial({ color: 0xffe23a, emissive: 0x9c7a00, emissiveIntensity: 0.8 }));
        ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; ring.visible = false; grp.add(ring); p._ring = ring;
        grp.visible = !p.sentOff;
        this.scene.add(grp); p.mesh = grp;
      }
      const marker = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.95, 22),
        new THREE.MeshBasicMaterial({ color: 0x33ff88, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
      marker.rotation.x = -Math.PI / 2; marker.position.y = 0.08; marker.visible = false;
      this.scene.add(marker); this._moveMarker = marker;
    }
    _ballTexture() {
      const c = document.createElement("canvas"); c.width = 256; c.height = 256;
      const g = c.getContext("2d"); g.fillStyle = "#f7f7f7"; g.fillRect(0, 0, 256, 256);
      g.fillStyle = "#1a1a1a";
      // 오각형 패치 느낌의 점/곡선
      const spots = [[128, 60], [60, 150], [196, 150], [128, 200], [40, 60], [216, 60]];
      for (const [x, y] of spots) {
        g.beginPath();
        for (let i = 0; i < 5; i++) { const a = (i / 5) * 6.283 - 1.57; const px = x + Math.cos(a) * 26, py = y + Math.sin(a) * 26; i ? g.lineTo(px, py) : g.moveTo(px, py); }
        g.closePath(); g.fill();
      }
      const t = new THREE.CanvasTexture(c); if ("colorSpace" in t) t.colorSpace = THREE.SRGBColorSpace; return t;
    }
    _buildBallMesh() {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 20),
        new THREE.MeshStandardMaterial({ map: this._ballTexture(), roughness: 0.4, metalness: 0.02 }));
      ball.castShadow = true; this.scene.add(ball); this.ballMesh = ball;
    }

    /* ===== 입력 ===== */
    _bind() {
      this._keydown = (e) => this._key(e, true); this._keyup = (e) => this._key(e, false);
      window.addEventListener("keydown", this._keydown); window.addEventListener("keyup", this._keyup);
      this._ptrDown = (e) => { this._ptrActive = true; this._moveTo(e); };
      this._ptrMove = (e) => { if (this._ptrActive) this._moveTo(e); };
      this._ptrUp = () => { this._ptrActive = false; };
      this.canvas.addEventListener("pointerdown", this._ptrDown);
      this.canvas.addEventListener("pointermove", this._ptrMove);
      window.addEventListener("pointerup", this._ptrUp);
      this.canvas.style.touchAction = "none";
    }
    destroy() {
      this.running = false;
      window.removeEventListener("keydown", this._keydown); window.removeEventListener("keyup", this._keyup);
      window.removeEventListener("pointerup", this._ptrUp);
      this.canvas.removeEventListener("pointerdown", this._ptrDown);
      this.canvas.removeEventListener("pointermove", this._ptrMove);
      window.removeEventListener("resize", this._resize);
      for (const el of [this._banner, this._nameTag]) if (el && el.parentElement) el.parentElement.removeChild(el);
      if (global.Sound) global.Sound.crowd(false);
      if (this.renderer) this.renderer.dispose();
    }
    _key(e, down) {
      const k = e.key.toLowerCase();
      if (k === "j") { this.input.pass = down; e.preventDefault(); }
      else if (k === "k" || k === " ") { this.input.shoot = down; e.preventDefault(); }
      else if ((k === "q" || k === "tab" || k === "shift") && down) { this.switchPlayer(); e.preventDefault(); }
    }
    setInput(name, val) { if (name in this.input) this.input[name] = val; }
    setUserFormation(f) { if (FORMATIONS[f]) this.userFormation = f; }
    _moveTo(e) {
      const rect = this.canvas.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this._raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
      const hit = this._raycaster.ray.intersectPlane(this._groundPlane, this._tmpV);
      if (!hit) return;
      const fx = clamp(wx2fx(hit.x), 8, FIELD.w - 8), fy = clamp(wz2fy(hit.z), 8, FIELD.h - 8);
      // 클릭 지점 근처에 우리 팀 선수가 있으면 그 선수로 '수동 전환'
      let near = null, bd = Infinity;
      for (const p of this.players) {
        if (p.team !== "home" || p.sentOff) continue;
        const d = dist2(p.x, p.y, fx, fy); if (d < bd) { bd = d; near = p; }
      }
      if (near && bd < 34 * 34 && near !== this.controlled) {
        if (this.controlled) this.controlled.moveTarget = null;
        this.controlled = near; near.moveTarget = null; return;
      }
      // 아니면 현재 조작 선수를 그 지점으로 이동
      const c = this.controlled;
      if (!c || c.team !== "home") return;
      c.moveTarget = { x: fx, y: fy };
    }

    /* ===== 이벤트(해설+사운드) ===== */
    emit(event, ctx) {
      ctx = ctx || {};
      ctx.home = this.home.name; ctx.away = this.away.name;
      ctx.hs = this.score.home; ctx.as = this.score.away;
      if (global.Commentary && this._ticker) this._pushTicker(global.Commentary.line(event, ctx));
      if (global.Sound) {
        const S = global.Sound;
        switch (event) {
          case "kickoff": S.whistle("start"); break;
          case "goal": case "penalty_goal": S.cheer(); break;
          case "shot": case "chance": S.kick(); break;
          case "save": S.save(); break;
          case "post": S.post(); break;
          case "foul": case "offside": case "penalty": S.whistle("foul"); break;
          case "halftime": S.whistle("foul"); break;
          case "fulltime": S.whistle("end"); break;
        }
      }
    }
    _pushTicker(line) {
      if (!this._ticker) return;
      const el = document.createElement("div"); el.className = "tick"; el.textContent = line;
      this._ticker.prepend(el);
      while (this._ticker.children.length > 4) this._ticker.removeChild(this._ticker.lastChild);
      setTimeout(() => { el.classList.add("fade"); }, 4200);
    }
    setTicker(el) { this._ticker = el; }

    /* ===== 루프 ===== */
    start() {
      this.running = true;
      if (global.Sound) { global.Sound.init(); global.Sound.crowd(true); }
      this.message = `${this.home.name}  VS  ${this.away.name}`;
      this.messageTimer = 1.9;
      this.lastTs = performance.now();
      const loop = (ts) => {
        if (!this.running) return;
        let dt = (ts - this.lastTs) / 1000; this.lastTs = ts;
        if (dt > 0.05) dt = 0.05;
        try { this._update(dt); } catch (err) { /* keep loop alive */ console.error(err); }
        this._sync(); this.renderer.render(this.scene, this.camera);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    _update(dt) {
      if (this.messageTimer > 0) {
        this.messageTimer -= dt;
        if (this.messageTimer <= 0) {
          this.message = null;
          if (this.phase === "kickoff" && !this._kickWhistled) { this.emit("kickoff", {}); this._kickWhistled = true; this.phase = "play"; }
        }
        this._updateCamera(dt); return;
      }
      // 시계 + 추가시간
      this.clock += dt;
      const half = HALF_SECONDS + this.addedTime;
      this.onClock(this._clockLabel());
      if (this.clock >= half) { this._endHalf(); return; }

      this._ensureControlled();
      this._handleInput(dt);
      this._ai(dt);
      this._integrate(dt);
      this._stamina(dt);
      this._ballPhysics(dt);
      this._goalkeeper(dt);
      this._collisions();
      this._deadballTick(dt);
      this._checkBounds();
      this._possessionTick(dt);
      this._updateCamera(dt);
      if (this.goalFlash > 0) this.goalFlash -= dt * 1.5;
    }

    _clockLabel() {
      const base = this.half === 1 ? 0 : 45;
      const t = base + (this.clock / HALF_SECONDS) * 45;
      const mm = Math.floor(t), ss = Math.floor((t - mm) * 60);
      let s = `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
      if (this.clock > HALF_SECONDS) s += ` +${Math.ceil((this.clock - HALF_SECONDS) / HALF_SECONDS * 45) || 1}`;
      return s;
    }

    _computeAddedTime() {
      // 정지 이벤트(파울/골/카드) 기반 1~5분 → 실초로 환산
      const ev = this.stats.home.fouls + this.stats.away.fouls + this.score.home + this.score.away +
                 this.stats.home.yellow + this.stats.away.yellow;
      const mins = clamp(1 + ev * 0.25, 1, 5);
      return (mins / 45) * HALF_SECONDS;
    }

    _endHalf() {
      if (this.half === 1) {
        this.half = 2; this.clock = 0; this.addedTime = 0; this._kickWhistled = false;
        this.emit("halftime", {});
        this.message = "하프타임 — 후반 시작!"; this.messageTimer = 1.9;
        this._kickoffReset(this.score.home <= this.score.away ? "home" : "away");
      } else {
        this.running = false;
        if (global.Sound) global.Sound.crowd(false);
        this.emit("fulltime", {});
        this.onEnd({ ...this.score, stats: this._statSnapshot(), scorers: this.scorers });
      }
    }

    _statSnapshot() {
      const tp = this.stats.home.poss + this.stats.away.poss || 1;
      return {
        possHome: Math.round((this.stats.home.poss / tp) * 100),
        possAway: Math.round((this.stats.away.poss / tp) * 100),
        home: { ...this.stats.home }, away: { ...this.stats.away },
      };
    }

    /* ===== 조작 선수 (수동 전환) ===== */
    // 자동으로 바꾸지 않음. controlled 가 없거나 퇴장당했을 때만 기본값 지정.
    _ensureControlled() {
      if (this.controlled && !this.controlled.sentOff && this.controlled.team === "home") return;
      let best = null, bd = Infinity;
      for (const p of this.players) {
        if (p.team !== "home" || p.role === "GK" || p.sentOff) continue;
        const d = dist2(p.x, p.y, this.ball.x, this.ball.y);
        if (d < bd) { bd = d; best = p; }
      }
      this.controlled = best;
    }
    // 전환 버튼/키: 공에 가까운 순서로 다음 동료에게 수동 전환
    switchPlayer() {
      const outs = this.players.filter((p) => p.team === "home" && !p.sentOff && p.role !== "GK");
      if (!outs.length) return;
      outs.sort((a, b) => dist2(a.x, a.y, this.ball.x, this.ball.y) - dist2(b.x, b.y, this.ball.x, this.ball.y));
      const i = outs.indexOf(this.controlled);
      const next = outs[(i + 1) % outs.length];
      if (this.controlled) this.controlled.moveTarget = null;
      this.controlled = next; next.moveTarget = null;
    }

    _handleInput(dt) {
      const p = this.controlled; if (!p) return;
      if (p.moveTarget) {
        const dx = p.moveTarget.x - p.x, dy = p.moveTarget.y - p.y, d = len(dx, dy);
        if (d < 7) p.moveTarget = null;
        else { const sp = this._speed(p); p.vx = (dx / d) * sp; p.vy = (dy / d) * sp; p.faceX = dx / d; p.faceY = dy / d; }
      }
      if (this.input.shoot && this.ball.owner === p) this.shootCharge = Math.min(this.shootCharge + dt, 1);
      else if (!this.input.shoot && this.shootCharge > 0) { if (this.ball.owner === p) this._shoot(p, this.shootCharge); this.shootCharge = 0; }
      if (this.input.pass && this.ball.owner === p) { this._pass(p); this.input.pass = false; }
    }

    _speed(p) {
      const stf = 0.62 + 0.38 * (p.stamina / 100);
      let sp = p.speedBase * stf;
      if (p !== this.controlled) sp *= 0.82;   // NPC 너프 유지
      return sp;
    }

    /* ===== 슛/패스 ===== */
    _shoot(p, charge) {
      const goalX = p.team === "home" ? FIELD.w : 0;
      const acc = p.attr.shoot / 100;
      const spread = (1 - acc) * GOAL_H * 0.9;
      const goalY = cy + rnd(-1, 1) * (GOAL_H * 0.35 + spread);
      let dx = goalX - this.ball.x, dy = goalY - this.ball.y; const l = len(dx, dy) || 1;
      const power = 9 + charge * 9 + acc * 2;
      this.ball.vx = (dx / l) * power; this.ball.vy = (dy / l) * power; this.ball.vh = 0.6 + charge * 0.5;
      this.ball.owner = null; p._touchCd = 0.4; this.lastTouch = p;
      this.stats[p.team].shots++;
      // 온타겟 여부(골문 향함)
      const onTarget = Math.abs(goalY - cy) < GOAL_H / 2;
      if (onTarget) this.stats[p.team].sot++;
      this.emit("shot", { player: p.name, team: p.team === "home" ? this.home.name : this.away.name });
      this._lastShot = { team: p.team };
    }

    _pass(p) {
      let best = null, bScore = -Infinity;
      const fwd = p.team === "home" ? 1 : -1;
      for (const m of this.players) {
        if (m === p || m.team !== p.team || m.sentOff || m.role === "GK") continue;
        const ahead = (m.x - p.x) * fwd, d = Math.sqrt(dist2(p.x, p.y, m.x, m.y));
        if (d < 35) continue;
        const open = this._laneOpen(p, m) ? 60 : -50;
        const score = ahead * 1.0 - d * 0.22 + open + (m.attr.pass / 20);
        if (score > bScore) { bScore = score; best = m; }
      }
      if (!best) return;
      this._maybeOffside(p, best);
      let dx = best.x - this.ball.x, dy = best.y - this.ball.y; const l = len(dx, dy) || 1;
      const power = clamp(l / 30, 5.5, 12) * (0.85 + p.attr.pass / 200);
      this.ball.vx = (dx / l) * power; this.ball.vy = (dy / l) * power; this.ball.vh = 0.15;
      this.ball.owner = null; p._touchCd = 0.28; this.lastTouch = p;
    }
    _laneOpen(a, b) {
      for (const o of this.players) {
        if (o.team === a.team || o.sentOff) continue;
        const t = this._projT(a, b, o);
        if (t > 0.1 && t < 0.95) { const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t; if (dist2(px, py, o.x, o.y) < 42 * 42) return false; }
      }
      return true;
    }
    _projT(a, b, o) { const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1; return ((o.x - a.x) * dx + (o.y - a.y) * dy) / l2; }

    /* ===== 오프사이드 ===== */
    _maybeOffside(passer, receiver) {
      const fwd = receiver.team === "home" ? 1 : -1;
      // 상대 진영에서만, 공보다 앞일 때
      const inAttackHalf = receiver.team === "home" ? receiver.x > FIELD.w / 2 : receiver.x < FIELD.w / 2;
      if (!inAttackHalf) { this.pendingOffside = null; return; }
      // 상대팀 뒤에서 두 번째 선수(보통 최종 수비수)의 x
      const opp = this.players.filter((q) => q.team !== passer.team && !q.sentOff);
      const xs = opp.map((q) => q.x).sort((A, B) => (receiver.team === "home" ? B - A : A - B));
      const lineX = xs[1] != null ? xs[1] : xs[0];
      const beyond = receiver.team === "home" ? receiver.x > lineX + 22 : receiver.x < lineX - 22;
      const aheadOfBall = (receiver.x - this.ball.x) * fwd > 0;
      if (beyond && aheadOfBall) this.pendingOffside = { receiver, team: passer.team };
      else this.pendingOffside = null;
    }
    _triggerOffside(pl) {
      this.pendingOffside = null;
      const defTeam = pl.team === "home" ? "away" : "home";
      this.emit("offside", { team: pl.team === "home" ? this.home.name : this.away.name, player: pl.name });
      this._startDeadball("offside", defTeam, pl.x, pl.y);
    }

    /* ===== AI ===== */
    _ai(dt) {
      if (this.phase === "penalty") { this._penaltyAI(dt); return; }
      const ball = this.ball;
      const presser = { home: this._closestToBall("home"), away: this._closestToBall("away") };
      const kickoffLock = this.phase === "kickoff";
      for (const p of this.players) {
        if (p.sentOff) continue;
        if (p._touchCd > 0) p._touchCd -= dt;
        if (p === this.controlled) continue;
        const home = this._formationPos(p);
        const ownsBall = ball.owner === p;
        const teamHasBall = ball.owner && ball.owner.team === p.team;
        const goalX = p.team === "home" ? FIELD.w : 0, ownGoalX = p.team === "home" ? 0 : FIELD.w;
        let tx = home.x, ty = home.y, boost = 1;

        if (kickoffLock && !ownsBall) {
          // 킥오프: 자기 진영 유지
          tx = home.x; ty = home.y;
        } else if (p.role === "GK") {
          const lineX = p.team === "home" ? FIELD.w * 0.045 : FIELD.w * 0.955;
          tx = lineX; ty = clamp(ball.y, cy - GOAL_H / 2 + 6, cy + GOAL_H / 2 - 6);
          if (Math.abs(ball.x - lineX) < FIELD.w * 0.13 && !ball.owner && dist2(p.x, p.y, ball.x, ball.y) < 120 * 120) { tx = ball.x; ty = ball.y; }
        } else if (ownsBall) {
          tx = goalX; ty = cy * 0.4 + ball.y * 0.6;
          const distGoal = Math.abs(goalX - p.x), pressed = this._nearestOpp(p) < 52;
          if (distGoal < FIELD.w * 0.26 && p._touchCd <= 0 && Math.random() < 0.045) this._shoot(p, 0.55 + Math.random() * 0.4);
          else if (pressed && p._touchCd <= 0 && Math.random() < 0.07) this._pass(p);
          boost = 0.82;
        } else if (teamHasBall) {
          p.runPhase += dt * 1.4;
          const push = (p.team === "home" ? 1 : -1) * (p.role === "FW" ? 0.18 : p.role === "MF" ? 0.08 : -0.02);
          const widen = (home.y < cy ? -1 : 1) * 22 * Math.sin(p.runPhase) * (p.role === "DF" ? 0.25 : 1);
          tx = clamp(home.x + push * FIELD.w, 45, FIELD.w - 45);
          ty = clamp(home.y * 0.6 + ball.y * 0.2 + widen + cy * 0.2, 35, FIELD.h - 35);
        } else {
          if (p === presser[p.team] && p.role !== "GK") { tx = ball.x; ty = ball.y; boost = 1.02; }
          else {
            const mark = this._markTarget(p);
            if (mark) { tx = mark.x * 0.7 + ownGoalX * 0.3; ty = mark.y * 0.78 + cy * 0.22; }
            else { tx = home.x * 0.55 + ball.x * 0.25 + ownGoalX * 0.2; ty = home.y * 0.6 + ball.y * 0.4; }
            boost = 0.9;
          }
        }
        const sp = this._speed(p) * boost;
        const dx = tx - p.x, dy = ty - p.y, d = len(dx, dy);
        if (d > 5) { p.vx = (dx / d) * sp; p.vy = (dy / d) * sp; p.faceX = dx / d; p.faceY = dy / d; }
        else { p.vx = 0; p.vy = 0; }
      }
    }
    _closestToBall(team) {
      let best = null, bd = Infinity;
      for (const p of this.players) { if (p.team !== team || p.role === "GK" || p.sentOff) continue; const d = dist2(p.x, p.y, this.ball.x, this.ball.y); if (d < bd) { bd = d; best = p; } }
      return best;
    }
    _nearestOpp(p) { let bd = Infinity; for (const o of this.players) { if (o.team === p.team || o.sentOff) continue; const d = dist2(p.x, p.y, o.x, o.y); if (d < bd) bd = d; } return Math.sqrt(bd); }
    _markTarget(p) {
      const ownGoalX = p.team === "home" ? 0 : FIELD.w; let best = null, bScore = Infinity;
      for (const o of this.players) {
        if (o.team === p.team || o.role === "GK" || o.sentOff || o === this.ball.owner) continue;
        const threat = Math.abs(o.x - ownGoalX), near = Math.sqrt(dist2(p.x, p.y, o.x, o.y));
        const score = threat + near * 0.6; if (score < bScore) { bScore = score; best = o; }
      }
      return best;
    }

    /* ===== 골키퍼 선방 ===== */
    _goalkeeper(dt) {
      const b = this.ball; if (b.owner) return;
      for (const gk of this.players) {
        if (gk.role !== "GK" || gk.sentOff) continue;
        const goalX = gk.team === "home" ? 0 : FIELD.w;
        const towardGoal = gk.team === "home" ? b.vx < -2 : b.vx > 2;
        if (!towardGoal) continue;
        if (Math.abs(b.x - goalX) > FIELD.w * 0.22) continue;
        // 슛 궤적의 골라인 도달 y 예측
        const t = (goalX - b.x) / (b.vx || (gk.team === "home" ? -1 : 1));
        if (t < 0 || t > 60) continue;
        const predY = b.y + b.vy * t;
        if (predY < cy - GOAL_H / 2 - 30 || predY > cy + GOAL_H / 2 + 30) continue;
        // 다이브
        const lineX = gk.team === "home" ? FIELD.w * 0.04 : FIELD.w * 0.96;
        gk.x += (lineX - gk.x) * 0.3;
        gk.y += clamp(predY - gk.y, -1, 1) * 8 * (0.7 + gk.attr.defend / 200);
        // 도달 시 처리
        if (dist2(gk.x, gk.y, b.x, b.y) < (PLAYER_R + BALL_R + 10) ** 2) {
          const power = len(b.vx, b.vy);
          const holdP = clamp(gk.attr.defend / 100 - power / 40, 0.15, 0.85);
          if (Math.random() < holdP) { b.owner = gk; b.vx = b.vy = b.vh = 0; this.lastTouch = gk; }
          else { // 펀칭
            const ang = rnd(-1, 1);
            b.vx = (gk.team === "home" ? 1 : -1) * rnd(3, 6); b.vy = ang * rnd(3, 6); this.lastTouch = gk;
          }
          this.emit("save", { player: gk.name, team: gk.team === "home" ? this.home.name : this.away.name });
          gk._touchCd = 0.3;
        }
      }
    }

    /* ===== 물리 ===== */
    _integrate(dt) {
      const step = dt * 60;
      for (const p of this.players) {
        if (p.sentOff) continue;
        p.x += p.vx * step; p.y += p.vy * step; p.vx *= FRICTION; p.vy *= FRICTION;
        p.x = clamp(p.x, PLAYER_R, FIELD.w - PLAYER_R); p.y = clamp(p.y, PLAYER_R, FIELD.h - PLAYER_R);
      }
    }
    _stamina(dt) {
      for (const p of this.players) {
        if (p.sentOff) continue;
        const moving = len(p.vx, p.vy) > 0.5;
        p.stamina += (moving ? -1.1 : 1.4) * dt;
        p.stamina = clamp(p.stamina, 30, 100);
      }
    }
    _ballPhysics(dt) {
      const b = this.ball, step = dt * 60;
      if (b.owner) {
        if (b.owner.sentOff) { b.owner = null; }
        else {
          const fl = len(b.owner.faceX, b.owner.faceY) || 1;
          b.x = b.owner.x + (b.owner.faceX / fl) * (PLAYER_R + 7);
          b.y = b.owner.y + (b.owner.faceY / fl) * (PLAYER_R + 7);
          b.vx = 0; b.vy = 0; b.h = 0.4; return;
        }
      }
      b.x += b.vx * step; b.y += b.vy * step; b.vx *= BALL_FRICTION; b.vy *= BALL_FRICTION;
      // 높이(포물선)
      b.h += b.vh * step * 0.3; b.vh -= 0.04 * step; if (b.h < 0) { b.h = 0; b.vh = Math.abs(b.vh) * 0.4; if (b.vh < 0.2) b.vh = 0; }
    }
    _collisions() {
      const b = this.ball;
      if (this.phase === "penalty") return;
      for (const p of this.players) {
        if (p.sentOff || p._touchCd > 0) continue;
        const rr = (PLAYER_R + BALL_R + 5) ** 2;
        if (dist2(p.x, p.y, b.x, b.y) < rr) {
          if (!b.owner) {
            b.owner = p; this.lastTouch = p;
            // 오프사이드 수신 확인
            if (this.pendingOffside && this.pendingOffside.receiver === p) { this._triggerOffside(p); return; }
            else this.pendingOffside = null;
            if (this.phase === "kickoff") this.phase = "play";
          } else if (b.owner.team !== p.team) {
            this._challenge(p, b.owner);
          }
        }
      }
      // 선수 분리
      for (let i = 0; i < this.players.length; i++) for (let j = i + 1; j < this.players.length; j++) {
        const a = this.players[i], c = this.players[j]; if (a.sentOff || c.sentOff) continue;
        const dx = c.x - a.x, dy = c.y - a.y, d = len(dx, dy), min = PLAYER_R * 2;
        if (d > 0 && d < min) { const push = (min - d) / 2, nx = dx / d, ny = dy / d; a.x -= nx * push; a.y -= ny * push; c.x += nx * push; c.y += ny * push; }
      }
    }

    /* ===== 태클·파울·카드 ===== */
    _challenge(def, att) {
      def._touchCd = 0.55;             // 재시도 쿨다운(프레임마다 반복 방지)
      const success = clamp(0.5 + (def.attr.defend - att.rating * 100) * 0.004, 0.12, 0.8);
      if (Math.random() < success * 0.5) { this.ball.owner = def; this.lastTouch = def; this.pendingOffside = null; }
      else {
        // 실패 → 가끔 파울
        const foulP = 0.05 + len(def.vx, def.vy) * 0.012;
        if (Math.random() < foulP) this._foul(def, att);
      }
    }
    _foul(def, att) {
      this.stats[def.team].fouls++;
      const spotX = att.x, spotY = att.y;
      // 박스 안 파울 → 페널티
      const defendingOwnBox = this._inOwnBox(def, spotX, spotY);
      // 카드 판정
      const hard = len(def.vx, def.vy) > 1.8;
      if (hard && Math.random() < 0.22) this._card(def, false);
      else if (Math.random() < 0.06) this._card(def, false);
      if (defendingOwnBox) {
        this.emit("penalty", { team: att.team === "home" ? this.home.name : this.away.name });
        this._startPenalty(att.team);
      } else {
        this.emit("foul", { player: def.name, team: def.team === "home" ? this.home.name : this.away.name });
        this._startDeadball("freekick", att.team, spotX, spotY);
      }
    }
    _inOwnBox(p, x, y) {
      if (p.team === "home") return x < PBOX_DX && Math.abs(y - cy) < PBOX_HY;
      return x > FIELD.w - PBOX_DX && Math.abs(y - cy) < PBOX_HY;
    }
    _card(pl, straightRed) {
      if (straightRed || pl.yellow >= 1) {
        pl.yellow++; pl.sentOff = true; pl.mesh.visible = false; this.stats[pl.team].red++;
        if (this.ball.owner === pl) this.ball.owner = null;
        this.emit("red", { player: pl.name, team: pl.team === "home" ? this.home.name : this.away.name });
      } else {
        pl.yellow = 1; this.stats[pl.team].yellow++;
        this.emit("yellow", { player: pl.name, team: pl.team === "home" ? this.home.name : this.away.name });
      }
    }

    /* ===== 데드볼(스로인/코너/골킥/프리킥) ===== */
    _startDeadball(type, team, x, y) {
      this.phase = "dead";
      this.ball.owner = null; this.ball.vx = this.ball.vy = this.ball.vh = 0; this.ball.h = 0;
      this.ball.x = clamp(x, 6, FIELD.w - 6); this.ball.y = clamp(y, 6, FIELD.h - 6);
      // 테이커 = 해당 팀 최근접
      let taker = null, bd = Infinity;
      for (const p of this.players) { if (p.team !== team || p.sentOff || p.role === "GK") continue; const d = dist2(p.x, p.y, this.ball.x, this.ball.y); if (d < bd) { bd = d; taker = p; } }
      if (type === "goalkick") taker = this.players.find((p) => p.team === team && p.role === "GK" && !p.sentOff) || taker;
      this.dead = { type, team, taker, timer: 0.9 };
      if (taker) { taker.x = this.ball.x - (team === "home" ? 14 : -14); taker.y = this.ball.y; taker.moveTarget = null; }
      // 상대 선수 약간 물러서기
      const keep = type === "throwin" ? 30 : 70;
      for (const o of this.players) { if (o.team === team || o.sentOff) continue; const d = Math.sqrt(dist2(o.x, o.y, this.ball.x, this.ball.y)); if (d < keep) { const nx = (o.x - this.ball.x) / (d || 1), ny = (o.y - this.ball.y) / (d || 1); o.x = this.ball.x + nx * keep; o.y = this.ball.y + ny * keep; } }
    }
    _deadballTick(dt) {
      if (this.phase !== "dead" || !this.dead) return;
      this.dead.timer -= dt;
      const tk = this.dead.taker;
      if (tk) { this.ball.owner = tk; this.lastTouch = tk; }
      if (this.dead.timer <= 0) {
        this.phase = "play";
        const team = this.dead.team, type = this.dead.type;
        this.dead = null;
        if (tk && tk.team !== "home") {
          // AI 테이커는 자동으로 전개
          if (type === "corner") this._shoot(tk, 0.4); // 크로스 비슷하게 박스로
          else this._pass(tk);
        }
        // 유저 팀 테이커면 그대로 소유 → 유저가 조작
      }
    }

    /* ===== 페널티킥 ===== */
    _startPenalty(team) {
      this.phase = "penalty";
      const goalX = team === "home" ? FIELD.w : 0;
      const spotX = team === "home" ? FIELD.w - PEN_SPOT : PEN_SPOT;
      this.ball.owner = null; this.ball.vx = this.ball.vy = this.ball.vh = this.ball.h = 0;
      this.ball.x = spotX; this.ball.y = cy;
      // 키커 = 슛 능력 높은 공격수
      let kicker = null, bs = -1;
      for (const p of this.players) { if (p.team !== team || p.role === "GK" || p.sentOff) continue; if (p.attr.shoot > bs) { bs = p.attr.shoot; kicker = p; } }
      const gk = this.players.find((p) => p.team !== team && p.role === "GK" && !p.sentOff);
      this.penalty = { team, kicker, gk, timer: kicker && kicker.team === "home" ? 99 : 1.0, taken: false, goalX };
      // 위치 정리: 키커 뒤, 나머지 박스 밖
      if (kicker) { kicker.x = team === "home" ? spotX - 26 : spotX + 26; kicker.y = cy; kicker.moveTarget = null; }
      if (gk) { gk.x = team === "home" ? FIELD.w * 0.97 : FIELD.w * 0.03; gk.y = cy; }
      for (const p of this.players) { if (p === kicker || p === gk || p.sentOff) continue; p.x = clamp(team === "home" ? FIELD.w - PBOX_DX - 40 : PBOX_DX + 40, 30, FIELD.w - 30); p.y = cy + rnd(-120, 120); }
      this.controlled = (kicker && kicker.team === "home") ? kicker : this.controlled;
      this.message = "⚽ 페널티킥!"; this.messageTimer = 1.2;
    }
    _penaltyAI(dt) {
      const pen = this.penalty; if (!pen) return;
      if (this.messageTimer > 0) return;
      pen.timer -= dt;
      const gk = pen.gk;
      if (pen.taken) {
        // 공 진행 중 GK 다이브는 _goalkeeper가 처리 + 결과 판정
        if (len(this.ball.vx, this.ball.vy) < 1.2 && this.ball.h <= 0.1) this._endPenalty();
        return;
      }
      // 유저 키커: 슛 입력 대기 / AI 키커: 자동 슈팅
      if (pen.kicker && pen.kicker.team === "home") {
        // 유저가 K(슛) 누르면 _handleInput에서 처리되도록 소유 부여
        this.ball.owner = pen.kicker; this.lastTouch = pen.kicker;
        if (this.input.shoot || this.shootCharge > 0) { /* handled by input → _shoot */ }
        // 슛이 발사되면 owner=null 됨 → taken
        if (!this.ball.owner) { pen.taken = true; this._penaltyDive(); }
        if (pen.timer < -8) { this._forcePenaltyShot(pen); } // 너무 오래면 자동
      } else if (pen.timer <= 0 && pen.kicker) {
        this._forcePenaltyShot(pen); this._penaltyDive();
      }
    }
    _forcePenaltyShot(pen) {
      const k = pen.kicker; this.ball.owner = null; pen.taken = true;
      const side = pick([-1, 0, 1]); const goalY = cy + side * (GOAL_H * 0.38);
      let dx = pen.goalX - this.ball.x, dy = goalY - this.ball.y; const l = len(dx, dy) || 1;
      const power = 13 + (k.attr.shoot / 100) * 4;
      this.ball.vx = (dx / l) * power; this.ball.vy = (dy / l) * power; this.ball.vh = 0.3;
      this.lastTouch = k; this.stats[k.team].shots++; this.stats[k.team].sot++;
      pen._side = side;
    }
    _penaltyDive() {
      const pen = this.penalty, gk = pen.gk; if (!gk) return;
      const guess = pick([-1, 0, 1]); pen._gkGuess = guess;
      gk._penDiveY = cy + guess * (GOAL_H * 0.4);
    }
    _endPenalty() {
      const pen = this.penalty; if (!pen) { this.phase = "play"; return; }
      // 골 판정은 _checkBounds의 골 처리에서 이미 됐을 수 있음. 여기서 정리만.
      this.penalty = null; this.phase = "play";
      if (this.ball.owner) { /* GK 캐치 */ }
    }

    /* ===== 경계/아웃/골 ===== */
    _checkBounds() {
      const b = this.ball; if (b.owner) return;
      const inGoalY = b.y > cy - GOAL_H / 2 && b.y < cy + GOAL_H / 2;
      // 골
      if (b.x <= BALL_R + 1 && inGoalY && b.h < 4) return this._goal("away");
      if (b.x >= FIELD.w - BALL_R - 1 && inGoalY && b.h < 4) return this._goal("home");
      if (this.phase === "dead" || this.phase === "penalty") {
        // 페널티/데드볼 중 골라인 통과 시 (페널티 빗나감 등)
        if (this.penalty && (b.x < 0 || b.x > FIELD.w)) { this.emit("penalty_miss", {}); this._afterPenaltyNoGoal(); }
        return;
      }
      // 사이드라인 아웃 → 스로인
      if (b.y < 2 || b.y > FIELD.h - 2) {
        const team = (this.lastTouch && this.lastTouch.team === "home") ? "away" : "home";
        this.emit("throwin", { team: team === "home" ? this.home.name : this.away.name });
        this._startDeadball("throwin", team, clamp(b.x, 20, FIELD.w - 20), b.y < 2 ? 6 : FIELD.h - 6);
        return;
      }
      // 골라인 아웃(골 아님) → 코너/골킥
      if (b.x < 2 || b.x > FIELD.w - 2) {
        const leftOut = b.x < 2;
        const defending = leftOut ? "home" : "away";        // 그 골을 지키는 팀
        const attacking = leftOut ? "away" : "home";
        const lastTeam = this.lastTouch ? this.lastTouch.team : attacking;
        if (lastTeam === attacking) {
          this.emit("goalkick", { team: defending === "home" ? this.home.name : this.away.name });
          const gx = leftOut ? 80 : FIELD.w - 80;
          this._startDeadball("goalkick", defending, gx, cy + rnd(-80, 80));
        } else {
          this.stats[attacking].corners++;
          this.emit("corner", { team: attacking === "home" ? this.home.name : this.away.name });
          const cx = leftOut ? 8 : FIELD.w - 8, cyy = b.y < cy ? 8 : FIELD.h - 8;
          this._startDeadball("corner", attacking, cx, cyy);
        }
      }
    }
    _afterPenaltyNoGoal() {
      this.penalty = null; this.phase = "play";
      // 골킥으로 재개
      const def = this._lastShot && this._lastShot.team === "home" ? "away" : "home";
      this._startDeadball("goalkick", def, def === "home" ? 80 : FIELD.w - 80, cy);
    }
    _goal(scorer) {
      const wasPenalty = this.phase === "penalty" || !!this.penalty;
      this.score[scorer]++;
      this.scorers.push({ team: scorer, name: (this.lastTouch && this.lastTouch.team === scorer ? this.lastTouch.name : ""), minute: this._clockLabel().split(":")[0] });
      this.onGoal(scorer, { ...this.score });
      const nm = scorer === "home" ? this.home.name : this.away.name;
      const scn = (this.lastTouch && this.lastTouch.team === scorer) ? this.lastTouch.name : "";
      this.emit(wasPenalty ? "penalty_goal" : "goal", { team: nm, scorer: scn });
      this.message = `⚽ GOAL!  —  ${nm}` + (scn ? `  (${scn})` : "");
      this.messageTimer = 2.0; this.goalFlash = 1;
      this.penalty = null;
      this._kickoffReset(scorer === "home" ? "away" : "home");
      this.messageTimer = 2.0; // kickoffReset 후 다시
    }

    _possessionTick(dt) {
      const o = this.ball.owner || this.lastTouch;
      if (o) this.stats[o.team].poss += dt;
      this.onStats(this._statSnapshot());
    }

    /* ===== 동기화/렌더 ===== */
    _sync() {
      for (const p of this.players) {
        if (p.sentOff) { p.mesh.visible = false; continue; }
        p.mesh.visible = true;
        p.mesh.position.set(fx2wx(p.x), 0, fy2wz(p.y));
        const ang = Math.atan2(fx2wx(p.x + p.faceX) - fx2wx(p.x), fy2wz(p.y + p.faceY) - fy2wz(p.y));
        p.mesh.rotation.y = ang;
        // 달리기 팔다리 애니메이션
        if (p._legL) {
          const moving = Math.min(len(p.vx, p.vy), 1.4); p.runPhase += moving * 0.07;
          const sw = Math.sin(p.runPhase * 2) * moving * 0.6;
          p._legL.rotation.x = sw; p._legR.rotation.x = -sw;
          if (p._armL) { p._armL.rotation.x = -sw * 0.7; p._armR.rotation.x = sw * 0.7; }
        }
        if (p._ring) p._ring.visible = (p === this.controlled);
      }
      const b = this.ball;
      this.ballMesh.position.set(fx2wx(b.x), 0.5 + b.h, fy2wz(b.y));
      this.ballMesh.rotation.x += b.vy * 0.05; this.ballMesh.rotation.z -= b.vx * 0.05;
      const c = this.controlled;
      if (c && c.moveTarget) { this._moveMarker.visible = true; this._moveMarker.position.set(fx2wx(c.moveTarget.x), 0.08, fy2wz(c.moveTarget.y)); }
      else this._moveMarker.visible = false;
      // 배너
      if (this._banner) {
        if (this.message) { if (this._banner.textContent !== this.message) this._banner.textContent = this.message; this._banner.style.display = "block"; this._banner.classList.toggle("goal", this.goalFlash > 0); }
        else this._banner.style.display = "none";
      }
      // 이름표(조작 선수)
      if (this._nameTag && c) {
        this._projV.set(fx2wx(c.x), 3.6, fy2wz(c.y)).project(this.camera);
        const rect = this.canvas.getBoundingClientRect();
        const sx = (this._projV.x * 0.5 + 0.5) * rect.width, sy = (-this._projV.y * 0.5 + 0.5) * rect.height;
        if (this._projV.z < 1) { this._nameTag.style.display = "block"; this._nameTag.style.left = sx + "px"; this._nameTag.style.top = sy + "px"; this._nameTag.textContent = `${c.number} ${c.name}`; }
        else this._nameTag.style.display = "none";
      } else if (this._nameTag) this._nameTag.style.display = "none";
    }

    _updateCamera(dt) {
      const bx = fx2wx(this.ball.x), bz = fy2wz(this.ball.y);
      const desired = this._tmpV.set(bx * 0.32, 72, bz * 0.18 + WORLD.h / 2 + 28);
      const k = 1 - Math.pow(0.0015, dt);
      this.camera.position.lerp(desired, Math.min(k * 2.0, 1));
      this._camTarget.set(bx * 0.4, 0, bz * 0.32 - 4); this.camera.lookAt(this._camTarget);
    }
  }

  MatchEngine.FORMATIONS = Object.keys(FORMATIONS);
  global.MatchEngine = MatchEngine;
})(window);
