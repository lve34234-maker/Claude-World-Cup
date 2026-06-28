/* ===========================================================
 *  tournament.js — 월드컵 구조 (32개국)
 *  8개조 조별리그 → 16강 토너먼트.
 *  유저 경기는 직접 플레이, 나머지는 전력 기반 시뮬레이션.
 * =========================================================== */
(function (global) {
  "use strict";

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 전력차 기반 스코어 시뮬레이션
  function simulateScore(aRating, bRating) {
    const diff = (aRating - bRating) / 10;
    const aLambda = Math.max(0.2, 1.35 + diff * 0.45);
    const bLambda = Math.max(0.2, 1.35 - diff * 0.45);
    return [poisson(aLambda), poisson(bLambda)];
  }
  function poisson(lambda) {
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= Math.random(); } while (p > L);
    return k - 1;
  }

  class Tournament {
    constructor(teams, userTeamId) {
      this.userTeamId = userTeamId;
      this.stage = "group";          // group | r16 | qf | sf | final | done
      this.groups = this._draw(teams);
      this.bracket = null;
      this.champion = null;
      this.matchQueue = [];          // 유저가 플레이할 현재 단계 경기들
      this._buildGroupFixtures();
    }

    _draw(teams) {
      // rating 순 포트 분배 후 8개조
      const sorted = teams.slice().sort((a, b) => b.rating - a.rating);
      const pots = [[], [], [], []];
      sorted.forEach((t, i) => pots[Math.floor(i / 8)].push(t));
      pots.forEach((p, i) => (pots[i] = shuffle(p)));
      const groups = [];
      const letters = "ABCDEFGH";
      for (let g = 0; g < 8; g++) {
        groups.push({
          name: letters[g],
          teams: [pots[0][g], pots[1][g], pots[2][g], pots[3][g]],
          table: {},
          fixtures: [],
        });
      }
      // 테이블 초기화
      for (const g of groups) {
        for (const t of g.teams) {
          g.table[t.id] = { team: t, P: 0, W: 0, D: 0, L: 0, GF: 0, GA: 0, Pts: 0 };
        }
      }
      return groups;
    }

    _buildGroupFixtures() {
      // 각 조 round-robin (6경기)
      for (const g of g_each(this.groups)) {
        const [a, b, c, d] = g.teams;
        g.fixtures = [
          [a, b], [c, d], [a, c], [b, d], [a, d], [b, c],
        ].map((pair) => ({ home: pair[0], away: pair[1], played: false, score: null }));
      }
      this._refreshUserQueue();
    }

    _refreshUserQueue() {
      this.matchQueue = [];
      if (this.stage === "group") {
        for (const g of this.groups) {
          for (const f of g.fixtures) {
            if (!f.played && (f.home.id === this.userTeamId || f.away.id === this.userTeamId)) {
              this.matchQueue.push({ group: g, fixture: f });
            }
          }
        }
      } else if (this.bracket) {
        const round = this.bracket.rounds[this.bracket.current];
        for (const tie of round) {
          if (!tie.played && tie.home && tie.away &&
              (tie.home.id === this.userTeamId || tie.away.id === this.userTeamId)) {
            this.matchQueue.push({ tie });
          }
        }
      }
    }

    nextUserMatch() {
      return this.matchQueue.length ? this.matchQueue[0] : null;
    }

    // 유저 경기 결과 반영
    reportUserResult(homeScore, awayScore) {
      const m = this.matchQueue.shift();
      if (!m) return;
      if (m.fixture) {
        m.fixture.played = true;
        m.fixture.score = [homeScore, awayScore];
        this._applyTable(m.group, m.fixture);
      } else if (m.tie) {
        this._applyTie(m.tie, homeScore, awayScore);
      }
    }

    // 유저가 끼지 않은 모든 경기 시뮬레이션 (현재 단계)
    simulateRemaining() {
      if (this.stage === "group") {
        for (const g of this.groups) {
          for (const f of g.fixtures) {
            if (f.played) continue;
            if (f.home.id === this.userTeamId || f.away.id === this.userTeamId) continue;
            const s = simulateScore(f.home.rating, f.away.rating);
            f.played = true; f.score = s;
            this._applyTable(g, f);
          }
        }
        // 유저 경기가 전부 끝났는지
        if (this.matchQueue.length === 0) this._advanceFromGroups();
      } else if (this.bracket) {
        const round = this.bracket.rounds[this.bracket.current];
        for (const tie of round) {
          if (tie.played || !tie.home || !tie.away) continue;
          if (tie.home.id === this.userTeamId || tie.away.id === this.userTeamId) continue;
          let s = simulateScore(tie.home.rating, tie.away.rating);
          this._applyTie(tie, s[0], s[1], true);
        }
        if (this.matchQueue.length === 0) this._advanceBracket();
      }
    }

    _applyTable(g, f) {
      const [hs, as] = f.score;
      const ht = g.table[f.home.id], at = g.table[f.away.id];
      ht.P++; at.P++; ht.GF += hs; ht.GA += as; at.GF += as; at.GA += hs;
      if (hs > as) { ht.W++; ht.Pts += 3; at.L++; }
      else if (hs < as) { at.W++; at.Pts += 3; ht.L++; }
      else { ht.D++; at.D++; ht.Pts++; at.Pts++; }
    }

    standings(g) {
      return Object.values(g.table).sort((a, b) =>
        b.Pts - a.Pts || (b.GF - b.GA) - (a.GF - a.GA) || b.GF - a.GF ||
        b.team.rating - a.team.rating
      );
    }

    _advanceFromGroups() {
      // 각 조 1,2위 진출 → 16강 대진
      const winners = [], runners = [];
      for (const g of this.groups) {
        const s = this.standings(g);
        winners.push(s[0].team); runners.push(s[1].team);
      }
      // 표준 교차 대진: 1A-2B, 1C-2D ...
      const ties = [];
      const order = [
        [winners[0], runners[1]], [winners[2], runners[3]],
        [winners[4], runners[5]], [winners[6], runners[7]],
        [winners[1], runners[0]], [winners[3], runners[2]],
        [winners[5], runners[4]], [winners[7], runners[6]],
      ];
      for (const [h, a] of order) ties.push(this._mkTie(h, a));
      this.bracket = {
        rounds: [ties, this._empty(4), this._empty(2), this._empty(1)],
        labels: ["16강", "8강", "4강", "결승"],
        current: 0,
      };
      this.stage = "r16";
      this._refreshUserQueue();
    }

    _empty(n) { return Array.from({ length: n }, () => this._mkTie(null, null)); }
    _mkTie(h, a) { return { home: h, away: a, played: false, score: null, winner: null }; }

    _applyTie(tie, hs, as, sim) {
      // 무승부면 승부차기 시뮬
      let winner;
      if (hs === as) {
        const pen = simulateScore(tie.home.rating + 2, tie.away.rating) ;
        winner = Math.random() < 0.5 + (tie.home.rating - tie.away.rating) * 0.02 ? tie.home : tie.away;
        tie.pens = true;
      } else {
        winner = hs > as ? tie.home : tie.away;
      }
      tie.played = true; tie.score = [hs, as]; tie.winner = winner;
      if (!sim) {
        // 유저 경기 처리 후 큐에서 제거됨 (reportUserResult가 호출)
      }
    }

    _advanceBracket() {
      const b = this.bracket;
      const round = b.rounds[b.current];
      if (round.some((t) => !t.played)) return; // 아직 안 끝남
      if (b.current === b.rounds.length - 1) {
        this.champion = round[0].winner;
        this.stage = "done";
        return;
      }
      // 다음 라운드 채우기
      const next = b.rounds[b.current + 1];
      for (let i = 0; i < next.length; i++) {
        next[i].home = round[i * 2].winner;
        next[i].away = round[i * 2 + 1].winner;
      }
      b.current++;
      this.stage = ["r16", "qf", "sf", "final"][b.current];
      this._refreshUserQueue();
    }

    // 유저 경기 후 다음 단계로 넘길 수 있으면 처리
    tryAdvance() {
      if (this.stage === "group") {
        if (this.matchQueue.length === 0 && this._allGroupPlayed()) this._advanceFromGroups();
      } else if (this.bracket) {
        if (this.matchQueue.length === 0) this._advanceBracket();
      }
    }
    _allGroupPlayed() {
      return this.groups.every((g) => g.fixtures.every((f) => f.played));
    }

    stageLabel() {
      const map = { group: "조별리그", r16: "16강", qf: "8강", sf: "4강", final: "결승", done: "종료" };
      return map[this.stage] || this.stage;
    }
  }

  // 헬퍼: groups 순회 (가독성)
  function g_each(groups) { return groups; }

  global.Tournament = Tournament;
})(window);
