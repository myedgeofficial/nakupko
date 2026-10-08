package si.nakupko.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NakupkoGeoPlugin.class);
        super.onCreate(savedInstanceState);
        takeStore(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        takeStore(intent);
    }

    // Tap na obvestilo »Si v trgovini«: native.js nato takoj odpre nakupovanje.
    private void takeStore(Intent intent) {
        String id = intent == null ? null : intent.getStringExtra(GeoManager.EXTRA_STORE);
        if (id != null) GeoManager.get(this).pendingStoreId = id;
    }
}
