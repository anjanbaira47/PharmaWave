const express = require("express");
const mysql = require("mysql2/promise");
const bodyParser = require("body-parser");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const http = require("http");
const { Server } = require("socket.io");
const { OAuth2Client } = require("google-auth-library");
const path = require("path");
const os = require("os");
const nodemailer = require("nodemailer");
const fs = require("fs");
require("dotenv").config();
// Support for Render Secret Files
const secretPath = path.join('/etc/secrets', '.env');
if (fs.existsSync(secretPath)) {
    require("dotenv").config({ path: secretPath });
    console.log("Loaded additional environment variables from Render Secret File.");
}

// Configure Nodemailer transporter with Gmail SMTP
const emailTransporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true, // Use SSL/TLS
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});


const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Create default JWT Secret if none provided in .env
const JWT_SECRET = process.env.JWT_SECRET || "pharma_wave_secure_super_secret_key_production";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"]
    }
});

app.use(cors());

// STATIC FOLDERS & MULTER CONFIG
// Relocate uploads outside the project root to prevent Live Server auto-refresh
const uploadDir = path.join(os.homedir(), 'PharmaWave_Uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

app.use('/uploads', express.static(uploadDir));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Database connection guard middleware
app.use((req, res, next) => {
    // Check if the pool is initialized for API routes
    if (req.path.startsWith('/api') || req.path === '/login' || req.path === '/register') {
        if (!pool) {
            return res.status(503).json({ 
                success: false, 
                message: "Database connection not established. Please ensure DB_HOST, DB_USER, DB_PASSWORD, and DB_NAME are set in Render environment variables." 
            });
        }
    }
    next();
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, "../front end")));

// Provide default route to index.html
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "../front end", "index.html"));
});

let pool;

async function initDB() {
    try {
        const dbUrl = process.env.DATABASE_URL || process.env.DB_URL;
        const dbHost = process.env.DB_HOST;

        // If a full connection string is provided in DATABASE_URL, DB_URL, or even DB_HOST
        if (dbUrl || (dbHost && dbHost.startsWith('mysql://'))) {
            const connectionString = dbUrl || dbHost;
            pool = mysql.createPool(connectionString);
            console.log("Connected to MySQL pool via Connection String");
        } else {
            pool = mysql.createPool({
                host: dbHost || "localhost",
                user: process.env.DB_USER || "root",
                password: process.env.DB_PASSWORD || "anjanbaira09@db",
                database: process.env.DB_NAME || "pharma",
                port: process.env.DB_PORT || 3306,
                waitForConnections: true,
                connectionLimit: 10,
                queueLimit: 0
            });
            console.log("Connected to MySQL pool via individual variables");
        }

        // 1. Create All Tables First
        await pool.query(`CREATE TABLE IF NOT EXISTS users (id INT AUTO_INCREMENT PRIMARY KEY, username VARCHAR(255) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL, contact VARCHAR(255))`);
        await pool.query(`CREATE TABLE IF NOT EXISTS products (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL, category VARCHAR(255), price DECIMAL(10, 2) NOT NULL, image_url VARCHAR(500), description TEXT, stock INT DEFAULT 100, expiry_date DATE)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS orders (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, total_amount DECIMAL(10, 2) NOT NULL, status VARCHAR(50) DEFAULT 'Pending', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id))`);
        await pool.query(`CREATE TABLE IF NOT EXISTS addresses (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, title VARCHAR(100) NOT NULL, full_address TEXT NOT NULL, is_default BOOLEAN DEFAULT FALSE, FOREIGN KEY (user_id) REFERENCES users(id))`);
        await pool.query(`CREATE TABLE IF NOT EXISTS order_items (id INT AUTO_INCREMENT PRIMARY KEY, order_id INT, product_id INT, quantity INT NOT NULL, price DECIMAL(10, 2) NOT NULL, FOREIGN KEY (order_id) REFERENCES orders(id), FOREIGN KEY (product_id) REFERENCES products(id))`);
        await pool.query(`CREATE TABLE IF NOT EXISTS prescriptions (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, image_data LONGTEXT NOT NULL, status VARCHAR(50) DEFAULT 'Pending Review', uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id))`);
        await pool.query(`CREATE TABLE IF NOT EXISTS pharmacies (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL, location VARCHAR(255) NOT NULL, contact VARCHAR(255) NOT NULL, status VARCHAR(50) DEFAULT 'Active', joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS user_cards (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, card_title VARCHAR(100), card_number VARCHAR(20), expiry VARCHAR(10), FOREIGN KEY (user_id) REFERENCES users(id))`);
        await pool.query(`CREATE TABLE IF NOT EXISTS consultations (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, doctor_name VARCHAR(255), subject VARCHAR(255), date DATE, time TIME, status VARCHAR(50) DEFAULT 'Booked', FOREIGN KEY (user_id) REFERENCES users(id))`);

        // 2. Run Migrations / Alterations
        try { await pool.query("ALTER TABLE users ADD COLUMN profile_pic LONGTEXT"); } catch (e) { }
        try { await pool.query("ALTER TABLE users ADD COLUMN email VARCHAR(255)"); } catch (e) { }
        try { await pool.query("ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'user'"); } catch (e) { }
        try { await pool.query("ALTER TABLE users ADD COLUMN vehicle_type VARCHAR(50)"); } catch (e) { }
        try { await pool.query("ALTER TABLE users ADD COLUMN vehicle_number VARCHAR(100)"); } catch (e) { }
        try { await pool.query("ALTER TABLE users ADD COLUMN availability VARCHAR(50) DEFAULT 'Online'"); } catch (e) { }
        try { await pool.query("ALTER TABLE users ADD COLUMN reset_token VARCHAR(255)"); } catch (e) { }
        try { await pool.query("ALTER TABLE users ADD COLUMN email_notifications BOOLEAN DEFAULT TRUE"); } catch (e) { }
        try { await pool.query("ALTER TABLE users ADD COLUMN sms_alerts BOOLEAN DEFAULT TRUE"); } catch (e) { }
        try { await pool.query("ALTER TABLE products ADD COLUMN expiry_date DATE"); } catch (e) { }
        try { await pool.query(`ALTER TABLE orders ADD COLUMN agent_id INT`); } catch (e) { }
        try { await pool.query(`ALTER TABLE orders ADD COLUMN address_id INT`); } catch (e) { }
        try { await pool.query(`ALTER TABLE orders ADD COLUMN payment_method VARCHAR(50) DEFAULT 'COD'`); } catch (e) { }
        try { await pool.query(`ALTER TABLE orders ADD COLUMN schedule VARCHAR(50) DEFAULT 'ASAP'`); } catch (e) { }
        try { await pool.query(`ALTER TABLE orders ADD COLUMN delivery_rating INT DEFAULT NULL`); } catch (e) { }
        try { await pool.query(`ALTER TABLE orders ADD COLUMN lat DECIMAL(10, 8)`); } catch (e) { }
        try { await pool.query(`ALTER TABLE orders ADD COLUMN lng DECIMAL(11, 8)`); } catch (e) { }
        try { await pool.query("ALTER TABLE users ADD COLUMN cart_data LONGTEXT"); } catch (e) { }

        console.log("Database tables initialized successfully.");

        // 3. Seed Data
        // Seed Users
        const [usersCount] = await pool.query('SELECT COUNT(*) as count FROM users');
        if (usersCount[0].count === 0) {
            const adminPassword = await bcrypt.hash('admin123', 10);
            const deliveryPassword = await bcrypt.hash('agent123', 10);
            const pharmacyPassword = await bcrypt.hash('pharmacy123', 10);
            const userPassword = await bcrypt.hash('user123', 10);
            
            const values = [
                ['admin', 'admin@pharmawave.com', adminPassword, 'admin', '1234567890'], 
                ['agent1', 'agent@pharmawave.com', deliveryPassword, 'delivery', '0987654321'], 
                ['pharmacy1', 'contact@citymedical.com', pharmacyPassword, 'pharmacy', '9998887776'],
                ['Test User', 'user@gmail.com', userPassword, 'user', '8887776665']
            ];
            await pool.query(`INSERT INTO users (username, email, password, role, contact) VALUES ?`, [values]);
            console.log("Mock users created.");
        }

        // Seed Products
        const [rows] = await pool.query("SELECT COUNT(*) AS count FROM products");
        if (rows[0].count === 0) {
            console.log("Seeding mock products...");
            const mockProducts = [
                ["Paracetamol 500mg", "Pain Relief", 5.99, "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3", "Effective for pain relief and fever reducing."],
                ["Vitamin C Supplement", "Vitamins", 12.50, "https://images.unsplash.com/photo-1550572017-edb9cf1209b6?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3", "Boosts immune system."],
                ["Cough Syrup", "Cold & Flu", 8.25, "https://images.unsplash.com/photo-1631549916768-4119b2e5f926?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3", "Relieves dry and tickly coughs."],
                ["First Aid Kit", "First Aid", 24.99, "https://images.unsplash.com/photo-1603398938378-e54eab446dde?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3", "Comprehensive first aid essentials."],
                ["Allergy Relief Tests", "Allergy", 14.00, "https://plus.unsplash.com/premium_photo-1661630983141-8f4dfbc52bf1?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3", "Fast relief from allergy symptoms."],
                ["Aspirin 81mg", "Pain Relief", 6.50, "https://images.unsplash.com/photo-1585435557343-3b092031a831?w=500&auto=format&fit=crop&q=60&ixlib=rb-4.0.3", "Low dose aspirin regimen."],
                ["Amoxicillin 250mg", "Antibiotics", 15.00, "https://images.unsplash.com/photo-1471864190281-a93a3070b6de?w=500&auto=format&fit=crop&q=60", "Prescription antibiotic."],
                ["Ibuprofen 400mg", "Pain Relief", 7.50, "https://images.unsplash.com/photo-1577401239170-897942555fb3?w=500&auto=format&fit=crop&q=60", "Reduces inflammation and pain."],
                ["Multivitamin For Men", "Vitamins", 22.99, "https://images.unsplash.com/photo-1584017911766-d451b3d0e843?w=500&auto=format&fit=crop&q=60", "Daily nutritional support for men."],
                ["Multivitamin For Women", "Vitamins", 22.99, "https://images.unsplash.com/photo-1584017911766-d451b3d0e843?w=500&auto=format&fit=crop&q=60", "Daily nutritional support for women."],
                ["Hydration Salts", "First Aid", 4.50, "https://images.unsplash.com/photo-1512069772995-ec65ed45afd6?w=500&auto=format&fit=crop&q=60", "Fast rehydration therapy."],
                ["Hand Sanitizer 500ml", "First Aid", 5.00, "https://images.unsplash.com/photo-1584483766114-2cea6facdcaa?w=500&auto=format&fit=crop&q=60", "Kills 99.9% of germs."],
                ["Antihistamine Tablets", "Allergy", 11.20, "https://plus.unsplash.com/premium_photo-1661630983141-8f4dfbc52bf1?w=500&auto=format&fit=crop&q=60", "Non-drowsy allergy relief."],
                ["Thermometer Digital", "First Aid", 18.50, "https://images.unsplash.com/photo-1584362917165-526a968579e8?w=500&auto=format&fit=crop&q=60", "Accurate temperature reading in seconds."]
            ];
            await pool.query("INSERT INTO products (name, category, price, image_url, description) VALUES ?", [mockProducts]);
            console.log("Mock products inserted.");
        }

    } catch (err) {
        console.error("Database initialization failed:", err);
    }
}

initDB();

// ==========================================
// AUTHENTICATION MIDDLEWARE
// ==========================================
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) return res.status(401).json({ success: false, message: "Access Denied: No Token Provided!" });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ success: false, message: "Invalid Token!" });
        req.user = user;
        next();
    });
}

// ==========================================
// 👤 USER SERVICE (Authentication & Profiles)
// ==========================================
// GOOGLE AUTH API
app.post("/api/auth/google", async (req, res) => {
    try {
        const { token, role } = req.body;
        const ticket = await googleClient.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID || '111780913791-qnn4b2m4ir2243m77dicnbbktf6nutkt.apps.googleusercontent.com'
        });
        const payload = ticket.getPayload();
        const email = payload.email;
        const name = payload.name;
        const picture = payload.picture;

        // Check if user exists by email
        let [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
        let user;

        if (rows.length > 0) {
            user = rows[0];
            // Update profile pic if empty
            if (!user.profile_pic && picture) {
                await pool.query("UPDATE users SET profile_pic = ? WHERE id = ?", [picture, user.id]);
                user.profile_pic = picture;
            }
        } else {
            // New Requirement: NO auto-signup.
            return res.status(404).json({ 
                success: false, 
                message: "No account found for this Google email. Please Sign Up first!" 
            });
        }

        const jwtToken = jwt.sign(
            { id: user.id, username: user.username, role: user.role || 'user' },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            message: "Google Login successful!",
            token: jwtToken,
            userId: user.id,
            username: user.username,
            profile_pic: user.profile_pic,
            role: user.role || 'user'
        });
    } catch (err) {
        console.error("Google Auth Error:", err);
        // Include the actual error message to help diagnose the mismatch
        res.status(500).json({ success: false, message: "Google Authentication failed: " + err.message });
    }
});

// FORGOT PASSWORD API
app.post("/api/auth/forgot-password", async (req, res) => {
    try {
        const { role, username, email } = req.body;
        const identifier = email || username;

        // Find user by username or email
        let query = "SELECT id, email, username FROM users WHERE (username = ? OR email = ?)";
        const params = [identifier, identifier];
        if (role) {
            query += " AND role = ?";
            params.push(role);
        }
        const [rows] = await pool.query(query, params);

        if (rows.length > 0) {
            const user = rows[0];
            const userEmail = user.email;

            if (!userEmail) {
                return res.status(400).json({ success: false, message: "No email associated with this account." });
            }

            const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
            await pool.query("UPDATE users SET reset_token = ? WHERE id = ?", [otpCode, user.id]);

            // Send OTP email via Nodemailer
            const mailOptions = {
                from: `"PharmaWave" <${process.env.EMAIL_USER}>`,
                to: userEmail,
                subject: 'Password Reset Code — PharmaWave',
                html: `
                    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 480px; margin: 0 auto; background: #0f172a; border-radius: 16px; overflow: hidden; border: 1px solid #1e293b;">
                        <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); padding: 32px 24px; text-align: center;">
                            <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">PharmaWave</h1>
                            <p style="color: #d1fae5; margin: 8px 0 0; font-size: 14px;">Password Reset Request</p>
                        </div>
                        <div style="padding: 32px 24px;">
                            <p style="color: #e2e8f0; font-size: 15px; line-height: 1.6; margin: 0 0 16px;">Hi <strong>${user.username}</strong>,</p>
                            <p style="color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">Use the code below to reset your password. This code expires in 10 minutes.</p>
                            <div style="background: #1e293b; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
                                <span style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #10b981;">${otpCode}</span>
                            </div>
                            <p style="color: #64748b; font-size: 13px; line-height: 1.5; margin: 0;">If you didn't request this, you can safely ignore this email. Your password will remain unchanged.</p>
                        </div>
                        <div style="padding: 16px 24px; border-top: 1px solid #1e293b; text-align: center;">
                            <p style="color: #475569; font-size: 12px; margin: 0;">© ${new Date().getFullYear()} PharmaWave. All rights reserved.</p>
                        </div>
                    </div>
                `
            };

            await emailTransporter.sendMail(mailOptions);
            console.log(`Password reset OTP sent to ${userEmail}`);

            res.json({ success: true, message: "OTP sent to your email!" });
        } else {
            res.status(404).json({ success: false, message: "No matching account found." });
        }
    } catch (err) {
        console.error("Forgot password error:", err);
        res.status(500).json({ success: false, message: "Failed to send reset email. Please try again." });
    }
});

// RESET PASSWORD API
app.post("/api/auth/reset-password", async (req, res) => {
    try {
        const { otp, newPassword } = req.body;

        if (!otp || !newPassword) return res.status(400).json({ success: false, message: "OTP and new password required" });

        const [rows] = await pool.query("SELECT id FROM users WHERE reset_token = ?", [otp]);

        if (rows.length > 0) {
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            await pool.query("UPDATE users SET password = ?, reset_token = NULL WHERE id = ?", [hashedPassword, rows[0].id]);
            res.json({ success: true, message: "Password updated successfully" });
        } else {
            res.status(400).json({ success: false, message: "Invalid or expired OTP" });
        }
    } catch (err) {
        console.error("Reset password error:", err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// REGISTER API
app.post("/register", async (req, res) => {
    try {
        const { username, password, contact } = req.body;

        if (!username || !password || !contact) {
            return res.status(400).json({ success: false, message: "All fields are required" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        // The existing DB uses the 'email' column for contact info
        const query = `INSERT INTO users (username, password, email) VALUES (?, ?, ?)`;

        await pool.query(query, [username, hashedPassword, contact]);

        // Generate JWT token upon registration
        const [newUser] = await pool.query(`SELECT id, role FROM users WHERE username = ?`, [username]);
        const token = jwt.sign(
            { id: newUser[0].id, username: username, role: newUser[0].role || 'user' },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({ 
            success: true, 
            message: "User registered successfully!", 
            userId: newUser[0].id,
            token: token 
        });
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            return res.status(400).json({ success: false, message: "Username or email already exists" });
        }
        console.error(err);
        res.status(500).send({ message: "Server error" });
    }
});

// LOGIN API
app.post("/login", async (req, res) => {
    try {
        const { username, email, password } = req.body;

        const loginIdentifier = email || username;

        if (!loginIdentifier || !password) {
            return res.status(400).json({ success: false, message: "Email and password required" });
        }

        const query = `SELECT * FROM users WHERE email = ? OR username = ?`;
        const [rows] = await pool.query(query, [loginIdentifier, loginIdentifier]);

        if (rows.length > 0) {
            const user = rows[0];

            // --- BLOCK DELIVERY AGENTS FROM CONSUMER LOGIN ---
            if (user.role === 'delivery') {
                return res.json({
                    success: false,
                    message: "Delivery partners must log in via the Agent Portal."
                });
            }

            const isMatch = await bcrypt.compare(password, user.password);
            const isLegacyMatch = password === user.password;

            if (isMatch || isLegacyMatch) {
                const token = jwt.sign(
                    { id: user.id, username: user.username, role: user.role || 'user' },
                    JWT_SECRET,
                    { expiresIn: '24h' }
                );

                res.json({
                    success: true,
                    message: "Login successful!",
                    token: token,
                    userId: user.id,
                    username: user.username,
                    profile_pic: user.profile_pic,
                    role: user.role || 'user'
                });
            } else {
                res.json({ success: false, message: "Invalid username or password" });
            }
        } else {
            res.json({ success: false, message: "No account found for this user. Please Sign Up first!" });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
    }
});

// AGENT LOGIN API
app.post("/api/agent/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        // Support both username and email as login identifiers
        const [rows] = await pool.query("SELECT * FROM users WHERE username = ? OR email = ?", [username, username]);

        if (rows.length > 0) {
            const user = rows[0];

            // STRICT ROLE CHECK
            if (user.role !== 'delivery') {
                return res.json({
                    success: false,
                    message: "Unauthorized: Customers cannot log in to the delivery system."
                });
            }

            const isMatch = await bcrypt.compare(password, user.password);
            const isLegacyMatch = password === user.password;

            if (isMatch || isLegacyMatch) {
                const token = jwt.sign(
                    { id: user.id, username: user.username, role: 'delivery' },
                    JWT_SECRET,
                    { expiresIn: '24h' }
                );

                res.json({
                    success: true,
                    message: "Agent access granted!",
                    token: token,
                    userId: user.id,
                    username: user.username,
                    profile_pic: user.profile_pic,
                    role: 'delivery'
                });
            } else {
                res.json({ success: false, message: "Invalid agent credentials" });
            }
        } else {
            res.json({ success: false, message: "Invalid agent credentials" });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error" });
    }
});

// AGENT REGISTER API
app.post("/api/agent/register", async (req, res) => {
    try {
        const { username, password, contact } = req.body;

        if (!username || !password || !contact) {
            return res.status(400).json({ success: false, message: "All fields are required" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const query = `INSERT INTO users (username, password, email, contact, role) VALUES (?, ?, ?, ?, 'delivery')`;
 
        // Populate both for compatibility
        await pool.query(query, [username, hashedPassword, contact.includes('@') ? contact : null, contact]);

        const [newUser] = await pool.query(`SELECT id FROM users WHERE username = ?`, [username]);
        const token = jwt.sign(
            { id: newUser[0].id, username: username, role: 'delivery' },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({ success: true, message: "Agent registered successfully!", token: token, role: 'delivery' });
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            return res.status(400).json({ success: false, message: "Username or email already exists" });
        }
        console.error("Agent Registration Error:", err);
        res.status(500).send({ message: "Server error" });
    }
});

// ==========================================
// 💊 MEDICINE SERVICE (Product Catalog)
// ==========================================
// GET PRODUCTS API
app.get("/api/products", async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT * FROM products");
        res.json({ success: true, products: rows });
    } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Server error fetching products" });
    }
});

// ==========================================
// 🛒 ORDER SERVICE (Transaction Management)
// ==========================================
// PLACE ORDER API
app.post("/api/orders", authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { userId, totalAmount, cartItems, addressId, paymentMethod, schedule } = req.body;

        if (!userId || !totalAmount || !cartItems || cartItems.length === 0) {
            return res.status(400).json({ success: false, message: "Invalid order data" });
        }

        // Insert Order without assigning an agent yet (Pooling model)
        const orderQuery = `INSERT INTO orders (user_id, total_amount, agent_id, address_id, payment_method, schedule) VALUES (?, ?, NULL, ?, ?, ?)`;
        const payMethod = paymentMethod || 'COD';
        const orderSchedule = schedule || 'ASAP';
        const [orderResult] = await connection.query(orderQuery, [userId, totalAmount, addressId || null, payMethod, orderSchedule]);
        const orderId = orderResult.insertId;

        // Insert Order Items
        const orderItemsValues = cartItems.map(item => [orderId, item.id, item.quantity, item.price]);
        const orderItemsQuery = `INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ?`;
        await connection.query(orderItemsQuery, [orderItemsValues]);

        await connection.commit();
        io.emit('new_order_pool'); // Alert agents of new order
        res.json({ success: true, message: "Order placed successfully! Preparing Delivery.", orderId: orderId, assignedAgent: null });
    } catch (err) {
        await connection.rollback();
        console.error("Order process failed:", err);
        res.status(500).send({ message: "Server error processing order" });
    } finally {
        connection.release();
    }
});

// GET USER ORDERS
app.get("/api/orders/user/:id", authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;
        // Basic Authorization check
        if (req.user.role !== 'admin' && req.user.id != userId) {
            return res.status(403).json({ success: false, message: "Unauthorized access to these orders" });
        }
        const query = `
            SELECT o.id, o.total_amount, o.status, o.created_at, 
                   COUNT(oi.id) as total_items
            FROM orders o
            LEFT JOIN order_items oi ON o.id = oi.order_id
            WHERE o.user_id = ?
            GROUP BY o.id
            ORDER BY o.created_at DESC
        `;
        const [rows] = await pool.query(query, [userId]);
        res.json({ success: true, orders: rows });
    } catch (err) {
        console.error("Fetch orders failed:", err);
        res.status(500).send({ message: "Server error fetching orders" });
    }
});

// GET ACTIVE AGENT ORDERS
app.get("/api/agent/orders", authenticateToken, async (req, res) => {
    try {
        const agentId = req.query.agentId;

        if (req.user.role !== 'delivery' && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: "Only delivery agents can access this." });
        }

        if (!agentId) {
            return res.status(400).json({ success: false, message: "Agent ID required" });
        }

        // Query to get all orders that are not fully delivered AND match the assigned agent
        // Joining with users for contact info
        const orderQuery = `
            SELECT o.id as order_id, o.total_amount, o.status, o.created_at, 
                   u.username as customer_name, u.contact as customer_phone, u.email as customer_email
            FROM orders o
            JOIN users u ON o.user_id = u.id
            WHERE (o.status != 'Delivered' OR o.status IS NULL) 
              AND o.agent_id = ?
            ORDER BY o.created_at ASC
        `;
        const [orders] = await pool.query(orderQuery, [agentId]);

        // For each order, get the attached items
        for (let i = 0; i < orders.length; i++) {
            const itemQuery = `
                SELECT oi.quantity, p.name as product_name
                FROM order_items oi
                JOIN products p ON oi.product_id = p.id
                WHERE oi.order_id = ?
            `;
            const [items] = await pool.query(itemQuery, [orders[i].order_id]);
            orders[i].items = items;
        }

        res.json({ success: true, activeOrders: orders });
    } catch (err) {
        console.error("Fetch agent orders failed:", err);
        res.status(500).send({ message: "Server error fetching active orders" });
    }
});

// GET AGENT PROFILE
app.get("/api/agent/profile/:id", authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;
        if (req.user.role !== 'admin' && req.user.id != userId) {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }
        const query = `SELECT username, contact as phone, email, vehicle_type, vehicle_number, availability, profile_pic FROM users WHERE id = ?`;
        const [rows] = await pool.query(query, [userId]);

        if (rows.length > 0) {
            res.json({ success: true, profile: rows[0] });
        } else {
            res.json({ success: false, message: "Agent not found" });
        }
    } catch (err) {
        console.error("Fetch agent profile failed:", err);
        res.status(500).send({ message: "Server error fetching agent profile" });
    }
});

// UPDATE AGENT PROFILE
app.post("/api/agent/profile/:id", authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;
        if (req.user.id != userId) return res.status(403).json({ success: false, message: "Unauthorized" });
        const { username, phone, vehicle_type, vehicle_number, availability } = req.body;

        const query = `
            UPDATE users 
            SET username = ?, email = ?, vehicle_type = ?, vehicle_number = ?, availability = ? 
            WHERE id = ?
        `;
        await pool.query(query, [username, phone, vehicle_type, vehicle_number, availability || 'Online', userId]);

        res.json({ success: true, message: "Profile updated successfully!" });
    } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
            return res.status(400).json({ success: false, message: "Username is already taken." });
        }
        console.error("Update agent profile failed:", err);
        res.status(500).send({ message: "Server error updating agent profile" });
    }
});

// UPDATE USER AVATAR
app.post("/api/user/:id/avatar", async (req, res) => {
    try {
        const userId = req.params.id;
        const { avatarDataUrl } = req.body; // Base64 image

        if (!avatarDataUrl) {
            return res.status(400).json({ success: false, message: "No image provided" });
        }

        const query = `UPDATE users SET profile_pic = ? WHERE id = ?`;
        await pool.query(query, [avatarDataUrl, userId]);

        res.json({ success: true, message: "Profile picture updated!" });
    } catch (err) {
        console.error("Avatar upload failed:", err);
        res.status(500).send({ message: "Server error updating profile picture" });
    }
});

// UPDATE USERNAME
app.post("/api/user/:id/username", authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;
        if (req.user.id != userId) return res.status(403).json({ success: false, message: "Unauthorized" });
        const { newUsername } = req.body;

        if (!newUsername || newUsername.trim() === '') {
            return res.status(400).json({ success: false, message: "Username cannot be empty" });
        }

        const query = `UPDATE users SET username = ? WHERE id = ?`;
        await pool.query(query, [newUsername.trim(), userId]);

        res.json({ success: true, message: "Username updated successfully!", newUsername: newUsername.trim() });
    } catch (err) {
        console.error("Username update failed:", err);
        if (err.code === "ER_DUP_ENTRY") {
            return res.status(400).json({ success: false, message: "Username is already taken. Please choose another one." });
        }
        res.status(500).send({ message: "Server error updating username." });
    }
});

// GET USER ADDRESSES
app.get("/api/user/:id/addresses", authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;
        if (String(req.user.id) !== String(userId) && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }
        const [rows] = await pool.query("SELECT * FROM addresses WHERE user_id = ?", [userId]);
        res.json({ success: true, addresses: rows });
    } catch (err) {
        console.error("Fetch addresses failed:", err);
        res.status(500).send({ message: "Server error fetching addresses" });
    }
});

// ADD USER ADDRESS
app.post("/api/user/:id/addresses", authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;
        if (String(req.user.id) !== String(userId) && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }
        const { title, full_address, is_default } = req.body;

        if (!title || !full_address) {
            return res.status(400).json({ success: false, message: "Title and Address are required." });
        }

        // If making this default, reset others
        if (is_default) {
            await pool.query("UPDATE addresses SET is_default = FALSE WHERE user_id = ?", [userId]);
        }

        const query = `INSERT INTO addresses (user_id, title, full_address, is_default) VALUES (?, ?, ?, ?)`;
        await pool.query(query, [userId, title, full_address, is_default ? true : false]);

        res.json({ success: true, message: "Address saved successfully!" });
    } catch (err) {
        console.error("Add address failed:", err);
        res.status(500).send({ message: "Server error adding address." });
    }
});

// DELETE USER ADDRESS
app.delete("/api/user/:id/addresses/:addressId", authenticateToken, async (req, res) => {
    try {
        const { id, addressId } = req.params;
        if (req.user.id != id && req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Unauthorized" });
        await pool.query("DELETE FROM addresses WHERE id = ? AND user_id = ?", [addressId, id]);
        res.json({ success: true, message: "Address deleted successfully!" });
    } catch (err) {
        console.error("Delete address failed:", err);
        res.status(500).send({ message: "Server error deleting address." });
    }
});

// ==========================================
// USER PRESCRIPTIONS APIs
// ==========================================

// Get User Prescriptions
app.get("/api/user/:id/prescriptions", authenticateToken, async (req, res) => {
    try {
        if (String(req.user.id) !== String(req.params.id) && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }
        const [rows] = await pool.query("SELECT * FROM prescriptions WHERE user_id = ? ORDER BY uploaded_at DESC", [req.params.id]);
        res.json({ success: true, prescriptions: rows });
    } catch (err) {
        console.error("Fetch prescriptions failed:", err);
        res.status(500).send({ message: "Server error fetching prescriptions." });
    }
});

// Upload Prescription (Base64)
app.post("/api/user/:id/prescriptions", authenticateToken, async (req, res) => {
    try {
        if (String(req.user.id) !== String(req.params.id)) {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }
        const { imageData } = req.body;
        if (!imageData) return res.status(400).json({ success: false, message: "No image data provided" });

        await pool.query("INSERT INTO prescriptions (user_id, image_data) VALUES (?, ?)", [req.params.id, imageData]);
        res.json({ success: true, message: "Prescription uploaded successfully for review!" });
    } catch (err) {
        console.error("Upload prescription failed:", err);
        res.status(500).send({ message: "Server error uploading prescription." });
    }
});

// Book Doctor Consultation
app.post("/api/consultations", authenticateToken, async (req, res) => {
    try {
        const { userId, doctorName, date, time } = req.body;
        if (req.user.id != userId) return res.status(403).json({ success: false, message: "Unauthorized" });
        if (!doctorName || !date || !time) return res.status(400).json({ success: false, message: "Missing required fields" });
        
        // Mock successful saving of appointment
        // We'll just return a success payload. In a real db we'd INSERT into a consultations table.
        res.json({ success: true, message: `Appointment confirmed with ${doctorName} on ${date} at ${time}. Link sent to your email!` });
    } catch (err) {
        console.error("Booking failed:", err);
        res.status(500).send({ message: "Server error booking consultation." });
    }
});

// ==========================================
// ADMIN DASHBOARD APIs
// ==========================================

// Get Dashboard Statistics
app.get("/api/admin/stats", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Admin access required" });
        const [users] = await pool.query("SELECT COUNT(*) as total FROM users WHERE role = 'user'");
        const [orders] = await pool.query("SELECT COUNT(*) as total FROM orders");
        const [revenue] = await pool.query("SELECT SUM(total_amount) as total FROM orders WHERE status = 'Delivered'");
        const [inventory] = await pool.query("SELECT COUNT(*) as low_stock FROM products WHERE stock < 20");

        res.json({
            success: true,
            stats: {
                totalUsers: users[0].total,
                totalOrders: orders[0].total,
                totalRevenue: revenue[0].total || 0,
                lowStockItems: inventory[0].low_stock
            }
        });
    } catch (err) {
        console.error("Fetch stats failed:", err);
        res.status(500).send({ message: "Server error fetching stats" });
    }
});

// Get All Users
app.get("/api/admin/users", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Admin access required" });
        const [rows] = await pool.query("SELECT id, username, email, contact, role FROM users ORDER BY id DESC");
        res.json({ success: true, users: rows });
    } catch (err) {
        console.error("Fetch users failed:", err);
        res.status(500).send({ message: "Server error fetching users" });
    }
});

app.delete("/api/admin/users/:id", authenticateToken, async (req, res) => {
    const connection = await pool.getConnection();
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Admin access required" });
        const userId = req.params.id;
        
        if (userId == req.user.id) return res.status(400).json({ success: false, message: "Cannot delete your own admin account" });

        await connection.beginTransaction();

        // 1. If agent, clear their assignments first
        await connection.query("UPDATE orders SET agent_id = NULL WHERE agent_id = ?", [userId]);

        // 2. Delete orders (and their items) if they are the customer
        const [userOrders] = await connection.query("SELECT id FROM orders WHERE user_id = ?", [userId]);
        for (const order of userOrders) {
            await connection.query("DELETE FROM order_items WHERE order_id = ?", [order.id]);
            await connection.query("DELETE FROM orders WHERE id = ?", [order.id]);
        }

        // 3. Delete other dependencies
        const [userData] = await connection.query("SELECT email FROM users WHERE id = ?", [userId]);
        const userEmail = userData.length > 0 ? userData[0].email : null;

        await connection.query("DELETE FROM prescriptions WHERE user_id = ?", [userId]);
        await connection.query("DELETE FROM addresses WHERE user_id = ?", [userId]);
        await connection.query("DELETE FROM consultations WHERE user_id = ?", [userId]);
        await connection.query("DELETE FROM user_cards WHERE user_id = ?", [userId]);
        await connection.query("DELETE FROM login WHERE id = ?", [userId]);
        if (userEmail) {
            await connection.query("DELETE FROM usrs WHERE email = ?", [userEmail]);
        }
        
        // 4. Finally delete the user
        await connection.query("DELETE FROM users WHERE id = ?", [userId]);

        await connection.commit();
        res.json({ success: true, message: "User/Agent and all related data removed" });
    } catch (err) {
        if (connection) await connection.rollback();
        console.error("Cascaded delete user failed:", err);
        res.status(500).send({ message: "Server error during cascaded deletion: " + err.message });
    } finally {
        if (connection) connection.release();
    }
});

// Get All Orders for Admin (with customer and agent info)
app.get("/api/admin/orders", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Admin access required" });
        const [orders] = await pool.query(`
            SELECT o.id, o.total_amount, o.status, o.created_at, o.agent_id,
                   u.username as customer_name, a.full_address,
                   ag.username as agent_name
            FROM orders o
            LEFT JOIN users u ON o.user_id = u.id
            LEFT JOIN addresses a ON o.address_id = a.id
            LEFT JOIN users ag ON o.agent_id = ag.id
            ORDER BY o.created_at DESC
        `);
        res.json({ success: true, orders });
    } catch (err) {
        console.error("Admin fetch orders failed:", err);
        res.status(500).send({ message: "Server error fetching orders" });
    }
});

// Get All Delivery Agents
app.get("/api/admin/agents", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Admin access required" });
        const [agents] = await pool.query("SELECT id, username, contact, vehicle_type, availability FROM users WHERE role = 'delivery'");
        res.json({ success: true, agents });
    } catch (err) {
        console.error("Fetch agents failed:", err);
        res.status(500).send({ message: "Server error fetching agents" });
    }
});

// Get Single Order Detail
app.get("/api/admin/orders/:id", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Admin access required" });
        const [order] = await pool.query(`
            SELECT o.*, u.username as customer_name, u.contact as customer_phone, a.full_address 
            FROM orders o 
            LEFT JOIN users u ON o.user_id = u.id 
            LEFT JOIN addresses a ON o.address_id = a.id
            WHERE o.id = ?
        `, [req.params.id]);

        if (order.length === 0) return res.status(404).json({ success: false, message: "Order not found" });

        const [items] = await pool.query(`
            SELECT oi.*, p.name as product_name, p.image_url 
            FROM order_items oi 
            JOIN products p ON oi.product_id = p.id 
            WHERE oi.order_id = ?
        `, [req.params.id]);

        // Fetch latest prescription if available
        const [prescriptions] = await pool.query(`
            SELECT image_data FROM prescriptions 
            WHERE user_id = ? 
            ORDER BY uploaded_at DESC LIMIT 1
        `, [order[0].user_id]);

        res.json({ 
            success: true, 
            order: order[0], 
            items,
            prescription: prescriptions.length > 0 ? prescriptions[0].image_data : null 
        });
    } catch (err) {
        console.error("Fetch order detail failed:", err);
        res.status(500).send({ message: "Server error fetching order details" });
    }
});

// Assign Agent to Order
app.post("/api/admin/orders/:id/assign", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Admin access required" });
        const { agentId } = req.body;
        const orderId = req.params.id;

        if (!agentId) return res.status(400).json({ success: false, message: "Agent ID required" });

        await pool.query("UPDATE orders SET agent_id = ?, status = 'Ready for Delivery' WHERE id = ?", [agentId, orderId]);

        // Get user_id of the order to notify them
        const [rows] = await pool.query("SELECT user_id FROM orders WHERE id = ?", [orderId]);
        if (rows.length > 0) {
            io.emit(`order_update_${rows[0].user_id}`, { orderId, status: 'Agent Assigned' });
        }
        
        // Notify the specific agent
        io.emit('new_delivery', { agentId, orderId });

        res.json({ success: true, message: "Agent assigned successfully!" });
    } catch (err) {
        console.error("Order assignment failed:", err);
        res.status(500).send({ message: "Server error assigning agent" });
    }
});

app.put("/api/admin/orders/:id/status", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Admin access required" });
        const { status } = req.body;
        const orderId = req.params.id;
        
        await pool.query("UPDATE orders SET status = ? WHERE id = ?", [status, orderId]);
        
        const [rows] = await pool.query("SELECT user_id FROM orders WHERE id = ?", [orderId]);
        if (rows.length > 0) {
            io.emit(`order_update_${rows[0].user_id}`, { orderId, status });
        }
        
        res.json({ success: true, message: `Order status updated to ${status}` });
    } catch (err) {
        console.error("Update order status failed:", err);
        res.status(500).send({ message: "Server error updating order status" });
    }
});

// Manage Inventory (Add/Update Product)
app.post("/api/admin/products", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Admin access required" });
        const { id, name, category, price, stock, image_url, description, expiry_date } = req.body;
        if (id) {
            // Update
            await pool.query(
                "UPDATE products SET name = ?, category = ?, price = ?, stock = ?, image_url = ?, description = ?, expiry_date = ? WHERE id = ?",
                [name, category, price, stock, image_url, description, expiry_date, id]
            );
            res.json({ success: true, message: "Product updated!" });
        } else {
            // Create
            await pool.query(
                "INSERT INTO products (name, category, price, stock, image_url, description, expiry_date) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [name, category, price, stock, image_url, description, expiry_date]
            );
            res.json({ success: true, message: "Product added!" });
        }
    } catch (err) {
        console.error("Manage product failed:", err);
        res.status(500).send({ success: false, message: "Server error managing product (v4): " + err.message });
    }
});

app.put("/api/admin/products/:id", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Admin access required" });
        const { id, name, category, price, stock, image_url, description, expiry_date } = req.body;
        const productId = req.params.id || id;
        
        await pool.query(
            "UPDATE products SET name = ?, category = ?, price = ?, stock = ?, image_url = ?, description = ?, expiry_date = ? WHERE id = ?",
            [name, category, price, stock, image_url, description, expiry_date, productId]
        );
        res.json({ success: true, message: "Product updated!" });
    } catch (err) {
        console.error("Update product failed:", err);
        res.status(500).send({ success: false, message: "Server error updating product: " + err.message });
    }
});

app.delete("/api/admin/products/:id", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Admin access required" });
        await pool.query("DELETE FROM products WHERE id = ?", [req.params.id]);
        res.json({ success: true, message: "Product deleted" });
    } catch (err) {
        console.error("Delete product failed:", err);
        res.status(500).send({ message: "Cannot delete product (may have existing orders)." });
    }
});

// Get Pharmacies
app.get("/api/admin/pharmacies", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Admin access required" });
        const [rows] = await pool.query("SELECT * FROM pharmacies ORDER BY joined_at DESC");
        res.json({ success: true, pharmacies: rows });
    } catch (err) {
        console.error("Fetch pharmacies failed:", err);
        res.status(500).send({ message: "Server error fetching pharmacies" });
    }
});

app.post("/api/admin/pharmacies", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Admin access required" });
        const { name, location, contact } = req.body;
        await pool.query("INSERT INTO pharmacies (name, location, contact) VALUES (?, ?, ?)", [name, location, contact]);
        res.json({ success: true, message: "Pharmacy registered successfully" });
    } catch (err) {
        console.error("Add pharmacy failed:", err);
        res.status(500).send({ message: "Server error adding pharmacy" });
    }
});

// Upload Image API
app.post("/api/admin/upload", authenticateToken, upload.single('image'), (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Admin access required" });
        if (!req.file) {
            console.error("Upload error: No file received in req.file");
            return res.status(400).json({ success: false, message: "No file uploaded" });
        }
        
        const imageUrl = `/uploads/${req.file.filename}`;
        console.log(`File uploaded successfully: ${imageUrl}`);
        res.json({ success: true, imageUrl });
    } catch (err) {
        console.error("Upload failed in endpoint:", err);
        res.status(500).json({ success: false, message: "Upload failed: " + err.message });
    }
});

// ==========================================
// PHARMACY DASHBOARD APIs
// ==========================================

// Get all orders mapped to this pharmacy (or all orders for mock version)
app.get("/api/pharmacy/orders", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'pharmacy' && req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Pharmacy access required" });
        const [orders] = await pool.query(`
            SELECT o.id, o.total_amount, o.status, o.payment_method, o.schedule, o.created_at, u.username as customer_name, a.full_address 
            FROM orders o 
            LEFT JOIN users u ON o.user_id = u.id 
            LEFT JOIN addresses a ON o.address_id = a.id
            ORDER BY o.created_at DESC
        `);
        res.json({ success: true, orders });
    } catch (err) {
        console.error("Pharmacy fetch orders failed:", err);
        res.status(500).send({ message: "Server error fetching pharmacy orders." });
    }
});

// Update Order Preparation Status
app.put("/api/pharmacy/orders/:id/status", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'pharmacy' && req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Pharmacy access required" });
        const { status } = req.body; // e.g. "Preparing", "Ready for Delivery", "Rejected"
        if (!status) return res.status(400).json({ success: false, message: "Status required" });
        await pool.query("UPDATE orders SET status = ? WHERE id = ?", [status, req.params.id]);
        res.json({ success: true, message: "Order status updated to " + status });
    } catch (err) {
        console.error("Pharmacy order status update failed:", err);
        res.status(500).send({ message: "Server error updating order status." });
    }
});

// Get Specific Order with Items
app.get("/api/orders/:id", authenticateToken, async (req, res) => {
    try {
        const [orders] = await pool.query("SELECT * FROM orders WHERE id = ?", [req.params.id]);
        if (orders.length === 0) return res.status(404).json({ success: false, message: "Order not found" });

        const [items] = await pool.query(`
            SELECT oi.*, p.name, p.image_url 
            FROM order_items oi 
            JOIN products p ON oi.product_id = p.id 
            WHERE oi.order_id = ?
        `, [req.params.id]);

        res.json({ success: true, order: orders[0], items: items });
    } catch (err) {
        console.error("Fetch order details failed:", err);
        res.status(500).send({ message: "Server error fetching order details" });
    }
});


// ==========================================
// USER PROFILE APIscription
app.get("/api/pharmacy/prescriptions", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'pharmacy' && req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Pharmacy access required" });
        const [prescriptions] = await pool.query(`
            SELECT p.*, u.username as customer_name 
            FROM prescriptions p 
            JOIN users u ON p.user_id = u.id 
            ORDER BY p.uploaded_at DESC
        `);
        res.json({ success: true, prescriptions });
    } catch (err) {
        console.error("Pharmacy fetch prescriptions failed:", err);
        res.status(500).send({ message: "Server error fetching prescriptions." });
    }
});

// Verify Prescription
app.put("/api/pharmacy/prescriptions/:id/status", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'pharmacy' && req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Pharmacy access required" });
        const { status } = req.body; // "Approved" or "Rejected"
        if (!status) return res.status(400).json({ success: false, message: "Status required" });
        await pool.query("UPDATE prescriptions SET status = ? WHERE id = ?", [status, req.params.id]);
        res.json({ success: true, message: "Prescription marked as " + status });
    } catch (err) {
        console.error("Pharmacy prescription status update failed:", err);
        res.status(500).send({ message: "Server error updating prescription status." });
    }
});

// ==========================================
// DELIVERY PARTNER DASHBOARD APIs
// ==========================================

// Pool of unassigned orders
app.get("/api/delivery/pool", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'delivery' && req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Delivery access required" });
        const [orders] = await pool.query(`
            SELECT o.id, o.total_amount, o.status, o.payment_method, u.username as customer_name, u.contact as customer_phone, a.full_address 
            FROM orders o 
            LEFT JOIN users u ON o.user_id = u.id 
            LEFT JOIN addresses a ON o.address_id = a.id
            WHERE o.agent_id IS NULL AND (o.status = 'Ready for Delivery' OR o.status = 'Pending' OR o.status = 'Preparing')
            ORDER BY o.created_at ASC
        `);
        res.json({ success: true, orders });
    } catch (err) {
        console.error("Fetch pool orders failed:", err);
        res.status(500).send({ message: "Server error fetching pool orders." });
    }
});

// Accept order from pool
app.post("/api/delivery/accept/:id", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'delivery' && req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Delivery access required" });
        
        const [result] = await pool.query(
            "UPDATE orders SET agent_id = ?, status = 'Ready for Delivery' WHERE id = ? AND agent_id IS NULL", 
            [req.user.id, req.params.id]
        );
        
        if (result.affectedRows === 0) {
            return res.status(400).json({ success: false, message: "Order already taken or invalid." });
        }
        
        const [rows] = await pool.query("SELECT user_id FROM orders WHERE id = ?", [req.params.id]);
        if (rows.length > 0) {
           io.emit(`order_update_${rows[0].user_id}`, { orderId: req.params.id, status: 'Agent Assigned' });
        }
        io.emit('new_order_pool');
        res.json({ success: true, message: "Order accepted successfully!" });
    } catch (err) {
        console.error("Accept order failed:", err);
        res.status(500).send({ message: "Server error accepting order." });
    }
});

// Get Orders Assigned to Delivery Agent
app.get("/api/delivery/assigned", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'delivery' && req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Delivery access required" });
        const [orders] = await pool.query(`
            SELECT o.id, o.total_amount, o.status, o.payment_method, u.username as customer_name, u.contact as customer_phone, a.full_address 
            FROM orders o 
            LEFT JOIN users u ON o.user_id = u.id 
            LEFT JOIN addresses a ON o.address_id = a.id
            WHERE o.agent_id = ? AND o.status NOT IN ('Delivered', 'Review', 'Rejected')
            ORDER BY o.created_at ASC
        `, [req.user.id]);
        res.json({ success: true, orders });
    } catch (err) {
        console.error("Fetch delivery orders failed:", err);
        res.status(500).send({ message: "Server error fetching delivery orders." });
    }
});

// Update Delivery Status (and emit socket)
app.put("/api/delivery/order/:id/status", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'delivery' && req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Delivery access required" });
        const { status, lat, lng } = req.body; 
        if (!status) return res.status(400).json({ success: false, message: "Status required" });
        await pool.query("UPDATE orders SET status = ? WHERE id = ? AND agent_id = ?", [status, req.params.id, req.user.id]);
        
        const [rows] = await pool.query("SELECT user_id FROM orders WHERE id = ?", [req.params.id]);
        if (rows.length > 0) {
            io.emit(`order_update_${rows[0].user_id}`, { orderId: req.params.id, status, lat, lng });
        }
        
        res.json({ success: true, message: "Delivery status updated to " + status });
    } catch (err) {
        console.error("Update delivery status failed:", err);
        res.status(500).send({ message: "Server error updating delivery status." });
    }
});

// Rate an Order
app.post("/api/user/order/:id/rate", authenticateToken, async (req, res) => {
    try {
        const { rating } = req.body;
        await pool.query("UPDATE orders SET delivery_rating = ? WHERE id = ? AND user_id = ?", [rating, req.params.id, req.user.id]);
        res.json({ success: true, message: "Rating saved. Thank you!" });
    } catch (error) {
        console.error("Save rating failed", error);
        res.status(500).send({ message: "Server error saving rating." });
    }
});

// Card Management
app.get("/api/user/:id/cards", authenticateToken, async (req, res) => {
    try {
        if (req.user.id != req.params.id && req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Unauthorized" });
        const [cards] = await pool.query("SELECT * FROM user_cards WHERE user_id = ?", [req.params.id]);
        res.json({ success: true, cards });
    } catch (err) {
        res.status(500).json({ success: false, message: "Error fetching cards" });
    }
});

app.post("/api/user/:id/cards", authenticateToken, async (req, res) => {
    try {
        const { cardTitle, cardNumber, expiry } = req.body;
        const masked = "**** **** **** " + cardNumber.slice(-4);
        await pool.query("INSERT INTO user_cards (user_id, card_title, card_number, expiry) VALUES (?, ?, ?, ?)", [req.user.id, cardTitle, masked, expiry]);
        res.json({ success: true, message: "Card saved safely" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Error saving card" });
    }
});

app.delete("/api/user/:userId/cards/:cardId", authenticateToken, async (req, res) => {
    try {
        await pool.query("DELETE FROM user_cards WHERE id = ? AND user_id = ?", [req.params.cardId, req.user.id]);
        res.json({ success: true, message: "Card removed" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Error deleting card" });
    }
});

// Settings Preferences
app.put("/api/user/:id/settings", authenticateToken, async (req, res) => {
    try {
        const { email_notifications, sms_alerts } = req.body;
        await pool.query("UPDATE users SET email_notifications = ?, sms_alerts = ? WHERE id = ?", [email_notifications, sms_alerts, req.user.id]);
        res.json({ success: true, message: "Settings updated" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Error updating settings" });
    }
});

// Order Tracking
app.get("/api/orders/:id/track", authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT o.id, o.status, o.lat, o.lng, u.username as agent_name, u.contact as agent_phone 
            FROM orders o 
            LEFT JOIN users u ON o.agent_id = u.id 
            WHERE o.id = ? AND (o.user_id = ? OR o.agent_id = ? OR ?='admin')
        `, [req.params.id, req.user.id, req.user.id, req.user.role]);
        
        if (rows.length === 0) return res.status(404).json({ success: false, message: "Tracking info not found" });
        res.json({ success: true, tracking: rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, message: "Error fetching tracking info" });
    }
});

// Consultation Booking
app.post("/api/consultations", authenticateToken, async (req, res) => {
    try {
        const { doctorName, subject, date, time } = req.body;
        await pool.query("INSERT INTO consultations (user_id, doctor_name, subject, date, time) VALUES (?, ?, ?, ?, ?)", [req.user.id, doctorName, subject || 'General Checkup', date, time]);
        res.json({ success: true, message: `Consultation with ${doctorName} booked for ${date} at ${time}.` });
    } catch (err) {
        console.error("Consultation booking failed:", err);
        res.status(500).json({ success: false, message: "Error booking consultation" });
    }
});

app.get("/api/user/:id/consultations", authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT * FROM consultations WHERE user_id = ? ORDER BY date DESC, time DESC", [req.user.id]);
        res.json({ success: true, consultations: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: "Error fetching consultations" });
    }
});

// Get Agent Earnings (Sum of delivered orders delivery fee mock)
app.get("/api/delivery/earnings", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'delivery' && req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Delivery access required" });
        // Mocking ₹50 per delivered order assigned to this agent
        const [rows] = await pool.query("SELECT COUNT(*) as count FROM orders WHERE agent_id = ? AND status = 'Delivered'", [req.user.id]);
        const trips = rows[0].count;
        res.json({ success: true, earnings: trips * 50, trips });
    } catch (err) {
        res.status(500).json({ success: false, message: "Error fetching earnings" });
    }
});

// ==========================================
// ADVANCED FEATURES APIs (Phase 5)
// ==========================================

// Mock AI Medicine Recommendation (by symptom)
app.post("/api/ai/recommend", async (req, res) => {
    try {
        const { symptom } = req.body;
        if (!symptom) return res.status(400).json({ success: false, message: "Symptom required" });

        const symptomLower = symptom.toLowerCase();
        let targetCategory = null;

        // Handle Greetings
        if (symptomLower.match(/\b(hi|hello|hey|greetings|hola)\b/)) {
            return res.json({
                success: true,
                message: "👋 Hello! I'm your PharmaWave AI Pharmacist. How can I help you today? Tell me your symptoms like 'I have a headache' or 'I feel weak'.",
                products: []
            });
        }

        // Logic for mapping symptoms to categories
        if (symptomLower.includes('pain') || symptomLower.includes('headache') || symptomLower.includes('backache')) targetCategory = "Pain Relief";
        else if (symptomLower.includes('fever') || symptomLower.includes('cold') || symptomLower.includes('flu') || symptomLower.includes('cough')) targetCategory = "Cold & Flu";
        else if (symptomLower.includes('weak') || symptomLower.includes('vitamin') || symptomLower.includes('energy')) targetCategory = "Vitamins";
        else if (symptomLower.includes('infection') || symptomLower.includes('bacteria')) targetCategory = "Antibiotics";
        else if (symptomLower.includes('allergy') || symptomLower.includes('itch') || symptomLower.includes('sneeze')) targetCategory = "Allergy";
        else if (symptomLower.includes('injury') || symptomLower.includes('cut') || symptomLower.includes('wound') || symptomLower.includes('kit') || symptomLower.includes('burn')) targetCategory = "First Aid";

        if (targetCategory) {
            const [recommendations] = await pool.query("SELECT * FROM products WHERE category = ? LIMIT 3", [targetCategory]);
            res.json({
                success: true,
                message: `🤖 AI Diagnosis: I recommend products from our **${targetCategory}** category. Hope you feel better soon!`,
                products: recommendations
            });
        } else {
            res.json({
                success: true,
                message: "I'm not quite sure how to help with that specifically. Could you describe your symptoms more clearly? (E.g. fever, headache, allergy)",
                products: []
            });
        }
    } catch (err) {
        console.error("AI recommend failed:", err);
        res.status(500).send({ message: "Server error generating AI recommendation." });
    }
});

// Mock AI Substitute Suggestions
app.get("/api/ai/substitute/:name", async (req, res) => {
    try {
        const productName = req.params.name.toLowerCase();
        // Just return medicines in the same category that aren't the exact one
        const [original] = await pool.query("SELECT category FROM products WHERE LOWER(name) = ?", [productName]);

        if (original.length === 0) return res.json({ success: true, substitutes: [] });

        const [substitutes] = await pool.query("SELECT * FROM products WHERE category = ? AND LOWER(name) != ? LIMIT 3", [original[0].category, productName]);
        res.json({ success: true, substitutes });
    } catch (err) {
        console.error("AI substitute failed:", err);
        res.status(500).send({ message: "Server error finding substitutes." });
    }
});

// ==========================================
// 🛒 CART PERSISTENCE APIs
// ==========================================

// Get User Cart
app.get("/api/user/:id/cart", authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;
        if (req.user.id != userId && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }
        const [rows] = await pool.query("SELECT cart_data FROM users WHERE id = ?", [userId]);
        if (rows.length > 0) {
            res.json({ success: true, cart: rows[0].cart_data ? JSON.parse(rows[0].cart_data) : [] });
        } else {
            res.status(404).json({ success: false, message: "User not found" });
        }
    } catch (err) {
        console.error("Fetch cart failed:", err);
        res.status(500).send({ message: "Server error fetching cart" });
    }
});

// Save User Cart
app.post("/api/user/:id/cart", authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;
        if (req.user.id != userId && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }
        const { cart } = req.body;
        await pool.query("UPDATE users SET cart_data = ? WHERE id = ?", [JSON.stringify(cart), userId]);
        res.json({ success: true, message: "Cart saved successfully!" });
    } catch (err) {
        console.error("Save cart failed:", err);
        res.status(500).send({ message: "Server error saving cart" });
    }
});

// Monthly Medicine Subscription
app.post("/api/subscriptions", authenticateToken, async (req, res) => {
    try {
        const { cartItems } = req.body;
        // Mocking subscription storage - in production we'd have a `subscriptions` table
        res.json({ success: true, message: "Monthly refill subscription activated for " + cartItems.length + " items!" });
    } catch (err) {
        res.status(500).send({ message: "Server error starting subscription." });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});