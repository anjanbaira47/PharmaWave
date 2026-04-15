require("dotenv").config();
const nodemailer = require("nodemailer");

const emailTransporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // Use SSL/TLS
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

async function run() {
    try {
        const mailOptions = {
            from: `"PharmaWave" <${process.env.EMAIL_USER}>`,
            to: process.env.EMAIL_USER,
            subject: 'Test Email',
            text: 'This is a test email'
        };
        await emailTransporter.sendMail(mailOptions);
        console.log("Success");
    } catch (e) {
        console.error("Error sending email:", e);
    }
}
run();
