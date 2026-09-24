const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuid } = require('uuid');
const db = require('../db/db');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Media + common document types — enough for "share a photo/video/file in
// chat or a comment" without turning this into a general file host.
const ALLOWED_MIMETYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword',
  'text/plain', 'text/csv',
]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  // A random name on disk — never the original filename — so a guessed or
  // enumerated path reveals nothing, and access still goes through the
  // authenticated /api/uploads/:id route, not a static file server.
  filename: (req, file, cb) => cb(null, uuid() + path.extname(file.originalname).slice(0, 10)),
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_MIMETYPES.has(file.mimetype)),
});

// POST /api/uploads — multipart form: file + projectId. Requires at least
// commenter access to that project (same bar as posting the comment/chat
// message this attachment will end up on).
router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Unsupported file type, missing file, or file too large (max 25MB)' });
  const projectId = req.body.projectId;
  if (!projectId || !db.canCommentOnProject(req.session.userId, projectId)) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'You need at least commenter access to this project to attach files' });
  }
  const attachment = db.createAttachment({
    projectId,
    uploaderId: req.session.userId,
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
  });
  res.status(201).json({ id: attachment.id, originalName: attachment.originalName, mimetype: attachment.mimetype, size: attachment.size });
});

// GET /api/uploads/:id — streams the file back, only to someone with
// access to the project it was uploaded into.
router.get('/:id', (req, res) => {
  const attachment = db.getAttachmentById(req.params.id);
  if (!attachment || !db.canAccessProject(req.session.userId, attachment.projectId)) {
    return res.status(404).json({ error: 'Attachment not found' });
  }
  const filePath = path.join(UPLOAD_DIR, attachment.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Attachment not found' });
  res.setHeader('Content-Type', attachment.mimetype);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.originalName)}"`);
  res.sendFile(filePath);
});

module.exports = router;
