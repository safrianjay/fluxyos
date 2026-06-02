# FluxyOS Firebase Functions

## Deploy Auth deletion cleanup

`cleanupInternalUserOnAuthDelete` removes `internal_users/{uid}` after a single
Firebase Authentication user is deleted.

The Firebase project must be on the Blaze plan before Cloud Functions can be
deployed. After the plan upgrade:

```bash
firebase deploy --only functions:cleanupInternalUserOnAuthDelete
```

Firebase Admin SDK bulk deletion does not emit per-user Auth deletion events.
Delete accounts one at a time when this cleanup is required.
