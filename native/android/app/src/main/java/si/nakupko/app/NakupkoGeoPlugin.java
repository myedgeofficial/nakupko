package si.nakupko.app;

import android.Manifest;
import android.content.Intent;
import android.location.Location;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;
import androidx.core.app.ActivityCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import org.json.JSONArray;

// Most do spletnega dela (native.js) – enak vmesnik kot NakupkoGeo na iPhonu.
@CapacitorPlugin(
    name = "NakupkoGeo",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION })
    }
)
public class NakupkoGeoPlugin extends Plugin {
    private GeoManager geo;
    private boolean askedExtra, askedNotifications;

    @Override
    public void load() {
        geo = GeoManager.get(getContext());
        geo.foreground = true;
        geo.setListener(new GeoManager.Listener() {
            @Override public void onPosition(Location loc) {
                JSObject d = new JSObject();
                d.put("lat", loc.getLatitude());
                d.put("lon", loc.getLongitude());
                d.put("acc", loc.getAccuracy());
                d.put("time", loc.getTime());
                notifyListeners("position", d);
            }
            @Override public void onError(int code, String message) {
                JSObject d = new JSObject();
                d.put("code", code);
                d.put("message", message);
                notifyListeners("locationError", d);
            }
        });
        geo.refresh();
    }

    @Override
    protected void handleOnResume() {
        geo.foreground = true;
        askExtraPermissions();
        geo.repostShopping();
        geo.refresh();
    }

    @Override
    protected void handleOnPause() {
        geo.foreground = false;
    }

    // Za delovanje v ozadju: najprej lokacija »Vedno dovoli« (Android 10+), nato obvestila (Android 13+).
    // Android dovoli le eno vprašanje naenkrat, zato drugo pride, ko se uporabnik vrne v aplikacijo.
    // Lokacijo »Vedno« vprašamo ob vsakem zagonu aplikacije, dokler je ni.
    private void askExtraPermissions() {
        if (getActivity() == null) return;
        // Seznam na zaklenjenem zaslonu potrebuje obvestila tudi brez zaznavanja trgovin.
        if (!geo.enabled() || !geo.hasLocation()) {
            if (geo.shopShowing()) askNotifications();
            return;
        }
        if (!geo.hasBackground() && Build.VERSION.SDK_INT >= 29) {
            if (askedExtra) return;
            askedExtra = true;
            // Android 11+ odpre stran z dovoljenji, kjer mora uporabnik sam izbrati »Vedno dovoli«.
            Toast.makeText(getContext(), "Izberi »Vedno dovoli«, da te Nakupko opozori v trgovini.", Toast.LENGTH_LONG).show();
            ActivityCompat.requestPermissions(getActivity(), new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, 7010);
            return;
        }
        askNotifications();
    }

    private void askNotifications() {
        if (!geo.hasNotifications() && Build.VERSION.SDK_INT >= 33 && !askedNotifications && getActivity() != null) {
            askedNotifications = true;
            ActivityCompat.requestPermissions(getActivity(), new String[]{Manifest.permission.POST_NOTIFICATIONS}, 7011);
        }
    }

    @PluginMethod
    public void requestAlways(PluginCall call) {
        askedExtra = false;
        getActivity().runOnUiThread(this::askExtraPermissions);
        call.resolve();
    }

    // Velikost prikaza (Mlajši / Srednja leta / Starejši): povečamo celo stran, kot na iPhonu.
    @PluginMethod
    public void setZoom(PluginCall call) {
        double z = call.getDouble("zoom", 1.0);
        String js = "document.documentElement.style.zoom='" + (z == 1.0 ? "" : String.valueOf(z)) + "'";
        getActivity().runOnUiThread(() -> getBridge().getWebView().evaluateJavascript(js, null));
        call.resolve();
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", getContext().getPackageName(), null));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @PluginMethod
    public void startWatch(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "locationPermission");
            return;
        }
        geo.startWatch();
        call.resolve();
    }

    @PermissionCallback
    private void locationPermission(PluginCall call) {
        geo.startWatch(); // brez dovoljenja javi napako »zavrnjeno«
        if (geo.hasLocation()) askExtraPermissions();
        call.resolve();
    }

    @PluginMethod
    public void stopWatch(PluginCall call) {
        geo.stopWatch();
        call.resolve();
    }

    @PluginMethod
    public void setConfig(PluginCall call) {
        boolean wasOn = geo.enabled();
        JSArray stores = call.getArray("stores", new JSArray());
        JSArray groups = call.getArray("groups", new JSArray());
        JSObject hh = call.getObject("household", null);
        String hhUrl = hh == null ? null : hh.optString("url", null);
        String hhCode = hh == null ? null : hh.optString("code", null);
        geo.configure(Boolean.TRUE.equals(call.getBoolean("enabled", false)), call.getFloat("radius", 75f), stores, groups, hhUrl, hhCode);
        if (!wasOn && geo.enabled()) askExtraPermissions();
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        try { call.resolve(JSObject.fromJSONObject(geo.status())); } catch (Exception e) { call.resolve(); }
    }

    @PluginMethod
    public void shopping(PluginCall call) {
        JSONArray groups = call.getArray("groups", new JSArray());
        geo.shopping(Boolean.TRUE.equals(call.getBoolean("active", false)), call.getString("store", "Nakupovanje"),
            groups, call.getInt("done", 0), call.getInt("total", 0), Boolean.TRUE.equals(call.getBoolean("updateOnly", false)));
        if (geo.shopShowing() && getActivity() != null) getActivity().runOnUiThread(this::askNotifications);
        call.resolve();
    }

    @PluginMethod
    public void takePendingStore(PluginCall call) {
        String id = geo.pendingStoreId;
        geo.pendingStoreId = null;
        JSObject r = new JSObject();
        r.put("storeId", id == null ? "" : id);
        call.resolve(r);
    }
}
