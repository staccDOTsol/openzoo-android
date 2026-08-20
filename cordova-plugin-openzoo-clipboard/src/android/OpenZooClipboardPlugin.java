package fun.openzoo.android;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;

import org.apache.cordova.CallbackContext;
import org.apache.cordova.CordovaPlugin;
import org.json.JSONArray;

public class OpenZooClipboardPlugin extends CordovaPlugin {
    @Override
    public boolean execute(String action, JSONArray args, CallbackContext callbackContext) {
        if (!"copy".equals(action)) return false;
        final String text = args.optString(0, "");
        cordova.getActivity().runOnUiThread(() -> {
            try {
                ClipboardManager cm = (ClipboardManager) cordova.getActivity()
                    .getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm == null) {
                    callbackContext.error("clipboard unavailable");
                    return;
                }
                cm.setPrimaryClip(ClipData.newPlainText("openzoo", text));
                callbackContext.success();
            } catch (Exception e) {
                callbackContext.error(e.getMessage() == null ? "clipboard failed" : e.getMessage());
            }
        });
        return true;
    }
}
