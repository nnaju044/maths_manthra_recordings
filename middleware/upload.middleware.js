/**
 * middleware/upload.middleware.js
 * Multer + Cloudinary storage for course thumbnail uploads.
 * Files stream directly to Cloudinary — no local disk used.
 * Storage is instantiated lazily on upload request.
 */
const multer = require('multer');

let uploadInstance = null;

function getUpload() {
  if (!uploadInstance) {
    const { CloudinaryStorage } = require('multer-storage-cloudinary');
    const cloudinary = require('../config/cloudinary');

    const storage = new CloudinaryStorage({
      cloudinary,
      params: {
        folder: 'maths-manthra/course-thumbnails',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        public_id: (req, file) => `course-thumb-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      },
    });

    const fileFilter = (req, file, cb) => {
      const allowedTypes = /jpeg|jpg|png|webp/;
      const mimeOk = allowedTypes.test(file.mimetype);
      if (mimeOk) {
        cb(null, true);
      } else {
        cb(new Error('Only image files are allowed (jpeg, jpg, png, webp)'), false);
      }
    };

    uploadInstance = multer({
      storage,
      fileFilter,
      limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 }, // 5MB
    });
  }
  return uploadInstance;
}

// Lazy proxy for upload middleware so app startup does not hang on Cloudinary dependency traversal
const uploadProxy = {
  single: (field) => (req, res, next) => getUpload().single(field)(req, res, next),
  array: (field, max) => (req, res, next) => getUpload().array(field, max)(req, res, next),
};

// Excel upload storage (in-memory buffer for xlsx parsing)
const excelFilter = (req, file, cb) => {
  const isExcel =
    file.originalname.match(/\.(xlsx|xls)$/i) ||
    file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    file.mimetype === 'application/vnd.ms-excel' ||
    file.mimetype === 'application/octet-stream';

  if (isExcel) {
    cb(null, true);
  } else {
    cb(new Error('Only Excel files (.xlsx, .xls) are allowed'), false);
  }
};

const uploadExcel = multer({
  storage: multer.memoryStorage(),
  fileFilter: excelFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

module.exports = { upload: uploadProxy, uploadExcel, getUpload };
