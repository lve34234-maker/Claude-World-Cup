(function (global) {
  "use strict";

  const GENERIC = [
    "Smith", "Garcia", "Muller", "Rossi", "Silva", "Kovac", "Novak", "Hansen",
    "Andersson", "Petrov", "Costa", "Lopez", "Schmidt", "Olsen", "Marin", "Vidic",
    "Ferreira", "Moreno", "Walker", "Berg"
  ];

  const POOLS = {
    // BRA = Brazil
    BRA: [
      "Silva", "Santos", "Neymar", "Vinicius", "Rodrigo", "Casemiro", "Alves",
      "Marquinhos", "Jesus", "Paqueta", "Fabinho", "Militao", "Danilo", "Raphinha",
      "Richarlison", "Bruno", "Coutinho", "Firmino"
    ],
    // ARG = Argentina
    ARG: [
      "Messi", "Di Maria", "Martinez", "Alvarez", "De Paul", "Otamendi", "Romero",
      "Acuna", "Molina", "Paredes", "Mac Allister", "Fernandez", "Tagliafico",
      "Lautaro", "Dybala", "Lo Celso", "Montiel", "Correa"
    ],
    // FRA = France
    FRA: [
      "Mbappe", "Griezmann", "Giroud", "Dembele", "Kante", "Pogba", "Varane",
      "Kounde", "Hernandez", "Tchouameni", "Camavinga", "Coman", "Rabiot",
      "Upamecano", "Pavard", "Maignan", "Thuram", "Konate"
    ],
    // ENG = England
    ENG: [
      "Kane", "Bellingham", "Foden", "Saka", "Sterling", "Rashford", "Stones",
      "Walker", "Rice", "Maguire", "Henderson", "Trippier", "Grealish", "Mount",
      "Shaw", "Pickford", "Sancho", "Phillips"
    ],
    // ESP = Spain
    ESP: [
      "Morata", "Gavi", "Pedri", "Asensio", "Olmo", "Torres", "Rodri", "Busquets",
      "Laporte", "Carvajal", "Azpilicueta", "Llorente", "Sarabia", "Soler",
      "Williams", "Simon", "Balde", "Merino"
    ],
    // POR = Portugal
    POR: [
      "Ronaldo", "Fernandes", "Silva", "Felix", "Leao", "Cancelo", "Dias",
      "Neves", "Carvalho", "Guerreiro", "Pepe", "Otavio", "Ramos", "Dalot",
      "Pereira", "Costa", "Vitinha", "Horta"
    ],
    // NED = Netherlands
    NED: [
      "Van Dijk", "De Jong", "Depay", "Gakpo", "Bergwijn", "Klaassen", "Blind",
      "Dumfries", "Timber", "Ake", "De Vrij", "Koopmeiners", "Berghuis",
      "Janssen", "Malacia", "Noppert", "Weghorst", "Wijnaldum"
    ],
    // GER = Germany
    GER: [
      "Muller", "Gnabry", "Kimmich", "Goretzka", "Havertz", "Sane", "Musiala",
      "Rudiger", "Sule", "Gundogan", "Neuer", "Kehrer", "Werner", "Gosens",
      "Raum", "Schlotterbeck", "Adeyemi", "Hofmann"
    ],
    // BEL = Belgium
    BEL: [
      "De Bruyne", "Lukaku", "Hazard", "Mertens", "Witsel", "Alderweireld",
      "Vertonghen", "Tielemans", "Carrasco", "Meunier", "Castagne", "Doku",
      "Trossard", "Batshuayi", "Onana", "Courtois", "Vermeeren", "Openda"
    ],
    // ITA = Italy
    ITA: [
      "Chiesa", "Barella", "Verratti", "Jorginho", "Immobile", "Insigne",
      "Bonucci", "Chiellini", "Di Lorenzo", "Bastoni", "Locatelli", "Tonali",
      "Pellegrini", "Zaniolo", "Scamacca", "Donnarumma", "Politano", "Acerbi"
    ],
    // CRO = Croatia
    CRO: [
      "Modric", "Kovacic", "Brozovic", "Perisic", "Kramaric", "Vlasic", "Lovren",
      "Gvardiol", "Sosa", "Juranovic", "Pasalic", "Petkovic", "Majer", "Livakovic",
      "Vida", "Orsic", "Sucic", "Budimir"
    ],
    // URU = Uruguay
    URU: [
      "Suarez", "Cavani", "Valverde", "Bentancur", "Nunez", "Gimenez", "Godin",
      "Vecino", "Torreira", "De Arrascaeta", "Pellistri", "Araujo", "Olivera",
      "Caceres", "Rochet", "Ugarte", "Pereiro", "Gomez"
    ],
    // COL = Colombia
    COL: [
      "James", "Rodriguez", "Cuadrado", "Falcao", "Borja", "Mina", "Sanchez",
      "Lerma", "Uribe", "Diaz", "Muriel", "Zapata", "Arias", "Cuesta",
      "Ospina", "Borre", "Mojica", "Lucumi"
    ],
    // USA = USA
    USA: [
      "Pulisic", "McKennie", "Adams", "Reyna", "Dest", "Robinson", "Weah",
      "Musah", "Aaronson", "Ferreira", "Sargent", "Morris", "Long", "Zimmerman",
      "Turner", "Ream", "Scally", "Acosta"
    ],
    // MEX = Mexico
    MEX: [
      "Lozano", "Jimenez", "Vela", "Guardado", "Herrera", "Alvarez", "Moreno",
      "Gallardo", "Antuna", "Pineda", "Chavez", "Sanchez", "Vasquez", "Araujo",
      "Ochoa", "Funes Mori", "Corona", "Gutierrez"
    ],
    // SEN = Senegal
    SEN: [
      "Mane", "Koulibaly", "Mendy", "Sarr", "Gueye", "Diatta", "Dia", "Ciss",
      "Jakobs", "Diallo", "Sabaly", "Name", "Cisse", "Ndiaye", "Mendy",
      "Ballo-Toure", "Gomis", "Sane"
    ],
    // JPN = Japan
    JPN: [
      "Ito", "Kubo", "Endo", "Mitoma", "Tanaka", "Kamada", "Minamino", "Maeda",
      "Asano", "Doan", "Morita", "Yoshida", "Tomiyasu", "Nagatomo", "Gonda",
      "Kakitani", "Hasebe", "Sakai"
    ],
    // KOR = South Korea
    KOR: [
      "Son", "Kim", "Lee", "Park", "Hwang", "Cho", "Jung", "Hong", "Kwon",
      "Kang", "Na", "Jeong", "Hwang", "Lee", "Kim", "Paik", "Cho", "Seol"
    ],
    // MAR = Morocco
    MAR: [
      "Hakimi", "Ziyech", "En-Nesyri", "Amrabat", "Boufal", "Mazraoui",
      "Saiss", "Aguerd", "Ounahi", "Cheddira", "Sabiri", "El Yamiq", "Attiat-Allah",
      "Bounou", "Amallah", "Harit", "Dari", "Ezzalzouli"
    ],
    // SUI = Switzerland
    SUI: [
      "Xhaka", "Shaqiri", "Embolo", "Sow", "Freuler", "Akanji", "Rodriguez",
      "Elvedi", "Widmer", "Zakaria", "Vargas", "Seferovic", "Okafor", "Fernandes",
      "Sommer", "Schar", "Steffen", "Aebischer"
    ],
    // DEN = Denmark
    DEN: [
      "Eriksen", "Hojbjerg", "Damsgaard", "Dolberg", "Braithwaite", "Christensen",
      "Kjaer", "Maehle", "Wass", "Delaney", "Skov Olsen", "Cornelius", "Norgaard",
      "Schmeichel", "Vestergaard", "Lindstrom", "Jensen", "Andersen"
    ],
    // SRB = Serbia
    SRB: [
      "Vlahovic", "Mitrovic", "Tadic", "Milinkovic-Savic", "Kostic", "Jovic",
      "Gudelj", "Maksimovic", "Pavlovic", "Lukic", "Zivkovic", "Radonjic",
      "Vlasic", "Mladenovic", "Rajkovic", "Veljkovic", "Babic", "Grujic"
    ],
    // SEN2 = Poland (id is SEN2 but nation is POLAND)
    SEN2: [
      "Lewandowski", "Zielinski", "Milik", "Krychowiak", "Glik", "Szymanski",
      "Bednarek", "Cash", "Frankowski", "Grosicki", "Kaminski", "Bereszynski",
      "Szczesny", "Kiwior", "Piatek", "Zalewski", "Skoras", "Walukiewicz"
    ],
    // ECU = Ecuador
    ECU: [
      "Valencia", "Caicedo", "Estupinan", "Plata", "Hincapie", "Mendez",
      "Preciado", "Torres", "Sarmiento", "Franco", "Porozo", "Arboleda",
      "Galindez", "Cifuentes", "Reasco", "Ibarra", "Palacios", "Yeboah"
    ],
    // WAL = Wales
    WAL: [
      "Bale", "Ramsey", "Williams", "Allen", "James", "Roberts", "Davies",
      "Wilson", "Moore", "Johnson", "Mepham", "Rodon", "Ampadu", "Morrell",
      "Hennessey", "Ward", "Brooks", "Levitt"
    ],
    // CMR = Cameroon
    CMR: [
      "Aboubakar", "Choupo-Moting", "Onana", "Anguissa", "Toko Ekambi", "Hongla",
      "Ngamaleu", "Nkoulou", "Castelletto", "Mbeumo", "Fai", "Tolo", "Gouet",
      "Epassy", "Wooh", "Bassogog", "Nouhou", "Kunde"
    ],
    // GHA = Ghana
    GHA: [
      "Ayew", "Partey", "Kudus", "Williams", "Salisu", "Amartey", "Lamptey",
      "Sulemana", "Bukari", "Owusu", "Mensah", "Baba", "Djiku", "Odoi",
      "Ati-Zigi", "Semenyo", "Aidoo", "Afena-Gyan"
    ],
    // AUS = Australia
    AUS: [
      "Mooy", "Leckie", "Duke", "Irvine", "Hrustic", "Rogic", "Behich",
      "Souttar", "Degenek", "McGree", "Goodwin", "Maclaren", "Wright", "Karacic",
      "Ryan", "Atkinson", "Boyle", "Mabil"
    ],
    // TUN = Tunisia
    TUN: [
      "Khazri", "Msakni", "Jaziri", "Skhiri", "Laidouni", "Talbi", "Bronn",
      "Drager", "Maaloul", "Sassi", "Slimane", "Ben Romdhane", "Abdi", "Meriah",
      "Dahmen", "Ben Slimane", "Mejbri", "Jebali"
    ],
    // CRC = Costa Rica
    CRC: [
      "Campbell", "Borges", "Tejeda", "Fuller", "Contreras", "Duarte", "Vargas",
      "Oviedo", "Calvo", "Waston", "Bennette", "Aguilera", "Martinez", "Ruiz",
      "Navas", "Sequeira", "Galo", "Zamora"
    ],
    // KSA = Saudi Arabia
    KSA: [
      "Al-Dawsari", "Al-Shehri", "Al-Buraikan", "Kanno", "Al-Faraj", "Al-Owais",
      "Al-Bulaihi", "Al-Shahrani", "Al-Najei", "Al-Malki", "Al-Hassan", "Al-Ghannam",
      "Al-Amri", "Al-Tambakti", "Al-Yami", "Otayf", "Al-Khaibri", "Bahebri"
    ],
    // QAT = Qatar
    QAT: [
      "Afif", "Ali", "Al-Haydos", "Hatem", "Khoukhi", "Madibo", "Pedro",
      "Boudiaf", "Hassan", "Muntari", "Waad", "Salman", "Al-Rawi", "Ahmed",
      "Barsham", "Miguel", "Tarek", "Assadalla"
    ]
  };

  const NamePool = {
    get: function (id) {
      return POOLS[id] || GENERIC;
    }
  };

  global.NamePool = NamePool;
})(typeof window !== "undefined" ? window : this);
