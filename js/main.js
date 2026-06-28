/* ===========================================================
 *  main.js — 화면 전환 / UI / 게임 흐름 제어
 * =========================================================== */
(function () {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const state = {
    mode: null,        // "tournament" | "quick"
    userTeamId: null,
    tournament: null,
    engine: null,
    quickAway: null,
    pendingMatch: null, // {home, away, onEnd}
  };

  /* ---------- 화면 전환 ---------- */
  function show(id) {
    $$(".screen").forEach((s) => s.classList.remove("active"));
    $("#" + id).classList.add("active");
  }

  /* ---------- 홈 ---------- */
  function initHome() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const a = btn.dataset.action;
      if (a === "home") goHome();
      else if (a === "start-tournament") { state.mode = "tournament"; openTeamSelect("월드컵 — 국가대표 선택"); }
      else if (a === "quick-match") { state.mode = "quick"; openTeamSelect("빠른 경기 — 우리 팀 선택"); }
      else if (a === "show-howto") $("#howto-modal").classList.remove("hidden");
      else if (a === "close-howto") $("#howto-modal").classList.add("hidden");
    });
  }

  function goHome() {
    if (state.engine) { state.engine.destroy(); state.engine = null; }
    show("screen-home");
  }

  /* ---------- 팀 선택 ---------- */
  function openTeamSelect(title) {
    $("#select-title").textContent = title;
    const grid = $("#team-grid");
    grid.innerHTML = "";
    TEAMS.forEach((t) => {
      const card = document.createElement("button");
      card.className = "team-card";
      card.style.setProperty("--c1", t.colors[0]);
      card.style.setProperty("--c2", t.colors[1]);
      card.innerHTML = `
        <span class="tc-flag">${t.flag}</span>
        <span class="tc-name">${t.name}</span>
        <span class="tc-rating">OVR ${t.rating}</span>
        <span class="tc-bar"><i style="width:${t.rating}%"></i></span>`;
      card.addEventListener("click", () => chooseTeam(t.id));
      grid.appendChild(card);
    });
    show("screen-select");
  }

  function chooseTeam(id) {
    state.userTeamId = id;
    if (state.mode === "tournament") {
      state.tournament = new Tournament(TEAMS, id);
      renderTournament();
      show("screen-tournament");
    } else {
      // 빠른 경기: 랜덤 상대
      let opp;
      do { opp = TEAMS[Math.floor(Math.random() * TEAMS.length)]; } while (opp.id === id);
      startMatch(teamById(id), opp, (res) => {
        showResultOverlay(teamById(id), opp, res, () => goHome());
      });
    }
  }

  /* ---------- 토너먼트 허브 렌더 ---------- */
  function renderTournament() {
    const t = state.tournament;
    $("#t-stage-label").textContent = t.stageLabel();

    if (t.stage === "group") {
      $("#groups-view").classList.remove("hidden");
      $("#bracket-view").classList.add("hidden");
      renderGroups();
    } else {
      $("#groups-view").classList.add("hidden");
      $("#bracket-view").classList.remove("hidden");
      renderBracket();
    }
    renderNextMatch();
  }

  function renderGroups() {
    const t = state.tournament;
    const view = $("#groups-view");
    view.innerHTML = "";
    for (const g of t.groups) {
      const standings = t.standings(g);
      const el = document.createElement("div");
      el.className = "group-card";
      let rows = standings.map((r, i) => `
        <tr class="${r.team.id === t.userTeamId ? "me" : ""} ${i < 2 ? "qualify" : ""}">
          <td class="gc-pos">${i + 1}</td>
          <td class="gc-team">${r.team.flag} ${r.team.name}</td>
          <td>${r.P}</td><td>${r.W}</td><td>${r.D}</td><td>${r.L}</td>
          <td>${r.GF - r.GA > 0 ? "+" : ""}${r.GF - r.GA}</td>
          <td class="gc-pts">${r.Pts}</td>
        </tr>`).join("");
      el.innerHTML = `
        <h4>조 ${g.name}</h4>
        <table class="group-table">
          <thead><tr><th></th><th>팀</th><th>경기</th><th>승</th><th>무</th><th>패</th><th>득실</th><th>승점</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
      view.appendChild(el);
    }
  }

  function renderBracket() {
    const t = state.tournament;
    const b = t.bracket;
    const view = $("#bracket-view");
    view.innerHTML = "";
    if (t.stage === "done") {
      view.innerHTML = `
        <div class="champion-box">
          <div class="champ-trophy">🏆</div>
          <div class="champ-label">월드컵 챔피언</div>
          <div class="champ-team">${t.champion.flag} ${t.champion.name}</div>
          <button class="btn btn-primary" data-action="home">홈으로</button>
        </div>`;
      return;
    }
    b.rounds.forEach((round, ri) => {
      const col = document.createElement("div");
      col.className = "bracket-col";
      col.innerHTML = `<h5>${b.labels[ri]}</h5>`;
      round.forEach((tie) => {
        const cur = ri === b.current;
        const d = document.createElement("div");
        d.className = "tie" + (cur ? " active" : "");
        const row = (team, score, win) => `
          <div class="tie-row ${win ? "win" : ""} ${team && team.id === t.userTeamId ? "me" : ""}">
            <span>${team ? team.flag + " " + team.name : "—"}</span>
            <b>${score == null ? "" : score}</b>
          </div>`;
        d.innerHTML =
          row(tie.home, tie.score ? tie.score[0] : null, tie.winner && tie.home && tie.winner.id === tie.home.id) +
          row(tie.away, tie.score ? tie.score[1] : null, tie.winner && tie.away && tie.winner.id === tie.away.id) +
          (tie.pens ? `<div class="tie-pens">승부차기</div>` : "");
        col.appendChild(d);
      });
      view.appendChild(col);
    });
  }

  function renderNextMatch() {
    const t = state.tournament;
    const card = $("#next-match-card");
    const m = t.nextUserMatch();
    if (t.stage === "done") { card.innerHTML = ""; return; }
    if (m) {
      const fx = m.fixture || m.tie;
      const isHome = fx.home.id === t.userTeamId;
      const me = isHome ? fx.home : fx.away;
      const opp = isHome ? fx.away : fx.home;
      card.innerHTML = `
        <div class="nm-label">다음 경기 (${t.stageLabel()})</div>
        <div class="nm-teams">
          <span>${fx.home.flag} ${fx.home.name}</span>
          <span class="nm-vs">VS</span>
          <span>${fx.away.flag} ${fx.away.name}</span>
        </div>
        <button class="btn btn-primary" id="btn-play-match">▶ 경기 시작 (${me.name} 조작)</button>`;
      $("#btn-play-match").addEventListener("click", () => playTournamentMatch(m));
    } else {
      card.innerHTML = `
        <div class="nm-label">이번 단계 유저 경기 완료</div>
        <button class="btn btn-primary" id="btn-advance">⏩ 결과 진행 / 다음 단계</button>`;
      $("#btn-advance").addEventListener("click", () => {
        t.simulateRemaining();
        t.tryAdvance();
        renderTournament();
      });
    }
  }

  function playTournamentMatch(m) {
    const t = state.tournament;
    const fx = m.fixture || m.tie;
    startMatch(fx.home, fx.away, (res) => {
      showResultOverlay(fx.home, fx.away, res, () => {
        t.reportUserResult(res.home, res.away);
        t.tryAdvance();
        renderTournament();
        show("screen-tournament");
      });
    });
  }

  $("#btn-sim-others") && $("#btn-sim-others").addEventListener("click", () => {
    const t = state.tournament;
    if (!t) return;
    t.simulateRemaining();
    t.tryAdvance();
    renderTournament();
  });

  /* ---------- 경기 실행 ---------- */
  function startMatch(home, away, onEnd) {
    show("screen-match");
    $("#sb-home-flag").textContent = home.flag;
    $("#sb-home-name").textContent = home.name;
    $("#sb-away-flag").textContent = away.flag;
    $("#sb-away-name").textContent = away.name;
    $("#sb-home-score").textContent = "0";
    $("#sb-away-score").textContent = "0";
    $("#sb-clock").textContent = "00:00";
    $("#match-overlay").classList.add("hidden");

    if (state.engine) state.engine.destroy();
    // 캔버스가 레이아웃되도록 다음 프레임에 시작
    requestAnimationFrame(() => {
      const engine = new MatchEngine($("#pitch"), home, away, {
        onGoal: (scorer, score) => {
          $("#sb-home-score").textContent = score.home;
          $("#sb-away-score").textContent = score.away;
        },
        onClock: (label) => { $("#sb-clock").textContent = label; },
        onEnd: (res) => { engine.destroy(); onEnd(res); },
      });
      state.engine = engine;
      engine.start();
    });
    bindTouchControls();
  }

  function showResultOverlay(home, away, res, next) {
    const ov = $("#match-overlay");
    ov.classList.remove("hidden");
    let verdict;
    if (res.home > res.away) verdict = `${home.flag} ${home.name} 승리!`;
    else if (res.home < res.away) verdict = `${away.flag} ${away.name} 승리!`;
    else verdict = "무승부";
    ov.innerHTML = `
      <div class="result-card">
        <div class="rc-final">FULL TIME</div>
        <div class="rc-score">
          <span>${home.flag} ${home.name}</span>
          <b>${res.home} : ${res.away}</b>
          <span>${away.name} ${away.flag}</span>
        </div>
        <div class="rc-verdict">${verdict}</div>
        <button class="btn btn-primary" id="rc-next">계속 ▶</button>
      </div>`;
    $("#rc-next").addEventListener("click", next);
  }

  /* ---------- 터치 컨트롤 ---------- */
  let touchBound = false;
  function bindTouchControls() {
    if (touchBound) return;
    touchBound = true;
    const setDir = (dir, val) => {
      if (!state.engine) return;
      state.engine.setInput(dir, val);
    };
    $$(".dbtn").forEach((b) => {
      const dir = b.dataset.dir;
      const on = (e) => { e.preventDefault(); setDir(dir, true); };
      const off = (e) => { e.preventDefault(); setDir(dir, false); };
      b.addEventListener("touchstart", on, { passive: false });
      b.addEventListener("touchend", off);
      b.addEventListener("mousedown", on);
      b.addEventListener("mouseup", off);
      b.addEventListener("mouseleave", off);
    });
    $$(".abtn").forEach((b) => {
      const act = b.dataset.act;
      const on = (e) => { e.preventDefault(); if (state.engine) state.engine.setInput(act, true); };
      const off = (e) => { e.preventDefault(); if (state.engine) state.engine.setInput(act, false); };
      b.addEventListener("touchstart", on, { passive: false });
      b.addEventListener("touchend", off);
      b.addEventListener("mousedown", on);
      b.addEventListener("mouseup", off);
    });
  }

  /* ---------- 부팅 ---------- */
  initHome();
  show("screen-home");
})();
