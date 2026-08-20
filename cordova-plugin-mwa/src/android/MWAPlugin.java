package com.example.cordovaseeker;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import android.util.Log;

import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CallbackContext;

import org.json.JSONArray;
import org.json.JSONObject;

import com.solana.mobilewalletadapter.clientlib.scenario.LocalAssociationScenario;
import com.solana.mobilewalletadapter.clientlib.scenario.LocalAssociationIntentCreator;
import com.solana.mobilewalletadapter.clientlib.protocol.MobileWalletAdapterClient;

import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

public class MWAPlugin extends CordovaPlugin {
    private static final String TAG = "MWAPlugin";
    // Dapp identity shown in the wallet's approval dialog — customize for your game
    private static final String IDENTITY_URI  = "https://example.com";
    private static final String IDENTITY_ICON = "icons/icon-192.png";
    private static final String IDENTITY_NAME = "CordovaSeeker";
    private static final String CHAIN         = "solana:mainnet";
    private static final int SCENARIO_TIMEOUT_MS = 90000;
    private static final String B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

    // Saved from authorize — reused for signing sessions
    private String savedAuthToken = null;

    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) {
        if ("authorize".equals(action)) {
            cordova.getThreadPool().execute(() -> doAuthorize(callbackContext));
            return true;
        }
        if ("signMessage".equals(action)) {
            final String messageB64 = args.optString(0, "");
            cordova.getThreadPool().execute(() -> doSignMessage(messageB64, callbackContext));
            return true;
        }
        if ("signTransaction".equals(action)) {
            final String txB64 = args.optString(0, "");
            cordova.getThreadPool().execute(() -> doSignTransaction(txB64, callbackContext));
            return true;
        }
        if ("signAndSendTransaction".equals(action)) {
            final String txB64 = args.optString(0, "");
            cordova.getThreadPool().execute(() -> doSignAndSendTransaction(txB64, callbackContext));
            return true;
        }
        return false;
    }

    /**
     * Open a new MWA session, reauthorize (or authorize fresh), and return the client.
     * Caller must close the scenario when done.
     */
    private Object[] openSessionAndReauthorize() throws Exception {
        final Activity activity = cordova.getActivity();

        LocalAssociationScenario scenario = new LocalAssociationScenario(SCENARIO_TIMEOUT_MS);
        Log.d(TAG, "Scenario created on port " + scenario.getPort());

        Intent intent = LocalAssociationIntentCreator.createAssociationIntent(
            null, scenario.getPort(), scenario.getSession()
        );

        final Intent chooser = Intent.createChooser(intent, "Select wallet");
        final boolean[] intentFailed = {false};
        activity.runOnUiThread(() -> {
            try {
                activity.startActivity(chooser);
            } catch (ActivityNotFoundException e) {
                Log.e(TAG, "No MWA wallet found", e);
                intentFailed[0] = true;
            }
        });

        Thread.sleep(200);
        if (intentFailed[0]) {
            scenario.close();
            throw new ActivityNotFoundException("No MWA-compatible wallet app found");
        }

        MobileWalletAdapterClient client = scenario.start()
            .get(SCENARIO_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        Log.d(TAG, "Wallet connected via WebSocket");

        // Reauthorize with saved token, or fresh authorize
        MobileWalletAdapterClient.AuthorizationResult result;
        if (savedAuthToken != null) {
            Log.d(TAG, "Reauthorizing with saved token...");
            result = client.authorize(
                Uri.parse(IDENTITY_URI),
                Uri.parse(IDENTITY_ICON),
                IDENTITY_NAME,
                CHAIN,
                savedAuthToken, null, null, null
            ).get(SCENARIO_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } else {
            Log.d(TAG, "Fresh authorize...");
            result = client.authorize(
                Uri.parse(IDENTITY_URI),
                Uri.parse(IDENTITY_ICON),
                IDENTITY_NAME,
                CHAIN,
                null, null, null, null
            ).get(SCENARIO_TIMEOUT_MS, TimeUnit.MILLISECONDS);
        }

        savedAuthToken = result.authToken;
        Log.d(TAG, "Authorized, accounts: " + result.accounts.length);

        return new Object[]{ scenario, client, result };
    }

    private void doAuthorize(final CallbackContext cb) {
        LocalAssociationScenario scenario = null;
        try {
            Object[] session = openSessionAndReauthorize();
            scenario = (LocalAssociationScenario) session[0];
            MobileWalletAdapterClient.AuthorizationResult result =
                (MobileWalletAdapterClient.AuthorizationResult) session[2];

            byte[] publicKey = result.accounts[0].publicKey;
            String address = base58Encode(publicKey);

            scenario.close().get(5000, TimeUnit.MILLISECONDS);
            Log.d(TAG, "Scenario closed");

            JSONObject json = new JSONObject();
            json.put("address", address);
            json.put("authToken", result.authToken);
            if (result.accounts[0].accountLabel != null) {
                json.put("label", result.accounts[0].accountLabel);
            }
            cb.success(json);

        } catch (ActivityNotFoundException e) {
            cb.error("No MWA-compatible wallet found");
        } catch (TimeoutException e) {
            cb.error("Wallet connection timed out");
        } catch (ExecutionException e) {
            String msg = e.getCause() != null ? e.getCause().getMessage() : e.getMessage();
            cb.error("MWA error: " + msg);
        } catch (Exception e) {
            cb.error("MWA error: " + e.getMessage());
        } finally {
            if (scenario != null) try { scenario.close(); } catch (Exception ignored) {}
        }
    }

    private void doSignMessage(String messageB64, final CallbackContext cb) {
        LocalAssociationScenario scenario = null;
        try {
            byte[] messageBytes = Base64.decode(messageB64, Base64.NO_WRAP);

            Object[] session = openSessionAndReauthorize();
            scenario = (LocalAssociationScenario) session[0];
            MobileWalletAdapterClient client = (MobileWalletAdapterClient) session[1];
            MobileWalletAdapterClient.AuthorizationResult authResult =
                (MobileWalletAdapterClient.AuthorizationResult) session[2];

            // signMessagesDetached wants byte[][] addresses
            byte[][] addresses = new byte[][]{ authResult.accounts[0].publicKey };

            Log.d(TAG, "Signing message (" + messageBytes.length + " bytes)...");
            MobileWalletAdapterClient.SignMessagesResult signResult =
                client.signMessagesDetached(
                    new byte[][]{ messageBytes },
                    addresses
                ).get(SCENARIO_TIMEOUT_MS, TimeUnit.MILLISECONDS);

            scenario.close().get(5000, TimeUnit.MILLISECONDS);

            // Public fields: signResult.messages[0].signatures[0]
            byte[] signature = signResult.messages[0].signatures[0];
            String sigB58 = base58Encode(signature);
            Log.d(TAG, "Message signed: " + sigB58.substring(0, Math.min(16, sigB58.length())) + "...");

            JSONObject json = new JSONObject();
            json.put("signature", sigB58);
            cb.success(json);

        } catch (ActivityNotFoundException e) {
            cb.error("No MWA-compatible wallet found");
        } catch (TimeoutException e) {
            cb.error("Wallet connection timed out");
        } catch (ExecutionException e) {
            String msg = e.getCause() != null ? e.getCause().getMessage() : e.getMessage();
            cb.error("MWA sign error: " + msg);
        } catch (Exception e) {
            cb.error("MWA sign error: " + e.getMessage());
        } finally {
            if (scenario != null) try { scenario.close(); } catch (Exception ignored) {}
        }
    }

    private void doSignTransaction(String txB64, final CallbackContext cb) {
        LocalAssociationScenario scenario = null;
        try {
            byte[] txBytes = Base64.decode(txB64, Base64.NO_WRAP);

            Object[] session = openSessionAndReauthorize();
            scenario = (LocalAssociationScenario) session[0];
            MobileWalletAdapterClient client = (MobileWalletAdapterClient) session[1];

            Log.d(TAG, "Signing transaction (" + txBytes.length + " bytes)...");
            MobileWalletAdapterClient.SignPayloadsResult signResult =
                client.signTransactions(new byte[][]{ txBytes })
                    .get(SCENARIO_TIMEOUT_MS, TimeUnit.MILLISECONDS);

            scenario.close().get(5000, TimeUnit.MILLISECONDS);

            // Public field: signResult.signedPayloads[0]
            byte[] signedTx = signResult.signedPayloads[0];
            String signedTxB64 = Base64.encodeToString(signedTx, Base64.NO_WRAP);
            Log.d(TAG, "Transaction signed");

            JSONObject json = new JSONObject();
            json.put("signedTransaction", signedTxB64);
            cb.success(json);

        } catch (ActivityNotFoundException e) {
            cb.error("No MWA-compatible wallet found");
        } catch (TimeoutException e) {
            cb.error("Wallet connection timed out");
        } catch (ExecutionException e) {
            String msg = e.getCause() != null ? e.getCause().getMessage() : e.getMessage();
            cb.error("MWA sign error: " + msg);
        } catch (Exception e) {
            cb.error("MWA sign error: " + e.getMessage());
        } finally {
            if (scenario != null) try { scenario.close(); } catch (Exception ignored) {}
        }
    }

    private void doSignAndSendTransaction(String txB64, final CallbackContext cb) {
        LocalAssociationScenario scenario = null;
        try {
            byte[] txBytes = Base64.decode(txB64, Base64.NO_WRAP);

            Object[] session = openSessionAndReauthorize();
            scenario = (LocalAssociationScenario) session[0];
            MobileWalletAdapterClient client = (MobileWalletAdapterClient) session[1];

            Log.d(TAG, "Sign+send transaction (" + txBytes.length + " bytes)...");
            // signAndSendTransactions(byte[][], Integer minContextSlot)
            MobileWalletAdapterClient.SignAndSendTransactionsResult sendResult =
                client.signAndSendTransactions(new byte[][]{ txBytes }, null)
                    .get(SCENARIO_TIMEOUT_MS, TimeUnit.MILLISECONDS);

            scenario.close().get(5000, TimeUnit.MILLISECONDS);

            // Public field: sendResult.signatures[0]
            byte[] txSig = sendResult.signatures[0];
            String sigB58 = base58Encode(txSig);
            Log.d(TAG, "Transaction sent, sig: " + sigB58.substring(0, Math.min(16, sigB58.length())) + "...");

            JSONObject json = new JSONObject();
            json.put("signature", sigB58);
            cb.success(json);

        } catch (ActivityNotFoundException e) {
            cb.error("No MWA-compatible wallet found");
        } catch (TimeoutException e) {
            cb.error("Wallet connection timed out");
        } catch (ExecutionException e) {
            String msg = e.getCause() != null ? e.getCause().getMessage() : e.getMessage();
            cb.error("MWA send error: " + msg);
        } catch (Exception e) {
            cb.error("MWA send error: " + e.getMessage());
        } finally {
            if (scenario != null) try { scenario.close(); } catch (Exception ignored) {}
        }
    }

    /** Base58 encode a byte array (Bitcoin/Solana alphabet) */
    private static String base58Encode(byte[] input) {
        if (input.length == 0) return "";
        int zeros = 0;
        while (zeros < input.length && input[zeros] == 0) zeros++;
        byte[] copy = new byte[input.length];
        System.arraycopy(input, 0, copy, 0, input.length);
        StringBuilder encoded = new StringBuilder();
        int start = zeros;
        while (start < copy.length) {
            int carry = 0;
            for (int i = start; i < copy.length; i++) {
                carry = carry * 256 + (copy[i] & 0xFF);
                copy[i] = (byte) (carry / 58);
                carry %= 58;
            }
            encoded.append(B58_ALPHABET.charAt(carry));
            while (start < copy.length && copy[start] == 0) start++;
        }
        for (int i = 0; i < zeros; i++) encoded.append('1');
        return encoded.reverse().toString();
    }
}
