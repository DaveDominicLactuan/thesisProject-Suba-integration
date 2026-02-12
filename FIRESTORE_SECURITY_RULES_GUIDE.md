# Firestore Security Rules & userId Fix - Deployment Guide

## Overview
This guide explains the Firestore security rules and the userId fix that was applied to fix the "Missing or insufficient permissions" error.

## Problem Solved
**Error:** `FirebaseError: Missing or insufficient permissions`

**Root Causes:**
1. Firestore had no security rules defined (default: DENY ALL)
2. `userId` field was being written as `null` instead of the authenticated user's UID
3. Security rules require `userId` to match the authenticated user for read/write access

## What Was Fixed

### 1. Code Changes in `image-storage.service.ts`
- ✅ **Changed:** `userId: session.userId || null` → `userId: currentUid` (ALWAYS set, never null)
- ✅ **Changed:** `userId: image.userId || null` → `userId: currentUid` (ALWAYS set, never null)
- ✅ **Added:** Query filter `where('userId', '==', currentUid)` when removing old images

### 2. Created Firestore Security Rules (`firestore.rules`)
Security rules define who can read/write each collection:

```sql
-- Users can only read/write their own user profile
match /users/{userId} {
  allow read: if request.auth.uid == userId;
  allow write: if request.auth.uid == userId;
}

-- Users can only read/write sessions where userId matches
match /sessionsImages/{sessionId} {
  allow read: if resource.data.userId == request.auth.uid;
  allow write: if request.resource.data.userId == request.auth.uid;
}

-- Users can only read/write images where userId matches
match /images/{imageId} {
  allow read: if resource.data.userId == request.auth.uid;
  allow write: if request.resource.data.userId == request.auth.uid;
}
```

## How to Deploy Rules to Firebase

### Option 1: Firebase Console (Recommended for beginners)

1. **Go to Firebase Console**
   - Open https://console.firebase.google.com
   - Select your project

2. **Navigate to Firestore**
   - Click "Firestore Database" in left sidebar
   - Click "Rules" tab at top

3. **Copy and Paste Rules**
   - Open `firestore.rules` file locally
   - Select all content (Ctrl+A)
   - Paste into Firebase Console rules editor
   - Click "Publish" button

4. **Verify**
   - You should see "Rules Updated" message
   - Timestamp will update at top right

### Option 2: Firebase CLI (Recommended for production)

1. **Install Firebase CLI** (if not already installed)
   ```bash
   npm install -g firebase-tools
   ```

2. **Login to Firebase**
   ```bash
   firebase login
   ```

3. **Initialize Firebase in your project** (if not done yet)
   ```bash
   firebase init firestore
   ```

4. **Deploy Rules**
   ```bash
   firebase deploy --only firestore:rules
   ```

5. **Verify Deployment**
   ```bash
   firebase rules:list
   ```

## Verifying the Fix Works

After deploying rules, test by:

1. **Build and run the app**
   ```bash
   npm run build
   ionic serve
   ```

2. **Log in with your test account**

3. **Try to save a session**
   - Click "Save Session" in feedback-page
   - An image should save to Firestore with `userId` field set to your UID

4. **Check Firestore Database**
   - Go to Firebase Console → Firestore Database → Data tab
   - Look at `sessionsImages` and `images` collections
   - Verify each document has `userId` field with your UID

5. **Check Console Logs**
   - Look for: `[ImageStorageService] Saving session to Firestore`
   - Should show userId in the output
   - Should see: `✅ Session and images saved to Firestore`

## Troubleshooting

### Still Getting "Missing or insufficient permissions"?

1. **Check userId is being written**
   - Look at Firestore Console → Data tab
   - Verify `userId` field exists and is not empty
   - Should match the authenticated user's UID

2. **Verify rules are published**
   - Go to Firebase Console → Firestore → Rules tab
   - Check the "Last updated" timestamp
   - Make sure your rules are showing, not the default template

3. **Check authentication**
   - Verify user is logged in: `auth.currentUser` should not be null
   - Check console logs for auth messages

4. **Check security rules syntax**
   - Look for syntax errors in Firebase Console (displays red highlight)
   - Rules must end with semicolon before closing brace

### "Firebase API called outside injection context"?

This is a warning that can sometimes occur. The fix is already applied in the code. If it persists:
- This usually resolves after the Firestore module initializes
- Not a blocker for functionality

## Security Rules Breakdown

### Collection: `sessionsImages`
- **Read:** ✅ User can read if `userId` in document matches their UID
- **Write:** ✅ User can write if `userId` in new document matches their UID
- **Delete:** ✅ User can delete if `userId` in document matches their UID

### Collection: `images`
- **Read:** ✅ User can read if `userId` in document matches their UID
- **Write:** ✅ User can write if `userId` in new document matches their UID
- **Delete:** ✅ User can delete if `userId` in document matches their UID

### Collection: `users`
- **Read:** ✅ User can read their own user profile
- **Write:** ✅ User can write their own user profile
- Sub-collections (`users/{userId}/images`, `users/{userId}/sessions`):
  - **Read/Write:** ✅ User can access only their own sub-collection

### Collection: `pendingAccounts`
- **Read:** ✅ Anyone can read (for admin review)
- **Create:** ✅ Only authenticated user can create their own pending account
- **Update/Delete:** ✅ Only admin can update/delete

## Best Practices Going Forward

1. **Always set userId when writing**
   ```typescript
   const data = {
     userId: currentUid,  // ← ALWAYS include
     name: "Session Name",
     // ... other fields
   };
   ```

2. **Include userId in queries**
   ```typescript
   const q = query(
     collection(db, 'sessionsImages'),
     where('userId', '==', currentUid)  // ← Filter by userId
   );
   ```

3. **Test rules changes**
   - Always test in a development project first
   - Use Firebase Emulator for local testing before deploying to production

4. **Document your rules**
   - Add comments explaining what each rule allows/denies
   - Update this guide when rules change

## Next Steps

After rules are deployed and verified:

1. ✅ Test session/image save functionality
2. ✅ Verify data persists to Firestore
3. ✅ Test retrieving sessions/images
4. ✅ Test deleting sessions/images
5. ✅ Test multi-user scenario (make sure users can't see each other's data)

## References

- Firebase Firestore Security Rules: https://firebase.google.com/docs/firestore/security/start
- Firebase Console: https://console.firebase.google.com
- Firebase CLI: https://firebase.google.com/docs/cli
