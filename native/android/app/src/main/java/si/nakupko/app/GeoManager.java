package si.nakupko.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingClient;
import com.google.android.gms.location.GeofencingRequest;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

// Nakupko: zaznavanje trgovin tudi, ko je aplikacija zaprta (Android različica NakupkoGeo.swift).
//
// Android spremlja geofence območja najbližjih trgovin in eno večje »domače« območje
// okoli zadnje lokacije. Ko ga zapustiš, izbere nove trgovine in jih po potrebi sam naloži
// iz OpenStreetMap. Ob vstopu v trgovino pošlje obvestilo z izdelki, ki so še na seznamu.
final class GeoManager {
    interface Listener {
        void onPosition(Location loc);
        void onError(int code, String message);
    }

    static final String ACTION_GEOFENCE = "si.nakupko.app.GEOFENCE";
    static final String EXTRA_STORE = "nakupko.storeId";
    private static final String STORE_PREFIX = "store:";
    private static final String HOME_ID = "home";
    private static final int MAX_STORE_REGIONS = 60;
    private static final float HOME_RADIUS = 1500;
    private static final float REFETCH_DISTANCE = 2500;
    private static final long RENOTIFY_AFTER = 45 * 60 * 1000L;
    // Toliko časa moraš biti do ~100 m od trgovine, preden pride obvestilo.
    private static final int STORE_DWELL_MS = 45 * 1000;
    private static final String CH_STORE = "store";
    private static final String CH_SHOP = "shopping";
    private static final int SHOP_NOTIFICATION = 7001;

    private static GeoManager instance;

    static synchronized GeoManager get(Context ctx) {
        if (instance == null) instance = new GeoManager(ctx.getApplicationContext());
        return instance;
    }

    private final Context ctx;
    private final SharedPreferences prefs;
    private final FusedLocationProviderClient fused;
    private final GeofencingClient geofencing;
    private final Handler main = new Handler(Looper.getMainLooper());
    private Listener listener;
    private boolean watching;
    private volatile boolean fetching;
    private Location shoppingFrom;
    volatile boolean foreground;
    volatile String pendingStoreId;

    private final LocationCallback callback = new LocationCallback() {
        @Override public void onLocationResult(LocationResult result) {
            Location loc = result.getLastLocation();
            if (loc != null) onLocation(loc);
        }
    };

    private GeoManager(Context ctx) {
        this.ctx = ctx;
        prefs = ctx.getSharedPreferences("nakupko.geo", Context.MODE_PRIVATE);
        fused = LocationServices.getFusedLocationProviderClient(ctx);
        geofencing = LocationServices.getGeofencingClient(ctx);
        createChannels();
    }

    void setListener(Listener l) { listener = l; }

    // ---------- Dovoljenja ----------
    boolean hasLocation() {
        return granted(Manifest.permission.ACCESS_FINE_LOCATION) || granted(Manifest.permission.ACCESS_COARSE_LOCATION);
    }

    boolean hasBackground() {
        return Build.VERSION.SDK_INT < 29 || granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION);
    }

    boolean hasNotifications() {
        return Build.VERSION.SDK_INT < 33 || granted(Manifest.permission.POST_NOTIFICATIONS);
    }

    private boolean granted(String p) {
        return ContextCompat.checkSelfPermission(ctx, p) == PackageManager.PERMISSION_GRANTED;
    }

    // ---------- Shranjene nastavitve ----------
    boolean enabled() { return prefs.getBoolean("enabled", false); }

    private float radius() { return Math.max(prefs.getFloat("radius", 75), 75); }

    private JSONArray json(String key) {
        try { return new JSONArray(prefs.getString(key, "[]")); } catch (Exception e) { return new JSONArray(); }
    }

    private Location lastFetch() {
        if (!prefs.contains("fetchLat")) return null;
        Location l = new Location("saved");
        l.setLatitude(Double.longBitsToDouble(prefs.getLong("fetchLat", 0)));
        l.setLongitude(Double.longBitsToDouble(prefs.getLong("fetchLon", 0)));
        return l;
    }

    private void setLastFetch(Location l) {
        prefs.edit().putLong("fetchLat", Double.doubleToLongBits(l.getLatitude()))
            .putLong("fetchLon", Double.doubleToLongBits(l.getLongitude())).apply();
    }

    void configure(boolean on, float r, JSONArray stores, JSONArray groups, String hhUrl, String hhCode) {
        SharedPreferences.Editor e = prefs.edit().putFloat("radius", r).putString("groups", groups.toString()).putBoolean("enabled", on)
            .putString("hhUrl", hhUrl == null ? "" : hhUrl).putString("hhCode", hhCode == null ? "" : hhCode);
        e.apply();
        if (stores.length() > 0) {
            prefs.edit().putString("stores", stores.toString()).apply();
            if (lastFetch() == null) withLastLocation(loc -> { if (loc != null) setLastFetch(loc); });
        }
        refresh();
    }

    // Ponovno nastavi območja (ob zagonu, po vrnitvi v aplikacijo, po ponovnem zagonu telefona).
    void refresh() {
        if (!enabled()) { stopBackground(); return; }
        withLastLocation(loc -> {
            if (loc == null) loc = lastFetch();
            if (loc != null) refreshRegions(loc, null);
        });
    }

    JSONObject status() {
        JSONObject o = new JSONObject();
        try {
            o.put("enabled", enabled());
            o.put("authorization", !hasLocation() ? "notDetermined" : hasBackground() ? "always" : "whenInUse");
            o.put("precise", granted(Manifest.permission.ACCESS_FINE_LOCATION));
            o.put("notifications", hasNotifications());
            o.put("regions", enabled() && hasBackground() ? prefs.getInt("regions", 0) : 0);
            o.put("stores", json("stores").length());
        } catch (Exception ignored) {}
        return o;
    }

    interface LocCb { void got(Location loc); }

    @SuppressLint("MissingPermission")
    private void withLastLocation(LocCb cb) {
        if (!hasLocation()) { cb.got(null); return; }
        fused.getLastLocation().addOnCompleteListener(t -> cb.got(t.isSuccessful() ? t.getResult() : null));
    }

    // ---------- Sledenje, ko je aplikacija odprta ----------
    @SuppressLint("MissingPermission")
    void startWatch() {
        if (!hasLocation()) {
            if (listener != null) listener.onError(1, "Dostop do lokacije je zavrnjen.");
            return;
        }
        if (watching) return;
        watching = true;
        LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 3000)
            .setMinUpdateIntervalMillis(1000).setMinUpdateDistanceMeters(5).build();
        fused.requestLocationUpdates(req, callback, Looper.getMainLooper());
        fused.getLastLocation().addOnSuccessListener(loc -> { if (loc != null && watching) onLocation(loc); });
    }

    void stopWatch() {
        watching = false;
        fused.removeLocationUpdates(callback);
    }

    private void onLocation(Location loc) {
        if (watching && listener != null) listener.onPosition(loc);
        // Ko odideš iz trgovine, seznam iz vrstice z obvestili umaknemo.
        if (shoppingFrom != null && loc.distanceTo(shoppingFrom) > 800) shopping(false, "", new JSONArray(), 0, 0, false);
        if (!enabled()) return;
        Location home = homeCenter();
        if (home == null || loc.distanceTo(home) > HOME_RADIUS * 0.6f) refreshRegions(loc, null);
    }

    private Location homeCenter() {
        if (!prefs.contains("homeLat")) return null;
        Location l = new Location("home");
        l.setLatitude(Double.longBitsToDouble(prefs.getLong("homeLat", 0)));
        l.setLongitude(Double.longBitsToDouble(prefs.getLong("homeLon", 0)));
        return l;
    }

    // ---------- Spremljanje v ozadju ----------
    private PendingIntent geofenceIntent() {
        Intent i = new Intent(ctx, GeofenceReceiver.class).setAction(ACTION_GEOFENCE);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
        return PendingIntent.getBroadcast(ctx, 0, i, flags);
    }

    void stopBackground() {
        geofencing.removeGeofences(geofenceIntent());
        prefs.edit().remove("homeLat").remove("homeLon").apply();
    }

    // done se pokliče, ko je delo (tudi nalaganje trgovin) končano – za sprejemnik v ozadju.
    @SuppressLint("MissingPermission")
    void refreshRegions(Location loc, Runnable done) {
        if (!enabled() || !hasLocation() || !hasBackground()) { if (done != null) done.run(); return; }
        // Android geofence je natančen na ~100 m, zato manjši polmer ne pomaga.
        float r = Math.min(Math.max(radius(), 100), 300);
        JSONArray stores = json("stores");
        List<Object[]> near = new ArrayList<>();
        for (int i = 0; i < stores.length(); i++) {
            JSONObject s = stores.optJSONObject(i);
            if (s == null) continue;
            float[] d = new float[1];
            Location.distanceBetween(loc.getLatitude(), loc.getLongitude(), s.optDouble("lat"), s.optDouble("lon"), d);
            if (d[0] < 8000) near.add(new Object[]{s, d[0]});
        }
        near.sort((a, b) -> Float.compare((float) a[1], (float) b[1]));
        List<Geofence> fences = new ArrayList<>();
        for (int i = 0; i < near.size() && i < MAX_STORE_REGIONS; i++) {
            JSONObject s = (JSONObject) near.get(i)[0];
            fences.add(new Geofence.Builder().setRequestId(STORE_PREFIX + s.optString("id"))
                .setCircularRegion(s.optDouble("lat"), s.optDouble("lon"), r)
                .setExpirationDuration(Geofence.NEVER_EXPIRE)
                // Obvestilo šele, ko se pri trgovini zadržiš (ne v mimovožnji ali na robu območja).
                .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_DWELL)
                .setLoiteringDelay(STORE_DWELL_MS)
                .setNotificationResponsiveness(30000).build());
        }
        fences.add(new Geofence.Builder().setRequestId(HOME_ID)
            .setCircularRegion(loc.getLatitude(), loc.getLongitude(), HOME_RADIUS)
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_EXIT).build());
        prefs.edit().putInt("regions", fences.size() - 1).putLong("homeLat", Double.doubleToLongBits(loc.getLatitude()))
            .putLong("homeLon", Double.doubleToLongBits(loc.getLongitude())).apply();
        GeofencingRequest req = new GeofencingRequest.Builder().setInitialTrigger(0).addGeofences(fences).build();
        PendingIntent pi = geofenceIntent();
        geofencing.removeGeofences(pi).addOnCompleteListener(t -> {
            try { geofencing.addGeofences(req, pi); } catch (SecurityException ignored) {}
        });

        Location last = lastFetch();
        if (last == null || loc.distanceTo(last) > REFETCH_DISTANCE) fetchStores(loc, done);
        else if (done != null) done.run();
    }

    // Trgovine iz OpenStreetMap (isto kot spletna aplikacija), da deluje tudi na poti.
    private void fetchStores(Location loc, Runnable done) {
        if (fetching) { if (done != null) done.run(); return; }
        fetching = true;
        new Thread(() -> {
            JSONArray list = new JSONArray();
            try {
                String q = String.format(Locale.US, "[out:json][timeout:20];(nwr[\"shop\"~\"^(supermarket|convenience|grocery|discount|greengrocer|department_store|chemist)$\"](around:5000,%f,%f););out center tags 150;",
                    loc.getLatitude(), loc.getLongitude());
                HttpURLConnection c = (HttpURLConnection) new URL("https://overpass-api.de/api/interpreter").openConnection();
                c.setRequestMethod("POST");
                c.setConnectTimeout(10000);
                c.setReadTimeout(25000);
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
                try (OutputStream os = c.getOutputStream()) {
                    os.write(("data=" + URLEncoder.encode(q, "UTF-8")).getBytes(StandardCharsets.UTF_8));
                }
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                try (InputStream in = c.getInputStream()) {
                    byte[] b = new byte[8192];
                    int n;
                    while ((n = in.read(b)) > 0) buf.write(b, 0, n);
                }
                JSONArray els = new JSONObject(buf.toString("UTF-8")).optJSONArray("elements");
                for (int i = 0; els != null && i < els.length(); i++) {
                    JSONObject e = els.getJSONObject(i);
                    JSONObject tags = e.optJSONObject("tags");
                    if (tags == null) tags = new JSONObject();
                    JSONObject center = e.optJSONObject("center");
                    double lat = e.has("lat") ? e.getDouble("lat") : center != null ? center.optDouble("lat", Double.NaN) : Double.NaN;
                    double lon = e.has("lon") ? e.getDouble("lon") : center != null ? center.optDouble("lon", Double.NaN) : Double.NaN;
                    if (Double.isNaN(lat) || Double.isNaN(lon)) continue;
                    String hours = tags.optString("opening_hours", "");
                    String text = (tags.optString("brand", "") + " " + tags.optString("name", "") + " " + tags.optString("operator", "")).trim();
                    // Samo verige in dežurne trgovine, kot v aplikaciji.
                    StoreRules.Kind kind = StoreRules.kind(text, hours);
                    if (kind == null) continue;
                    String name = tags.optString("name", tags.optString("brand", tags.optString("operator", "Trgovina")));
                    JSONObject s = new JSONObject();
                    s.put("id", e.optString("type", "n") + "/" + e.optLong("id"));
                    s.put("name", name);
                    s.put("lat", lat);
                    s.put("lon", lon);
                    if (kind.chain != null) s.put("chain", kind.chain);
                    if (kind.chain != null && StoreRules.ONLY.containsKey(kind.chain)) s.put("only", StoreRules.ONLY.get(kind.chain));
                    s.put("duty", kind.duty);
                    s.put("hours", hours);
                    list.put(s);
                }
            } catch (Exception ignored) {}
            final JSONArray result = list;
            main.post(() -> {
                fetching = false;
                if (result.length() > 0) {
                    prefs.edit().putString("stores", result.toString()).apply();
                    setLastFetch(loc);
                    refreshRegions(loc, done);
                } else if (done != null) done.run();
            });
        }).start();
    }

    // ---------- Vstop v trgovino ----------
    // Skupen seznam (household.js): ob prihodu v trgovino preberemo najnovejši seznam s strežnika.
    // done se pokliče, ko je obvestilo poslano (za sprejemnik v ozadju).
    void onEnteredStore(String requestId, Runnable done) {
        if (!requestId.startsWith(STORE_PREFIX) || !enabled()) { done.run(); return; }
        String url = prefs.getString("hhUrl", ""), code = prefs.getString("hhCode", "");
        if (url.isEmpty() || code.isEmpty()) { showStoreNotification(requestId, json("groups")); done.run(); return; }
        new Thread(() -> {
            JSONArray open = null;
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url + "/h/" + URLEncoder.encode(code, "UTF-8") + "/items.json").openConnection();
                c.setConnectTimeout(6000);
                c.setReadTimeout(6000);
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                try (InputStream in = c.getInputStream()) {
                    byte[] b = new byte[8192];
                    int n;
                    while ((n = in.read(b)) > 0) buf.write(b, 0, n);
                }
                String body = buf.toString("UTF-8").trim();
                if (body.equals("null")) open = new JSONArray();
                else {
                    JSONObject obj = new JSONObject(body);
                    List<JSONObject> items = new ArrayList<>();
                    for (Iterator<String> it = obj.keys(); it.hasNext(); ) {
                        JSONObject i = obj.optJSONObject(it.next());
                        if (i != null) items.add(i);
                    }
                    open = groupsOf(items);
                }
            } catch (Exception ignored) {}
            final JSONArray result = open;
            main.post(() -> {
                if (result != null) prefs.edit().putString("groups", result.toString()).apply();
                showStoreNotification(requestId, result != null ? result : json("groups"));
                done.run();
            });
        }).start();
    }

    private static final String[][] CATS = {
        {"Sadje in zelenjava", "🥦"}, {"Kruh in pecivo", "🥖"}, {"Mlečni izdelki", "🥛"}, {"Meso in ribe", "🥩"},
        {"Shramba", "🥫"}, {"Brez glutena", "🌾"}, {"Prigrizki", "🍫"}, {"Pijače", "🥤"}, {"Zamrznjeno", "🧊"},
        {"Otroci", "🍼"}, {"Gospodinjstvo", "🧽"}, {"Higiena", "🧴"}, {"Zdravje", "💊"}, {"Tobak", "🚬"},
        {"Ljubljenčki", "🐾"}, {"Drugo", "🛒"}
    };

    // Enako kot groupsOf() v native.js: odprti izdelki po oddelkih.
    static JSONArray groupsOf(List<JSONObject> items) {
        java.util.Map<String, List<JSONObject>> by = new java.util.HashMap<>();
        for (JSONObject i : items) {
            if (i.optBoolean("done", false)) continue;
            String name = i.optString("name", "");
            if (name.isEmpty()) continue;
            String c = i.optString("cat", "Drugo");
            boolean known = false;
            for (String[] k : CATS) if (k[0].equals(c)) known = true;
            if (!known) c = "Drugo";
            if (!by.containsKey(c)) by.put(c, new ArrayList<>());
            by.get(c).add(i);
        }
        java.text.Collator sl = java.text.Collator.getInstance(new Locale("sl"));
        JSONArray out = new JSONArray();
        for (String[] k : CATS) {
            List<JSONObject> list = by.get(k[0]);
            if (list == null) continue;
            list.sort((a, b) -> sl.compare(a.optString("name"), b.optString("name")));
            JSONArray labels = new JSONArray();
            for (JSONObject i : list) {
                int qty = i.optInt("qty", 1);
                String brand = i.optString("brand", "");
                labels.put((qty > 1 ? qty + "× " : "") + i.optString("name") + (brand.isEmpty() ? "" : " (" + brand + ")"));
            }
            try { out.put(new JSONObject().put("icon", k[1]).put("name", k[0]).put("items", labels)); } catch (Exception ignored) {}
        }
        return out;
    }

    private void showStoreNotification(String requestId, JSONArray groups) {
        if (!enabled()) return;
        String id = requestId.substring(STORE_PREFIX.length());
        JSONObject store = null;
        JSONArray stores = json("stores");
        for (int i = 0; i < stores.length(); i++) {
            JSONObject s = stores.optJSONObject(i);
            if (s != null && id.equals(s.optString("id"))) { store = s; break; }
        }
        if (store == null) return;
        int count = 0;
        StringBuilder body = new StringBuilder();
        for (int i = 0; i < groups.length(); i++) {
            JSONObject g = groups.optJSONObject(i);
            JSONArray items = g == null ? null : g.optJSONArray("items");
            if (items == null || items.length() == 0) continue;
            // Samo izdelki, ki jih ta trgovina prodaja (npr. v dm samo drogerija).
            List<String> sold = new ArrayList<>();
            for (int k = 0; k < items.length(); k++) if (StoreRules.sells(store.optString("only", ""), g.optString("name", "") + " " + items.optString(k))) sold.add(items.optString(k));
            if (sold.isEmpty()) continue;
            count += sold.size();
            if (body.length() > 0) body.append('\n');
            body.append(g.optString("icon", "🛒")).append(' ');
            for (int k = 0; k < sold.size(); k++) body.append(k > 0 ? ", " : "").append(sold.get(k));
        }
        if (count == 0 || foreground) return; // odprta aplikacija to pokaže sama
        // Zaprta trgovina (npr. ob 6h pred Sparom, ki odpre ob 7:30): brez obvestila.
        String chain = store.has("chain") && !store.isNull("chain") ? store.optString("chain") : null;
        if (Boolean.FALSE.equals(StoreRules.isOpen(store.optString("hours", ""), chain))) return;
        long now = System.currentTimeMillis();
        JSONObject sent;
        try { sent = new JSONObject(prefs.getString("notified", "{}")); } catch (Exception e) { sent = new JSONObject(); }
        if (now - sent.optLong(id, 0) < RENOTIFY_AFTER) return;
        for (Iterator<String> it = sent.keys(); it.hasNext(); ) if (now - sent.optLong(it.next(), 0) > 24 * 3600 * 1000L) it.remove();
        try { sent.put(id, now); } catch (Exception ignored) {}
        prefs.edit().putString("notified", sent.toString()).apply();

        String word = count == 1 ? "izdelek" : count == 2 ? "izdelka" : count < 5 ? "izdelki" : "izdelkov";
        String title = "🛒 " + store.optString("name", "Trgovina") + " · " + count + " " + word;
        NotificationCompat.Builder n = new NotificationCompat.Builder(ctx, CH_STORE)
            .setSmallIcon(R.drawable.ic_stat_nakupko)
            .setColor(0xFF8A3FFC)
            .setContentTitle(title)
            .setContentText(body.toString().replace('\n', ' '))
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body.toString()))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(openApp(id));
        post(id.hashCode(), n);
    }

    private PendingIntent openApp(String storeId) {
        Intent i = new Intent(ctx, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (storeId != null) i.putExtra(EXTRA_STORE, storeId);
        int code = storeId == null ? 0 : storeId.hashCode();
        return PendingIntent.getActivity(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    @SuppressLint("MissingPermission")
    private void post(int id, NotificationCompat.Builder n) {
        if (!hasNotifications()) return;
        try { NotificationManagerCompat.from(ctx).notify(id, n.build()); } catch (SecurityException ignored) {}
    }

    // ---------- Seznam med nakupovanjem (stalno obvestilo, kot Live Activity na iPhonu) ----------
    // updateOnly: aplikacija ni v načinu »V trgovini« – obstoječi seznam samo osvežimo, nikoli ga ne odpremo ali zapremo.
    private boolean shopShowing = false;
    private String shopStore = "Nakupovanje";
    private int shopDone = 0, shopTotal = 0;
    void shopping(boolean active, String store, JSONArray groups, int done, int total, boolean updateOnly) {
        if (!active) {
            shoppingFrom = null;
            shopShowing = false;
            NotificationManagerCompat.from(ctx).cancel(SHOP_NOTIFICATION);
            return;
        }
        if (updateOnly) {
            if (!shopShowing) return;
            int open = total;
            // Kar je izginilo s seznama, je kupljeno; novi izdelki povečajo skupno število.
            done = shopDone + Math.max(0, (shopTotal - shopDone) - open);
            total = done + open;
            store = shopStore;
        }
        shopShowing = true;
        shopStore = store;
        shopDone = done;
        shopTotal = total;
        if (shoppingFrom == null) withLastLocation(loc -> { if (loc != null) shoppingFrom = loc; });
        StringBuilder body = new StringBuilder();
        for (int i = 0; i < groups.length(); i++) {
            JSONObject g = groups.optJSONObject(i);
            JSONArray items = g == null ? null : g.optJSONArray("items");
            if (items == null || items.length() == 0) continue;
            if (body.length() > 0) body.append('\n');
            body.append(g.optString("icon", "🛒")).append(' ');
            for (int k = 0; k < items.length(); k++) body.append(k > 0 ? ", " : "").append(items.optString(k));
        }
        String left = body.length() == 0 ? "Vse je v košarici ✓" : body.toString();
        NotificationCompat.Builder n = new NotificationCompat.Builder(ctx, CH_SHOP)
            .setSmallIcon(R.drawable.ic_stat_nakupko)
            .setColor(0xFF8A3FFC)
            .setContentTitle("🛒 " + store + " · " + done + "/" + total)
            .setContentText(left.replace('\n', ' '))
            .setStyle(new NotificationCompat.BigTextStyle().bigText(left))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setProgress(Math.max(total, 1), done, false)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openApp(null));
        post(SHOP_NOTIFICATION, n);
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        NotificationChannel store = new NotificationChannel(CH_STORE, "Si v trgovini", NotificationManager.IMPORTANCE_HIGH);
        store.setDescription("Obvestilo s seznamom, ko prideš v trgovino.");
        NotificationChannel shop = new NotificationChannel(CH_SHOP, "Seznam med nakupovanjem", NotificationManager.IMPORTANCE_LOW);
        shop.setDescription("Preostali izdelki, dokler nakupuješ.");
        shop.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(store);
        nm.createNotificationChannel(shop);
    }
}
