const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { HttpError } = require('../utils/helpers');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const ALLOWED = {
  'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image',
  'video/mp4': 'video', 'video/webm': 'video',
  'audio/mpeg': 'audio', 'audio/mp4': 'audio', 'audio/wav': 'audio', 'audio/webm': 'audio', 'audio/ogg': 'audio',
  'application/pdf': 'document',
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
};

// Files get random names; the original name is never used on disk.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_ROOT),
  filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).toLowerCase().slice(0, 8)),
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024, files: 5 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED[file.mimetype]) return cb(new HttpError(400, `File type not allowed: ${file.mimetype}`));
    cb(null, true);
  },
});

const fileKind = (mimetype) => ALLOWED[mimetype] || 'document';

// Deletes files that were saved but not used (e.g. validation failed after upload).
function discard(files) {
  for (const f of files || []) fs.unlink(f.path, () => {});
}

module.exports = { upload, fileKind, discard, UPLOAD_ROOT };
