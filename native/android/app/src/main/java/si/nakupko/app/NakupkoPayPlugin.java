package si.nakupko.app;

import android.content.Intent;
import android.net.Uri;
import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

// Nakupko Plus prek Google Play (enak vmesnik kot NakupkoPay.swift na iPhonu):
// status, buy, restore, manage in dogodek »change«. Deluje le, ko je aplikacija nameščena iz Google Play.
@CapacitorPlugin(name = "NakupkoPay")
public class NakupkoPayPlugin extends Plugin {
    // ID naročnine v Play Console (Monetizacija → Naročnine).
    static final String PRODUCT_ID = "nakupko_plus_mesecno";

    private BillingClient billing;
    private ProductDetails details;
    private PluginCall pendingBuy;
    private final List<Runnable> waiting = new ArrayList<>();
    private boolean connecting;

    @Override
    public void load() {
        billing = BillingClient.newBuilder(getContext())
            .setListener(this::onPurchases)
            .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
            .enableAutoServiceReconnection()
            .build();
    }

    // Povezava z Google Play; ukazi počakajo, dokler ni vzpostavljena.
    private void ready(Runnable r) {
        if (billing.isReady()) { r.run(); return; }
        synchronized (waiting) { waiting.add(r); if (connecting) return; connecting = true; }
        billing.startConnection(new BillingClientStateListener() {
            @Override public void onBillingSetupFinished(BillingResult result) { flush(); }
            @Override public void onBillingServiceDisconnected() { flush(); }
        });
    }

    private void flush() {
        List<Runnable> list;
        synchronized (waiting) { list = new ArrayList<>(waiting); waiting.clear(); connecting = false; }
        for (Runnable r : list) r.run();
    }

    private interface Done { void done(JSObject status); }

    // active: naročnina velja; product: ali naročnina v Google Play obstaja (sicer nikogar ne zaklenemo).
    private void currentStatus(Done done) {
        ready(() -> {
            JSObject out = new JSObject();
            out.put("active", false);
            out.put("productId", PRODUCT_ID);
            if (!billing.isReady()) { out.put("product", false); done.done(out); return; }
            QueryProductDetailsParams q = QueryProductDetailsParams.newBuilder()
                .setProductList(Collections.singletonList(QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(PRODUCT_ID).setProductType(BillingClient.ProductType.SUBS).build()))
                .build();
            billing.queryProductDetailsAsync(q, (r, res) -> {
                List<ProductDetails> list = res == null ? null : res.getProductDetailsList();
                details = list == null || list.isEmpty() ? null : list.get(0);
                out.put("product", details != null);
                if (details != null) describe(details, out);
                billing.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build(), (r2, purchases) -> {
                    for (Purchase p : purchases) {
                        if (!p.getProducts().contains(PRODUCT_ID) || p.getPurchaseState() != Purchase.PurchaseState.PURCHASED) continue;
                        out.put("active", true);
                        acknowledge(p);
                    }
                    done.done(out);
                });
            });
        });
    }

    // Cena in brezplačno obdobje: Google Play vrne le ponudbe, do katerih je uporabnik upravičen.
    private static void describe(ProductDetails d, JSObject out) {
        List<ProductDetails.SubscriptionOfferDetails> offers = d.getSubscriptionOfferDetails();
        if (offers == null) return;
        int trialDays = 0;
        String price = null;
        for (ProductDetails.SubscriptionOfferDetails o : offers) {
            for (ProductDetails.PricingPhase ph : o.getPricingPhases().getPricingPhaseList()) {
                if (ph.getPriceAmountMicros() == 0) trialDays = Math.max(trialDays, days(ph.getBillingPeriod()));
                else if (ph.getRecurrenceMode() == ProductDetails.RecurrenceMode.INFINITE_RECURRING && price == null) price = ph.getFormattedPrice();
            }
        }
        if (price != null) out.put("price", price);
        out.put("trialEligible", trialDays > 0);
        if (trialDays > 0) out.put("trialDays", trialDays);
    }

    // ISO 8601 obdobje (P1W, P1M, P7D …) v dneh.
    static int days(String iso) {
        Matcher m = Pattern.compile("P(?:(\\d+)Y)?(?:(\\d+)M)?(?:(\\d+)W)?(?:(\\d+)D)?").matcher(iso == null ? "" : iso);
        if (!m.matches()) return 0;
        int[] mult = {365, 30, 7, 1};
        int sum = 0;
        for (int i = 0; i < 4; i++) if (m.group(i + 1) != null) sum += Integer.parseInt(m.group(i + 1)) * mult[i];
        return sum;
    }

    // Nakup je treba potrditi v 3 dneh, sicer ga Google Play vrne.
    private void acknowledge(Purchase p) {
        if (p.isAcknowledged() || p.getPurchaseState() != Purchase.PurchaseState.PURCHASED) return;
        billing.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.getPurchaseToken()).build(), r -> {});
    }

    private void onPurchases(BillingResult result, List<Purchase> purchases) {
        boolean pending = false;
        if (purchases != null) for (Purchase p : purchases) {
            acknowledge(p);
            if (p.getPurchaseState() == Purchase.PurchaseState.PENDING) pending = true;
        }
        final String outcome = result.getResponseCode() == BillingClient.BillingResponseCode.OK ? (pending ? "pending" : "ok")
            : result.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED ? "cancelled" : "error";
        final PluginCall call = pendingBuy;
        pendingBuy = null;
        currentStatus(s -> {
            notifyListeners("change", s);
            if (call == null) return;
            if (outcome.equals("error") && !s.optBoolean("active")) { call.reject("Google Play: " + result.getDebugMessage()); return; }
            s.put("result", outcome);
            call.resolve(s);
        });
    }

    @PluginMethod
    public void status(PluginCall call) { currentStatus(call::resolve); }

    @PluginMethod
    public void buy(PluginCall call) {
        currentStatus(s -> {
            List<ProductDetails.SubscriptionOfferDetails> offers = details == null ? null : details.getSubscriptionOfferDetails();
            if (details == null || offers == null || offers.isEmpty()) { call.reject("Naročnina v Google Play še ni na voljo."); return; }
            if (s.optBoolean("active")) { s.put("result", "ok"); call.resolve(s); return; }
            // Prva ponudba je najugodnejša, do katere je uporabnik upravičen (npr. z brezplačnim obdobjem).
            BillingFlowParams params = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(Collections.singletonList(BillingFlowParams.ProductDetailsParams.newBuilder()
                    .setProductDetails(details).setOfferToken(offers.get(0).getOfferToken()).build()))
                .build();
            getActivity().runOnUiThread(() -> {
                pendingBuy = call;
                BillingResult r = billing.launchBillingFlow(getActivity(), params);
                if (r.getResponseCode() != BillingClient.BillingResponseCode.OK && pendingBuy == call) {
                    pendingBuy = null;
                    call.reject("Google Play: " + r.getDebugMessage());
                }
            });
        });
    }

    @PluginMethod
    public void restore(PluginCall call) { currentStatus(call::resolve); }

    @PluginMethod
    public void manage(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/account/subscriptions?sku=" + PRODUCT_ID + "&package=" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { getContext().startActivity(i); } catch (Exception ignored) {}
        currentStatus(call::resolve);
    }

    @Override
    protected void handleOnResume() {
        // Naročnina se je morda spremenila v Google Play (preklic, podaljšanje).
        if (billing != null) currentStatus(s -> notifyListeners("change", s));
    }
}
