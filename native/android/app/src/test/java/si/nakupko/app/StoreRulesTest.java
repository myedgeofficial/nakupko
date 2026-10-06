package si.nakupko.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.util.Calendar;
import java.util.TimeZone;
import org.junit.Test;

// Enaki preizkusi kot native/tests/main.swift za iPhone.
public class StoreRulesTest {
    private static Calendar at(int y, int m, int d, int h, int min) {
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone("Europe/Ljubljana"));
        c.clear();
        c.set(y, m - 1, d, h, min);
        return c;
    }

    private static String open(String hours, String chain, Calendar c) {
        Boolean r = StoreRules.isOpen(hours, chain, c);
        return r == null ? "neznano" : r ? "odprto" : "zaprto";
    }

    @Test public void kinds() {
        assertEquals("spar", StoreRules.kind("Spar Spar", "").chain);
        assertEquals("tus", StoreRules.kind("Tuš market", "").chain);
        assertEquals(true, StoreRules.kind("Korenček", "").duty);
        assertEquals(true, StoreRules.kind("Market", "24/7").duty);
        assertNull(StoreRules.kind("Indijska trgovina", ""));
    }

    // 5. 10. 2026 je ponedeljek, 4. 10. nedelja, 10. 10. sobota.
    @Test public void hours() {
        assertEquals("zaprto", open(null, "spar", at(2026, 10, 5, 6, 0)));
        assertEquals("odprto", open("", "spar", at(2026, 10, 5, 8, 0)));
        assertEquals("zaprto", open("Mo-Sa 07:30-21:00", "spar", at(2026, 10, 5, 7, 0)));
        assertEquals("odprto", open("Mo-Sa 07:30-21:00", "spar", at(2026, 10, 5, 7, 30)));
        assertEquals("zaprto", open(null, "hofer", at(2026, 10, 4, 10, 0)));
        assertEquals("zaprto", open("Mo-Sa 07:00-21:00", "lidl", at(2026, 12, 25, 10, 0)));
        assertEquals("zaprto", open("Mo-Sa 07:00-21:00", "lidl", at(2026, 4, 6, 10, 0)));
        assertEquals("odprto", open("24/7", null, at(2026, 10, 5, 3, 0)));
        assertEquals("neznano", open("", null, at(2026, 10, 5, 3, 0)));
        assertEquals("zaprto", open("Mo-Fr 07:00-20:00, Sa 07:00-13:00", "tus", at(2026, 10, 10, 14, 0)));
        assertEquals("odprto", open("Mo-Fr 07:00-20:00, Sa 07:00-13:00", "tus", at(2026, 10, 10, 12, 0)));
        assertEquals("odprto", open("Mo-Fr 07:00-20:00; Sa,Su 08:00-12:00", null, at(2026, 10, 4, 9, 0)));
        assertEquals("zaprto", open("Mo-Su 06:00-22:00; PH 08:00-12:00", null, at(2026, 11, 1, 13, 0)));
    }

    // Zastareli urnik v OSM: uro po zapiranju in pol ure pred odprtjem trgovina še velja za morda odprto.
    @Test public void grace() {
        assertEquals(true, StoreRules.mayBeOpen("Mo-Sa 07:00-20:00", "spar", at(2026, 10, 5, 20, 40)));
        assertEquals(false, StoreRules.mayBeOpen("Mo-Sa 07:00-20:00", "spar", at(2026, 10, 5, 21, 30)));
        assertEquals(true, StoreRules.mayBeOpen("Mo-Sa 07:30-21:00", "spar", at(2026, 10, 5, 7, 10)));
        assertEquals(false, StoreRules.mayBeOpen("Mo-Sa 07:30-21:00", "spar", at(2026, 10, 5, 6, 0)));
    }
}
