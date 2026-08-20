var cordovaExec = require("cordova/exec");

// Monthly Play subscriptions. Prices come from GET https://zoo.openzoo.fun/api/billing/tiers
// — do not invent SKUs or amounts here.
var PlayBilling = {
  PRODUCTS: {
    basic: "fun.openzoo.android.sub.basic",
    pro: "fun.openzoo.android.sub.pro",
    ultra: "fun.openzoo.android.sub.ultra",
  },
  queryProducts: function (productIds, success, error) {
    cordovaExec(success, error, "PlayBillingPlugin", "queryProducts", [productIds || []]);
  },
  purchase: function (productId, success, error) {
    cordovaExec(success, error, "PlayBillingPlugin", "purchase", [productId]);
  },
  restore: function (success, error) {
    cordovaExec(success, error, "PlayBillingPlugin", "restore", []);
  },
  acknowledge: function (purchaseToken, success, error) {
    cordovaExec(success, error, "PlayBillingPlugin", "acknowledge", [purchaseToken]);
  },
  unlockStatus: function (success, error) {
    cordovaExec(success, error, "PlayBillingPlugin", "unlockStatus", []);
  },
  tryDevUnlock: function (email, success, error) {
    cordovaExec(success, error, "PlayBillingPlugin", "tryDevUnlock", [email || ""]);
  },
};

module.exports = PlayBilling;
