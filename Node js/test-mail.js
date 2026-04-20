require('dotenv').config({ path: '.env' });
console.log("USER:", process.env.EMAIL_USER ? "Loaded" : "NOT LOADED");
const nodemailer = require('nodemailer');

const emailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const mailOptions = {
    from: process.env.EMAIL_USER || 'test@test.com',
    to: process.env.EMAIL_USER || 'test@test.com',
    subject: 'Test connection',
    text: 'Test body'
};

emailTransporter.sendMail(mailOptions, (err, info) => {
    if (err) console.error("Error:", err.message);
    else console.log("Success:", info.response);
});
