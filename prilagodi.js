// Prilagoditev receptov alergijam in prehrani: namesto da recept skrijemo, zamenjamo sestavino
// (npr. maslo → maslo brez laktoze, moka → moka brez glutena, mleto meso → rastlinsko mleto meso).
// Skrijemo samo jedi, ki jih ni mogoče prilagoditi (zrezek pri vegetarijancih, ribe pri alergiji na ribe, omleta brez jajc …).
// Oznake: alergeni kot v Moji kuhinji + "meso" (ni za vegetarijance) + "zival" (ni za vegane: mleko, jajca, med, želatina).
// Isto datoteko uporabljata aplikacija (iOS, Android) in nakupko.com.
(function () {
  "use strict";
  // sestavina → oznake
  var P = {};
  function tag(list, t) { list.split("|").forEach(function (n) { P[n] = (P[n] ? P[n] + " " : "") + t; }); }
  tag("Moka bela|Moka za pico (tip 00)|Moka polnozrnata|Pirina moka|Krušne drobtine|Kruh beli|Kruh polnozrnati|Kruh črni|Kruh s semeni|Ciabatta|Bageta|Toast kruh|" +
    "Hamburger žemlje|Žemlje|Lepinje|Hot dog štručke|Pita kruh|Tortilje|Testenine špageti|Testenine peresniki|Testenine fusilli|Testenine tagliatelle|Testenine metuljčki|" +
    "Testenine polžki|Testenine polnozrnate|Makaroni|Polži (testenine za juho)|Jušne zvezdice|Jajčne testenine (rezanci)|Lističi za lazanjo|Njoki|Njoki (sveži)|Testo za pico|" +
    "Piškoti|Petit beurre|Piškoti za tiramisu|Krekerji|Kus kus|Bulgur|Ješprenj|Pšenični zdrob|Ovseni kosmiči|Granola|Kitajski rezanci|Instant rezanci|Sojina omaka|" +
    "Teriyaki omaka|Pivo|Pivo (paket)|Koruzni kosmiči|Mešanica za palačinke|Listnato testo|Vlečeno testo|Seitan|Tortelini (sveži)|Ravioli|Zamrznjeni štruklji|Mlinci|" +
    "Rogljiček|Ribje palčke|Piščančji nuggetsi|Palčke slane|Ovseni napitek|Falafel", "gluten");
  tag("Mleko|Maslo|Smetana za kuhanje|Sladka smetana|Kisla smetana|Jogurt navadni|Grški jogurt|Kefir|Kislo mleko|Skuta|Ricotta|Mascarpone|Kremni sir|Sirni namaz|" +
    "Parmezan|Sir Pecorino|Nariban sir|Sir Gauda|Sir Edamec|Sir Ementalec|Sir Cheddar|Sir Tolminc|Sir za pico|Sir v lističih|Mozzarella|Feta|Sir Gorgonzola|Sir Halloumi|" +
    "Kozji sir|Sir za žar|Sladoled|Čokolada za kuhanje|Čokoladne kapljice|Lešnikov namaz|Pesto|Pesto rosso|Tortelini (sveži)|Ravioli|Zamrznjeni štruklji|Petit beurre|" +
    "Pire krompir v prahu|Rogljiček|Mlinci", "mleko zival");
  tag("Jajca|Jajčne testenine (rezanci)|Majoneza|Tatarska omaka|Piškoti za tiramisu|Tortelini (sveži)|Ravioli|Zamrznjeni štruklji|Mlinci", "jajca zival");
  tag("Med|Želatina", "zival");
  tag("Orehi|Mandlji|Mandlji mleti|Lešniki|Lešniki mleti|Indijski oreščki|Lešnikov namaz|Pesto", "orescki");
  tag("Arašidi|Arašidovo maslo", "arasidi");
  tag("Sojina omaka|Teriyaki omaka|Tofu|Tempeh", "soja");
  tag("Sezam|Sezamovo olje|Tahini (sezamova pasta)|Hummus", "sezam");
  tag("Zelena (gomolj)", "zelena");
  tag("Gorčica|Majoneza|Tatarska omaka", "gorcica");
  tag("Losos file|Dimljeni losos|Tuna v pločevinki|Tuna v olju|Tuna file (svež)|Oslič file|Postrv|Zamrznjeni file postrvi|Brancin|Orada|Sardele (sveže)|Sardine|" +
    "Skuše v pločevinki|Bakalar (polenovka)|Inćuni|Ribje palčke|Worcester omaka", "ribe meso");
  tag("Kozice|Zamrznjene kozice|Lignji|Školjke (dagnje)|Mešani morski sadeži|Hobotnica", "raki meso");
  tag("Šunka|Prekajena šunka|Pršut|Slanina|Salama|Čorizo|Puranje prsi narezek|Ocvirki|Mast|Hrenovke|Kranjska klobasa|Klobase za žar|Pečenice|Debrecinke|Krvavice|" +
    "Mleto meso|Mleto goveje meso|Mleto svinjsko meso|Čevapčiči|Pleskavice za žar|Piščančji file|Puranji file|Piščančja bedra|Piščančja krača|Piščančje perutničke|" +
    "Piščančji bobrčki|Cel piščanec|Piščančja jetrca|Piščančji nuggetsi|Puranji zrezki|Svinjski zrezki|Svinjska vratovina|Svinjska plečka|Svinjska pečenka|Svinjska rebrca|" +
    "Svinjska ribica|Svinjski kotleti|Goveji zrezki|Goveji zrezek|Goveji file|Goveji rostbif|Goveji golaž|Goveje meso za juho|Teletina|Telečji zrezki|Jagnjetina|Raca|" +
    "Govedska juha v kocki|Pašteta", "meso");

  // nadomestki: [ime, oznake nadomestka, enota (neobvezno), opomba (neobvezno)] — prvi, ki ustreza, zmaga; "" = izpusti
  var GF = function (n) { return [[n, ""]]; };
  var S = {
    "Moka bela": GF("Moka brez glutena"), "Moka za pico (tip 00)": GF("Moka brez glutena"), "Moka polnozrnata": GF("Moka brez glutena"), "Pirina moka": GF("Moka brez glutena"),
    "Krušne drobtine": GF("Drobtine brez glutena"),
    "Kruh beli": GF("Kruh brez glutena"), "Kruh polnozrnati": GF("Kruh brez glutena"), "Kruh črni": GF("Kruh brez glutena"), "Kruh s semeni": GF("Kruh s semeni brez glutena"),
    "Ciabatta": GF("Kruh brez glutena"), "Bageta": GF("Bageta brez glutena"), "Toast kruh": GF("Toast kruh brez glutena"),
    "Hamburger žemlje": GF("Žemlje brez glutena"), "Žemlje": GF("Žemlje brez glutena"), "Lepinje": GF("Žemlje brez glutena"), "Hot dog štručke": GF("Žemlje brez glutena"),
    "Pita kruh": GF("Tortilje brez glutena"), "Tortilje": GF("Tortilje brez glutena"),
    "Testenine špageti": GF("Testenine brez glutena"), "Testenine tagliatelle": GF("Testenine brez glutena"), "Testenine metuljčki": GF("Testenine brez glutena"),
    "Testenine polžki": GF("Testenine brez glutena"), "Testenine polnozrnate": GF("Testenine brez glutena"), "Makaroni": GF("Testenine brez glutena"),
    "Polži (testenine za juho)": GF("Testenine brez glutena"), "Jušne zvezdice": GF("Testenine brez glutena"),
    "Testenine peresniki": GF("Testenine brez glutena peresniki"), "Testenine fusilli": GF("Testenine brez glutena fusilli"),
    "Jajčne testenine (rezanci)": [["Testenine tagliatelle", "gluten"], ["Testenine brez glutena", ""]],
    "Lističi za lazanjo": GF("Lazanja plošče brez glutena"), "Njoki": GF("Njoki brez glutena"), "Njoki (sveži)": GF("Njoki brez glutena"),
    "Testo za pico": GF("Pica testo brez glutena"), "Piškoti": GF("Piškoti brez glutena"), "Petit beurre": GF("Piškoti brez glutena"),
    "Krekerji": GF("Krekerji brez glutena"), "Palčke slane": GF("Grisini brez glutena"), "Kus kus": GF("Kvinoja"), "Bulgur": GF("Kvinoja"), "Ješprenj": GF("Kvinoja"),
    "Pšenični zdrob": GF("Koruzni zdrob (polenta)"), "Ovseni kosmiči": GF("Ovseni kosmiči brez glutena"), "Granola": GF("Musli brez glutena"),
    "Kitajski rezanci": GF("Riževi rezanci"), "Instant rezanci": GF("Riževi rezanci"),
    "Sojina omaka": [["Tamari omaka", "soja"], ["Kokosova aminos omaka", ""]], "Teriyaki omaka": [["Tamari omaka", "soja"], ["Kokosova aminos omaka", ""]],
    "Pivo": GF("Pivo brez glutena"), "Pivo (paket)": GF("Pivo brez glutena"), "Koruzni kosmiči": GF("Koruzni kosmiči brez glutena"),
    "Mešanica za palačinke": GF("Mešanica za palačinke brez glutena"), "Listnato testo": GF("Listnato testo brez glutena"), "Rogljiček": [["Rogljički brez glutena", "mleko zival"]],
    "Ovseni napitek": GF("Rižev napitek"),
    // mleko: najprej brez laktoze, za vegane rastlinsko
    "Mleko": [["Mleko brez laktoze", "zival"], ["Ovseni napitek", "gluten"], ["Rižev napitek", ""]],
    "Kislo mleko": [["Jogurt brez laktoze", "zival"], ["Rastlinski jogurt", ""]],
    "Maslo": [["Maslo brez laktoze", "zival"], ["Rastlinsko maslo", ""]],
    "Smetana za kuhanje": [["Smetana za kuhanje brez laktoze", "zival"], ["Rastlinska smetana za kuhanje", ""]],
    "Sladka smetana": [["Sladka smetana brez laktoze", "zival"], ["Rastlinska sladka smetana", ""]],
    "Kisla smetana": [["Kisla smetana brez laktoze", "zival"], ["Rastlinski jogurt", ""]],
    "Jogurt navadni": [["Jogurt brez laktoze", "zival"], ["Rastlinski jogurt", ""]], "Grški jogurt": [["Jogurt brez laktoze", "zival"], ["Rastlinski jogurt", ""]],
    "Kefir": [["Jogurt brez laktoze", "zival"], ["Rastlinski jogurt", ""]],
    "Skuta": [["Skuta brez laktoze", "zival"], ["Tofu", "soja"]], "Ricotta": [["Skuta brez laktoze", "zival"], ["Tofu", "soja"]],
    "Mascarpone": [["Kremni sir brez laktoze", "zival"], ["Veganski kremni sir", ""]], "Kremni sir": [["Kremni sir brez laktoze", "zival"], ["Veganski kremni sir", ""]],
    "Sirni namaz": [["Kremni sir brez laktoze", "zival"], ["Veganski kremni sir", ""]],
    "Mozzarella": [["Mozzarella brez laktoze", "zival"], ["Veganski sir", ""]],
  };
  // trdi in nariban sir: sir brez laktoze ali veganski sir
  "Parmezan|Sir Pecorino|Nariban sir|Sir Gauda|Sir Edamec|Sir Ementalec|Sir Cheddar|Sir Tolminc|Sir za pico|Sir v lističih|Feta".split("|").forEach(function (n) { S[n] = [["Sir brez laktoze", "zival"], ["Veganski sir", ""]]; });
  Object.assign(S, {
    "Sladoled": [["Sladoled brez laktoze", "zival"], ["Rastlinski sladoled", ""]],
    "Čokolada za kuhanje": [["Temna čokolada za kuhanje", ""]], "Čokoladne kapljice": [["Temna čokolada za kuhanje", ""]],
    "Pesto": [["Veganski pesto", "orescki"]], "Pesto rosso": [["Veganski pesto", "orescki"]],
    "Jajca": [["Chia semena", "", "žlica", "1 žlica chia semen + 3 žlice vode namesto 1 jajca"]],
    "Majoneza": [["Veganska majoneza", "gorcica"]], "Tatarska omaka": [["Veganska majoneza", "gorcica"]],
    "Med": [["Javorjev sirup", ""]], "Želatina": [["Agar agar", ""]],
    "Orehi": [["Sončnična semena", ""]], "Mandlji": [["Sončnična semena", ""]], "Mandlji mleti": [["Sončnična semena", ""]], "Lešniki": [["Sončnična semena", ""]],
    "Lešniki mleti": [["Sončnična semena", ""]], "Indijski oreščki": [["Bučna semena", ""]], "Arašidi": [["Bučna semena", ""]],
    "Sezam": [["", ""]], "Sezamovo olje": [["Olje sončnično", ""]], "Zelena (gomolj)": [["Peteršiljeva korenina", ""]], "Gorčica": [["", ""]],
    "Inćuni": [["", ""]], "Worcester omaka": [["", ""]],
    // meso: kar je mleto ali narezano, se da nadomestiti; meso v kosu (zrezek, pečenka) ne
    "Mleto meso": [["Rastlinsko mleto meso", "soja"]], "Mleto goveje meso": [["Rastlinsko mleto meso", "soja"]], "Mleto svinjsko meso": [["Rastlinsko mleto meso", "soja"]],
    "Pleskavice za žar": [["Rastlinski burger", "soja"]],
    "Piščančji file": [["Tofu", "soja"], ["Čičerika", ""]], "Puranji file": [["Tofu", "soja"], ["Čičerika", ""]],
    "Hrenovke": [["Rastlinske hrenovke", "soja"]], "Kranjska klobasa": [["Rastlinske hrenovke", "soja"]], "Klobase za žar": [["Rastlinske hrenovke", "soja"]],
    "Pečenice": [["Rastlinske hrenovke", "soja"]], "Debrecinke": [["Rastlinske hrenovke", "soja"]],
    "Slanina": [["Dimljeni tofu", "soja"], ["", ""]], "Šunka": [["Dimljeni tofu", "soja"], ["", ""]], "Prekajena šunka": [["Dimljeni tofu", "soja"], ["", ""]],
    "Pršut": [["", ""]], "Salama": [["", ""]], "Čorizo": [["Dimljeni tofu", "soja"], ["", ""]], "Puranje prsi narezek": [["Dimljeni tofu", "soja"], ["", ""]],
    "Ocvirki": [["", ""]], "Mast": [["Olje sončnično", ""]], "Govedska juha v kocki": [["Jušna kocka", ""]]
  });
  // ko je sestavina glavna stvar jedi, prilagoditev nima smisla
  var STAR = {
    jajca: /jajc|omlet|umešan|fritat|šakšuk|shakshuk|benedikt|poširan|majonez|tiramis|pavlov|beljak|kremšnit|carbonar|quiche|kiš|flan|meringe|sufle/i,
    mleko: /halloumi|fondue|ocvrt\w* sir|sir na žar|sir za žar|kremšnit|tiramis|panna cotta|kajmak|bešamel/i,
    orescki: /oreh|orešk|mandelj|mandlj|lešnik|indijsk|potic|pesto|baklav/i,
    arasidi: /araš|satay/i,
    soja: /tofu|tempeh|edamame|teriyaki|miso/i,
    sezam: /sezam|tahini|humus|hummus/i,
    gorcica: /gorčic/i
  };
  var BURGER = /burger|pleskavic/i;
  // sestavine, kjer je lahko gluten (začimbne mešanice, kocke …)
  var GQ = /jušna kocka|juha v kocki|kari pasta|začimba|omaka|ketchup|gorčica|majoneza|čokolad|puding|kakav|koruzni kosmiči|pecilni|ovsen/i;

  function tags(n) { return P[n] ? P[n].split(" ") : []; }
  // vrne null (ni mogoče) ali { sw: {indeks: [novo ime ("" = izpusti), enota, opomba, količina]}, notes: [[besedilo, [imena]]], n }
  function forbidden(al, diet) { var f = al.slice(); if (diet >= 1) f.push("meso"); if (diet >= 2) f.push("zival"); return f; }
  function hit(t, F) { return t.some(function (x) { return F.indexOf(x) >= 0; }); }
  function adapt(r, al, diet) {
    var F = forbidden(al, diet), ral = r[9] || [], need = [], notes = [], sw = {};
    if (!F.length) return { sw: sw, notes: notes, n: 0 };
    ral.forEach(function (a) { if (a.indexOf("?") < 0 && F.indexOf(a) >= 0) need.push(a); });
    if ((r[10] || 0) < diet) need.push((r[10] || 0) === 0 ? "meso" : "zival");
    var name = r[1] || "", found = {}, ok = true, eggs = 0;
    r[6].forEach(function (g, i) {
      if (!ok) return;
      var t = tags(g[0]);
      t.forEach(function (x) { found[x] = 1; });
      if (!hit(t, F)) return;
      // je sestavina glavna stvar jedi?
      var bad = t.filter(function (x) { return F.indexOf(x) >= 0; });
      if (bad.some(function (x) { return STAR[x] && STAR[x].test(name); })) { ok = false; return; }
      if (bad.indexOf("zival") >= 0 && (STAR.jajca.test(name) && t.indexOf("jajca") >= 0 || STAR.mleko.test(name) && t.indexOf("mleko") >= 0)) { ok = false; return; }
      var c = (S[g[0]] || []).filter(function (s) { return !hit(s[1] ? s[1].split(" ") : [], F); })[0];
      // burger: polpet iz rastlinskega burgerja
      if (BURGER.test(name) && /^(Mleto|Piščančji file|Puranji file)/.test(g[0]) && F.indexOf("meso") >= 0 && F.indexOf("soja") < 0) c = ["Rastlinski burger", "soja", "kos", null, 4];
      if (!c) { ok = false; return; }
      if (g[0] === "Jajca") { eggs = g[1] || 0; if (eggs > 3) { ok = false; return; } }
      sw[i] = [c[0], c[2] || null, c[3] || null, c[4] == null ? null : c[4]];
    });
    if (!ok) return null;
    // vsaka oznaka iz podatkov recepta mora biti pojasnjena s sestavino, sicer raje skrijemo
    if (need.some(function (a) { return a === "zival" ? !(found.mleko || found.jajca || found.zival) : !found[a]; })) return null;
    if (al.indexOf("gluten") >= 0 && ral.indexOf("gluten?") >= 0) {
      var q = r[6].filter(function (g, i) { return !sw[i] && GQ.test(g[0]); }).map(function (g) { return g[0]; });
      notes.push(q.length ? ["Preveri, da je brez glutena", q] : ["Pri začimbah in omakah izberi izdelke z oznako brez glutena."]);
    }
    if (al.indexOf("mleko") >= 0 && diet < 2 && Object.keys(sw).some(function (i) { return /brez laktoze/.test(sw[i][0]); })) notes.push(["Pri alergiji na mlečne beljakovine namesto izdelkov brez laktoze vzemi rastlinske."]);
    Object.keys(sw).forEach(function (i) { if (sw[i][2]) notes.push([sw[i][2]]); });
    return { sw: sw, notes: notes, n: Object.keys(sw).length };
  }
  // seznam sestavin po prilagoditvi: [ime, količina, enota, prvotno ime ali null]; izpuščene odpadejo
  function ingredients(r, a) {
    var out = [];
    r[6].forEach(function (g, i) {
      var s = a && a.sw[i];
      if (!s) { out.push([g[0], g[1], g[2], null]); return; }
      if (!s[0]) return;
      out.push([s[0], s[3] == null ? g[1] : s[3], s[1] || g[2], g[0]]);
    });
    return out;
  }
  window.NK_PRILAGODI = { adapt: adapt, ingredients: ingredients, P: P, S: S };
})();
