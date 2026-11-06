package si.nakupko.app;

import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import androidx.core.app.NotificationCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

// Obvestila skupnega seznama prek Firebase Cloud Messaging (partner je dodal na seznam, »Rabiš kaj?«, prošnja za pridružitev).
// Ko je aplikacija v ozadju, obvestilo prikaže sistem sam (privzeti kanal in ikona v AndroidManifest.xml);
// ko je odprta, ga prikažemo tukaj, da se vseeno vidi.
public class NakupkoPushService extends FirebaseMessagingService {
    @Override
    public void onNewToken(String token) {
        GeoManager.get(this).setPushToken(token);
    }

    @Override
    public void onMessageReceived(RemoteMessage msg) {
        RemoteMessage.Notification n = msg.getNotification();
        String title = n != null ? n.getTitle() : msg.getData().get("title");
        String body = n != null ? n.getBody() : msg.getData().get("body");
        if (title == null && body == null) return;
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 7400, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, GeoManager.CH_HOUSEHOLD)
            .setSmallIcon(R.drawable.ic_stat_nakupko)
            .setColor(0xFF8A3FFC)
            .setContentTitle(title == null ? "Nakupko" : title)
            .setContentText(body == null ? "" : body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body == null ? "" : body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pi);
        try {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.notify((int) (System.currentTimeMillis() % 100000) + 20000, b.build());
        } catch (SecurityException ignored) {}
    }
}
