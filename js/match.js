/* ===========================================================
 *  match.js — Canvas 기반 탑다운 축구 엔진 (아케이드)
 *  홈팀(플레이어)은 왼→오른쪽 공격, 어웨이(AI)는 반대.
 *  5명(필드 4 + GK) 포메이션, 패스/슛/태클/골 처리.
 * =========================================================== */
(function (global) {
  "use strict";

  // 논리 좌표계 (실제 픽셀은 캔버스 크기에 맞춰 스케일)
  const FIELD = { w: 1050, h: 680 };
  const GOAL_H = 180;            // 골문 폭
  const PLAYER_R = 13;
  const BALL_R = 8;
  const FRICTION = 0.985;
  const BALL_FRICTION = 0.982;
  const HALF_SECONDS = 90;       // 전/후반 길이(게임 초)

  // 5인 포메이션(필드의 상대 비율). x:0=자기진영 골라인, 1=상대 골라인
  const FORMATION = [
    { role: "GK", x: 0.05, y: 0.5 },
    { role: "DF", x: 0.25, y: 0.28 },
    { role: "DF", x: 0.25, y: 0.72 },
    { role: "MF", x: 0.5,  y: 0.5 },
    { role: "FW", x: 0.72, y: 0.5 },
  ];

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }
  function len(x, y) { return Math.hypot(x, y); }

  class MatchEngine {
    constructor(canvas, home, away, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.home = home;
      this.away = away;
      this.opts = opts;
      this.onGoal = opts.onGoal || function () {};
      this.onEnd = opts.onEnd || function () {};
      this.onClock = opts.onClock || function () {};

      this.score = { home: 0, away: 0 };
      this.half = 1;
      this.clock = 0;          // 현재 하프 경과 게임초
      this.running = false;
      this.paused = false;
      this.lastTs = 0;
      this.message = null;
      this.messageTimer = 0;

      this.input = { up: false, down: false, left: false, right: false, pass: false, shoot: false };
      this.shootCharge = 0;
      this.controlled = null;

      this._buildPlayers();
      this._resetPositions("home");
      this._fitCanvas();
      this._bind();
    }

    /* ---------- 팀/선수 구성 ---------- */
    _buildPlayers() {
      this.players = [];
      const mk = (team, f, idx) => {
        const rating = (team === "home" ? this.home.rating : this.away.rating) / 100;
        return {
          team, role: f.role, base: { x: f.x, y: f.y }, idx,
          x: 0, y: 0, vx: 0, vy: 0,
          speed: 2.6 + rating * 1.6 + (f.role === "FW" ? 0.5 : 0),
          rating,
        };
      };
      FORMATION.forEach((f, i) => this.players.push(mk("home", f, i)));
      FORMATION.forEach((f, i) => this.players.push(mk("away", f, i)));
      this.ball = { x: FIELD.w / 2, y: FIELD.h / 2, vx: 0, vy: 0, owner: null };
    }

    // 홈은 base.x 그대로(왼→오), 어웨이는 x 반전
    _formationPos(p) {
      const bx = p.team === "home" ? p.base.x : 1 - p.base.x;
      const by = p.team === "home" ? p.base.y : 1 - p.base.y;
      return { x: bx * FIELD.w, y: by * FIELD.h };
    }

    _resetPositions(kickoffTeam) {
      for (const p of this.players) {
        const fp = this._formationPos(p);
        p.x = fp.x; p.y = fp.y; p.vx = 0; p.vy = 0;
      }
      this.ball.x = FIELD.w / 2; this.ball.y = FIELD.h / 2;
      this.ball.vx = 0; this.ball.vy = 0; this.ball.owner = null;
      // 킥오프 팀 중앙 선수에게 약하게 부여
      const mid = this.players.find((p) => p.team === kickoffTeam && p.role === "MF");
      if (mid) { mid.x = FIELD.w / 2 - (kickoffTeam === "home" ? 30 : -30); mid.y = FIELD.h / 2; }
    }

    /* ---------- 입력 ---------- */
    _bind() {
      this._keydown = (e) => this._key(e, true);
      this._keyup = (e) => this._key(e, false);
      window.addEventListener("keydown", this._keydown);
      window.addEventListener("keyup", this._keyup);
    }
    destroy() {
      this.running = false;
      window.removeEventListener("keydown", this._keydown);
      window.removeEventListener("keyup", this._keyup);
      window.removeEventListener("resize", this._resize);
    }
    _key(e, down) {
      const k = e.key.toLowerCase();
      const map = {
        arrowup: "up", w: "up", arrowdown: "down", s: "down",
        arrowleft: "left", a: "left", arrowright: "right", d: "right",
        j: "pass", k: "shoot", " ": "shoot",
      };
      if (map[k]) {
        this.input[map[k]] = down;
        e.preventDefault();
      }
    }
    setInput(name, val) { if (name in this.input) this.input[name] = val; }

    /* ---------- 캔버스 핏 ---------- */
    _fitCanvas() {
      this._resize = () => {
        const wrap = this.canvas.parentElement;
        const maxW = wrap.clientWidth;
        const maxH = wrap.clientHeight;
        const ratio = FIELD.w / FIELD.h;
        let w = maxW, h = maxW / ratio;
        if (h > maxH) { h = maxH; w = maxH * ratio; }
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = w * dpr;
        this.canvas.height = h * dpr;
        this.canvas.style.width = w + "px";
        this.canvas.style.height = h + "px";
        this.scale = (w * dpr) / FIELD.w;
        this.ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      };
      this._resize();
      window.addEventListener("resize", this._resize);
    }

    /* ---------- 루프 ---------- */
    start() {
      this.running = true;
      this.message = `${this.home.name} vs ${this.away.name}`;
      this.messageTimer = 1.6;
      this.lastTs = performance.now();
      const loop = (ts) => {
        if (!this.running) return;
        let dt = (ts - this.lastTs) / 1000;
        this.lastTs = ts;
        if (dt > 0.05) dt = 0.05;
        if (!this.paused) this._update(dt);
        this._render();
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }

    _update(dt) {
      // 시계 (메시지 표시 중에는 멈춤)
      if (this.messageTimer > 0) {
        this.messageTimer -= dt;
        if (this.messageTimer <= 0) this.message = null;
      } else {
        this.clock += dt;
        this.onClock(this._clockLabel());
        if (this.clock >= HALF_SECONDS) this._endHalf();
      }

      this._chooseControlled();
      this._updateInput(dt);
      this._updateAI(dt);
      this._integrate(dt);
      this._ballPhysics(dt);
      this._collisions();
      this._checkGoal();
    }

    _clockLabel() {
      const base = this.half === 1 ? 0 : 45;
      const minute = Math.floor(base + (this.clock / HALF_SECONDS) * 45);
      const sec = Math.floor((((base + (this.clock / HALF_SECONDS) * 45) % 1) * 60));
      return `${String(minute).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    }

    _endHalf() {
      if (this.half === 1) {
        this.half = 2;
        this.clock = 0;
        this.message = "하프타임 — 후반 시작!";
        this.messageTimer = 1.8;
        this._resetPositions(this.score.home <= this.score.away ? "home" : "away");
      } else {
        this.running = false;
        this.onEnd({ ...this.score });
      }
    }

    /* ---------- 조작 선수 선택 ---------- */
    _chooseControlled() {
      // 홈팀이 공 소유 시 소유 선수 조작, 아니면 공에 가장 가까운 필드 선수
      if (this.ball.owner && this.ball.owner.team === "home") {
        this.controlled = this.ball.owner;
        return;
      }
      let best = null, bd = Infinity;
      for (const p of this.players) {
        if (p.team !== "home" || p.role === "GK") continue;
        const d = dist2(p.x, p.y, this.ball.x, this.ball.y);
        if (d < bd) { bd = d; best = p; }
      }
      this.controlled = best;
    }

    _updateInput(dt) {
      const p = this.controlled;
      if (!p) return;
      let dx = 0, dy = 0;
      if (this.input.up) dy -= 1;
      if (this.input.down) dy += 1;
      if (this.input.left) dx -= 1;
      if (this.input.right) dx += 1;
      const l = len(dx, dy);
      if (l > 0) {
        dx /= l; dy /= l;
        p.vx = dx * p.speed;
        p.vy = dy * p.speed;
        p.faceX = dx; p.faceY = dy;
      }

      // 슛 차징
      if (this.input.shoot && this.ball.owner === p) {
        this.shootCharge = Math.min(this.shootCharge + dt, 1);
      } else if (!this.input.shoot && this.shootCharge > 0 && this.ball.owner === p) {
        this._shoot(p, this.shootCharge);
        this.shootCharge = 0;
      }
      // 패스
      if (this.input.pass && this.ball.owner === p) {
        this._pass(p);
        this.input.pass = false;
      }
    }

    _shoot(p, charge) {
      const goalX = p.team === "home" ? FIELD.w : 0;
      const goalY = FIELD.h / 2 + (Math.random() - 0.5) * GOAL_H * 0.7;
      let dx = goalX - this.ball.x, dy = goalY - this.ball.y;
      // 조준 방향이 입력으로 있으면 가미
      if (p.faceX || p.faceY) { dx += p.faceX * 200; dy += p.faceY * 200; }
      const l = len(dx, dy) || 1;
      const power = 11 + charge * 11;
      this.ball.vx = (dx / l) * power;
      this.ball.vy = (dy / l) * power;
      this.ball.owner = null;
      p._touchCd = 0.5;
      this._flash(p.team === "home" ? "home" : "away");
    }

    _pass(p) {
      // 같은 팀, 전방에 가까운 동료 찾기
      let best = null, bScore = -Infinity;
      const fwd = p.team === "home" ? 1 : -1;
      for (const m of this.players) {
        if (m === p || m.team !== p.team || m.role === "GK") continue;
        const ahead = (m.x - p.x) * fwd;
        const d = Math.sqrt(dist2(p.x, p.y, m.x, m.y));
        const score = ahead * 1.2 - d * 0.4;
        if (score > bScore) { bScore = score; best = m; }
      }
      if (!best) return;
      let dx = best.x - this.ball.x, dy = best.y - this.ball.y;
      const l = len(dx, dy) || 1;
      const power = clamp(l / 35, 6, 13);
      this.ball.vx = (dx / l) * power;
      this.ball.vy = (dy / l) * power;
      this.ball.owner = null;
      p._touchCd = 0.35;
    }

    /* ---------- AI ---------- */
    _updateAI(dt) {
      const ball = this.ball;
      for (const p of this.players) {
        if (p === this.controlled) continue;
        if (p._touchCd > 0) p._touchCd -= dt;
        const home = this._formationPos(p);
        const ownsBall = ball.owner === p;
        const teamHasBall = ball.owner && ball.owner.team === p.team;
        const goalX = p.team === "home" ? FIELD.w : 0;

        let tx = home.x, ty = home.y;

        if (p.role === "GK") {
          // 골키퍼: 골라인 근처, 공 y 추종
          const lineX = p.team === "home" ? FIELD.w * 0.04 : FIELD.w * 0.96;
          tx = lineX;
          ty = clamp(ball.y, FIELD.h / 2 - GOAL_H / 2, FIELD.h / 2 + GOAL_H / 2);
          // 공이 매우 가까우면 돌진
          if (dist2(p.x, p.y, ball.x, ball.y) < 90 * 90 && !ball.owner) { tx = ball.x; ty = ball.y; }
        } else if (ownsBall) {
          // 드리블: 상대 골 방향
          tx = goalX; ty = FIELD.h / 2;
          // 슛 사정권이면 슛
          const distGoal = Math.abs(goalX - p.x);
          if (distGoal < FIELD.w * 0.28 && p._touchCd <= 0) {
            if (Math.random() < 0.03) { this._shoot(p, 0.6 + Math.random() * 0.4); }
            else if (Math.random() < 0.02) { this._pass(p); }
          }
        } else if (teamHasBall) {
          // 공격 전개: 전방으로 전진 + 기본위치
          const push = p.team === "home" ? 0.12 : -0.12;
          tx = clamp(home.x + push * FIELD.w, 40, FIELD.w - 40);
          ty = home.y * 0.5 + ball.y * 0.5;
        } else {
          // 수비/볼 추적: 가장 가까운 한 명만 공으로
          const closest = this._closestToBall(p.team);
          if (closest === p) { tx = ball.x; ty = ball.y; }
          else {
            // 자기 진영 쪽으로 후퇴 + 공 y 따라가기
            tx = home.x * 0.6 + ball.x * 0.4;
            ty = home.y * 0.5 + ball.y * 0.5;
          }
        }

        let dx = tx - p.x, dy = ty - p.y;
        const l = len(dx, dy);
        if (l > 4) {
          const sp = p.speed * (ownsBall ? 0.92 : 1);
          p.vx = (dx / l) * sp; p.vy = (dy / l) * sp;
          p.faceX = dx / l; p.faceY = dy / l;
        } else { p.vx *= 0.6; p.vy *= 0.6; }
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

    /* ---------- 물리 ---------- */
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
      const b = this.ball;
      const step = dt * 60;
      if (b.owner) {
        // 소유자 앞에 부착
        const fx = b.owner.faceX || (b.owner.team === "home" ? 1 : -1);
        const fy = b.owner.faceY || 0;
        const fl = len(fx, fy) || 1;
        b.x = b.owner.x + (fx / fl) * (PLAYER_R + 6);
        b.y = b.owner.y + (fy / fl) * (PLAYER_R + 6);
        b.vx = 0; b.vy = 0;
        return;
      }
      b.x += b.vx * step; b.y += b.vy * step;
      b.vx *= BALL_FRICTION; b.vy *= BALL_FRICTION;
      // 위/아래 벽 반사
      if (b.y < BALL_R) { b.y = BALL_R; b.vy *= -0.7; }
      if (b.y > FIELD.h - BALL_R) { b.y = FIELD.h - BALL_R; b.vy *= -0.7; }
      // 좌/우 벽: 골 영역 밖이면 반사
      const inGoalY = b.y > FIELD.h / 2 - GOAL_H / 2 && b.y < FIELD.h / 2 + GOAL_H / 2;
      if (b.x < BALL_R && !inGoalY) { b.x = BALL_R; b.vx *= -0.7; }
      if (b.x > FIELD.w - BALL_R && !inGoalY) { b.x = FIELD.w - BALL_R; b.vx *= -0.7; }
    }

    _collisions() {
      const b = this.ball;
      // 공 소유 획득
      for (const p of this.players) {
        if (p._touchCd > 0) continue;
        const rr = (PLAYER_R + BALL_R + 4) ** 2;
        if (dist2(p.x, p.y, b.x, b.y) < rr) {
          if (!b.owner) {
            b.owner = p;
          } else if (b.owner.team !== p.team) {
            // 태클: 확률적 탈취
            const steal = 0.5 + (p.rating - b.owner.rating) * 0.5;
            if (Math.random() < steal * 0.25) { b.owner = p; p._touchCd = 0.2; }
          }
        }
      }
      // 선수 간 가벼운 분리
      for (let i = 0; i < this.players.length; i++) {
        for (let j = i + 1; j < this.players.length; j++) {
          const a = this.players[i], c = this.players[j];
          const dx = c.x - a.x, dy = c.y - a.y;
          const d = len(dx, dy);
          const min = PLAYER_R * 2;
          if (d > 0 && d < min) {
            const push = (min - d) / 2;
            const nx = dx / d, ny = dy / d;
            a.x -= nx * push; a.y -= ny * push;
            c.x += nx * push; c.y += ny * push;
          }
        }
      }
    }

    _checkGoal() {
      const b = this.ball;
      const inGoalY = b.y > FIELD.h / 2 - GOAL_H / 2 && b.y < FIELD.h / 2 + GOAL_H / 2;
      if (b.x <= BALL_R + 2 && inGoalY) { this._goal("away"); }
      else if (b.x >= FIELD.w - BALL_R - 2 && inGoalY) { this._goal("home"); }
    }

    _goal(scorer) {
      this.score[scorer]++;
      this.onGoal(scorer, { ...this.score });
      const name = scorer === "home" ? this.home.name : this.away.name;
      this.message = `⚽ GOAL! — ${name}`;
      this.messageTimer = 1.8;
      this.goalFlash = 1;
      this._resetPositions(scorer === "home" ? "away" : "home");
    }

    _flash() {}
    _flashTimer() {}

    /* ---------- 렌더 ---------- */
    _render() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, FIELD.w, FIELD.h);
      this._drawPitch(ctx);
      this._drawBallShadow(ctx);
      // 선수
      for (const p of this.players) this._drawPlayer(ctx, p);
      this._drawBall(ctx);
      if (this.message) this._drawMessage(ctx);
      if (this.shootCharge > 0 && this.controlled) this._drawCharge(ctx);
      if (this.goalFlash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${this.goalFlash * 0.5})`;
        ctx.fillRect(0, 0, FIELD.w, FIELD.h);
        this.goalFlash -= 0.04;
      }
    }

    _drawPitch(ctx) {
      // 잔디 스트라이프
      const stripes = 12;
      const sw = FIELD.w / stripes;
      for (let i = 0; i < stripes; i++) {
        ctx.fillStyle = i % 2 ? "#1f8a4c" : "#1c813f";
        ctx.fillRect(i * sw, 0, sw, FIELD.h);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 3;
      // 외곽선
      ctx.strokeRect(12, 12, FIELD.w - 24, FIELD.h - 24);
      // 센터라인
      ctx.beginPath();
      ctx.moveTo(FIELD.w / 2, 12); ctx.lineTo(FIELD.w / 2, FIELD.h - 12); ctx.stroke();
      // 센터서클
      ctx.beginPath();
      ctx.arc(FIELD.w / 2, FIELD.h / 2, 80, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.arc(FIELD.w / 2, FIELD.h / 2, 4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.fill();
      // 페널티 박스 + 골
      const boxH = 300, boxW = 150, gy = FIELD.h / 2;
      ctx.strokeRect(12, gy - boxH / 2, boxW, boxH);
      ctx.strokeRect(FIELD.w - 12 - boxW, gy - boxH / 2, boxW, boxH);
      // 골문
      ctx.lineWidth = 6;
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.beginPath();
      ctx.moveTo(12, gy - GOAL_H / 2); ctx.lineTo(12, gy + GOAL_H / 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(FIELD.w - 12, gy - GOAL_H / 2); ctx.lineTo(FIELD.w - 12, gy + GOAL_H / 2); ctx.stroke();
    }

    _drawPlayer(ctx, p) {
      const team = p.team === "home" ? this.home : this.away;
      const col = team.colors[0];
      const alt = team.colors[1];
      // 그림자
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + PLAYER_R * 0.7, PLAYER_R, PLAYER_R * 0.45, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fill();
      // 몸체
      ctx.beginPath();
      ctx.arc(p.x, p.y, PLAYER_R, 0, Math.PI * 2);
      ctx.fillStyle = p.role === "GK" ? "#222" : col;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = alt;
      ctx.stroke();
      // 조작 표시(노란 링)
      if (p === this.controlled) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, PLAYER_R + 5, 0, Math.PI * 2);
        ctx.strokeStyle = "#FFEB3B"; ctx.lineWidth = 3; ctx.stroke();
      }
    }

    _drawBallShadow(ctx) {
      ctx.beginPath();
      ctx.ellipse(this.ball.x, this.ball.y + BALL_R * 0.8, BALL_R, BALL_R * 0.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fill();
    }
    _drawBall(ctx) {
      const b = this.ball;
      ctx.beginPath();
      ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
      ctx.fillStyle = "#fff"; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = "#333"; ctx.stroke();
      // 오각 점
      ctx.beginPath();
      ctx.arc(b.x, b.y, BALL_R * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = "#222"; ctx.fill();
    }

    _drawCharge(ctx) {
      const p = this.controlled;
      ctx.beginPath();
      ctx.arc(p.x, p.y, PLAYER_R + 9, -Math.PI / 2, -Math.PI / 2 + this.shootCharge * Math.PI * 2);
      ctx.strokeStyle = "#ff5252"; ctx.lineWidth = 4; ctx.stroke();
    }

    _drawMessage(ctx) {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(0, FIELD.h / 2 - 50, FIELD.w, 100);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 46px 'Russo One', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(this.message, FIELD.w / 2, FIELD.h / 2);
      ctx.restore();
    }
  }

  global.MatchEngine = MatchEngine;
})(window);
