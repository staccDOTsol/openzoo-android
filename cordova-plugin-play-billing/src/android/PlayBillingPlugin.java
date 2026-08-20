package fun.openzoo.android;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.util.Log;

import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

public class PlayBillingPlugin extends CordovaPlugin implements PurchasesUpdatedListener {
    private static final String TAG = "PlayBillingPlugin";

    private BillingClient billingClient;
    private CallbackContext purchaseCallback;
    private boolean connecting = false;
    private final List<Runnable> readyQueue = new ArrayList<Runnable>();

    @Override
    protected void pluginInitialize() {
        Activity activity = cordova.getActivity();
        billingClient = BillingClient.newBuilder(activity)
            .setListener(this)
            .enablePendingPurchases()
            .build();
        ensureReady(null, null);
    }

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) {
        if ("queryProducts".equals(action)) {
            JSONArray ids = args.optJSONArray(0);
            final List<String> productIds = new ArrayList<String>();
            if (ids != null) {
                for (int i = 0; i < ids.length(); i++) productIds.add(ids.optString(i));
            }
            cordova.getThreadPool().execute(() -> queryProducts(productIds, callbackContext));
            return true;
        }
        if ("purchase".equals(action)) {
            final String productId = args.optString(0, "");
            cordova.getThreadPool().execute(() -> purchase(productId, callbackContext));
            return true;
        }
        if ("restore".equals(action)) {
            cordova.getThreadPool().execute(() -> restore(callbackContext));
            return true;
        }
        if ("acknowledge".equals(action)) {
            final String token = args.optString(0, "");
            cordova.getThreadPool().execute(() -> acknowledge(token, callbackContext));
            return true;
        }
        if ("unlockStatus".equals(action)) {
            cordova.getThreadPool().execute(() -> unlockStatus(callbackContext));
            return true;
        }
        if ("tryDevUnlock".equals(action)) {
            final String email = args.optString(0, "");
            cordova.getThreadPool().execute(() -> tryDevUnlock(email, callbackContext));
            return true;
        }
        return false;
    }

    /**
     * Cordova debug / USB sideload only. Play release APKs are not debuggable
     * and BuildConfig.DEBUG is false — this path is a no-op there.
     */
    private boolean isDebugApk() {
        boolean buildDebug = false;
        try {
            Class<?> cfg = Class.forName("fun.openzoo.android.BuildConfig");
            buildDebug = cfg.getField("DEBUG").getBoolean(null);
        } catch (Exception ignored) {
            buildDebug = false;
        }
        boolean debuggable = false;
        try {
            debuggable = (cordova.getActivity().getApplicationInfo().flags
                & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        } catch (Exception ignored) {
            debuggable = false;
        }
        return buildDebug || debuggable;
    }

    private SharedPreferences unlockPrefs() {
        return cordova.getActivity().getSharedPreferences("openzoo.android.dbg", Context.MODE_PRIVATE);
    }

    private void unlockStatus(CallbackContext cb) {
        try {
            boolean debug = isDebugApk();
            JSONObject o = new JSONObject();
            o.put("debug", debug);
            o.put("unlocked", debug && unlockPrefs().getBoolean("u", false));
            cb.success(o);
        } catch (Exception e) {
            cb.error(e.getMessage());
        }
    }

    private void tryDevUnlock(String email, CallbackContext cb) {
        if (!isDebugApk()) {
            cb.error("unavailable");
            return;
        }
        String got = email == null ? "" : email.trim().toLowerCase(Locale.US);
        if (!"jarettrsdunn1999@gmail.com".equals(got)) {
            cb.error("no");
            return;
        }
        unlockPrefs().edit().putBoolean("u", true).apply();
        try {
            JSONObject o = new JSONObject();
            o.put("unlocked", true);
            cb.success(o);
        } catch (Exception e) {
            cb.success();
        }
    }

    private void ensureReady(final CallbackContext cb, final Runnable next) {
        if (billingClient != null && billingClient.isReady()) {
            if (next != null) next.run();
            return;
        }
        if (next != null) {
            readyQueue.add(() -> {
                if (billingClient != null && billingClient.isReady()) next.run();
                else if (cb != null) cb.error("Google Play Billing is not available");
            });
        }
        if (connecting) return;
        connecting = true;
        billingClient.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult result) {
                connecting = false;
                List<Runnable> q = new ArrayList<Runnable>(readyQueue);
                readyQueue.clear();
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    Log.w(TAG, "Billing setup failed: " + result.getDebugMessage());
                }
                for (Runnable r : q) r.run();
            }

            @Override
            public void onBillingServiceDisconnected() {
                connecting = false;
            }
        });
    }

    private void queryProducts(List<String> productIds, CallbackContext cb) {
        ensureReady(cb, () -> {
            List<QueryProductDetailsParams.Product> products = new ArrayList<QueryProductDetailsParams.Product>();
            for (String id : productIds) {
                products.add(QueryProductDetailsParams.Product.newBuilder()
                    .setProductId(id)
                    .setProductType(BillingClient.ProductType.SUBS)
                    .build());
            }
            QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                .setProductList(products)
                .build();
            billingClient.queryProductDetailsAsync(params, (result, details) -> {
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    cb.error(result.getDebugMessage());
                    return;
                }
                try {
                    JSONArray out = new JSONArray();
                    for (ProductDetails d : details) {
                        JSONObject o = new JSONObject();
                        o.put("productId", d.getProductId());
                        o.put("title", d.getTitle());
                        o.put("description", d.getDescription());
                        out.put(o);
                    }
                    cb.success(out);
                } catch (Exception e) {
                    cb.error(e.getMessage());
                }
            });
        });
    }

    private void purchase(String productId, CallbackContext cb) {
        if (productId == null || productId.length() == 0) {
            cb.error("missing productId");
            return;
        }
        ensureReady(cb, () -> {
            QueryProductDetailsParams.Product product = QueryProductDetailsParams.Product.newBuilder()
                .setProductId(productId)
                .setProductType(BillingClient.ProductType.SUBS)
                .build();
            QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                .setProductList(Collections.singletonList(product))
                .build();
            billingClient.queryProductDetailsAsync(params, (result, details) -> {
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK || details == null || details.isEmpty()) {
                    cb.error(result.getDebugMessage() == null || result.getDebugMessage().isEmpty()
                        ? "Product not found in Play Console: " + productId
                        : result.getDebugMessage());
                    return;
                }
                ProductDetails details0 = details.get(0);
                List<ProductDetails.SubscriptionOfferDetails> offers = details0.getSubscriptionOfferDetails();
                if (offers == null || offers.isEmpty()) {
                    cb.error("No subscription offer for " + productId);
                    return;
                }
                BillingFlowParams.ProductDetailsParams pdp = BillingFlowParams.ProductDetailsParams.newBuilder()
                    .setProductDetails(details0)
                    .setOfferToken(offers.get(0).getOfferToken())
                    .build();
                BillingFlowParams flow = BillingFlowParams.newBuilder()
                    .setProductDetailsParamsList(Collections.singletonList(pdp))
                    .build();
                purchaseCallback = cb;
                Activity activity = cordova.getActivity();
                activity.runOnUiThread(() -> {
                    BillingResult launched = billingClient.launchBillingFlow(activity, flow);
                    if (launched.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                        purchaseCallback = null;
                        cb.error(launched.getDebugMessage());
                    }
                });
            });
        });
    }

    private void restore(CallbackContext cb) {
        ensureReady(cb, () -> {
            QueryPurchasesParams params = QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.SUBS)
                .build();
            billingClient.queryPurchasesAsync(params, (result, purchases) -> {
                if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) {
                    cb.error(result.getDebugMessage());
                    return;
                }
                try {
                    cb.success(purchasesToJson(purchases));
                } catch (Exception e) {
                    cb.error(e.getMessage());
                }
            });
        });
    }

    private void acknowledge(String token, CallbackContext cb) {
        if (token == null || token.isEmpty()) {
            cb.error("missing purchaseToken");
            return;
        }
        ensureReady(cb, () -> {
            AcknowledgePurchaseParams params = AcknowledgePurchaseParams.newBuilder()
                .setPurchaseToken(token)
                .build();
            billingClient.acknowledgePurchase(params, result -> {
                if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) cb.success();
                else cb.error(result.getDebugMessage());
            });
        });
    }

    @Override
    public void onPurchasesUpdated(BillingResult result, List<Purchase> purchases) {
        CallbackContext cb = purchaseCallback;
        purchaseCallback = null;
        if (cb == null) return;
        if (result.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
            cb.error("canceled");
            return;
        }
        if (result.getResponseCode() != BillingClient.BillingResponseCode.OK || purchases == null || purchases.isEmpty()) {
            cb.error(result.getDebugMessage() == null ? "purchase failed" : result.getDebugMessage());
            return;
        }
        try {
            cb.success(purchaseToJson(purchases.get(0)));
        } catch (Exception e) {
            cb.error(e.getMessage());
        }
    }

    private JSONArray purchasesToJson(List<Purchase> purchases) throws Exception {
        JSONArray out = new JSONArray();
        if (purchases == null) return out;
        for (Purchase p : purchases) out.put(purchaseToJson(p));
        return out;
    }

    private JSONObject purchaseToJson(Purchase p) throws Exception {
        JSONObject o = new JSONObject();
        o.put("purchaseToken", p.getPurchaseToken());
        o.put("orderId", p.getOrderId() == null ? "" : p.getOrderId());
        o.put("acknowledged", p.isAcknowledged());
        JSONArray ids = new JSONArray();
        String first = "";
        if (p.getProducts() != null) {
            for (String id : p.getProducts()) {
                ids.put(id);
                if (first.isEmpty()) first = id;
            }
        }
        o.put("productIds", ids);
        o.put("productId", first);
        return o;
    }
}
