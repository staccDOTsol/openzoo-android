var cordovaExec = require("cordova/exec");

var OpenZooClipboard = {
  copy: function (text, success, error) {
    cordovaExec(success, error, "OpenZooClipboard", "copy", [String(text || "")]);
  },
};

module.exports = OpenZooClipboard;
