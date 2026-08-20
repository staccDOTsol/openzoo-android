var cordovaExec = require('cordova/exec');

var MWA = {
    /**
     * Connect to a Solana wallet via Mobile Wallet Adapter.
     * @param {function} success - Called with {address: string, authToken: string}
     * @param {function} error   - Called with error message string
     */
    authorize: function(success, error) {
        cordovaExec(success, error, 'MWAPlugin', 'authorize', []);
    },

    /**
     * Sign an arbitrary message via MWA.
     * Opens wallet, reauthorizes, signs, returns signature.
     * @param {string} messageB64 - Base64-encoded message bytes
     * @param {function} success  - Called with {signature: string} (base58)
     * @param {function} error    - Called with error message string
     */
    signMessage: function(messageB64, success, error) {
        cordovaExec(success, error, 'MWAPlugin', 'signMessage', [messageB64]);
    },

    /**
     * Sign a serialized transaction via MWA (returns signed tx, does NOT send).
     * @param {string} txB64    - Base64-encoded serialized transaction
     * @param {function} success - Called with {signedTransaction: string} (base64)
     * @param {function} error   - Called with error message string
     */
    signTransaction: function(txB64, success, error) {
        cordovaExec(success, error, 'MWAPlugin', 'signTransaction', [txB64]);
    },

    /**
     * Sign and send a serialized transaction via MWA.
     * Wallet signs and submits to the network.
     * @param {string} txB64    - Base64-encoded serialized transaction
     * @param {function} success - Called with {signature: string} (base58 tx signature)
     * @param {function} error   - Called with error message string
     */
    signAndSendTransaction: function(txB64, success, error) {
        cordovaExec(success, error, 'MWAPlugin', 'signAndSendTransaction', [txB64]);
    }
};

module.exports = MWA;
