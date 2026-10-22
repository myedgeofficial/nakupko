package si.nakupko.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NakupkoGeoPlugin.class);
        registerPlugin(NakupkoPayPlugin.class);
        super.onCreate(savedInstanceState);
        takeStore(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        takeStore(intent);
    }

    // Tap na obvestilo »Si v trgovini«: native.js nato takoj odpre nakupovanje.
    // Seznam s spletne strani (nakupko://dodaj?i=Mleko|Kruh): native.js doda izdelke na seznam.
    private void takeStore(Intent intent) {
        if (intent == null) return;
        Uri data = intent.getData();
        if (data != null && "nakupko".equals(data.getScheme()) && "dodaj".equals(data.getHost())) {
            String items = data.getQueryParameter("i");
            if (items != null && !items.isEmpty()) GeoManager.get(this).pendingStoreId = "import:" + items;
            return;
        }
        // QR »Poveži s telefonom« na nakupko.com (nakupko://povezi?k=PARKODA): splet dobi isti seznam.
        if (data != null && "nakupko".equals(data.getScheme()) && "povezi".equals(data.getHost())) {
            String k = data.getQueryParameter("k");
            if (k != null && !k.isEmpty()) GeoManager.get(this).pendingStoreId = "povezi:" + k;
            return;
        }
        String id = intent.getStringExtra(GeoManager.EXTRA_STORE);
        if (id != null) GeoManager.get(this).pendingStoreId = id;
    }
}
