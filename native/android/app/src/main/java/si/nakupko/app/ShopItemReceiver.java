package si.nakupko.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

// Tap na izdelek v seznamu na zaklenjenem zaslonu: izdelek je kupljen.
public class ShopItemReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!GeoManager.ACTION_ITEM_DONE.equals(intent.getAction())) return;
        String id = intent.getStringExtra(GeoManager.EXTRA_ITEM);
        if (id != null && !id.isEmpty()) GeoManager.get(context).markDone(id);
    }
}
