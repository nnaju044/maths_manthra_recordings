/**
 * config/cloudinary.js
 * Lazy-loaded Cloudinary SDK configuration — used for course thumbnail uploads.
 * Defers loading the heavy Cloudinary SDK until an upload actually occurs.
 */
let cloudinaryInstance = null;

function getCloudinary() {
  if (!cloudinaryInstance) {
    const cloudinary = require('cloudinary').v2;
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
    cloudinaryInstance = cloudinary;
  }
  return cloudinaryInstance;
}

// Export a proxy so any access (e.g. cloudinary.uploader) lazily loads the instance
const cloudinaryProxy = new Proxy({}, {
  get(target, prop) {
    const instance = getCloudinary();
    const val = instance[prop];
    return typeof val === 'function' ? val.bind(instance) : val;
  },
});

module.exports = cloudinaryProxy;
module.exports.getCloudinary = getCloudinary;
