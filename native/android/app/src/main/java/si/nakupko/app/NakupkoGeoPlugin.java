package si.nakupko.app;

import android.Manifest;
import android.location.Location;
import android.os.Build;
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
import java.util.ArrayList;
import java.util.List;
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
    private boolean askedExtra;

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
        geo.refresh();
    }

    @Override
    protected void handleOnPause() {
        geo.foreground = false;
    }

    // Za obvestila v ozadju: obvestila (Android 13+) in lokacija »Vedno dovoli« (Android 10+).
    // Android dovoli le eno vprašanje naenkrat, zato drugo pride ob naslednji vrnitvi v aplikacijo.
    private void askExtraPermissions() {
        if (!geo.enabled() || !geo.hasLocation() || getActivity() == null) return;
        List<String> ask = new ArrayList<>();
        if (!geo.hasNotifications() && Build.VERSION.SDK_INT >= 33) ask.add(Manifest.permission.POST_NOTIFICATIONS);
        else if (!geo.hasBackground() && Build.VERSION.SDK_INT >= 29 && !askedExtra) {
            askedExtra = true;
            ask.add(Manifest.permission.ACCESS_BACKGROUND_LOCATION);
        }
        if (!ask.isEmpty()) ActivityCompat.requestPermissions(getActivity(), ask.toArray(new String[0]), 7010);
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
        geo.configure(Boolean.TRUE.equals(call.getBoolean("enabled", false)), call.getFloat("radius", 75f), stores, groups);
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
            groups, call.getInt("done", 0), call.getInt("total", 0));
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
