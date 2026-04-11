# Save Session Flow - Step by Step Breakdown

## Overview
When `saveCurrentStoredImageAndGoHome()` is triggered, the app performs a multi-stage process to save session data, upload images to S3, and persist everything to Firestore.

---

## **STEP 1: Initial Trigger & Entry Preparation**
**File:** `feedback-page.page.ts` → `saveCurrentStoredImageAndGoHome()`

```typescript
// User clicks the "Save Session" button
// Button call: (click)="saveCurrentStoredImageAndGoHome()"
```

**What Happens:**
- Retrieves the currently selected image from the component state
- Fallback: If no current image in service, finds it in the `imagePaths` array
- Creates a `StoredImage` object with:
  - `original` - Base64 data URL of original image
  - `withBoxes` - Base64 data URL of image with detection boxes
  - `filename` - Generated unique filename  
  - `timestamp` - Current ISO string
  - `rawPrediction` - ML prediction (type, shape, severity)
  - `statusMessage` - Status text for the image

**Code Location:** Lines 1091-1147
```typescript
let entry = {
  original: found.original,
  withBoxes: found.withBoxes,
  boxes: [],
  timestamp: new Date().toISOString(),
  filename: found.fileName,
  rawPrediction: found.rawPrediction,
  statusMessage: 'Saved as session'
};
```

---

## **STEP 2: Show Session Name Prompt Dialog**
**Method:** `showSaveSessionPrompt(entry)`

**What Happens:**
- Displays an overlay dialog asking user to name the session
- User types a name (or accepts auto-generated default like "Session Apr 11, 2026 3:45:22 PM")
- Shows Cancel and Save buttons
- When Save is clicked, proceeds to next steps

**Key Variables Setup:**
```typescript
const val = input.value.trim() || `Session ${new Date().toLocaleString()}`;
const imageKey = entry.filename || entry.original;  // Use filename as primary key
let savedSessionId = null;
```

---

## **STEP 3: Create or Update Session**
**Location:** `feedback-page.page.ts` → `showSaveSessionPrompt()`, lines 1270-1310

**Path A: New Session (no pre-existing session)**
```typescript
if (typeof svc.createSession === 'function') {
  const s = svc.createSession(val, [imageKey]);  // val = session name, [imageKey] = array with image key
  savedSessionId = s.id;  // e.g., "session_12345..."
}
```

**Path B: Existing Session (from Camera page)**
```typescript
if (this.selectedSessionId) {
  svc.addImageToSession(this.selectedSessionId, imageKey);  // Add image to existing session
  svc.updateSessionName(this.selectedSessionId, val);  // Optional: rename session
  savedSessionId = this.selectedSessionId;
}
```

**Created Session Object Structure** (from `image-storage.service.ts`):
```typescript
interface ImageSession {
  id: string;                    // e.g., "session_abc123def456"
  name: string;                  // User-provided name
  imageKeys: string[];           // Array of image filenames ["img_20260411_154522_1.jpg"]
  created: string;               // ISO timestamp
  userId?: string;               // Will be set later in Firestore save
  totalBoundingBoxes?: number;   // Number of detection boxes
}
```

---

## **STEP 4A: Upload Original Image to S3**
**Method:** `ImageStorageService.uploadSessionImageOriginal()`

**Code Location:** Lines 176-205

**Data Transformations:**

1. **Generate S3 Filename:**
   ```typescript
   const s3Filename = this.generateSessionFilename({
     sessionId,              // Session ID from Step 3
     filename: originalFilename,  // e.g., "img_20260411_154522_1.jpg"
     imageType: 'original',
     timestamp: new Date().toISOString()
   });
   // Result: e.g., "[sessionId_]img1_[sessionId]_img_20260411_154522_1_originalMMDDYYYYHHMM.jpg"
   ```

2. **Convert Data URL to Binary:**
   ```typescript
   // Input: "data:image/jpeg;base64,/9j/4AAQSkZJRg..."
   const uint8Array = this.dataUrlToUint8Array(dataUrl);
   // Output: Uint8Array of binary image data
   ```

3. **Upload to AWS S3:**
   ```typescript
   const params = {
     Bucket: 'my-angular-test-bucket-12345',
     Key: s3Filename,  // Generated filename from step 1
     Body: uint8Array,  // Binary image data
     ContentType: 'image/jpeg'
   };
   const command = new PutObjectCommand(params);
   await this.s3Client.send(command);  // AWS SDK sends to S3
   ```

4. **Generate S3 URL:**
   ```typescript
   const finalUrl = `https://my-angular-test-bucket-12345.s3.ap-southeast-2.amazonaws.com/${s3Filename}`;
   ```

**Return Value:**
```typescript
return {
  url: "https://my-angular-test-bucket-12345.s3.ap-southeast-2.amazonaws.com/...",
  s3Key: "[generated S3 filename]"
}
```

**Stored In Component:** `originalS3Result`

---

## **STEP 4B: Upload WithBoxes Image to S3**
**Method:** `ImageStorageService.uploadSessionImageWithBoxes()`

**Code Location:** Lines 217-252

**Same Process as Step 4A, but:**
```typescript
imageType: 'withBoxes'  // Instead of 'original'
// Results in different S3 filename with "_withBoxes" in the name
```

**Stored In Component:** `withBoxesS3Result`

---

## **STEP 5: Update Entry with S3 References**
**Location:** `feedback-page.page.ts` → `showSaveSessionPrompt()`, lines 1330-1345

**What Happens:**
- Updates the original `entry` object with S3 URLs and keys from Steps 4A & 4B
- This entry will be saved to Firestore in the next step

```typescript
// Update entry only if S3 upload succeeded
if (originalS3Result) {
  entry.storagePath = originalS3Result.s3Key;        // S3 object key
  entry.storageUrl = originalS3Result.url;           // S3 https URL
}
if (withBoxesS3Result) {
  entry.withBoxesStoragePath = withBoxesS3Result.s3Key;
  entry.withBoxesStorageUrl = withBoxesS3Result.url;
}

// Persist updated entry back to service (local storage)
svc.setEntryForImage(imageKey, entry);
```

**Updated Entry Object Now Contains:**
```typescript
{
  original: "data:image/jpeg;base64,...",           // Original base64
  withBoxes: "data:image/jpeg;base64,...",          // WithBoxes base64
  filename: "img_20260411_154522_1.jpg",
  timestamp: "2026-04-11T15:45:22.123Z",
  rawPrediction: { type: "Alligator", shape: "Short", severity: "Low" },
  statusMessage: "Saved as session",
  storagePath: "[S3 key for original]",         // ← NEW
  storageUrl: "https://bucket.s3...original",   // ← NEW
  withBoxesStoragePath: "[S3 key for withBoxes]", // ← NEW
  withBoxesStorageUrl: "https://bucket.s3...withBoxes"  // ← NEW
}
```

---

## **STEP 6: Save Session & Images to Firestore**
**Method:** `ImageStorageService.saveSessionWithImagesToFirestore(sessionId)`

**Code Location:** Lines 795-878

### **Step 6.1: Get Current Session**
```typescript
const session = this.sessions.find(s => s.id === sessionId);
// Returns the ImageSession object created in Step 3
```

### **Step 6.2: Collect All Images for Session**
```typescript
const imagesForSession: StoredImage[] = [];
for (const key of session.imageKeys || []) {  // e.g., ["img_20260411_154522_1.jpg"]
  const img = this.images.find(i => i.filename === key);
  if (img && img.filename) imagesForSession.push(img);
}
// Now imagesForSession = [entry object from Step 5]
```

### **Step 6.3: Get Current User ID**
```typescript
const currentUid = await this.waitForAuthUserId();
// Waits up to 8 seconds for Firebase Auth to be ready
// Returns: current authenticated Firebase user UID (e.g., "user_abc123")
```

### **Step 6.4: Prepare Firestore Batch Write**
- Uses Firestore `writeBatch()` for atomic multi-document writes

### **Step 6.5: Delete Old Images for This Session**
```typescript
// Query Firestore for existing images with this sessionId + userId
const existingQuery = query(
  imagesCollection, 
  where('sessionId', '==', session.id), 
  where('userId', '==', currentUid)
);
const existingSnapshot = await getDocs(existingQuery);

// Delete all found documents
const deleteBatch = writeBatch(this.firestore);
existingSnapshot.forEach(docSnapshot => deleteBatch.delete(docSnapshot.ref));
await deleteBatch.commit();
```

### **Step 6.6: Write Session Document to Firestore**
```typescript
// Firestore Collection: 'sessionsImages'
// Document ID: session.id (e.g., "session_12345...")

const sessionRef = doc(sessionsCollection, session.id);
batch.set(sessionRef, {
  id: session.id,
  name: 'Session Apr 11, 2026 3:45:22 PM',     // User-provided name
  imageKeys: ['img_20260411_154522_1.jpg'],    // Array of image filenames
  created: '2026-04-11T15:45:22.123Z',
  totalBoundingBoxes: 0,
  userId: 'user_abc123',                       // Current user UID
  sessionId: null
});
```

**Firestore Path:** `sessionsImages/[session.id]`

---

## **Step 6.7: Write Image Documents to Firestore**
```typescript
// For each image in imagesForSession
for (const image of imagesForSession) {
  // Ensure userId is set
  image.userId = currentUid;
  
  // Compress base64 if it exceeds 900KB (Firestore doc limit)
  const safeOriginal = await this.clampDataUrlToBytes(image.original, 900_000);
  const safeWithBoxes = await this.clampDataUrlToBytes(image.withBoxes, 900_000);

  // Firestore Collection: 'images'
  // Document ID: image.filename (e.g., "img_20260411_154522_1.jpg")
  const imageRef = doc(imagesCollection, image.filename);
  
  batch.set(imageRef, {
    timestamp: '2026-04-11T15:45:22.123Z',
    filename: 'img_20260411_154522_1.jpg',
    userId: 'user_abc123',                     // Current user UID
    sessionId: 'session_12345...',             // Links to session
    
    // Base64 data (compressed if needed)
    original: '[compressed base64 if > 900KB, else full base64]',
    withBoxes: '[compressed base64 if > 900KB, else full base64]',
    
    // Metadata
    hasPrediction: true,
    statusMessage: 'Saved as session',
    detectionMessage: '',
    prediction: { 
      type: 'Alligator', 
      shape: 'Short', 
      severity: 'Low' 
    },
    boxes: [],
    
    // S3 References (from Step 5)
    storagePath: '[S3 key for original]',
    storageUrl: 'https://bucket.s3.../original.jpg',
    withBoxesStoragePath: '[S3 key for withBoxes]',
    withBoxesStorageUrl: 'https://bucket.s3.../withBoxes.jpg'
  });
}

// Execute the batch write (atomic)
await batch.commit();
```

**Firestore Path:** `images/[image.filename]`

---

## **Firestore Data Structure Summary**

### **Collection 1: `sessionsImages`**
```
sessionsImages/
├── session_12345abc/  ← Document ID = session.id
│   ├── id: "session_12345abc"
│   ├── name: "Session Apr 11, 2026 3:45:22 PM"
│   ├── imageKeys: ["img_20260411_154522_1.jpg"]
│   ├── created: "2026-04-11T15:45:22.123Z"
│   ├── userId: "user_abc123"
│   └── totalBoundingBoxes: 0
```

### **Collection 2: `images`**
```
images/
├── img_20260411_154522_1.jpg/  ← Document ID = image.filename
│   ├── timestamp: "2026-04-11T15:45:22.123Z"
│   ├── filename: "img_20260411_154522_1.jpg"
│   ├── sessionId: "session_12345abc"  ← Foreign key to session
│   ├── userId: "user_abc123"
│   ├── original: "[base64 data]"
│   ├── withBoxes: "[base64 data]"
│   ├── prediction: { type: "Alligator", shape: "Short", severity: "Low" }
│   ├── statusMessage: "Saved as session"
│   ├── storagePath: "s3-key-original"  ← Points to S3
│   ├── storageUrl: "https://bucket.s3.../original.jpg"
│   ├── withBoxesStoragePath: "s3-key-withBoxes"
│   └── withBoxesStorageUrl: "https://bucket.s3.../withBoxes.jpg"
```

---

## **STEP 7: Log Workflow Status (Optional)**
**Method:** `ImageStorageService.logSaveWorkflowStatus(sessionId)`

**Code Location:** Lines 274-339

**What Happens:**
- Collects all saved session and image metadata
- Logs a comprehensive status report to the browser console
- Verifies S3 references and Firestore persistence

**Console Output Example:**
```
[ImageStorageService] ✅ Workflow Status for Session: session_12345abc
  - Session ID: session_12345abc
  - Session Name: Session Apr 11, 2026 3:45:22 PM
  - Total Images: 1
  - Images with Predictions: 1
  - S3 Uploads:
    - Original: my-bucket/[s3-key-original]
    - WithBoxes: my-bucket/[s3-key-withBoxes]
  - Firestore Status: Verified
```

---

## **STEP 8: Show Confirmation Dialog**
**Method:** `showFirestoreSavePrompt(message)`

**Code Location:** Lines 1472-1525

**What Happens:**
- Displays success message with:
  - Session ID saved
  - S3 file keys (if uploads succeeded)
- User clicks "Close"

**Message Example:**
```
✅ Session saved to Firestore: session_12345abc
📁 S3 Files:
Original: my-bucket/sessionId_img_20260411_154522_1_original0411202615.jpg
Processed: my-bucket/sessionId_img_20260411_154522_1_withBoxes0411202615.jpg
```

---

## **STEP 9: Navigate to Home**
**Location:** `feedback-page.page.ts` → `showSaveSessionPrompt()`, line 1460

```typescript
this.router.navigate(['/home-page2']);
```

**What Happens:**
- Closes all dialogs
- Navigates user back to home page
- All data is now persisted in:
  - **Firestore** (sessionsImages collection & images collection)
  - **S3** (original and withBoxes images)
  - **Local Storage** (Ionic Storage backup)

---

## **Data Flow Diagram**

```
User clicks "Save Session"
        ↓
[STEP 1] Prepare entry object (image + metadata)
        ↓
[STEP 2] Show name dialog → User enters session name
        ↓
[STEP 3] Create new session OR update existing
        ↓
[STEP 4A] Upload original image to S3
        ↓ (get S3 URL + key)
[STEP 4B] Upload withBoxes image to S3
        ↓ (get S3 URL + key)
[STEP 5] Update entry with S3 references
        ↓
[STEP 6] Save to Firestore:
        ├─→ Write session doc to 'sessionsImages' collection
        └─→ Write image doc(s) to 'images' collection
        ↓
[STEP 7] Log workflow status to console
        ↓
[STEP 8] Show confirmation dialog
        ↓
[STEP 9] Navigate to home page

Final State:
  - Firestore: session + image docs with S3 references
  - S3: 2 image files (original + withBoxes)
  - Local Storage: Backup of all data
```

---

## **Key Objects & Variables**

| Variable | Type | Purpose |
|----------|------|---------|
| `entry` | `StoredImage` | Contains image data, prediction, filename |
| `savedSessionId` | `string` | Session ID (e.g., "session_abc123") |
| `imageKey` | `string` | Image filename as primary key |
| `originalS3Result` | `{ url, s3Key }` | S3 upload result for original |
| `withBoxesS3Result` | `{ url, s3Key }` | S3 upload result for processed |
| `currentUid` | `string` | Firebase Auth user ID |
| `session` | `ImageSession` | Session metadata object |
| `imagesForSession` | `StoredImage[]` | Array of images in this session |

---

## **Error Handling & Fallbacks**

| Step | Failure | Fallback |
|------|---------|----------|
| S3 Upload | Network/CORS error | Image still saved to Firestore (no S3 reference) |
| Firestore Write | Auth not ready | Waits up to 8 seconds for auth |
| Firestore Write | User not authenticated | Operation skipped, warning logged |
| Image Compression | Data > 900KB | Automatically compressed to fit Firestore limit |

---

## **Files Modified/Updated**

1. **In Memory (variables):**
   - `this.selectedSessionId` ← updated with new session ID
   - `this.imagePaths` ← image displays refreshed

2. **In Firestore:**
   - New document: `sessionsImages/[sessionId]`
   - New document: `images/[filename]`

3. **In S3:**
   - New object: `[bucket]/[s3-key-original]`
   - New object: `[bucket]/[s3-key-withBoxes]`

4. **In Ionic Local Storage:**
   - Backup of images and sessions arrays updated

