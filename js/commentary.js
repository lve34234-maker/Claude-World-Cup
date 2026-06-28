(function (global) {
  "use strict";

  // Pick a random element of an array.
  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Templates per event. Each template is a function of ctx so we can
  // interpolate fields with safe fallbacks.
  var TEMPLATES = {
    kickoff: [
      function (c) { return "삑—! 경기 시작입니다! " + matchLabel(c) + " 운명의 휘슬이 울립니다!"; },
      function (c) { return "자, 드디어 킥오프! " + (c.home || "홈팀") + " 대 " + (c.away || "원정팀") + ", 시작됩니다!"; },
      function ()  { return "공이 굴러갑니다, 경기 시작! 양 팀 모두 전의를 불태웁니다!"; },
      function ()  { return "킥오프! 첫 번째 볼 터치, 긴장감이 감돕니다!"; },
      function (c) { return "운명의 90분이 시작됩니다! " + matchLabel(c); },
      function ()  { return "심판의 휘슬과 함께 경기가 막을 올립니다!"; }
    ],

    goal: [
      function (c) { return "⚽ 골!! " + subj(c, c.scorer) + " 환상적인 마무리입니다!"; },
      function (c) { return "고오오올! " + subj(c, c.scorer) + " 그물을 흔듭니다! " + scoreLabel(c); },
      function (c) { return "들어갔습니다! " + subj(c, c.scorer) + "의 통렬한 슛! 골망이 출렁입니다!"; },
      function (c) { return "골! 골! 골! " + subj(c, c.scorer) + " 결정적인 한 방! " + scoreLabel(c); },
      function (c) { return "믿을 수 없는 골! " + subj(c, c.scorer) + " 관중석이 폭발합니다!"; },
      function (c) { return "네트를 가릅니다! " + subj(c, c.scorer) + "의 멋진 골! " + scoreLabel(c); }
    ],

    shot: [
      function (c) { return "슛~! " + subj(c, c.player) + " 강력한 슈팅입니다!"; },
      function (c) { return "때립니다! " + subj(c, c.player) + "의 과감한 슛!"; },
      function (c) { return "기회를 놓치지 않습니다, " + subj(c, c.player) + " 슈팅!"; },
      function (c) { return "올라옵니다, " + subj(c, c.player) + " 그대로 슛을 시도합니다!"; },
      function ()  { return "슛! 강하게 때렸습니다, 골문을 위협합니다!"; },
      function (c) { return "한 박자 빠른 슈팅! " + subj(c, c.player) + " 노립니다!"; }
    ],

    save: [
      function (c) { return "막아냅니다! " + subj(c, c.player) + " 환상적인 선방!"; },
      function (c) { return "세이브! " + subj(c, c.player) + " 위기를 넘깁니다!"; },
      function (c) { return "쳐냅니다! " + subj(c, c.player) + "의 슈퍼 세이브!"; },
      function ()  { return "골키퍼 정면! 안정적으로 잡아냅니다!"; },
      function (c) { return "선방입니다! " + subj(c, c.player) + " 손끝에 걸렸습니다!"; },
      function ()  { return "막혔습니다! 골키퍼의 눈부신 방어!"; }
    ],

    miss: [
      function (c) { return "아쉽게 빗나갑니다! " + subj(c, c.player) + " 머리를 감쌉니다!"; },
      function (c) { return "골문을 벗어납니다! " + subj(c, c.player) + " 절호의 기회를 놓칩니다!"; },
      function ()  { return "크로스바 위로! 아슬아슬하게 빗나갑니다!"; },
      function (c) { return "옆 그물! " + subj(c, c.player) + " 정확성이 아쉽습니다!"; },
      function ()  { return "허공을 가릅니다! 아까운 슈팅이었습니다!"; },
      function (c) { return "빗맞았습니다! " + subj(c, c.player) + " 아쉬운 마무리!"; }
    ],

    post: [
      function (c) { return "골대! 맞고 나옵니다! " + subj(c, c.player) + " 천운이 따르지 않습니다!"; },
      function ()  { return "포스트를 강타합니다! 아, 정말 아까운 장면!"; },
      function ()  { return "크로스바를 때립니다! 골대가 도와줍니다!"; },
      function (c) { return "기둥을 맞히고 나옵니다! " + subj(c, c.player) + " 탄식합니다!"; },
      function ()  { return "골대 불운! 몇 센티미터 차이로 골이 아닙니다!"; },
      function (c) { return "땅! 골대를 강타! " + subj(c, c.player) + " 운이 없습니다!"; }
    ],

    foul: [
      function (c) { return "거친 태클, 파울입니다! " + subj(c, c.player) + " 주의해야 합니다!"; },
      function ()  { return "삑—! 파울 선언! 심판이 휘슬을 붑니다!"; },
      function (c) { return "반칙입니다! " + subj(c, c.player) + " 너무 늦었습니다!"; },
      function ()  { return "파울! 위험한 지역에서 프리킥을 내줍니다!"; },
      function (c) { return "넘어집니다! " + subj(c, c.player) + "의 파울이 선언됩니다!"; },
      function ()  { return "거친 몸싸움 끝에 파울! 경기가 잠시 멈춥니다!"; }
    ],

    yellow: [
      function (c) { return "옐로카드! " + subj(c, c.player) + " 경고를 받습니다!"; },
      function (c) { return "심판이 카드를 꺼냅니다, 경고! " + subj(c, c.player) + " 조심해야 합니다!"; },
      function (c) { return "경고 누적이 우려됩니다, " + subj(c, c.player) + "에게 옐로카드!"; },
      function ()  { return "노란 카드가 나옵니다! 거친 플레이의 대가입니다!"; },
      function (c) { return "경고! " + subj(c, c.player) + " 이제 몸을 사려야 합니다!"; }
    ],

    red: [
      function (c) { return "레드카드!! " + subj(c, c.player) + " 퇴장입니다!"; },
      function (c) { return "다이렉트 퇴장! " + subj(c, c.player) + " 그라운드를 떠납니다!"; },
      function (c) { return "심판이 레드카드를 꺼냅니다! " + subj(c, c.player) + " 큰 위기입니다!"; },
      function (c) { return "경고 누적, 두 번째 옐로! " + subj(c, c.player) + " 퇴장당합니다!"; },
      function ()  { return "빨간 카드! 한 명이 줄어듭니다, 엄청난 변수입니다!"; }
    ],

    corner: [
      function (c) { return "코너킥입니다! " + (c.team ? c.team + " " : "") + "절호의 기회!"; },
      function ()  { return "코너! 키커가 공을 세팅합니다, 모두 박스로 몰립니다!"; },
      function (c) { return "코너킥을 얻어냅니다! " + (c.team || "공격팀") + " 세트피스 기회!"; },
      function ()  { return "구석으로 흐릅니다, 코너킥! 위협적인 장면이 예상됩니다!"; },
      function ()  { return "코너킥! 장신 수비수들이 페널티 박스로 올라옵니다!"; }
    ],

    throwin: [
      function (c) { return "스로인입니다, " + (c.team || "한 팀") + " 공격을 이어갑니다!"; },
      function ()  { return "라인 밖으로! 스로인으로 경기 재개됩니다!"; },
      function (c) { return "측면에서 스로인! " + (c.team || "공격팀") + " 빠르게 전개합니다!"; },
      function ()  { return "공이 터치라인을 넘습니다, 스로인!"; }
    ],

    goalkick: [
      function (c) { return "골킥입니다! " + (c.team || "수비팀") + " 후방에서 다시 시작합니다!"; },
      function ()  { return "골킥! 골키퍼가 길게 차올립니다!"; },
      function ()  { return "공이 골라인을 넘습니다, 골킥으로 재개!"; },
      function (c) { return "골킥, " + (c.team || "수비팀") + " 차분하게 빌드업을 준비합니다!"; }
    ],

    offside: [
      function (c) { return "오프사이드! " + subj(c, c.player) + " 깃발이 올라갑니다!"; },
      function ()  { return "오프사이드 선언! 아슬아슬한 타이밍이었습니다!"; },
      function (c) { return "부심의 깃발! " + subj(c, c.player) + " 한 발 빨랐습니다!"; },
      function ()  { return "오프사이드 함정에 걸립니다! 공격이 무산됩니다!"; },
      function (c) { return "아, 오프사이드! " + subj(c, c.player) + " 아까운 침투였습니다!"; }
    ],

    halftime: [
      function (c) { return "전반 종료! " + scoreLabel(c) + " 숨 가빴던 45분이었습니다!"; },
      function (c) { return "삑—! 하프타임입니다. 현재 스코어 " + scoreOnly(c) + "!"; },
      function ()  { return "전반전이 끝납니다! 양 팀 라커룸으로 향합니다!"; },
      function (c) { return "하프타임 휘슬! " + scoreLabel(c) + " 후반전이 기대됩니다!"; }
    ],

    fulltime: [
      function (c) { return "경기 종료!! 최종 스코어 " + scoreOnly(c) + "!"; },
      function (c) { return "삑삑삑—! 풀타임입니다! " + scoreLabel(c); },
      function ()  { return "경기가 끝났습니다! 모든 것이 결정됐습니다!"; },
      function (c) { return "종료 휘슬! 길었던 승부가 막을 내립니다! " + scoreOnly(c) + "!"; }
    ],

    penalty: [
      function (c) { return "페널티킥! " + (c.team || "공격팀") + "에게 절호의 기회가 주어집니다!"; },
      function (c) { return "심판이 스폿을 가리킵니다! 페널티킥! " + subj(c, c.player) + " 키커로 나섭니다!"; },
      function ()  { return "페널티 박스 안에서 반칙! PK가 선언됩니다!"; },
      function ()  { return "PK입니다! 11미터, 골키퍼와의 외로운 싸움!"; },
      function (c) { return "페널티킥 찬스! " + (c.team || "공격팀") + " 숨죽인 순간입니다!"; }
    ],

    penalty_goal: [
      function (c) { return "⚽ 페널티킥 성공! " + subj(c, c.scorer) + " 침착하게 마무리합니다! " + scoreLabel(c); },
      function (c) { return "골! PK 득점입니다! " + subj(c, c.scorer) + " 골키퍼를 속였습니다!"; },
      function (c) { return "넣었습니다! " + subj(c, c.scorer) + "의 완벽한 페널티킥! " + scoreLabel(c); },
      function ()  { return "골망을 흔드는 페널티킥! 압박을 이겨냅니다!"; },
      function (c) { return "성공! " + subj(c, c.scorer) + " 강심장의 PK 골! " + scoreLabel(c); }
    ],

    penalty_miss: [
      function (c) { return "막혔습니다! 페널티킥 실패! " + subj(c, c.player) + " 고개를 떨굽니다!"; },
      function (c) { return "아! 빗나갑니다! " + subj(c, c.player) + "의 PK가 골문을 외면합니다!"; },
      function ()  { return "골키퍼 선방! 페널티킥을 막아냅니다! 엄청난 순간!"; },
      function ()  { return "크로스바! PK가 골대를 강타합니다! 통한의 실축!"; },
      function (c) { return "실축입니다! " + subj(c, c.player) + " 천금 같은 기회를 날립니다!"; }
    ],

    tackle: [
      function (c) { return "완벽한 태클! " + subj(c, c.player) + " 공을 끊어냅니다!"; },
      function ()  { return "깔끔한 태클! 위기를 사전에 차단합니다!"; },
      function (c) { return "슬라이딩 태클! " + subj(c, c.player) + " 멋지게 공을 걷어냅니다!"; },
      function ()  { return "끊어냅니다! 절묘한 수비 타이밍!"; },
      function (c) { return "몸을 던집니다, " + subj(c, c.player) + "의 결정적 태클!"; }
    ],

    chance: [
      function (c) { return "찬스! " + subj(c, c.player) + " 골문 앞 절호의 기회입니다!"; },
      function ()  { return "위협적인 장면! 골 냄새가 진하게 풍깁니다!"; },
      function (c) { return "결정적 기회! " + subj(c, c.player) + " 노립니다!"; },
      function ()  { return "수비 라인이 무너집니다! 큰 기회가 옵니다!"; },
      function (c) { return "공간이 열립니다! " + subj(c, c.player) + " 침투합니다, 위험합니다!"; },
      function ()  { return "빅 찬스! 관중이 자리에서 일어섭니다!"; }
    ]
  };

  // Subject helper: prefer the given name, then team, then a generic subject.
  function subj(c, name) {
    return name || (c && c.team) || "선수";
  }

  // "홈팀 vs 어웨이팀" label.
  function matchLabel(c) {
    if (c && c.home && c.away) return c.home + " vs " + c.away;
    return "";
  }

  // "홈팀 2 - 1 어웨이팀" if names + scores present, else "".
  function scoreLabel(c) {
    if (!c) return "";
    var hasScore = typeof c.hs === "number" && typeof c.as === "number";
    if (hasScore && c.home && c.away) {
      return c.home + " " + c.hs + " - " + c.as + " " + c.away + "!";
    }
    if (hasScore) {
      return "스코어 " + c.hs + " - " + c.as + "!";
    }
    return "";
  }

  // "2 - 1" style, with names when available.
  function scoreOnly(c) {
    if (!c) return "0 - 0";
    var hs = typeof c.hs === "number" ? c.hs : 0;
    var as = typeof c.as === "number" ? c.as : 0;
    if (c.home && c.away) return c.home + " " + hs + " - " + as + " " + c.away;
    return hs + " - " + as;
  }

  var Commentary = {
    line: function (event, ctx) {
      var c = ctx || {};
      var bucket = TEMPLATES[event];
      if (!bucket) {
        // Unknown event: degrade gracefully.
        return "경기가 계속됩니다!";
      }
      var tpl = pick(bucket);
      try {
        return tpl(c);
      } catch (e) {
        return "경기가 계속됩니다!";
      }
    },
    // Exposed helper per spec.
    pick: pick
  };

  global.Commentary = Commentary;
})(typeof window !== "undefined" ? window : this);
