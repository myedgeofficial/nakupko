package si.nakupko.app;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// Katere trgovine spremljamo in ali so odprte. Enaka pravila kot v app.js
// (storeKind, parseHours, isHoliday) in StoreRules.swift na iPhonu.
final class StoreRules {
    private StoreRules() {}

    private static final String[][] CHAINS = {
        {"spar", "spar|interspar"},
        {"mercator", "mercator|hipermarket m|mere"},
        {"tus", "tu[sš]\\b|tus |tuš"},
        {"lidl", "lidl"},
        {"hofer", "hofer|aldi"},
        {"eurospin", "eurospin"},
        {"jager", "jager"},
        {"leclerc", "leclerc"}
    };
    private static final String DUTY = "koren[cč]ek|betka|ekspres|de[zž]urn|non ?-?stop";
    private static final String CHAIN_DEFAULT_HOURS = "Mo-Sa 07:00-21:00; Su off; PH off";
    private static final List<String> DAYS = Arrays.asList("Su", "Mo", "Tu", "We", "Th", "Fr", "Sa");

    private static boolean matches(String text, String pattern) {
        return Pattern.compile(pattern, Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE).matcher(text).find();
    }

    static final class Kind {
        final String chain;
        final boolean duty;
        Kind(String chain, boolean duty) { this.chain = chain; this.duty = duty; }
    }

    // Vrne vrsto trgovine ali null, če je ne spremljamo.
    static Kind kind(String text, String hours) {
        for (String[] c : CHAINS) if (matches(text, c[1])) return new Kind(c[0], false);
        if (matches(text, DUTY) || (hours != null && hours.contains("24/7"))) return new Kind(null, true);
        return null;
    }

    // ---------- Prazniki (trgovine so po zakonu zaprte) ----------
    private static int[] easter(int y) {
        int a = y % 19, b = y / 100, c = y % 100, d = b / 4, e = b % 4, f = (b + 8) / 25;
        int g = (b - f + 1) / 3, h = (19 * a + b - d - g + 15) % 30, i = c / 4, k = c % 4;
        int l = (32 + 2 * e + 2 * i - h - k) % 7, m = (a + 11 * h + 22 * l) / 451;
        return new int[]{(h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1};
    }

    static boolean isHoliday(Calendar now) {
        int month = now.get(Calendar.MONTH) + 1, day = now.get(Calendar.DAY_OF_MONTH);
        String md = month + "-" + day;
        if (Arrays.asList("1-1", "1-2", "2-8", "4-27", "5-1", "5-2", "6-25", "8-15", "10-31", "11-1", "12-25", "12-26").contains(md)) return true;
        Calendar monday = (Calendar) now.clone();
        int[] e = easter(now.get(Calendar.YEAR));
        monday.set(Calendar.MONTH, e[0] - 1);
        monday.set(Calendar.DAY_OF_MONTH, e[1]);
        monday.add(Calendar.DAY_OF_MONTH, 1);
        return monday.get(Calendar.MONTH) == now.get(Calendar.MONTH) && monday.get(Calendar.DAY_OF_MONTH) == day;
    }

    // ---------- OSM opening_hours, npr. "Mo-Sa 07:00-21:00; Su off; PH off" ----------
    static final class Hours {
        boolean always;
        final Map<Integer, List<int[]>> days = new HashMap<>();
        List<int[]> ph;
    }

    private static final String DAY = "(?:Mo|Tu|We|Th|Fr|Sa|Su|PH)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?";
    private static final Pattern RULE = Pattern.compile("^((?:" + DAY + "\\s*,?\\s*)+)\\s*(.*)$");
    private static final Pattern ONLY_DAYS = Pattern.compile("^(?:" + DAY + "\\s*,?\\s*)+$");
    private static final Pattern SPAN = Pattern.compile("^(\\d{1,2}):(\\d{2})\\s*-\\s*(\\d{1,2}):(\\d{2})$");

    static Hours parse(String input) {
        String str = input == null ? "" : input.trim();
        if (str.isEmpty()) return null;
        Hours h = new Hours();
        if (str.equals("24/7")) { h.always = true; return h; }
        // Vejica pred novim naborom dni loči pravila ("Mo-Fr 07:00-20:00, Sa 07:00-13:00").
        String normalized = str.replaceAll("\\s*,\\s*(?=" + DAY + "\\s+(?:\\d|off|closed))", ";");
        String[] raw = normalized.split(";");
        List<String> rules = new ArrayList<>();
        String carry = null;
        for (int q = 0; q < raw.length; q++) {
            String part = raw[q].trim();
            String piece = carry != null ? carry + "," + part : part;
            carry = null;
            if (q + 1 < raw.length && ONLY_DAYS.matcher(piece).matches()) carry = piece;
            else rules.add(piece);
        }
        boolean ok = false;
        for (String rule : rules) {
            String sel, times;
            Matcher m = RULE.matcher(rule);
            if (m.matches()) { sel = m.group(1); times = m.group(2).trim(); }
            else if (!rule.isEmpty() && Character.isDigit(rule.charAt(0))) { sel = "Mo-Su"; times = rule; }
            else continue;
            List<int[]> spans = new ArrayList<>();
            if (!times.equalsIgnoreCase("off") && !times.equalsIgnoreCase("closed")) {
                boolean valid = true;
                for (String p : times.split(",")) {
                    Matcher s = SPAN.matcher(p.trim());
                    if (!s.matches()) { valid = false; break; }
                    spans.add(new int[]{Integer.parseInt(s.group(1)) * 60 + Integer.parseInt(s.group(2)),
                                        Integer.parseInt(s.group(3)) * 60 + Integer.parseInt(s.group(4))});
                }
                if (!valid) continue;
            }
            ok = true;
            for (String tokRaw : sel.split(",")) {
                String tok = tokRaw.trim();
                if (tok.isEmpty()) continue;
                if (tok.equals("PH")) { h.ph = spans; continue; }
                String[] ab = tok.split("-");
                int a = DAYS.indexOf(ab[0]);
                if (a < 0) continue;
                int b = ab.length > 1 ? DAYS.indexOf(ab[1]) : a;
                if (b < 0) continue;
                int d = a;
                for (int n = 0; n < 7; n++) { h.days.put(d, spans); if (d == b) break; d = (d + 1) % 7; }
            }
        }
        return ok ? h : null;
    }

    // TRUE = odprto, FALSE = zaprto, null = urnik ni znan (takrat raje obvestimo).
    static Boolean isOpen(String hours, String chain, Calendar now) {
        String src = hours == null || hours.isEmpty() ? (chain != null ? CHAIN_DEFAULT_HOURS : "") : hours;
        Hours h = parse(src);
        if (h == null) return null;
        if (h.always) return true;
        boolean holiday = isHoliday(now);
        int dow = now.get(Calendar.DAY_OF_WEEK) - 1;
        List<int[]> spans;
        if (holiday && h.ph != null) spans = h.ph;
        else if (holiday && chain != null) spans = new ArrayList<>();
        else spans = h.days.containsKey(dow) ? h.days.get(dow) : new ArrayList<>();
        int mins = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE);
        for (int[] s : spans) {
            int end = s[1] <= s[0] ? s[1] + 1440 : s[1];
            if (mins >= s[0] && mins < end) return true;
        }
        return false;
    }

    static Boolean isOpen(String hours, String chain) { return isOpen(hours, chain, Calendar.getInstance()); }
}
