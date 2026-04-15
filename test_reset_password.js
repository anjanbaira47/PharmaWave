const mysql = require("mysql2/promise");
require("dotenv").config({ path: "Node js/.env" });
async function test() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || "localhost",
        user: process.env.DB_USER || "root",
        password: process.env.DB_PASSWORD || "anjanbaira09@db",
        database: process.env.DB_NAME || "pharma",
    });
    
    // Create a mock user
    let email = "test_reset_" + Date.now() + "@gmail.com";
    await pool.query("INSERT INTO users (username, email, password) VALUES (?, ?, ?)", ["testuser_" + Date.now(), email, "oldpassword"]);
    
    console.log("Mock user created:", email);
    
    // Simulate forgot password API
    const [rows] = await pool.query("SELECT id, email FROM users WHERE email = ?", [email]);
    if(rows.length === 0) return console.log("User not found!");
    
    const user = rows[0];
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    await pool.query("UPDATE users SET reset_token = ? WHERE id = ?", [otpCode, user.id]);
    console.log("OTP generated:", otpCode);
    
    // Simulate reset password API
    const [checkRows] = await pool.query("SELECT id FROM users WHERE reset_token = ?", [otpCode]);
    if(checkRows.length === 0) return console.log("OTP check failed: Not found");
    console.log("OTP check successful, resetting password");
    
    await pool.query("UPDATE users SET password = ?, reset_token = NULL WHERE id = ?", ["newhashedpassword", checkRows[0].id]);
    console.log("Password reset query executed");
    
    // Verify
    const [verifyRows] = await pool.query("SELECT password, reset_token FROM users WHERE id = ?", [user.id]);
    console.log("Final user state:", verifyRows[0]);
    process.exit(0);
}
test().catch(console.error);
