const http = require('http');

async function test() {
  const resetRes = await fetch('http://localhost:3000/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@pharmawave.com' })
  });
  const resetData = await resetRes.json();
  console.log("Forgot Password Response:", resetData);

  if (resetData.fallbackOtp) {
     const verifyRes = await fetch('http://localhost:3000/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otp: resetData.fallbackOtp, newPassword: 'newadminpass' })
     });
     console.log("Reset Password Response:", await verifyRes.json());
  }
}
test();
