'use strict';

const admin = require('firebase-admin');
const functions = require('firebase-functions/v1');

admin.initializeApp();

// Keep the internal operations index aligned with Firebase Authentication.
// User-owned Firestore data is intentionally left untouched: this trigger only
// removes the denormalized row rendered by /internal.
exports.cleanupInternalUserOnAuthDelete = functions.auth.user().onDelete(async (user) => {
    await admin.firestore().doc(`internal_users/${user.uid}`).delete();
    functions.logger.info('Removed deleted Auth user from the internal index', {
        uid: user.uid
    });
});
