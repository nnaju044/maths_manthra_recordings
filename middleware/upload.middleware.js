/**
 * middleware/upload.middleware.js
 * Multer + Cloudinary storage for course thumbnail uploads.
 * Files stream directly to Cloudinary — no local disk used.
 */
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');

console.log('Cloudinary upload middleware loaded');
console.log('Cloud Name:', process.env.CLOUDINARY_CLOUD_NAME);
console.log('Cloudinary object keys:', Object.keys(cloudinary));
console.log('Cloudinary uploader:', cloudinary.uploader);

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'maths-manthra/course-thumbnails',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    // Auto-generate a unique public_id to avoid collisions
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

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 }, // 5MB
});

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

module.exports = { upload, uploadExcel };
