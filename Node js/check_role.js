const mysql = require('mysql2/promise');
async function run() {
  const pool = mysql.createPool({
    host: "localhost",
    user: "root",
    password: "anjanbaira09@db",
    database: "pharma"
  });
  const [rows] = await pool.query("SELECT email, role FROM users WHERE email = 'anjanbaira@gmail.com'");
  console.log(rows);
  process.exit(0);
}
run();
