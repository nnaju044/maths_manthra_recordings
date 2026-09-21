require('dotenv').config();
const cloudinary = require('cloudinary').v2;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

cloudinary.api.resources()
    .then(result => {
        console.log('AUTH SUCCESS');
        console.log(result.resources.length);
    })
    .catch(err => {
        console.error('AUTH FAILED');
        console.error(err);
    });