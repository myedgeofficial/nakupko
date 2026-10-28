# Recepti: vsaki jedi doda aparate, alergene in prehrano (polja 8, 9, 10 v recepti.json).
#   8  aparati: seznam kod; "a|b" = zadošča eden od obeh (npr. "cvrtnik|pecica")
#   9  alergeni: gluten, mleko, jajca, orescki, arasidi, ribe, raki, soja, sezam, zelena, gorcica
#   10 prehrana: 0 = meso/ribe, 1 = vegetarijansko, 2 = vegansko
# Zaženi po vsaki spremembi receptov:  python scripts/recepti-oznake.py
# Ročni popravek aparatov: v polje 8 zapiši seznam, ki se začne z "!" (npr. ["!", "pecica"]) in ga skripta ne spreminja.
import json, re, os, sys

POT = os.path.join(os.path.dirname(__file__), "..", "recepti.json")

ALERGENI = [
    ("gluten", r"^(moka (bela|polnozrnata|za pico)|moka$|pirina moka|ostra moka|kruh|toast|žemlj|bageta|rogljič|ciabatta|kajzer|lepinj|pita kruh|hamburger žemlje|hot dog|tortilje$|testenine(?! brez)|makaroni|lističi za lazanjo|listnato|vlečeno|testo za pico|kus kus|bulgur|ješprenj|pšenični|krušne drobtine|piškot|petit beurre|biskvit|ovseni kosmiči$|ovseni otrobi|granola|muesli|kosmiči za zajtrk|pivo|sojina omaka|teriyaki|seitan|njoki(?! brez)|tortelini|ravioli|kitajski rezanci|instant rezanci|jajčne testenine|jušne zvezdice|polži|mlinci|štruklji|zamrznjeni štruklji|krekerji|prepečenec|burek|krof|palačink|mešanica za|falafel|ribje palčke|dunajski|cordon|nuggets|kruhki|grisini|pereci|vaflji|potica|zavitek|gibanica|kremšnita|pinca|pogača|mlečna štručka|kifeljc|pletenica|buhtelj|cmoki|marelični|pica|pizza|lazanja|medenjaki|krekerji|palčke slane|napolitanke|piškoti za tiramisu)"),
    ("mleko", r"^(mleko(?! brez laktoze)|jogurt|sadni jogurt|grški jogurt|skyr|kefir|kisla smetana|sladka smetana|smetana|maslo|skuta|mozzarella|sir|parmezan|feta|mascarpone|ricotta|nariban sir|burata|ghee|puding|mlečn|kislo mleko|pinjenec|kremni sir|topljeni sir|sirni namaz|čokolad|lešnikov namaz|rogljič|pire krompir v prahu|palačink|piškot|petit beurre|zamrznjeni štruklji|štruklji|tortelini|lučka|monte|sladoled|kozji sir|ovčji sir|zrnati sir|beljakovinski|cordon)"),
    ("jajca", r"^(jajca|jajčne testenine|majoneza|tatarska|testenine tagliatelle|lističi za lazanjo|biskvit|piškoti za tiramisu|palačink|mlinci|štruklji|zamrznjeni štruklji|tortelini|krof|medenjaki|vaflji)"),
    ("orescki", r"^(orehi|lešnik|mandlj|indijski|pistacij|mešanica oreščkov|marcipan|potica|pesto(?! rosso)|študentska)"),
    ("arasidi", r"^(arašid)"),
    ("ribe", r"^(losos|tuna|tunina|sardine|sardele|postrv|orada|brancin|oslič|skuše|inćuni|bakalar|ribje|ribja|worcester|zamrznjen file oslič|zamrznjen losos|zamrznjeni file postrvi|dimljeni losos|surimi)"),
    ("raki", r"^(kozice|zamrznjene kozice|lignji|zamrznjeni lignji|školjke|hobotnica|mešani morski|zamrznjeni morski|surimi)"),
    ("soja", r"^(sojin|tofu|tempeh|teriyaki|rastlinski burger|rastlinske hrenovke)"),
    ("sezam", r"^(sezam|tahini|hummus|halva|hamburger žemlje)"),
    ("zelena", r"^(zelena \(gomolj\)|vegeta|jušna kocka|govedska juha|zamrznjena mešanica za juho|instant juha|gotova juha|fond za omake)"),
    ("gorcica", r"^(gorčica|majoneza)"),
]
MESO = r"^(piščan|puran|cel piščanec|mleto|svinjsk|govej|govedska|telečj|teletina|jagnjetin|raca|hrenovke|piščančje hrenovke|kranjska|pršut|šunka|salama|slanina|pašteta|čevapčiči|pleskavice|pečenice|krvavice|mortadela|klobase|debrecinke|mesni sir|kulen|čorizo|kraška panceta|suha šunka|prekajena|ocvirki|mast$|želatina|fond za omake|golaž|cordon|dunajski|zamrznjeni čevapčiči|zamrznjeni hamburgerji|piščančji nuggetsi|bolonjska)"
NI_VEGAN = r"^(med$|jajca)"

APARATI = [
    ("cvrtnik", r"cvrtnik"),
    ("mikrovalovka", r"mikrovalov"),
    ("pocasni", r"počasn\w* kuhalnik"),
    ("sopar", r"soparnik|kuhaln\w* za paro"),
    ("toaster", r"toaster|opekač"),
    ("zar", r"\bžar\w*(?! ponv)|\bna žaru|\bžaru\b|žerjavic"),
    ("blender", r"blender|paličn\w* mešalnik|zmiksaj|zmelj|sesekljalnik|smoothie|gladko zmelj|pretlači v gladko|kremasto zmelj"),
    ("mikser", r"mikser|stepi \w* ?(sneg|smetan|beljak|penast)|v trd sneg|stepi v (sneg|kremo|peno)|z mikserjem"),
    ("pecica", r"pečic|°c|predgret|\bpekač|zapeci v pečic"),
    ("stedilnik", r"ponv|ponev|lon[eč]|zavri|skuhaj|kuhaj|praži|duši|prepraž|cvri|zavre|kuhanj|pristavi|vre\b|popeci|opeci|kozico|karamel|ognj|ogenj|na maslu|na olju|pogrej|prevre|speci|ocvr|zavrel|vrel|rižot|nad sopar|v kozici|kozico"),
]


def low(s):
    return s.lower()


def alergeni(r):
    a = []
    for kod, rx in ALERGENI:
        if any(re.search(rx, low(g[0])) for g in r[6] if "brez glutena" not in low(g[0]) or kod != "gluten"):
            a.append(kod)
    return a


def prehrana(r, al):
    if any(re.search(MESO, low(g[0])) for g in r[6]) or "ribe" in al or "raki" in al:
        return 0
    if "mleko" in al or "jajca" in al or any(re.search(NI_VEGAN, low(g[0])) for g in r[6]):
        return 1
    return 2


def aparati(r):
    # Aparat iz vsakega koraka; »X ali Y« v istem koraku pomeni, da zadošča eden od obeh.
    need, alts = set(), set()
    for st in (r[7][0] if len(r) > 7 and r[7] else []):
        t = low(st)
        t = re.sub(r"mikrovalovn\w* pečic\w*", "mikrovalovki", t)
        t = re.sub(r"olje (segrej )?na \d+ °c|segrej olje na \d+ °c", "olje", t)
        if re.search(r"pod žar|žar v pečic|funkcij\w* žar", t):
            t = re.sub(r"žar\w*", "pečici", t)
        pos = {}
        for kod, rx in APARATI:
            for m in re.finditer(rx, t, re.I):
                pos.setdefault(kod, []).append(m.start())
        hit = [(min(v), k) for k, v in pos.items()]
        alt = None
        m = re.search(r"\bali\b", t)
        if m and len(pos) > 1:
            def prvi(del_, zadnji):
                # aparati v delu koraka; temperatura (°C) šteje za pečico le, če ni drugega aparata
                h = [(p, k) for kod, rx in APARATI for k, p in [(kod, x.start()) for x in re.finditer(rx, del_, re.I)] if not (k == "pecica" and del_[p:p + 2] == "°c")]
                if not h:
                    h = [(x.start(), "pecica") for x in re.finditer("°c", del_)]
                return (max(h) if zadnji else min(h))[1] if h else None
            a, b = prvi(t[:m.start()], True), prvi(t[m.end():], False)
            if a and b and a != b:
                alt = (a, b)
        if alt:
            alts.add("|".join(sorted(alt)))
            need.update(k for _, k in hit if k not in alt)
        else:
            need.update(k for _, k in hit)
    # če je kje navedena zamenjava (»ali v pečici«), velja za cel recept
    need -= {k for x in alts for k in x.split("|")}
    order = [k for k, _ in APARATI]
    return [k for k in order if k in need] + sorted(alts)


def main():
    d = json.load(open(POT, encoding="utf8"))
    for r in d["jedi"]:
        while len(r) < 8:
            r.append([[], []])
        al = alergeni(r)
        ap = r[8] if len(r) > 8 and r[8] and r[8][0] == "!" else aparati(r)
        r[8:] = [ap, al, prehrana(r, al)]
    with open(POT, "w", encoding="utf8") as f:
        json.dump(d, f, ensure_ascii=False, separators=(",", ":"))
    if "-v" in sys.argv:
        for r in d["jedi"]:
            print(r[1], r[8], r[9], r[10])


if __name__ == "__main__":
    main()
