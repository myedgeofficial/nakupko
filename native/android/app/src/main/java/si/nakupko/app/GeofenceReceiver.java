package si.nakupko.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingEvent;

// Android zbudi aplikacijo ob vstopu v trgovino, ob odhodu z »domačega« območja
// in po ponovnem zagonu telefona (takrat geofence območja izginejo).
public class GeofenceReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        GeoManager geo = GeoManager.get(context);
        String action = intent.getAction();
        if (!GeoManager.ACTION_GEOFENCE.equals(action)) {
            geo.refresh();
            return;
        }
        GeofencingEvent event = GeofencingEvent.fromIntent(intent);
        if (event == null || event.hasError() || event.getTriggeringGeofences() == null) return;
        if (event.getGeofenceTransition() == Geofence.GEOFENCE_TRANSITION_ENTER) {
            for (Geofence g : event.getTriggeringGeofences()) geo.onEnteredStore(g.getRequestId());
            return;
        }
        Location loc = event.getTriggeringLocation();
        if (event.getGeofenceTransition() != Geofence.GEOFENCE_TRANSITION_EXIT || loc == null) return;
        // Novo območje in po potrebi nove trgovine; počakamo, da se nalaganje konča.
        PendingResult pending = goAsync();
        geo.refreshRegions(loc, pending::finish);
    }
}
