require('dotenv').config();
const cloudinary = require('cloudinary').v2;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

cloudinary.uploader.upload(
    'https://res.cloudinary.com/demo/image/upload/sample.jpg',
    { folder: 'test' }
)
    .then(result => {
        console.log('UPLOAD SUCCESS');
        console.log(result.secure_url);
    })
    .catch(err => {
        console.log('UPLOAD FAILED');
        console.error(err);
    });