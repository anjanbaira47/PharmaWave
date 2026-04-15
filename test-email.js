require('dotenv').config({ path: 'Node js/.env' });
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

async function main() {
    try {
        console.log('Sending email...');
        let info = await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER,
            subject: 'Test Email from Local',
            text: 'This is a test email.'
        });
        console.log('Message sent: %s', info.messageId);
    } catch (e) {
        console.error(e);
    }
}
main();
