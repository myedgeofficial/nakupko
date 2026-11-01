# Okvirne prehranske vrednosti za recepte: vsaki sestavini iz recepti.json (in nadomestkom iz prilagodi.js)
# pripiše živilo iz USDA FoodData Central (SR Legacy, javna domena) in težo enot (kos, žlica, šopek …).
# Izhod: hranila.json — na 100 g: kcal, beljakovine, ogljikovi hidrati, maščobe, vlaknine (g), sol (g = natrij × 2,5)
# in teže enot, kjer se razlikujejo od privzetih (recepti.js). Aplikacija računa sama, brez klicev na splet.
#
# Zagon (enkrat, ko se spremenijo recepti):
#   prenesi https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip in razpakiraj
#   python scripts/hranila.py <mapa z food.csv>
import csv, json, os, re, sys

KOREN = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
POT = os.path.join(KOREN, "hranila.json")

# Privzete teže enot v gramih (enake so v recepti.js). Pri sestavini jih povozimo, kjer je treba.
ENOTE = {"g": 1, "ml": 1, "kg": 1000, "l": 1000, "žlica": 15, "žlička": 5, "strok": 5, "rezina": 25, "list": 0,
         "pločevinka": 400, "kozarec": 350, "šopek": 25, "vrečka": 10, "zavitek": 250, "kos": 150}

# Pogoste skupine tež
PRAH = {"žlica": 8, "žlička": 3}        # moka, škrob, kakav, mlete začimbe
ZACIMBA = {"žlica": 7, "žlička": 2.5}
OLJE = {"žlica": 13.5, "žlička": 4.5, "ml": 0.92, "l": 920}
SIRUP = {"žlica": 21, "žlička": 7}
SIR_KOS = {"kos": 20, "rezina": 20}     # rezina sira za sendvič ali burger
ZELISCE = {"šopek": 25}
AROMA = {"šopek": 8}                     # rožmarin, timijan: večina ostane v loncu

# Sestavina → (USDA NDB številka ali vzorec opisa, teže enot, delež, ki ga poješ)
# Vzorec: najkrajši opis, ki ustreza vsem delom (ločeni z &). Seznam = mešanica [(živilo, delež), …].
Z = {
    "Ajdova kaša": ("20009", {}),
    "Ajdova moka": ("20011", PRAH),
    "Ajvar": ([("11821", 0.8), ("11209", 0.15), ("4053", 0.05)], {"kozarec": 350}),
    "Ananas": ("9266", {"kos": 500}),
    "Ananas v pločevinki": ("9354", {"pločevinka": 340}),
    "Arašidi": ("16087", {}),
    "Arašidovo maslo": ("16098", {"žlica": 16}),
    "Artičoke": ("11007", {}),
    "Avokado": ("9037", {"kos": 140}),
    "Bageta": ("18029", {"kos": 250}),
    "Bakalar (polenovka)": ("15018", {}),
    "Balzamični kis": ("2069", {}),
    "Banane": ("9040", {"kos": 120}),
    "Bazilika": ("2044", ZELISCE),
    "Beluši": ("11011", {}),
    "Blitva": ("11147", {"šopek": 300}),
    "Borovnice": ("9050", {}),
    "Brancin": ("15091", {"kos": 200}),
    "Breskve": ("9236", {"kos": 150}),
    "Brokoli": ("11090", {"kos": 350}),
    "Bulgur": ("20012", {}),
    "Bučka hokaido": ("11643", {"kos": 800}),
    "Bučke": ("11477", {"kos": 250}),
    "Bučna semena": ("12014", {}),
    "Bučno olje": ("^Oil, pumpkin|^Oil, walnut", OLJE),
    "Cel piščanec": ("5006", {"kos": 1000}),
    "Chia semena": ("12006", {"žlica": 10}),
    "Ciabatta": ("18029", {"kos": 270}),
    "Cimet": ("2010", ZACIMBA),
    "Coca-Cola": ("14148", {}),
    "Cvetača": ("11135", {"kos": 600}),
    "Debrecinke": ("7950", {"kos": 100}),
    "Dimljena paprika": ("^Spices, paprika", ZACIMBA),
    "Dimljeni losos": ("15077", {}),
    "Drobnjak": ("^Chives, raw", ZELISCE),
    "Falafel": ("^Falafel", {"kos": 20}),
    "Feta": ("^Cheese, feta", {}),
    "Fige": ("^Figs, raw", {"kos": 50}),
    "Fižol suh": ("^Beans, white, mature seeds, raw", {}),
    "Fižol v pločevinki": ("^Beans, white, mature seeds, canned", {"pločevinka": 240}),
    "Garam masala": ("^Spices, curry powder", ZACIMBA),
    "Gobe jurčki (suhi)": ("^Mushrooms, shiitake, dried", {}),
    "Gobe šampinjoni": ("^Mushrooms, white, raw", {"kos": 20}),
    "Gorčica": ("^Mustard, prepared, yellow", {}),
    "Govedska juha v kocki": ("6076", {"kos": 10}),
    "Goveje meso za juho": ("23093", {}),
    "Goveji file": ("23601", {}),
    "Goveji golaž": ("23093", {}),
    "Goveji rostbif": ("13095", {}),
    "Goveji zrezek": ("23609", {}),
    "Goveji zrezki": ("23609", {}),
    "Granola": ("^Cereals ready-to-eat, granola, homemade", {}),
    "Grozdje": ("^Grapes, red or green", {}),
    "Grški jogurt": ("^Yogurt, Greek, plain, whole milk", {}),
    "Hamburger žemlje": ("^Rolls, hamburger or hotdog, plain", {"kos": 60}),
    "Hobotnica": ("15166", {}),
    "Hot dog štručke": ("^Rolls, hamburger or hotdog, plain", {"kos": 50}),
    "Hren": ("^Horseradish, prepared", {"kos": 60}),
    "Hren v kozarcu": ("^Horseradish, prepared", {}),
    "Hrenovke": ("7950", {"kos": 50}),
    "Hruške": ("^Pears, raw", {"kos": 170}),
    "Hummus": ("^Hummus, commercial", {}),
    "Indijski oreščki": ("^Nuts, cashew nuts, raw", {}),
    "Ingver": ("^Ginger root, raw", {"kos": 30}),
    "Instant rezanci": ("^Soup, ramen noodle, any flavor, dry", {"kos": 85}),
    "Inćuni": ("15002", {}),
    "Jabolka": ("^Apples, raw, with skin \\(", {"kos": 180}),
    "Jabolčni kis": ("^Vinegar, cider", {}),
    "Jagnjetina": ("17015", {}),
    "Jagode": ("^Strawberries, raw", {"kos": 15}),
    "Jajca": ("^Egg, whole, raw, fresh", {"kos": 50}),
    "Jajčevci": ("11209", {"kos": 300}),
    "Jajčne testenine (rezanci)": ("^Noodles, egg, dry, enriched", {}),
    "Jalapeno": ("^Peppers, jalapeno, raw", {}),
    "Javorjev sirup": ("^Syrups, maple", SIRUP),
    "Ješprenj": ("^Barley, pearled, raw", {}),
    "Jogurt navadni": ("^Yogurt, plain, whole milk", {"kos": 180}),
    "Jušna kocka": ("6081", {"kos": 10}),
    "Jušne zvezdice": ("20120", {}),
    "Kakav v prahu": ("^Cocoa, dry powder, unsweetened\\Z", PRAH),
    "Kalčki": ("^Mung beans, mature seeds, sprouted, raw", {}),
    "Kapre": ("^Capers, canned", {"žlica": 9}),
    "Kari (curry) začimba": ("^Spices, curry powder", ZACIMBA),
    "Kari pasta": ([("^Spices, curry powder", 0.4), ("4053", 0.3), ("^Peppers, hot chili, red, raw", 0.3)], {}),
    "Kava mleta": ("^Beverages, coffee, brewed, prepared with tap water\\Z", {}),
    "Kava za espresso": ("^Beverages, coffee, brewed, espresso, restaurant-prepared\\Z", {"kos": 30}),
    "Kefir": ("^Kefir, lowfat, plain", {}),
    "Ketchup": ("^Catsup\\Z", {"žlica": 17}),
    "Kis": ("^Vinegar, distilled", {}),
    "Kisla repa": ("^Sauerkraut, canned", {}),
    "Kisla smetana": ("^Cream, sour, cultured", {}),
    "Kisle kumarice": ("^Pickles, cucumber, dill or kosher dill", {"kos": 60, "kozarec": 350}),
    "Kislo mleko": ("^Yogurt, plain, whole milk", {}),
    "Kislo zelje": ("^Sauerkraut, canned", {"kos": 1000}),
    "Kitajski rezanci": ("^Noodles, chinese, chow mein|^Noodles, egg, dry, enriched", {}),
    "Kitajsko zelje": ("^Cabbage, chinese \\(pe-tsai\\), raw", {"kos": 800}),
    "Kivi": ("^Kiwifruit, green, raw", {"kos": 75}),
    "Klobase za žar": ("7015", {"kos": 100}),
    "Kokosova moka (nariban kokos)": ("^Nuts, coconut meat, dried \\(desiccated\\), not sweetened", {"žlica": 5}),
    "Kokosovo mleko": ("^Nuts, coconut milk, canned \\(liquid expressed from grated meat and water\\)", {}),
    "Koleraba": ("^Kohlrabi, raw", {"kos": 250}),
    "Koper": ("^Dill weed, fresh", ZELISCE),
    "Korenje": ("^Carrots, raw", {"kos": 80}),
    "Koriander (svež)": ("^Coriander \\(cilantro\\) leaves, raw", ZELISCE),
    "Koruza v pločevinki": ("^Corn, sweet, yellow, canned, whole kernel, drained solids", {"pločevinka": 280}),
    "Koruzna moka": ("^Cornmeal, whole-grain, yellow", PRAH),
    "Koruzni kosmiči": ("8506", {}),
    "Koruzni zdrob (polenta)": ("^Cornmeal, degermed, enriched, yellow", {}),
    "Koruzni škrob": ("^Cornstarch", PRAH),
    "Kostanj": ("^Nuts, chestnuts, european, raw, peeled", {}),
    "Kozice": ("15270", {}),
    "Kozji sir": ("^Cheese, goat, soft type", {}),
    "Kranjska klobasa": ("^Kielbasa|^Polish sausage, pork", {"kos": 180}),
    "Krekerji": ("^Crackers, standard snack-type, regular", {"zavitek": 100}),
    "Kremni sir": ("^Cheese, cream\\Z", {}),
    "Kristalka": ("^Lettuce, green leaf, raw", {"kos": 300}),
    "Krompir": ("^Potatoes, flesh and skin, raw", {"kos": 150}),
    "Kruh beli": ("^Bread, white, commercially prepared \\(includes soft bread crumbs\\)", {"rezina": 30, "kos": 500}),
    "Kruh polnozrnati": ("^Bread, whole-wheat, commercially prepared\\Z", {"rezina": 30}),
    "Kruh s semeni": ("^Bread, multi-grain \\(includes whole-grain\\)", {"rezina": 30}),
    "Kruh črni": ("^Bread, rye\\Z", {"rezina": 30, "kos": 500}),
    "Krušne drobtine": ("^Bread, crumbs, dry, grated, plain", {"žlica": 7}),
    "Krvavice": ("^Blood sausage", {"kos": 150}),
    "Kuhana rdeča pesa": ("^Beets, cooked, boiled, drained\\Z", {}),
    "Kumare": ("^Cucumber, with peel, raw", {"kos": 300}),
    "Kumina": ("^Spices, cumin seed", ZACIMBA),
    "Kurkuma": ("^Spices, turmeric, ground", ZACIMBA),
    "Kus kus": ("^Couscous, dry", {}),
    "Kvas (suhi)": ("^Leavening agents, yeast, baker's, active dry", {"vrečka": 7}),
    "Kvas (sveži)": ("^Leavening agents, yeast, baker's, compressed", {"kos": 42}),
    "Kvinoja": ("^Quinoa, uncooked", {}),
    "Lanena semena": ("^Seeds, flaxseed", {"žlica": 10}),
    "Lepinje": ("^Bread, pita, white, enriched", {"kos": 100}),
    "Leča": ("^Lentils, raw", {}),
    "Lešniki": ("^Nuts, hazelnuts or filberts\\Z", {}),
    "Lešniki mleti": ("^Nuts, hazelnuts or filberts\\Z", {}),
    "Lešnikov namaz": ("^Chocolate-flavored hazelnut spread", {"žlica": 20, "kozarec": 400}),
    "Lignji": ("15175", {}),
    "Limete": ("^Limes, raw", {"kos": 50}),
    "Limone": ("^Lemons, raw, without peel", {"kos": 60}),
    "Lističi za lazanjo": ("20120", {}),
    "Listnato testo": ("^Puff pastry, frozen, ready-to-bake", {"zavitek": 275}),
    "Losos file": ("15236", {}),
    "Lovorjev list": ("^Spices, bay leaf", {"list": 0}),
    "Lubenica": ("^Watermelon, raw", {"kos": 1500}),
    "Majaron": ("^Spices, marjoram, dried", ZACIMBA),
    "Majoneza": ("^Salad dressing, mayonnaise, regular", {"žlica": 14}),
    "Mak": ("^Spices, poppy seed", {"žlica": 9}),
    "Makaroni": ("20120", {}),
    "Maline": ("^Raspberries, raw", {}),
    "Mandlji": ("^Nuts, almonds\\Z", {}),
    "Mandlji mleti": ("^Nuts, almonds\\Z", {}),
    "Mango": ("^Mangos, raw", {"kos": 200}),
    "Marelice": ("^Apricots, raw", {}),
    "Marmelada": ("^Jams and preserves\\Z", {"žlica": 20, "kozarec": 450}),
    "Mascarpone": ([("^Cheese, cream\\Z", 0.5), ("^Cream, fluid, heavy whipping", 0.5)], {}),
    "Maslena buča": ("^Squash, winter, butternut, raw", {"kos": 1000}),
    "Maslo": ("^Butter, without salt", {"žlica": 14}),
    "Mast": ("^Lard\\Z", {"žlica": 13}),
    "Med": ("^Honey\\Z", SIRUP),
    "Mehiška začimba": ("^Spices, chili powder", dict(ZACIMBA, vrečka=30)),
    "Melona": ("^Melons, cantaloupe, raw", {"kos": 700}),
    "Meta": ("^Spearmint, fresh", ZELISCE),
    "Mešana solata": ("^Lettuce, green leaf, raw", {"vrečka": 125}),
    "Mešani morski sadeži": ([("15270", 0.4), ("15175", 0.3), ("15164", 0.3)], {}),
    "Mešanica za palačinke": ("18289", {}),
    "Mlada čebula": ("^Onions, spring or scallions \\(includes tops and bulb\\), raw", {"šopek": 100, "kos": 15}),
    "Mlada špinača (baby)": ("^Spinach, raw", {}),
    "Mladi krompir": ("^Potatoes, flesh and skin, raw", {}),
    "Mleko": ("^Milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D", {"ml": 1.03, "l": 1030}),
    "Mleto goveje meso": ("23572", {}),
    "Mleto meso": ([("23572", 0.5), ("^Pork, fresh, ground, raw", 0.5)], {}),
    "Mleto svinjsko meso": ("^Pork, fresh, ground, raw", {}),
    "Mlinci": ("20120", {}),
    "Moka bela": ("^Wheat flour, white, all-purpose, enriched, bleached", PRAH),
    "Moka polnozrnata": ("20080", PRAH),
    "Moka za pico (tip 00)": ("^Wheat flour, white, all-purpose, enriched, bleached", PRAH),
    "Morska sol": ("^Salt, table", {"žlička": 6}, 0.01),
    "Motovilec": ("^Lettuce, green leaf, raw", {}),
    "Mozzarella": ("^Cheese, mozzarella, whole milk\\Z", {}),
    "Muškatni orešček": ("^Spices, nutmeg, ground", ZACIMBA),
    "Nariban sir": ("^Cheese, gouda", {}),
    "Njoki": ([("^Potatoes, flesh and skin, raw", 0.75), ("^Wheat flour, white, all-purpose, enriched, bleached", 0.25)], {}),
    "Njoki (sveži)": ([("^Potatoes, flesh and skin, raw", 0.75), ("^Wheat flour, white, all-purpose, enriched, bleached", 0.25)], {}),
    "Nori listi": ("^Seaweed, laver, raw", {"kos": 3}),
    "Ocvirki": ("19041", {}),
    "Oglje za žar": (None, {}),
    "Ohrovt": ("^Cabbage, savoy, raw", {"kos": 700}),
    "Olive": ("^Olives, ripe, canned \\(small-extra large\\)", {}),
    "Olivno olje": ("4053", OLJE),
    "Olje sončnično": ("^Oil, sunflower, linoleic, \\(approx. 65%\\)", OLJE),
    "Olje za cvrtje": ("^Oil, sunflower, linoleic, \\(approx. 65%\\)", OLJE, 0.1),
    "Omaka BBQ": ("^Sauce, barbecue", {"žlica": 17}),
    "Orada": ("15101", {"kos": 200}),
    "Orehi": ("^Nuts, walnuts, english", {}),
    "Origano": ("^Spices, oregano, dried", ZACIMBA),
    "Oslič file": ("15132", {}),
    "Ostra paprika": ("11819", {"kos": 15}),
    "Ovseni kosmiči": ("^Oats\\Z|^Cereals, oats, regular and quick, not fortified, dry", {}),
    "Ovseni napitek": ([("8120", 0.1), ("4506", 0.01)], {}),
    "Palčke slane": ("^Snacks, pretzels, hard, plain, salted", {"vrečka": 100}),
    "Paprika": ("^Peppers, sweet, green, raw", {"kos": 150}),
    "Paradižnik": ("^Tomatoes, red, ripe, raw, year round average", {"kos": 120}),
    "Paradižnikov koncentrat": ("^Tomato products, canned, paste, without salt added", {"žlica": 16}),
    "Paradižnikova mezga": ("^Tomato products, canned, puree, without salt added", {}),
    "Paradižnikova omaka (pasata)": ("^Tomato products, canned, puree, without salt added", {}),
    "Parmezan": ("1033", {}),
    "Pastinak": ("^Parsnips, raw", {"kos": 100}),
    "Pašteta": ("^Pate, liver, not specified, canned|^Pate, chicken liver, canned", {"kos": 100}),
    "Pecilni prašek": ("^Leavening agents, baking powder, double-acting, sodium aluminum sulfate", {"vrečka": 12, "žlička": 4}),
    "Pehtran": ("^Spices, tarragon, dried", {"šopek": 3}),
    "Pelati": ("^Tomatoes, red, ripe, canned, packed in tomato juice\\Z", {}),
    "Pesa": ("^Beets, raw", {"kos": 150}),
    "Pesto": ("^Sauce, pesto, ready-to-serve, refrigerated|^Sauce, pesto", {"žlica": 15}),
    "Pesto rosso": ("^Sauce, pesto, ready-to-serve, refrigerated|^Sauce, pesto", {"žlica": 15}),
    "Peteršilj": ("11297", ZELISCE),
    "Peteršiljeva korenina": ("^Parsnips, raw", {"kos": 80}),
    "Petit beurre": ("^Cookies, butter, commercially prepared, enriched", {"kos": 7}),
    "Pečena paprika v kozarcu": ("^Peppers, sweet, red, canned, solids and liquids", {"kozarec": 300}),
    "Pečenice": ("7015", {"kos": 120}),
    "Pire krompir v prahu": ("^Potatoes, mashed, dehydrated, flakes without milk, dry form", {"vrečka": 100}),
    "Pirina moka": ("^Spelt, uncooked", PRAH),
    "Pita kruh": ("^Bread, pita, white, enriched", {"kos": 60}),
    "Pivo": ("^Alcoholic beverage, beer, regular, all", {"kos": 500}),
    "Pivo (paket)": (None, {}),
    "Piškoti": ("^Cookies, butter, commercially prepared, enriched", {}),
    "Piškoti za tiramisu": ("^Cookies, ladyfingers, with lemon juice and rind", {}),
    "Piščančja bedra": ("5091", {}),
    "Piščančja jetrca": ("5027", {}),
    "Piščančja krača": ("5091", {"kos": 250}),
    "Piščančje perutničke": ("5100", {}),
    "Piščančji bobrčki": ("5066", {}),
    "Piščančji file": ("^Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw", {}),
    "Piščančji nuggetsi": ("5323", {}),
    "Pleskavice za žar": ([("23572", 0.5), ("^Pork, fresh, ground, raw", 0.5)], {"kos": 150}),
    "Polži (testenine za juho)": ("20120", {}),
    "Pomaranče": ("^Oranges, raw, all commercial varieties", {"kos": 150}),
    "Pomfri": ("^Potatoes, french fried, all types, salt not added in processing, frozen, as purchased", {}),
    "Poper": ("^Spices, pepper, black", ZACIMBA),
    "Poper v zrnju": ("^Spices, pepper, black", ZACIMBA),
    "Por": ("^Leeks, \\(bulb and lower leaf-portion\\), raw", {"kos": 200}),
    "Postrv": ("15240", {"kos": 170}),
    "Prekajena šunka": ("^Ham, sliced, regular \\(approximately 11% fat\\)", {}),
    "Prosena kaša": ("^Millet, raw", {}),
    "Provansalska zelišča": ("^Spices, thyme, dried", ZACIMBA),
    "Pršut": ("^Ham, cured, boneless|^Pork, cured, ham, boneless, regular", {}),
    "Puding v prahu": ("^Puddings, vanilla, dry mix, regular", {"vrečka": 40}),
    "Puranje prsi narezek": ("^Turkey breast, sliced, prepackaged|^Turkey, breast, smoked", {}),
    "Puranji file": ("5219", {}),
    "Puranji zrezki": ("5219", {}),
    "Pšenični zdrob": ("^Semolina, enriched", {}),
    "Rabarbara": ("^Rhubarb, raw", {}),
    "Raca": ("5139", {"kos": 800}),
    "Radič": ("^Radicchio, raw", {"kos": 300}),
    "Rastlinske hrenovke": ("^Frankfurter, meatless", {"kos": 50}),
    "Rastlinski burger": ("^Veggie burgers or soyburgers, unprepared", {"kos": 110}),
    "Ravioli": ([("20093", 0.7), ("1036", 0.3)], {}),
    "Rdeča leča": ("^Lentils, pink or red, raw", {}),
    "Rdeča paprika": ("11821", {"kos": 150}),
    "Rdeča čebula": ("^Onions, raw", {"kos": 120}),
    "Rdeče zelje": ("^Cabbage, red, raw", {"kos": 900}),
    "Rdeči fižol v pločevinki": ("^Beans, kidney, red, mature seeds, canned, drained solids", {"pločevinka": 240}),
    "Redkvica": ("^Radishes, raw", {"šopek": 150}),
    "Ribje palčke": ("^Fish, fish sticks, frozen, prepared|^Fish sticks", {"kos": 28}),
    "Ricotta": ("^Cheese, ricotta, whole milk", {}),
    "Riž": ("20044", {}),
    "Riž basmati": ("20044", {}),
    "Riž jasmin": ("20044", {}),
    "Riž za mlečni riž": ("^Rice, white, short-grain, raw", {}),
    "Riž za rižoto": ("^Rice, white, medium-grain, raw, enriched", {}),
    "Riž za suši": ("^Rice, white, short-grain, raw", {}),
    "Rižev kis": ("^Vinegar, distilled", {}),
    "Riževi rezanci": ("^Rice noodles, dry", {}),
    "Rjavi sladkor": ("^Sugars, brown\\Z", {"žlica": 12, "žlička": 4}),
    "Robide": ("^Blackberries, raw", {}),
    "Rogljiček": ("^Croissants, butter", {"kos": 60}),
    "Rozine": ("9298", {}),
    "Rožmarin": ("^Rosemary, fresh", AROMA),
    "Rukola": ("^Arugula, raw", {}),
    "Salama": ("^Salami, dry or hard, pork, beef", {}),
    "Salsa omaka": ("^Sauce, salsa, ready-to-serve", {}),
    "Sardele (sveže)": ("15001", {}, 0.6),
    "Sardine": ("15088", {"pločevinka": 90}),
    "Seitan": ("^Vital wheat gluten", {}),
    "Sezam": ("^Seeds, sesame seeds, whole, dried", {"žlica": 9}),
    "Sezamovo olje": ("^Oil, sesame, salad or cooking", OLJE),
    "Sir Cheddar": ("^Cheese, cheddar\\Z|^Cheese, cheddar", SIR_KOS),
    "Sir Edamec": ("^Cheese, edam", SIR_KOS),
    "Sir Ementalec": ("^Cheese, swiss\\Z", {}),
    "Sir Gauda": ("^Cheese, gouda", SIR_KOS),
    "Sir Gorgonzola": ("^Cheese, blue", {}),
    "Sir Halloumi": ([("^Cheese, mozzarella, whole milk\\Z", 0.4), ("^Cheese, feta", 0.6)], {}),
    "Sir Pecorino": ("^Cheese, romano", {}),
    "Sir Tolminc": ("^Cheese, gruyere", {}),
    "Sir v lističih": ("^Cheese, gouda", SIR_KOS),
    "Sir za pico": ("^Cheese, mozzarella, low moisture, part-skim", {}),
    "Sir za žar": ([("^Cheese, mozzarella, whole milk\\Z", 0.4), ("^Cheese, feta", 0.6)], {}),
    "Sirni namaz": ("^Cheese spread, pasteurized process, American", {}),
    "Skuta": ("^Cheese, cottage, lowfat, 2% milkfat\\Z", {}),
    "Skuše v pločevinki": ("^Fish, mackerel, jack, canned, drained solids", {"pločevinka": 125}),
    "Sladka koruza (storž)": ("^Corn, sweet, yellow, raw", {"kos": 150}),
    "Sladka paprika": ("^Spices, paprika", ZACIMBA),
    "Sladka smetana": ("^Cream, fluid, heavy whipping", {}),
    "Sladki krompir": ("^Sweet potato, raw, unprepared", {"kos": 250}),
    "Sladkor": ("^Sugars, granulated", {"žlica": 12, "žlička": 4}),
    "Sladkor v prahu": ("^Sugars, powdered", PRAH),
    "Sladoled": ("^Ice creams, vanilla\\Z", {}),
    "Slanina": ("^Pork, cured, bacon, unprepared", {}),
    "Slive": ("^Plums, raw", {"kos": 40}),
    "Smetana za kuhanje": ("^Cream, fluid, light \\(coffee cream or table cream\\)", {}),
    "Smoki": ([("16087", 0.3), ("19008", 0.7)], {"vrečka": 50}),
    "Soda bikarbona": ("^Leavening agents, baking soda", {"žlička": 4}),
    "Sojina omaka": ("^Soy sauce made from soy and wheat \\(shoyu\\)\\Z", {"žlica": 16}),
    "Sok pomarančni": ("^Orange juice, raw", {}),
    "Sol": ("^Salt, table", {"žlička": 6, "žlica": 18}),
    "Solata (zelena)": ("^Lettuce, green leaf, raw", {"kos": 300}),
    "Solata ledenka": ("^Lettuce, iceberg \\(includes crisphead types\\), raw", {"kos": 500}),
    "Solata rimska": ("^Lettuce, cos or romaine, raw", {"kos": 300}),
    "Solatni preliv": ("^Salad dressing, italian dressing, commercial, regular", {}),
    "Sončnična semena": ("^Seeds, sunflower seed kernels, dried", {}),
    "Stročji fižol": ("^Beans, snap, green, raw", {}),
    "Suhe brusnice": ("^Cranberries, dried, sweetened", {}),
    "Suhe marelice": ("^Apricots, dried, sulfured, uncooked", {}),
    "Suhe slive": ("^Plums, dried \\(prunes\\), uncooked", {}),
    "Svinjska pečenka": ("10020", {}),
    "Svinjska plečka": ("10070", {}),
    "Svinjska rebrca": ("10088", {}, 0.7),
    "Svinjska ribica": ("10218", {}),
    "Svinjska vratovina": ("10080", {}),
    "Svinjski kotleti": ("10020", {"kos": 180}),
    "Svinjski zrezki": ("10024", {"kos": 120}),
    "Sweet chili omaka": ("^Sauce, sweet and sour, ready-to-serve|^Sauce, sweet and sour", {"žlica": 18}),
    "Taco školjke": ("^Taco shells, baked", {"kos": 13}),
    "Tahini (sezamova pasta)": ("^Seeds, sesame butter, tahini, from roasted and toasted kernels", {"žlica": 15}),
    "Tatarska omaka": ("^Salad dressing, mayonnaise, regular", {"žlica": 14, "kos": 200}),
    "Teletina": ("17088", {}),
    "Telečji zrezki": ("17094", {}),
    "Tempeh": ("^Tempeh\\Z", {}),
    "Teriyaki omaka": ("^Sauce, teriyaki, ready-to-serve\\Z", {"žlica": 18}),
    "Testenine fusilli": ("20120", {}),
    "Testenine metuljčki": ("20120", {}),
    "Testenine peresniki": ("20120", {}),
    "Testenine polnozrnate": ("^Pasta, whole-wheat, dry", {}),
    "Testenine polžki": ("20120", {}),
    "Testenine tagliatelle": ("^Noodles, egg, dry, enriched", {}),
    "Testenine špageti": ("20120", {}),
    "Testo za pico": ([("20081", 0.6), ("4053", 0.02), ("2047", 0.012)], {"kos": 400}),
    "Timijan": ("^Thyme, fresh", AROMA),
    "Toast kruh": ("^Bread, white, commercially prepared \\(includes soft bread crumbs\\)", {"rezina": 25}),
    "Tofu": ("^Tofu, raw, firm, prepared with calcium sulfate", {}),
    "Topinambur": ("^Jerusalem-artichokes, raw", {}),
    "Tortelini (sveži)": ([("20093", 0.7), ("1036", 0.3)], {}),
    "Tortilja čips": ("^Snacks, tortilla chips, plain, white corn, salted", {}),
    "Tortilje": ("^Tortillas, ready-to-bake or -fry, flour, refrigerated", {"kos": 60}),
    "Tuna file (svež)": ("15127", {}),
    "Tuna v olju": ("15119", {"pločevinka": 110}),
    "Tuna v pločevinki": ("15121", {"pločevinka": 120}),
    "Vanilijev sladkor": ("^Sugars, granulated", {"vrečka": 8}),
    "Vino belo": ("^Alcoholic beverage, wine, table, white\\Z", {}, 0.5),
    "Vino rdeče": ("^Alcoholic beverage, wine, table, red\\Z", {}, 0.5),
    "Vinski kis": ("^Vinegar, red wine", {}),
    "Vlečeno testo": ("^Phyllo dough", {"zavitek": 500}),
    "Wasabi": ("^Wasabi, root, raw", {}),
    "Worcester omaka": ("^Sauce, worcestershire", {"žlica": 17}),
    "Zamrznjena kitajska mešanica": ("^Vegetables, mixed, frozen, unprepared", {}),
    "Zamrznjena mešanica za juho": ("^Vegetables, mixed, frozen, unprepared", {}),
    "Zamrznjena zelenjava": ("^Vegetables, mixed, frozen, unprepared", {}),
    "Zamrznjena špinača": ("^Spinach, frozen, chopped or leaf, unprepared", {}),
    "Zamrznjene jagode": ("^Strawberries, frozen, unsweetened", {}),
    "Zamrznjene kozice": ("15270", {}),
    "Zamrznjeni file postrvi": ("15240", {}),
    "Zamrznjeni grah": ("^Peas, green, frozen, unprepared", {}),
    "Zamrznjeni štruklji": ([("^Wheat flour, white, all-purpose, enriched, bleached", 0.35), ("^Cheese, cottage, lowfat, 2% milkfat\\Z", 0.45), ("^Egg, whole, raw, fresh", 0.1), ("^Butter, without salt", 0.1)], {}),
    "Zamrznjeno sadje": ("^Strawberries, frozen, unsweetened", {}),
    "Začimba za piščanca": ("^Spices, poultry seasoning", ZACIMBA),
    "Začimba za žar": ("^Spices, paprika", ZACIMBA),
    "Zelena (gomolj)": ("^Celeriac, raw", {"kos": 400}),
    "Zelje": ("^Cabbage, raw", {"kos": 1000}),
    "Čaj": (None, {}),
    "Čebula": ("^Onions, raw", {"kos": 120}),
    "Česen": ("11215", {"strok": 5}),
    "Česen v prahu": ("^Spices, garlic powder", ZACIMBA),
    "Čevapčiči": ([("23572", 0.5), ("^Pork, fresh, ground, raw", 0.5)], {"kos": 30}),
    "Češnje": ("^Cherries, sweet, raw", {}),
    "Češnjev paradižnik": ("^Tomatoes, red, ripe, raw, year round average", {}),
    "Čili v prahu": ("^Spices, chili powder", ZACIMBA),
    "Čips": ("^Snacks, potato chips, plain, salted", {"vrečka": 150}),
    "Čičerika": ("^Chickpeas \\(garbanzo beans, bengal gram\\), mature seeds, canned, drained solids", {"pločevinka": 240}),
    "Čokolada za kuhanje": ("^Chocolate, dark, 60-69% cacao solids", {}),
    "Čokoladne kapljice": ("^Candies, semisweet chocolate", {}),
    "Čorizo": ("7019", {}),
    "Šitake": ("^Mushrooms, shiitake, raw", {}),
    "Školjke (dagnje)": ("15164", {}, 0.4),
    "Šparglji": ("11011", {}),
    "Špinača": ("^Spinach, raw", {}),
    "Šunka": ("^Ham, sliced, regular \\(approximately 11% fat\\)", {"rezina": 15}),
    "Žafran": ("^Spices, saffron", {"vrečka": 0.1}),
    "Želatina": ("^Gelatins, dry powder, unsweetened", {"vrečka": 10}),
    "Žemlje": ("^Rolls, hamburger or hotdog, plain", {"kos": 60}),
    # nadomestki iz prilagodi.js, ki se po sestavi razlikujejo od izvirnika (»… brez laktoze/glutena« vzame izvirnik)
    "Rastlinsko mleto meso": ("^Meat extender", {}),
    "Dimljeni tofu": ("^Tofu, raw, firm, prepared with calcium sulfate", {}),
    "Rižev napitek": ("^Beverages, rice milk, unsweetened", {}),
    "Rastlinski jogurt": ("16252", {"kos": 150}),
    "Rastlinsko maslo": ("^Margarine, regular, 80% fat, composite, stick, without salt|^Margarine, regular, 80% fat", {"žlica": 14}),
    "Rastlinska smetana za kuhanje": ([("^Nuts, coconut milk, canned \\(liquid expressed from grated meat and water\\)", 0.5), ("^Beverages, rice milk, unsweetened", 0.5)], {}),
    "Rastlinska sladka smetana": ("^Dessert topping, semi solid, frozen|^Nuts, coconut cream, canned", {}),
    "Veganski kremni sir": ("^Nuts, cashew nuts, raw", {}, 0.5),
    "Veganski sir": ([("^Oil, coconut", 0.25), ("^Cornstarch", 0.2)], {}),
    "Rastlinski sladoled": ("^Frozen novelties, ice type|^Sherbet, orange", {}),
    "Temna čokolada za kuhanje": ("^Chocolate, dark, 70-85% cacao solids", {}),
    "Veganski pesto": ([("4053", 0.5), ("2044", 0.3), ("^Seeds, sunflower seed kernels, dried", 0.2)], {"žlica": 15}),
    "Veganska majoneza": ("^Salad dressing, mayonnaise, soybean oil, without salt|^Salad dressing, mayonnaise, regular", {"žlica": 14}),
    "Agar agar": ("^Seaweed, agar, dried", {"vrečka": 10}),
    "Tamari omaka": ("^Soy sauce made from soy \\(tamari\\)", {"žlica": 16}),
    "Kokosova aminos omaka": ("^Soy sauce made from soy \\(tamari\\)", {"žlica": 16}, 0.3),
}

# Sol, ki ostane v jedi (namočena polenovka izgubi večino soli)
SOL = {"Bakalar (polenovka)": 0.1}

# Cele pečene jedi (potica, torta, pecivo) se ne delijo na 4: koliko porcij da cela jed
# (hranila.js to upošteva le, če bi bila četrtina jedi več kot 600 kcal)
PORCIJE = [(r"potic", 16, "sladice klasika"),
           (r"\btort[aei]?\b|sacher|malakov|gibanic|kremšnit|kremne rezine|kocke|brownies|kolač|šarkelj|zavitek|krostat|pogača|"
            r"domači kruh|piškot|rogljič|medenjak|\bkrofi\b|polžki|tartuf|profiterol", 12, "sladice klasika"),
           (r"\bpita\b", 12, "sladice")]


def porcije(jedi):
    out = {}
    for r in jedi:
        for vz, n, mape in PORCIJE:
            if r[5] in mape.split() and re.search(vz, r[1], re.I) and not re.search(r"skodelic|kozarc|lava", r[1]):
                out[r[1]] = n
                break
    return out


def naloži(mapa):
    N = {"1008": 0, "1003": 1, "1005": 2, "1004": 3, "1079": 4, "1093": 5}
    ndb = {r["fdc_id"]: r["NDB_number"] for r in csv.DictReader(open(os.path.join(mapa, "sr_legacy_food.csv"), encoding="utf8"))}
    hrana = {}
    for r in csv.DictReader(open(os.path.join(mapa, "food.csv"), encoding="utf8")):
        if r["fdc_id"] in ndb: hrana[r["fdc_id"]] = [r["description"], [0.0] * 6]
    for r in csv.DictReader(open(os.path.join(mapa, "food_nutrient.csv"), encoding="utf8")):
        i = N.get(r["nutrient_id"])
        if i is not None and r["fdc_id"] in hrana: hrana[r["fdc_id"]][1][i] = float(r["amount"] or 0)
    return {ndb[k]: v for k, v in hrana.items()}


def najdi(baza, spec):
    if re.fullmatch(r"\d+", spec):
        return spec
    for alt in spec.split("|"):
        p = re.compile(alt, re.I)
        zad = [k for k, v in baza.items() if p.search(v[0])]
        if zad:
            return min(zad, key=lambda k: (len(baza[k][0]), k))
    raise SystemExit("ni živila za vzorec: " + spec)


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__ or "python scripts/hranila.py <mapa USDA SR Legacy CSV>")
    baza = naloži(sys.argv[1])
    out, viri = {}, {}
    for ime, v in Z.items():
        spec, en = v[0], v[1]
        delež = v[2] if len(v) > 2 else 1
        if spec is None:
            out[ime] = [0, 0, 0, 0, 0, 0]
            continue
        mes = spec if isinstance(spec, list) else [(spec, 1)]
        vs = [0.0] * 6
        for s, w in mes:
            k = najdi(baza, s)
            viri.setdefault(ime, []).append(k + " " + baza[k][0])
            for i in range(6): vs[i] += baza[k][1][i] * w
        vs[5] = vs[5] * 2.5 / 1000 * SOL.get(ime, 1)  # natrij (mg) → sol (g)
        row = [round(x * delež, 2 if i == 5 else 1) for i, x in enumerate(vs)]
        en = {k: x for k, x in en.items() if ENOTE.get(k) != x}
        if en: row.append(en)
        out[ime] = row
    jedi = json.load(open(os.path.join(KOREN, "recepti.json"), encoding="utf8"))["jedi"]
    data = {"vir": "USDA FoodData Central, SR Legacy (2018)", "enote": ENOTE, "porcije": porcije(jedi), "z": out}
    with open(POT, "w", encoding="utf8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "hranila-viri.txt"), "w", encoding="utf8") as f:
        for ime in sorted(viri): f.write(ime + " ← " + " + ".join(viri[ime]) + "\n")
    print(len(out), "sestavin →", POT)


if __name__ == "__main__":
    main()
