require('dotenv').config();
const nodemailer = require('nodemailer');



async function test() {
    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: false,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });

    await transporter.sendMail({
        from: process.env.SMTP_FROM,
        to: process.env.SMTP_USER,
        subject: 'SMTP Test',
        text: 'SMTP is working'
    });

    console.log('Email sent successfully');
}

test().catch(console.error);