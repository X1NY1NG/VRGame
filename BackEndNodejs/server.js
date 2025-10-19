// server.js (ESM)
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fetch from 'node-fetch';
import admin from 'firebase-admin';
import { randomUUID } from 'crypto';

const {
  PORT = 4000,
  RPM_APP_ID,
  RPM_PARTNER,
  FB_BUCKET,
  FIREBASE_DB_URL,
  MAX_UPLOAD_MB = '10',
  CORS_ORIGIN = 'http://localhost:3000'
} = process.env;



// ---------- Firebase Admin ----------
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: FIREBASE_DB_URL,
    storageBucket: FB_BUCKET,               // <— add bucket (needed for walls)
  });
}
const rtdb = admin.database();
const bucket = admin.storage().bucket();    // <— used by walls

// ---------- Express ----------
const app = express();
app.use(express.json());
app.use(cors({ origin: CORS_ORIGIN }));
app.get('/health', (_, res) => res.json({ ok: true }));

// ---------- Multer ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(MAX_UPLOAD_MB) * 1024 * 1024 },
});

console.log('FIREBASE_DB_URL =', process.env.FIREBASE_DB_URL);
console.log('FB_BUCKET =', process.env.FB_BUCKET);

console.log('Admin options =', admin.app().options);
// Helpful envs that reveal which project your creds are bound to:
console.log('GCLOUD_PROJECT =', process.env.GCLOUD_PROJECT);
console.log('GOOGLE_CLOUD_PROJECT =', process.env.GOOGLE_CLOUD_PROJECT);

try {
  const [exists] = await admin.storage().bucket().exists();
  console.log('Bucket exists?', exists);
} catch (e) {
  console.error('Bucket exists() check failed:', e.message);
}


/* -------------------------------------------------------
 *  A) KEEP: Your existing Ready Player Me avatar endpoint
 *     POST /api/avatars/from-image  (fields: photo, nric)
 * -----------------------------------------------------*/
app.post('/api/avatars/from-image', upload.single('photo'), async (req, res) => {
  try {
    const nric = (req.body?.nric || '').toString().trim();
    if (!nric) return res.status(400).json({ ok: false, error: 'nric is required' });
    if (!req.file) return res.status(400).json({ ok: false, error: 'photo file is required' });

    // name (REQUIRED)
    const name = (req.body?.name || '').toString().trim();
    if (!name || name.length < 2 || name.length > 80) {
      return res.status(400).json({ ok: false, error: 'valid name is required (2–80 chars)' });
    }

    // gender (optional)
    const rawGender = (req.body?.gender || '').toString().toLowerCase().trim();
    const gender = ['male', 'female'].includes(rawGender) ? rawGender : undefined;

    // relationship (REQUIRED)
    const rawRel = (req.body?.relationship || '').toString().toLowerCase().trim();
    const ALLOWED_REL = new Set(['friend', 'son', 'daughter', 'wife', 'husband']);
    const relationship = ALLOWED_REL.has(rawRel) ? rawRel : undefined;
    if (!relationship) {
      return res.status(400).json({ ok: false, error: 'relationship is required (friend|son|daughter|wife|husband)' });
    }

    const { userId, token } = await createAnonUser();

    const base64Image = req.file.buffer.toString('base64');
    const avatarId = await createAndSaveAvatar({ token, userId, base64Image, gender, relationship });

    await rtdb.ref(`users/${nric}`).update({
      displayName: name,                  // NEW: persist name
      avatarId,
      rpmUserId: userId,
      chosenGender: gender ?? null,
      relationshipToUser: relationship,
      updatedAt: admin.database.ServerValue.TIMESTAMP,
    });

    return res.json({ ok: true, nric, name, userId, avatarId, gender, relationship });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message || 'server error' });
  }
});



// ----- helpers for avatar flow -----
async function createAnonUser() {
  const payload = { data: { applicationId: RPM_APP_ID, requestToken: true } };
  const r = await fetch('https://api.readyplayer.me/v1/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  console.log('RPM /v1/users status:', r.status, 'body:', j);
  if (!r.ok) throw new Error(j?.errors?.[0]?.message || 'RPM user creation failed');
  const userId = j.data.id;
  const token = j.data.token;
  if (!token) throw new Error('RPM user creation succeeded, but no token returned');
  return { userId, token };
}


async function readOnce(res) {
  const raw = await res.text();
  try { return { json: JSON.parse(raw), raw }; } catch { return { json: null, raw }; }
}

async function createAndSaveAvatar({ token, userId, base64Image, gender }) {
  const payload = {
    data: {
      userId,
      partner: RPM_PARTNER,
      bodyType: 'fullbody',
      gender: gender,
      base64Image,
      assets: {},
    },
  };

  // First attempt (with gender if provided)
  let r1 = await fetch('https://api.readyplayer.me/v2/avatars', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let b1 = await readOnce(r1);

  if (!r1.ok) throw new Error(b1.json?.errors?.[0]?.message || `RPM create avatar failed (${r1.status})`);

  const avatarId = b1.json?.data?.id;
  if (!avatarId) throw new Error('No avatarId returned from RPM');

  const r2 = await fetch(`https://api.readyplayer.me/v2/avatars/${avatarId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  });
  const b2 = await readOnce(r2);
  if (!r2.ok) throw new Error(b2.json?.errors?.[0]?.message || `RPM save avatar failed (${r2.status})`);

  return avatarId;
}

// Lookup by NRIC (used to preload avatarId)
app.get('/api/users/:nric', async (req, res) => {
  const nric = (req.params.nric || '').trim();
  if (!nric) return res.status(400).json({ ok: false, error: 'nric is required' });
  const snap = await rtdb.ref(`users/${nric}`).get();
  if (!snap.exists()) return res.status(404).json({ ok: false, error: 'user not found' });
  res.json({ ok: true, data: snap.val() });
});

// Overwrite avatarId with the latest one from RPM editor
app.post('/api/users/:nric/avatar-id', async (req, res) => {
  const nric = (req.params.nric || '').trim();
  const { avatarId } = req.body || {};
  if (!nric) return res.status(400).json({ ok: false, error: 'nric is required' });
  if (!avatarId) return res.status(400).json({ ok: false, error: 'avatarId required' });

  await rtdb.ref(`users/${nric}`).update({
    avatarId,
    updatedAt: admin.database.ServerValue.TIMESTAMP,
  });
  res.json({ ok: true });
});

/* -------------------------------------------------------
 *  B) ADD: 3-wall upload endpoint
 *     POST /api/walls/upload (fields: nric + left/front/right)
 * -----------------------------------------------------*/
app.post(
  '/api/walls/upload',
  upload.fields([{ name: 'left' }, { name: 'front' }, { name: 'right' }]),
  async (req, res) => {
    try {
      const nric = (req.body?.nric || '').toString().trim();
      if (!nric) return res.status(400).json({ ok: false, error: 'nric is required' });

      const left = req.files?.left?.[0];
      const front = req.files?.front?.[0];
      const right = req.files?.right?.[0];
      if (!left || !front || !right) {
        return res.status(400).json({ ok: false, error: 'left, front, right files are required' });
      }

      async function saveSide(side, file) {
        const ext = (file.mimetype?.split('/')[1] || 'jpg').toLowerCase();
        const objectPath = `users/${nric}/walls/${side}.${ext}`;
        const downloadToken = randomUUID();

        await bucket.file(objectPath).save(file.buffer, {
          resumable: false,
          contentType: file.mimetype || 'image/jpeg',
          metadata: {
            metadata: { firebaseStorageDownloadTokens: downloadToken },
            cacheControl: 'public,max-age=31536000,immutable',
          },
        });

        const encoded = encodeURIComponent(objectPath);
        const url = `https://firebasestorage.googleapis.com/v0/b/${FB_BUCKET}/o/${encoded}?alt=media&token=${downloadToken}`;
        return url;
      }

      const [leftUrl, frontUrl, rightUrl] = await Promise.all([
        saveSide('left', left),
        saveSide('front', front),
        saveSide('right', right),
      ]);

      await rtdb.ref(`users/${nric}`).update({
        walls: { left: leftUrl, front: frontUrl, right: rightUrl },
        wallsUpdatedAt: admin.database.ServerValue.TIMESTAMP,
      });

      return res.json({ ok: true, nric, urls: { left: leftUrl, front: frontUrl, right: rightUrl } });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: e.message || 'server error' });
    }
  }
);

/* -------------------------------------------------------
 *  C) ADD: Gallery upload endpoint
 *     POST /api/gallery/upload (fields: nric + photos[] 6 files)
 * -----------------------------------------------------*/
app.post(
  '/api/gallery/upload',
  upload.array('photos[]', 6), // accept up to 6 files
  async (req, res) => {
    try {
      const nric = (req.body?.nric || '').toString().trim();
      if (!nric) return res.status(400).json({ ok: false, error: 'nric is required' });

      const files = req.files || [];
      if (files.length < 1) {
        return res.status(400).json({ ok: false, error: 'exactly 1 photos[] required' });
      }

      async function savePhoto(index, file) {
        const ext = (file.mimetype?.split('/')[1] || 'jpg').toLowerCase();
        const objectPath = `users/${nric}/gallery/photo_${index}.${ext}`;
        const downloadToken = randomUUID();

        await bucket.file(objectPath).save(file.buffer, {
          resumable: false,
          contentType: file.mimetype || 'image/jpeg',
          metadata: {
            metadata: { firebaseStorageDownloadTokens: downloadToken },
            cacheControl: 'public,max-age=31536000,immutable',
          },
        });

        const encoded = encodeURIComponent(objectPath);
        return `https://firebasestorage.googleapis.com/v0/b/${FB_BUCKET}/o/${encoded}?alt=media&token=${downloadToken}`;
      }

      const urls = [];
      for (let i = 0; i < files.length; i++) {
        urls.push(await savePhoto(i, files[i]));
      }

      await rtdb.ref(`users/${nric}`).update({
        gallery: urls,
        galleryUpdatedAt: admin.database.ServerValue.TIMESTAMP,
      });

      return res.json({ ok: true, nric, urls });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, error: e.message || 'server error' });
    }
  }
);

app.listen(PORT, () => console.log(`API listening on :${PORT}`));

