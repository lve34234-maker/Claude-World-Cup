/* ===========================================================
 *  teams.js — 32개 본선 진출국 데이터
 *  rating: 종합 전력 (공격/수비/속도에 영향)
 *  colors: [홈 유니폼, 보조 색]
 * =========================================================== */
(function (global) {
  "use strict";

  const TEAMS = [
    { id: "BRA", name: "브라질",   flag: "🇧🇷", rating: 92, colors: ["#FFDF00", "#1B7A3D"] },
    { id: "ARG", name: "아르헨티나", flag: "🇦🇷", rating: 92, colors: ["#75AADB", "#ffffff"] },
    { id: "FRA", name: "프랑스",   flag: "🇫🇷", rating: 91, colors: ["#1E3A8A", "#ffffff"] },
    { id: "ENG", name: "잉글랜드", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿", rating: 90, colors: ["#ffffff", "#CF0A2C"] },
    { id: "ESP", name: "스페인",   flag: "🇪🇸", rating: 89, colors: ["#C60B1E", "#FFC400"] },
    { id: "POR", name: "포르투갈", flag: "🇵🇹", rating: 89, colors: ["#C8102E", "#006847"] },
    { id: "NED", name: "네덜란드", flag: "🇳🇱", rating: 88, colors: ["#F36C21", "#ffffff"] },
    { id: "GER", name: "독일",     flag: "🇩🇪", rating: 88, colors: ["#ffffff", "#111111"] },
    { id: "BEL", name: "벨기에",   flag: "🇧🇪", rating: 86, colors: ["#C8102E", "#FDDA24"] },
    { id: "ITA", name: "이탈리아", flag: "🇮🇹", rating: 86, colors: ["#0066B2", "#ffffff"] },
    { id: "CRO", name: "크로아티아", flag: "🇭🇷", rating: 85, colors: ["#CE1126", "#ffffff"] },
    { id: "URU", name: "우루과이", flag: "🇺🇾", rating: 84, colors: ["#5CBFEB", "#111111"] },
    { id: "COL", name: "콜롬비아", flag: "🇨🇴", rating: 83, colors: ["#FCD116", "#003893"] },
    { id: "USA", name: "미국",     flag: "🇺🇸", rating: 82, colors: ["#ffffff", "#0A3161"] },
    { id: "MEX", name: "멕시코",   flag: "🇲🇽", rating: 82, colors: ["#006847", "#ffffff"] },
    { id: "SEN", name: "세네갈",   flag: "🇸🇳", rating: 82, colors: ["#00853F", "#FDEF42"] },
    { id: "JPN", name: "일본",     flag: "🇯🇵", rating: 81, colors: ["#1857A4", "#ffffff"] },
    { id: "KOR", name: "대한민국", flag: "🇰🇷", rating: 81, colors: ["#C8102E", "#0047A0"] },
    { id: "MAR", name: "모로코",   flag: "🇲🇦", rating: 81, colors: ["#C1272D", "#006233"] },
    { id: "SUI", name: "스위스",   flag: "🇨🇭", rating: 80, colors: ["#D52B1E", "#ffffff"] },
    { id: "DEN", name: "덴마크",   flag: "🇩🇰", rating: 80, colors: ["#C8102E", "#ffffff"] },
    { id: "SRB", name: "세르비아", flag: "🇷🇸", rating: 79, colors: ["#C6363C", "#ffffff"] },
    { id: "SEN2", name: "폴란드",  flag: "🇵🇱", rating: 79, colors: ["#ffffff", "#DC143C"] },
    { id: "ECU", name: "에콰도르", flag: "🇪🇨", rating: 78, colors: ["#FFD100", "#034EA2"] },
    { id: "WAL", name: "웨일스",   flag: "🏴󠁧󠁢󠁷󠁬󠁳󠁿", rating: 78, colors: ["#C8102E", "#00B140"] },
    { id: "CMR", name: "카메룬",   flag: "🇨🇲", rating: 78, colors: ["#007A33", "#CE1126"] },
    { id: "GHA", name: "가나",     flag: "🇬🇭", rating: 77, colors: ["#ffffff", "#006B3F"] },
    { id: "AUS", name: "호주",     flag: "🇦🇺", rating: 77, colors: ["#FFCD00", "#00843D"] },
    { id: "TUN", name: "튀니지",   flag: "🇹🇳", rating: 76, colors: ["#E70013", "#ffffff"] },
    { id: "CRC", name: "코스타리카", flag: "🇨🇷", rating: 75, colors: ["#CE1126", "#002B7F"] },
    { id: "KSA", name: "사우디",   flag: "🇸🇦", rating: 75, colors: ["#006C35", "#ffffff"] },
    { id: "QAT", name: "카타르",   flag: "🇶🇦", rating: 74, colors: ["#8A1538", "#ffffff"] },
  ];

  global.TEAMS = TEAMS;
  global.teamById = (id) => TEAMS.find((t) => t.id === id);
})(window);
