const express = require("express");
const mysql = require("mysql2/promise");
const bodyParser = require("body-parser");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const http = require("http");
const { Server } = require("socket.io");
const admin = require("firebase-admin");

// Initialize Firebase Admin SDK (no service account needed — uses projectId to fetch Google's public keys)
if (!admin.apps.length) {
    admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID || 'pro-pharma-wave'
    });
}
const path = require("path");
const os = require("os");
const nodemailer = require("nodemailer");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, '.env') });
// Support for Render Secret Files
const secretPath = path.join('/etc/secrets', '.env');
if (fs.existsSync(secretPath)) {
    require("dotenv").config({ path: secretPath });
    console.log("Loaded additional environment variables from Render Secret File.");
}

// Configure Nodemailer transporter with Gmail SMTP
const emailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});


// google-auth-library is no longer needed; Firebase Admin handles token verification

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
        await pool.query(`CREATE TABLE IF NOT EXISTS users (
            id INT AUTO_INCREMENT PRIMARY KEY,
            username VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            email VARCHAR(255),
            contact VARCHAR(255),
            full_name VARCHAR(255),
            profile_pic LONGTEXT,
            role VARCHAR(50) DEFAULT 'user',
            vehicle_type VARCHAR(50),
            vehicle_number VARCHAR(100),
            availability VARCHAR(50) DEFAULT 'Online',
            reset_token VARCHAR(255),
            email_notifications BOOLEAN DEFAULT TRUE,
            sms_alerts BOOLEAN DEFAULT TRUE,
            cart_data LONGTEXT
        )`);
        await pool.query(`CREATE TABLE IF NOT EXISTS products (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            category VARCHAR(255),
            price DECIMAL(10, 2) NOT NULL,
            image_url VARCHAR(500),
            description TEXT,
            stock INT DEFAULT 100,
            expiry_date DATE,
            prescription_required BOOLEAN DEFAULT FALSE,
            manufacturer VARCHAR(255),
            discount DECIMAL(10, 2) DEFAULT 0.00,
            min_stock INT DEFAULT 10,
            is_active BOOLEAN DEFAULT TRUE
        )`);
        await pool.query(`CREATE TABLE IF NOT EXISTS orders (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT,
            order_number VARCHAR(50) UNIQUE,
            total_amount DECIMAL(10, 2) NOT NULL,
            subtotal DECIMAL(10, 2) DEFAULT 0.00,
            delivery_charge DECIMAL(10, 2) DEFAULT 0.00,
            status VARCHAR(50) DEFAULT 'Pending',
            payment_method VARCHAR(50) DEFAULT 'COD',
            payment_status VARCHAR(50) DEFAULT 'Pending',
            address_id INT,
            prescription_id INT,
            agent_id INT,
            schedule VARCHAR(50) DEFAULT 'ASAP',
            delivery_rating INT DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (address_id) REFERENCES addresses(id)
        )`);
        await pool.query(`CREATE TABLE IF NOT EXISTS addresses (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            full_name VARCHAR(255) NOT NULL,
            mobile VARCHAR(20) NOT NULL,
            house_number VARCHAR(100),
            street VARCHAR(255),
            city VARCHAR(120),
            state VARCHAR(120),
            pincode VARCHAR(20),
            landmark VARCHAR(255),
            label VARCHAR(50),
            full_address TEXT NOT NULL,
            latitude DECIMAL(10, 8),
            longitude DECIMAL(11, 8),
            is_default BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`);
        await pool.query(`CREATE TABLE IF NOT EXISTS order_items (
            id INT AUTO_INCREMENT PRIMARY KEY,
            order_id INT,
            product_id INT,
            quantity INT NOT NULL,
            price DECIMAL(10, 2) NOT NULL,
            FOREIGN KEY (order_id) REFERENCES orders(id),
            FOREIGN KEY (product_id) REFERENCES products(id)
        )`);
        await pool.query(`CREATE TABLE IF NOT EXISTS prescriptions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            file_name VARCHAR(255),
            mime_type VARCHAR(100),
            file_size INT DEFAULT 0,
            image_data LONGTEXT NOT NULL,
            status VARCHAR(50) DEFAULT 'Pending Review',
            uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`);
        await pool.query(`CREATE TABLE IF NOT EXISTS payments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            order_id INT NOT NULL,
            amount DECIMAL(10, 2) NOT NULL,
            payment_method VARCHAR(50) NOT NULL,
            payment_status VARCHAR(50) DEFAULT 'Pending',
            transaction_reference VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id),
            FOREIGN KEY (order_id) REFERENCES orders(id)
        )`);
        await pool.query(`CREATE TABLE IF NOT EXISTS pharmacies (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL, location VARCHAR(255) NOT NULL, contact VARCHAR(255) NOT NULL, status VARCHAR(50) DEFAULT 'Active', joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`);
        await pool.query(`CREATE TABLE IF NOT EXISTS user_cards (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, card_title VARCHAR(100), card_number VARCHAR(20), expiry VARCHAR(10), FOREIGN KEY (user_id) REFERENCES users(id))`);
        await pool.query(`CREATE TABLE IF NOT EXISTS consultations (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, doctor_name VARCHAR(255), subject VARCHAR(255), date DATE, time TIME, status VARCHAR(50) DEFAULT 'Booked', FOREIGN KEY (user_id) REFERENCES users(id))`);

        // 2. Run Migrations / Alterations
        try { await pool.query("ALTER TABLE users ADD COLUMN full_name VARCHAR(255)"); } catch (e) { }
        try { await pool.query("ALTER TABLE users ADD COLUMN email_notifications BOOLEAN DEFAULT TRUE"); } catch (e) { }
        try { await pool.query("ALTER TABLE users ADD COLUMN sms_alerts BOOLEAN DEFAULT TRUE"); } catch (e) { }
        try { await pool.query("ALTER TABLE users ADD COLUMN cart_data LONGTEXT"); } catch (e) { }
        try { await pool.query("ALTER TABLE products ADD COLUMN prescription_required BOOLEAN DEFAULT FALSE"); } catch (e) { }
        try { await pool.query("ALTER TABLE products ADD COLUMN manufacturer VARCHAR(255)"); } catch (e) { }
        try { await pool.query("ALTER TABLE products ADD COLUMN discount DECIMAL(10, 2) DEFAULT 0.00"); } catch (e) { }
        try { await pool.query("ALTER TABLE products ADD COLUMN min_stock INT DEFAULT 10"); } catch (e) { }
        try { await pool.query("ALTER TABLE products ADD COLUMN is_active BOOLEAN DEFAULT TRUE"); } catch (e) { }
        try { await pool.query("ALTER TABLE products ADD COLUMN expiry_date DATE"); } catch (e) { }
        try { await pool.query(`ALTER TABLE orders ADD COLUMN order_number VARCHAR(50) UNIQUE`); } catch (e) { }
        try { await pool.query(`ALTER TABLE orders ADD COLUMN subtotal DECIMAL(10, 2) DEFAULT 0.00`); } catch (e) { }
        try { await pool.query(`ALTER TABLE orders ADD COLUMN delivery_charge DECIMAL(10, 2) DEFAULT 0.00`); } catch (e) { }
        try { await pool.query(`ALTER TABLE orders ADD COLUMN payment_status VARCHAR(50) DEFAULT 'Pending'`); } catch (e) { }
        try { await pool.query(`ALTER TABLE orders ADD COLUMN prescription_id INT`); } catch (e) { }
        try { await pool.query(`ALTER TABLE orders ADD COLUMN agent_id INT`); } catch (e) { }
        try { await pool.query(`ALTER TABLE orders ADD COLUMN address_id INT`); } catch (e) { }
        try { await pool.query(`ALTER TABLE orders ADD COLUMN payment_method VARCHAR(50) DEFAULT 'COD'`); } catch (e) { }
        try { await pool.query(`ALTER TABLE orders ADD COLUMN schedule VARCHAR(50) DEFAULT 'ASAP'`); } catch (e) { }
        try { await pool.query(`ALTER TABLE orders ADD COLUMN delivery_rating INT DEFAULT NULL`); } catch (e) { }
        try { await pool.query(`ALTER TABLE orders ADD COLUMN lat DECIMAL(10, 8)`); } catch (e) { }
        try { await pool.query(`ALTER TABLE orders ADD COLUMN lng DECIMAL(11, 8)`); } catch (e) { }
        try { await pool.query("ALTER TABLE addresses ADD COLUMN title VARCHAR(100) NOT NULL DEFAULT 'Home'"); } catch (e) { }
        try { await pool.query("UPDATE addresses SET title = COALESCE(title, label, 'Home') WHERE title IS NULL OR title = ''"); } catch (e) { }
        try { await pool.query("ALTER TABLE addresses ADD COLUMN full_name VARCHAR(255)"); } catch (e) { }
        try { await pool.query("ALTER TABLE addresses ADD COLUMN mobile VARCHAR(20)"); } catch (e) { }
        try { await pool.query("ALTER TABLE addresses ADD COLUMN house_number VARCHAR(100)"); } catch (e) { }
        try { await pool.query("ALTER TABLE addresses ADD COLUMN street VARCHAR(255)"); } catch (e) { }
        try { await pool.query("ALTER TABLE addresses ADD COLUMN city VARCHAR(120)"); } catch (e) { }
        try { await pool.query("ALTER TABLE addresses ADD COLUMN state VARCHAR(120)"); } catch (e) { }
        try { await pool.query("ALTER TABLE addresses ADD COLUMN pincode VARCHAR(20)"); } catch (e) { }
        try { await pool.query("ALTER TABLE addresses ADD COLUMN landmark VARCHAR(255)"); } catch (e) { }
        try { await pool.query("ALTER TABLE addresses ADD COLUMN label VARCHAR(50)"); } catch (e) { }
        try { await pool.query("ALTER TABLE addresses ADD COLUMN latitude DECIMAL(10, 8)"); } catch (e) { }
        try { await pool.query("ALTER TABLE addresses ADD COLUMN longitude DECIMAL(11, 8)"); } catch (e) { }
        try { await pool.query("ALTER TABLE prescriptions ADD COLUMN file_name VARCHAR(255)"); } catch (e) { }
        try { await pool.query("ALTER TABLE prescriptions ADD COLUMN mime_type VARCHAR(100)"); } catch (e) { }
        try { await pool.query("ALTER TABLE prescriptions ADD COLUMN file_size INT DEFAULT 0"); } catch (e) { }
        try { await pool.query("CREATE TABLE IF NOT EXISTS payments (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT NOT NULL, order_id INT NOT NULL, amount DECIMAL(10,2) NOT NULL, payment_method VARCHAR(50) NOT NULL, payment_status VARCHAR(50) DEFAULT 'Pending', transaction_reference VARCHAR(255), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (order_id) REFERENCES orders(id))"); } catch (e) { }

        console.log("Database tables initialized successfully.");

        // 3. Seed Demo Users (ensure required accounts exist even when DB is not empty)
        const demoUsers = [
            { username: 'admin', email: 'admin@pharmawave.com', password: await bcrypt.hash('admin123', 10), role: 'admin', contact: '1234567890' },
            { username: 'agent1', email: 'agent@pharmawave.com', password: await bcrypt.hash('agent123', 10), role: 'delivery', contact: '0987654321' },
            { username: 'pharmacy1', email: 'contact@citymedical.com', password: await bcrypt.hash('pharmacy123', 10), role: 'pharmacy', contact: '9998887776' },
            { username: 'Test User', email: 'user@gmail.com', password: await bcrypt.hash('user123', 10), role: 'user', contact: '8887776665' }
        ];

        for (const user of demoUsers) {
            const [existing] = await pool.query('SELECT id FROM users WHERE username = ? OR email = ?', [user.username, user.email]);
            if (existing.length === 0) {
                await pool.query(
                    `INSERT INTO users (username, email, password, role, contact) VALUES (?, ?, ?, ?, ?)`,
                    [user.username, user.email, user.password, user.role, user.contact]
                );
            }
        }
        console.log("Demo users ensured.");

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

function normalizePhone(value) {
    if (!value) return '';
    return String(value).replace(/\D/g, '').slice(-10);
}

function normalizeIdentifier(value) {
    return sanitizeText(value).toLowerCase();
}

function isValidPhone(value) {
    const digits = normalizePhone(value);
    return /^\d{10}$/.test(digits) && /^[6-9]/.test(digits);
}

function isValidEmail(value) {
    if (typeof value !== 'string') return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function sanitizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeUserProfilePayload(payload = {}) {
    return {
        username: sanitizeText(payload.username || payload.userName || ''),
        full_name: sanitizeText(payload.full_name || payload.fullName || ''),
        email: sanitizeText(payload.email || ''),
        contact: normalizePhone(payload.contact || payload.mobile || ''),
        profile_pic: payload.profile_pic || null
    };
}

function validateAddressPayload(payload) {
    const errors = [];
    const hasStructuredAddress = Boolean(payload.house_number || payload.street || payload.city || payload.state || payload.pincode);
    const legacyFullAddress = Boolean((payload.full_address || payload.fullAddress) && !hasStructuredAddress);

    if (legacyFullAddress) {
        return errors;
    }

    if (!payload.full_name) errors.push('Full name is required.');
    if (!payload.mobile) errors.push('A valid 10-digit mobile number is required.');
    if (!payload.house_number) errors.push('House or flat number is required.');
    if (!payload.street) errors.push('Street or area is required.');
    if (!payload.city) errors.push('City is required.');
    if (!payload.state) errors.push('State is required.');
    if (!payload.pincode) errors.push('Pincode must be a 6-digit number.');

    if (payload.mobile && !isValidPhone(payload.mobile)) errors.push('A valid 10-digit mobile number is required.');
    if (payload.pincode && !/^\d{6}$/.test(String(payload.pincode).trim())) errors.push('Pincode must be a 6-digit number.');
    return errors;
}

function normalizeAddressRow(row = {}) {
    const address = { ...row };
    address.title = row.label || row.title || 'Home';
    address.label = row.label || row.title || 'Home';
    address.full_address = row.full_address || buildAddressString({
        house_number: row.house_number,
        street: row.street,
        city: row.city,
        state: row.state,
        pincode: row.pincode
    });
    return address;
}

function buildAddressString(address) {
    const parts = [
        address.house_number,
        address.street,
        address.city,
        address.state,
        address.pincode ? `PIN ${address.pincode}` : ''
    ].filter(Boolean);
    return parts.join(', ');
}

function formatDate(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

// ==========================================
// 👤 USER SERVICE (Authentication & Profiles)
// ==========================================
// GOOGLE AUTH API — Auto-provisions users + DB-failure fallback (always works for demo)
app.post("/api/auth/google", async (req, res) => {
    const { idToken, email, name, picture } = req.body;

    if (!idToken) {
        return res.status(400).json({ success: false, message: "Google verification token is required." });
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        const verifiedEmail = String(decodedToken.email || '').trim().toLowerCase();
        if (!verifiedEmail || decodedToken.email_verified === false) {
            return res.status(401).json({ success: false, message: "Google account email is not verified." });
        }
        const verifiedName = decodedToken.name || name || verifiedEmail.split('@')[0];
        const verifiedPicture = decodedToken.picture || picture || null;
        let [rows] = await pool.query("SELECT * FROM users WHERE LOWER(email) = ?", [verifiedEmail]);
        let user;

        if (rows.length > 0) {
            // Existing user — update pic if missing
            user = rows[0];
            if (!user.profile_pic && verifiedPicture) {
                await pool.query("UPDATE users SET profile_pic = ? WHERE id = ?", [verifiedPicture, user.id]);
                user.profile_pic = verifiedPicture;
            }
        } else {
            // Auto-provision: create a new account for this Google user
            const usernameBase = verifiedName.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 240) || verifiedEmail.split('@')[0];
            const username = `${usernameBase}_${Date.now().toString(36)}`.slice(0, 255);
            const tempPassword = await bcrypt.hash(require('crypto').randomBytes(16).toString('hex'), 10);
            const [result] = await pool.query(
                "INSERT INTO users (username, email, password, profile_pic, role) VALUES (?, ?, ?, ?, 'user')",
                [username, verifiedEmail, tempPassword, verifiedPicture]
            );
            user = { id: result.insertId, username, email: verifiedEmail, profile_pic: verifiedPicture, role: 'user' };
        }

        const jwtToken = jwt.sign(
            { id: user.id, username: user.username, role: user.role || 'user' },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        return res.json({
            success: true,
            message: "Google Login successful!",
            token: jwtToken,
            userId: user.id,
            username: user.username,
            profile_pic: user.profile_pic,
            role: user.role || 'user'
        });

    } catch (err) {
        console.error("Google auth failed:", err.message);
        return res.status(500).json({
            success: false,
            message: "Google sign-in failed. Please try again or use email login."
        });
    }
});


// FORGOT PASSWORD API
app.post("/api/auth/forgot-password", async (req, res) => {
    try {
        const { role, username, email } = req.body;
        const identifier = normalizeIdentifier(email || username || '');

        // Find user by username or email in a case-insensitive way
        let query = "SELECT id, email, username FROM users WHERE (LOWER(username) = ? OR LOWER(email) = ?)";
        const params = [identifier, identifier];
        if (role) {
            query += " AND LOWER(role) = ?";
            params.push(String(role).toLowerCase());
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

            // Wrap sendMail in a promise race to enforce a timeout (solves infinite hang on Render free tier)
            const sendEmailWithTimeout = new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    reject(new Error("SMTP Connection Timed Out. If local, your internet might be slow or ISP blocks SMTP."));
                }, 4000); // 4-second timeout for a better UX when blocked
                
                emailTransporter.sendMail(mailOptions)
                    .then(() => {
                        clearTimeout(timer);
                        resolve();
                    })
                    .catch((err) => {
                        clearTimeout(timer);
                        reject(err);
                    });
            });

            try {
                await sendEmailWithTimeout;
                console.log(`Password reset OTP sent to ${userEmail}`);
                res.json({ success: true, message: "OTP sent to your email!" });
            } catch (err) {
                console.error(`[SMTP ERROR] Failed to send email to ${userEmail}:`, err.message);
                // Fallback to showing the OTP so testing can continue
                console.log(`[FALLBACK] Password reset OTP for ${userEmail} is ${otpCode}`);
                res.json({ 
                    success: true, 
                    message: `OTP generated: ${otpCode}`,
                    fallbackOtp: otpCode
                });
            }
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
        let { email, otp, newPassword } = req.body;
        
        if (otp !== undefined && otp !== null) {
            otp = String(otp).replace(/\D/g, '').trim();
        }

        if (!otp || !newPassword) return res.status(400).json({ success: false, message: "OTP and new password required" });

        let query = "SELECT id FROM users WHERE reset_token = ?";
        let params = [otp];

        if (email) {
            query += " AND (email = ? OR username = ?)";
            params.push(email, email);
        }

        const [rows] = await pool.query(query, params);

        if (rows.length > 0) {
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            await pool.query("UPDATE users SET password = ?, reset_token = NULL WHERE id = ?", [hashedPassword, rows[0].id]);
            res.json({ success: true, message: "Password updated successfully" });
        } else {
            res.status(400).json({ success: false, message: "Invalid or expired OTP" });
        }
    } catch (err) {
        console.error("Reset password error:", err);
        res.status(500).json({ success: false, message: `Server error: ${err.message}` });
    }
});

// REGISTER API
app.post("/register", async (req, res) => {
    try {
        const { username, password, contact, email, full_name } = req.body;
        const rawContact = sanitizeText(contact || '');
        const emailValue = sanitizeText(email || (rawContact.includes('@') ? rawContact : ''));
        const mobileValue = email ? normalizePhone(rawContact) : (rawContact.includes('@') ? '' : normalizePhone(rawContact));
        const normalizedUsername = sanitizeText(username);

        if (!normalizedUsername || !password || (!emailValue && !mobileValue)) {
            return res.status(400).json({ success: false, message: "All fields are required" });
        }

        if (mobileValue && !isValidPhone(mobileValue)) {
            return res.status(400).json({ success: false, message: "Please enter a valid 10-digit mobile number." });
        }

        if (emailValue && !isValidEmail(emailValue)) {
            return res.status(400).json({ success: false, message: "Please enter a valid email address." });
        }

        const [existingUser] = await pool.query(
            `SELECT id FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)`,
            [normalizedUsername, emailValue || '']
        );

        if (existingUser.length > 0) {
            return res.status(400).json({ success: false, message: "Username or email already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const query = `INSERT INTO users (username, password, email, contact, full_name) VALUES (?, ?, ?, ?, ?)`;

        await pool.query(query, [normalizedUsername, hashedPassword, emailValue || null, mobileValue || null, sanitizeText(full_name || '')]);

        const [newUser] = await pool.query(`SELECT id, role FROM users WHERE LOWER(username) = LOWER(?)`, [normalizedUsername]);
        const token = jwt.sign(
            { id: newUser[0].id, username: normalizedUsername, role: newUser[0].role || 'user' },
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

// LOGIN API — Includes fallback for demo when DB is down
app.post("/login", async (req, res) => {
    const { email, username, password } = req.body;
    const loginIdentifier = normalizeIdentifier(email || username || "");

    if (!loginIdentifier || !password) {
        return res.status(400).json({ success: false, message: "Credentials required" });
    }

    try {
        const query = `SELECT * FROM users WHERE LOWER(email) = ? OR LOWER(username) = ?`;
        const [rows] = await pool.query(query, [loginIdentifier, loginIdentifier]);

        if (rows.length > 0) {
            const user = rows[0];
            const isMatch = await bcrypt.compare(password, user.password);
            const isLegacyMatch = password === user.password;

            if (isMatch || isLegacyMatch) {
                const token = jwt.sign(
                    { id: user.id, username: user.username, role: user.role || 'user' },
                    JWT_SECRET, { expiresIn: '24h' }
                );
                return res.json({
                    success: true,
                    token, userId: user.id, username: user.username,
                    profile_pic: user.profile_pic, role: user.role || 'user'
                });
            }
            // User found but password wrong — return immediately, do NOT fall to hardcoded fallback
            return res.status(401).json({ success: false, message: "Invalid credentials. Please check your password." });
        }
        // User not found in DB — throw to trigger fallback demo credentials check
        throw new Error("User not found in DB");
    } catch (err) {
        console.error("Login DB error:", err.message);
        res.status(401).json({ success: false, message: "Invalid credentials." });
    }
});

// AGENT LOGIN API
app.post("/api/agent/login", async (req, res) => {
    try {
        const { username, password } = req.body;
        const identifier = normalizeIdentifier(username || '');
        // Support both username and email as login identifiers in a case-insensitive way
        const [rows] = await pool.query("SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ?", [identifier, identifier]);

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
        const normalizedUsername = sanitizeText(username);

        if (!normalizedUsername || !password || !contact) {
            return res.status(400).json({ success: false, message: "All fields are required" });
        }

        const [existingUser] = await pool.query(
            `SELECT id FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)`,
            [normalizedUsername, String(contact).trim()]
        );

        if (existingUser.length > 0) {
            return res.status(400).json({ success: false, message: "Username or email already exists" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const query = `INSERT INTO users (username, password, email, contact, role) VALUES (?, ?, ?, ?, 'delivery')`;
 
        // Populate both for compatibility
        await pool.query(query, [normalizedUsername, hashedPassword, contact.includes('@') ? contact : null, contact]);

        const [newUser] = await pool.query(`SELECT id FROM users WHERE LOWER(username) = LOWER(?)`, [normalizedUsername]);
        const token = jwt.sign(
            { id: newUser[0].id, username: normalizedUsername, role: 'delivery' },
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
const FALLBACK_PRODUCTS = [
    { id: 1, name: "Paracetamol 500mg", category: "Pain Relief", price: 5.99, image_url: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&auto=format&fit=crop&q=60", description: "Effective for pain relief and fever reducing.", stock: 100 },
    { id: 2, name: "Vitamin C Supplement", category: "Vitamins", price: 12.50, image_url: "https://images.unsplash.com/photo-1550572017-edb9cf1209b6?w=500&auto=format&fit=crop&q=60", description: "Boosts immune system.", stock: 100 },
    { id: 3, name: "Cough Syrup", category: "Cold & Flu", price: 8.25, image_url: "https://images.unsplash.com/photo-1631549916768-4119b2e5f926?w=500&auto=format&fit=crop&q=60", description: "Relieves dry and tickly coughs.", stock: 100 },
    { id: 4, name: "First Aid Kit", category: "First Aid", price: 24.99, image_url: "https://images.unsplash.com/photo-1603398938378-e54eab446dde?w=500&auto=format&fit=crop&q=60", description: "Comprehensive first aid essentials.", stock: 100 },
    { id: 5, name: "Allergy Relief Tablets", category: "Allergy", price: 14.00, image_url: "https://plus.unsplash.com/premium_photo-1661630983141-8f4dfbc52bf1?w=500&auto=format&fit=crop&q=60", description: "Fast relief from allergy symptoms.", stock: 100 },
    { id: 6, name: "Aspirin 81mg", category: "Pain Relief", price: 6.50, image_url: "https://images.unsplash.com/photo-1585435557343-3b092031a831?w=500&auto=format&fit=crop&q=60", description: "Low dose aspirin regimen.", stock: 100 },
    { id: 7, name: "Amoxicillin 250mg", category: "Antibiotics", price: 15.00, image_url: "https://images.unsplash.com/photo-1471864190281-a93a3070b6de?w=500&auto=format&fit=crop&q=60", description: "Prescription antibiotic.", stock: 100 },
    { id: 8, name: "Ibuprofen 400mg", category: "Pain Relief", price: 7.50, image_url: "https://images.unsplash.com/photo-1577401239170-897942555fb3?w=500&auto=format&fit=crop&q=60", description: "Reduces inflammation and pain.", stock: 100 },
    { id: 9, name: "Multivitamin For Men", category: "Vitamins", price: 22.99, image_url: "https://images.unsplash.com/photo-1584017911766-d451b3d0e843?w=500&auto=format&fit=crop&q=60", description: "Daily nutritional support for men.", stock: 100 },
    { id: 10, name: "Multivitamin For Women", category: "Vitamins", price: 22.99, image_url: "https://images.unsplash.com/photo-1584017911766-d451b3d0e843?w=500&auto=format&fit=crop&q=60", description: "Daily nutritional support for women.", stock: 100 },
    { id: 11, name: "Hydration Salts", category: "First Aid", price: 4.50, image_url: "https://images.unsplash.com/photo-1512069772995-ec65ed45afd6?w=500&auto=format&fit=crop&q=60", description: "Fast rehydration therapy.", stock: 100 },
    { id: 12, name: "Hand Sanitizer 500ml", category: "First Aid", price: 5.00, image_url: "https://images.unsplash.com/photo-1584483766114-2cea6facdcaa?w=500&auto=format&fit=crop&q=60", description: "Kills 99.9% of germs.", stock: 100 },
    { id: 13, name: "Antihistamine Tablets", category: "Allergy", price: 11.20, image_url: "https://plus.unsplash.com/premium_photo-1661630983141-8f4dfbc52bf1?w=500&auto=format&fit=crop&q=60", description: "Non-drowsy allergy relief.", stock: 100 },
    { id: 14, name: "Digital Thermometer", category: "First Aid", price: 18.50, image_url: "https://images.unsplash.com/photo-1584362917165-526a968579e8?w=500&auto=format&fit=crop&q=60", description: "Accurate temperature reading in seconds.", stock: 100 }
];

app.get("/api/products", async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT * FROM products");
        res.json({ success: true, products: rows });
    } catch (err) {
        console.error("DB down, serving fallback products:", err.message);
        res.json({ success: true, products: FALLBACK_PRODUCTS });
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

        const { userId, totalAmount, cartItems, addressId, paymentMethod, schedule, deliveryCharge, prescriptionId } = req.body;

        if (!userId || !Array.isArray(cartItems) || cartItems.length === 0) {
            return res.status(400).json({ success: false, message: "Invalid order data" });
        }

        if (String(req.user.id) !== String(userId) && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: "Unauthorized order placement." });
        }

        const [addressRow] = await connection.query("SELECT id FROM addresses WHERE id = ? AND user_id = ?", [addressId, userId]);
        if (!addressId || addressRow.length === 0) {
            return res.status(400).json({ success: false, message: "Please select a valid delivery address." });
        }

        const productIds = [...new Set(cartItems.map(item => Number(item.id)).filter(Boolean))];
        if (productIds.length === 0) {
            return res.status(400).json({ success: false, message: "Cart is empty or invalid." });
        }

        const productPlaceholders = productIds.map(() => '?').join(',');
        const [products] = await connection.query(`SELECT * FROM products WHERE id IN (${productPlaceholders})`, productIds);
        const productMap = new Map(products.map(product => [product.id, product]));

        let subtotal = 0;
        for (const item of cartItems) {
            const product = productMap.get(Number(item.id));
            if (!product) {
                return res.status(400).json({ success: false, message: `Medicine not found: ${item.name || item.id}` });
            }
            if (!Number.isInteger(Number(item.quantity)) || Number(item.quantity) <= 0) {
                return res.status(400).json({ success: false, message: `Invalid quantity for ${product.name}.` });
            }
            if (Number(product.stock) < Number(item.quantity)) {
                return res.status(400).json({ success: false, message: `Only ${product.stock} units available for ${product.name}.` });
            }
            if (Boolean(product.prescription_required) && !prescriptionId) {
                return res.status(400).json({ success: false, message: `${product.name} requires a prescription before checkout.` });
            }
            if (Boolean(product.prescription_required) && prescriptionId) {
                const [prescriptionRow] = await connection.query("SELECT id FROM prescriptions WHERE id = ? AND user_id = ?", [prescriptionId, userId]);
                if (prescriptionRow.length === 0) {
                    return res.status(400).json({ success: false, message: "Selected prescription is invalid or does not belong to this user." });
                }
            }
            const unitPrice = Number(product.price || 0);
            const itemTotal = unitPrice * Number(item.quantity);
            subtotal += itemTotal;
        }

        const safeDeliveryCharge = Number(deliveryCharge || 0);
        const computedTotal = Number(subtotal) + safeDeliveryCharge;
        const requestedTotal = Number(totalAmount || 0);

        if (Math.abs(requestedTotal - computedTotal) > 0.01) {
            return res.status(400).json({ success: false, message: "Order total does not match the cart value. Please refresh and try again." });
        }

        const orderNumber = `PW${Date.now()}${Math.floor(Math.random() * 900 + 100)}`;
        const payMethod = (paymentMethod || 'COD').toString();
        const paymentStatus = ["UPI", "Card", "Online", "Stripe"].includes(payMethod) ? 'Paid' : 'Pending';
        const orderQuery = `INSERT INTO orders (user_id, order_number, subtotal, delivery_charge, total_amount, status, payment_method, payment_status, address_id, prescription_id, schedule) VALUES (?, ?, ?, ?, ?, 'Pending', ?, ?, ?, ?, ?)`;
        const orderSchedule = schedule || 'ASAP';
        const [orderResult] = await connection.query(orderQuery, [userId, orderNumber, subtotal.toFixed(2), safeDeliveryCharge.toFixed(2), computedTotal.toFixed(2), payMethod, paymentStatus, addressId || null, prescriptionId || null, orderSchedule]);
        const orderId = orderResult.insertId;

        const orderItemsValues = cartItems.map(item => {
            const product = productMap.get(Number(item.id));
            return [orderId, item.id, Number(item.quantity), Number(product.price || item.price || 0)];
        });
        const orderItemsQuery = `INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ?`;
        await connection.query(orderItemsQuery, [orderItemsValues]);

        const transactionReference = paymentStatus === 'Paid' ? `TXN-${Date.now()}-${orderId}` : null;
        await connection.query(
            "INSERT INTO payments (user_id, order_id, amount, payment_method, payment_status, transaction_reference) VALUES (?, ?, ?, ?, ?, ?)",
            [userId, orderId, computedTotal.toFixed(2), payMethod, paymentStatus, transactionReference]
        );

        for (const item of cartItems) {
            const product = productMap.get(Number(item.id));
            const qty = Number(item.quantity);
            const [updateResult] = await connection.query(
                "UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?",
                [qty, product.id, qty]
            );
            if (updateResult.affectedRows === 0) {
                throw new Error(`Inventory validation failed for ${product.name}`);
            }
        }

        await connection.commit();
        io.emit('new_order_pool');
        res.json({ success: true, message: "Order placed successfully! Preparing Delivery.", orderId, orderNumber, assignedAgent: null });
    } catch (err) {
        await connection.rollback();
        console.error("Order process failed:", err);
        res.status(500).json({ success: false, message: err.message || "Server error processing order" });
    } finally {
        connection.release();
    }
});

// GET USER ORDERS
app.get("/api/orders/user/:id", authenticateToken, async (req, res) => {
    try {
        const userId = req.params.id;
        if (req.user.role !== 'admin' && req.user.id != userId) {
            return res.status(403).json({ success: false, message: "Unauthorized access to these orders" });
        }
        const query = `
            SELECT o.id, o.order_number, o.total_amount, o.subtotal, o.delivery_charge, o.status, o.payment_method, o.payment_status, o.created_at, o.address_id, o.prescription_id,
                   COUNT(oi.id) as total_items,
                   a.full_address as delivery_address,
                   p.file_name as prescription_file
            FROM orders o
            LEFT JOIN order_items oi ON o.id = oi.order_id
            LEFT JOIN addresses a ON o.address_id = a.id
            LEFT JOIN prescriptions p ON o.prescription_id = p.id
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
            SET username = ?, contact = ?, vehicle_type = ?, vehicle_number = ?, availability = ?
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
        const authHeader = req.headers.authorization || '';
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
        if (!token) return res.status(401).json({ success: false, message: "Unauthorized" });
        const authenticatedUser = await new Promise((resolve, reject) => {
            jwt.verify(token, JWT_SECRET, (err, user) => err ? reject(err) : resolve(user));
        });
        const userId = req.params.id;
        if (String(authenticatedUser.id) !== String(userId) && authenticatedUser.role !== 'admin') {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }
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

// UPDATE USERNAME — Includes fallback
app.post("/api/user/:id/username", authenticateToken, async (req, res) => {
    const userId = req.params.id;
    const { newUsername } = req.body;

    if (!newUsername || newUsername.trim() === '') {
        return res.status(400).json({ success: false, message: "Username cannot be empty" });
    }

    try {
        if (req.user.id != userId && req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Unauthorized" });
        
        await pool.query("UPDATE users SET username = ? WHERE id = ?", [newUsername.trim(), userId]);
        res.json({ success: true, message: "Username updated!", newUsername: newUsername.trim() });
    } catch (err) {
        console.error("Username update failed:", err.message);
        res.status(500).json({ success: false, message: "Server error updating username." });
    }
});

// GET USER PROFILE
app.get("/api/user/:id/profile", authenticateToken, async (req, res) => {
    const userId = req.params.id;
    try {
        if (String(req.user.id) !== String(userId) && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }
        const [rows] = await pool.query(
            "SELECT id, username, email, contact, full_name, profile_pic, role, email_notifications, sms_alerts FROM users WHERE id = ?",
            [userId]
        );
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'User not found.' });
        res.json({ success: true, user: rows[0] });
    } catch (err) {
        console.error('Profile fetch failed:', err);
        res.status(500).json({ success: false, message: 'Server error fetching profile.' });
    }
});

app.put("/api/user/:id/profile", authenticateToken, async (req, res) => {
    const userId = req.params.id;
    try {
        if (String(req.user.id) !== String(userId) && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const payload = normalizeUserProfilePayload(req.body);
        if (!payload.username) return res.status(400).json({ success: false, message: 'Username is required.' });
        if (!payload.full_name) return res.status(400).json({ success: false, message: 'Full name is required.' });
        if (!payload.contact || !isValidPhone(payload.contact)) {
            return res.status(400).json({ success: false, message: 'Please enter a valid 10-digit mobile number.' });
        }
        if (payload.email && !isValidEmail(payload.email)) {
            return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
        }

        const [existing] = await pool.query("SELECT id, username, email FROM users WHERE (username = ? OR email = ?) AND id != ?", [payload.username, payload.email || '', userId]);
        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'Username or email is already in use.' });
        }

        await pool.query(
            "UPDATE users SET username = ?, full_name = ?, email = ?, contact = ? WHERE id = ?",
            [payload.username, payload.full_name, payload.email || null, payload.contact, userId]
        );

        const [updated] = await pool.query("SELECT id, username, email, contact, full_name, profile_pic, role FROM users WHERE id = ?", [userId]);
        res.json({ success: true, message: 'Profile updated successfully.', user: updated[0] });
    } catch (err) {
        console.error('Profile update failed:', err);
        res.status(500).json({ success: false, message: 'Server error updating profile.' });
    }
});

// GET USER ADDRESSES
app.get("/api/user/:id/addresses", authenticateToken, async (req, res) => {
    const userId = req.params.id;
    try {
        if (String(req.user.id) !== String(userId) && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }
        const [rows] = await pool.query("SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC", [userId]);
        res.json({ success: true, addresses: rows.map(normalizeAddressRow) });
    } catch (err) {
        console.error('Addresses fetch failed:', err);
        res.status(500).json({ success: false, message: 'Server error fetching addresses.' });
    }
});

// ADD USER ADDRESS
app.post("/api/user/:id/addresses", authenticateToken, async (req, res) => {
    const userId = req.params.id;
    try {
        if (String(req.user.id) !== String(userId) && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const body = req.body || {};
        console.log('DEBUG_ADDRESS_BODY', JSON.stringify(body));
        const payload = {
            full_name: sanitizeText(body.full_name || body.name || ''),
            mobile: normalizePhone(body.mobile || body.contact || ''),
            house_number: sanitizeText(body.house_number || body.flat_number || ''),
            street: sanitizeText(body.street || body.area || ''),
            city: sanitizeText(body.city || ''),
            state: sanitizeText(body.state || ''),
            pincode: sanitizeText(body.pincode || ''),
            landmark: sanitizeText(body.landmark || ''),
            title: sanitizeText(body.title || body.label || 'Home'),
            label: sanitizeText(body.label || body.title || 'Home'),
            full_address: sanitizeText(body.full_address || body.fullAddress || ''),
            is_default: Boolean(body.is_default),
            latitude: body.latitude || null,
            longitude: body.longitude || null
        };

        if (!payload.full_name) {
            const [userRow] = await pool.query('SELECT username, contact FROM users WHERE id = ?', [userId]);
            payload.full_name = sanitizeText(userRow[0]?.username || 'Customer');
        }
        if (!payload.mobile) {
            const [userRow] = await pool.query('SELECT contact FROM users WHERE id = ?', [userId]);
            payload.mobile = normalizePhone(userRow[0]?.contact || '');
        }
        if (!payload.mobile && payload.full_address) {
            payload.mobile = '0000000000';
        }

        const validationErrors = validateAddressPayload(payload);
        if (validationErrors.length) {
            return res.status(400).json({ success: false, message: validationErrors[0] });
        }

        const fullAddress = payload.full_address || buildAddressString(payload);

        if (payload.is_default) {
            await pool.query('UPDATE addresses SET is_default = FALSE WHERE user_id = ?', [userId]);
        }

        const [result] = await pool.query(
            "INSERT INTO addresses (user_id, full_name, mobile, house_number, street, city, state, pincode, landmark, label, full_address, latitude, longitude, is_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [userId, payload.full_name, payload.mobile, payload.house_number, payload.street, payload.city, payload.state, payload.pincode, payload.landmark, payload.label || payload.title || 'Home', fullAddress, payload.latitude, payload.longitude, payload.is_default ? 1 : 0]
        );

        res.json({ success: true, message: 'Address saved successfully!', addressId: result.insertId });
    } catch (err) {
        console.error('Address save failed:', err);
        res.status(500).json({ success: false, message: 'Server error saving address.' });
    }
});

app.put("/api/user/:id/addresses/:addressId", authenticateToken, async (req, res) => {
    const userId = req.params.id;
    const addressId = req.params.addressId;
    try {
        if (String(req.user.id) !== String(userId) && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const body = req.body || {};
        const payload = {
            full_name: sanitizeText(body.full_name || body.name || ''),
            mobile: normalizePhone(body.mobile || body.contact || ''),
            house_number: sanitizeText(body.house_number || body.flat_number || ''),
            street: sanitizeText(body.street || body.area || ''),
            city: sanitizeText(body.city || ''),
            state: sanitizeText(body.state || ''),
            pincode: sanitizeText(body.pincode || ''),
            landmark: sanitizeText(body.landmark || ''),
            title: sanitizeText(body.title || body.label || 'Home'),
            label: sanitizeText(body.label || body.title || 'Home'),
            full_address: sanitizeText(body.full_address || body.fullAddress || ''),
            is_default: Boolean(body.is_default),
            latitude: body.latitude || null,
            longitude: body.longitude || null
        };

        if (!payload.full_name) {
            const [userRow] = await pool.query('SELECT username, contact FROM users WHERE id = ?', [userId]);
            payload.full_name = sanitizeText(userRow[0]?.username || 'Customer');
        }
        if (!payload.mobile) {
            const [userRow] = await pool.query('SELECT contact FROM users WHERE id = ?', [userId]);
            payload.mobile = normalizePhone(userRow[0]?.contact || '');
        }
        if (!payload.mobile && payload.full_address) {
            payload.mobile = '0000000000';
        }

        const validationErrors = validateAddressPayload(payload);
        if (validationErrors.length) {
            return res.status(400).json({ success: false, message: validationErrors[0] });
        }

        if (payload.is_default) {
            await pool.query('UPDATE addresses SET is_default = FALSE WHERE user_id = ?', [userId]);
        }

        const fullAddress = payload.full_address || buildAddressString(payload);
        await pool.query(
            "UPDATE addresses SET full_name = ?, mobile = ?, house_number = ?, street = ?, city = ?, state = ?, pincode = ?, landmark = ?, label = ?, full_address = ?, latitude = ?, longitude = ?, is_default = ? WHERE id = ? AND user_id = ?",
            [payload.full_name, payload.mobile, payload.house_number, payload.street, payload.city, payload.state, payload.pincode, payload.landmark, payload.label || payload.title || 'Home', fullAddress, payload.latitude, payload.longitude, payload.is_default ? 1 : 0, addressId, userId]
        );
        res.json({ success: true, message: 'Address updated successfully!' });
    } catch (err) {
        console.error('Update address failed:', err);
        res.status(500).json({ success: false, message: 'Server error updating address.' });
    }
});

// DELETE USER ADDRESS
app.delete("/api/user/:id/addresses/:addressId", authenticateToken, async (req, res) => {
    try {
        const { id, addressId } = req.params;
        if (req.user.id != id && req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Unauthorized" });
        const [result] = await pool.query("DELETE FROM addresses WHERE id = ? AND user_id = ?", [addressId, id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Address not found.' });
        }
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
        const body = req.body || {};
        const { imageData, fileName, mimeType, fileSize } = body;
        if (!imageData) return res.status(400).json({ success: false, message: "No image data provided" });

        const fileType = String(mimeType || 'image/jpeg');
        if (!/^image\//.test(fileType)) {
            return res.status(400).json({ success: false, message: 'Only image prescriptions are supported.' });
        }
        if (Number(fileSize || 0) > 5 * 1024 * 1024) {
            return res.status(400).json({ success: false, message: 'Prescription file size must be under 5MB.' });
        }

        const [result] = await pool.query(
            "INSERT INTO prescriptions (user_id, file_name, mime_type, file_size, image_data) VALUES (?, ?, ?, ?, ?)",
            [req.params.id, fileName || 'prescription', fileType, Number(fileSize || 0), imageData]
        );
        res.json({ success: true, message: "Prescription uploaded successfully for review!", prescriptionId: result.insertId });
    } catch (err) {
        console.error("Upload prescription failed:", err);
        res.status(500).send({ message: "Server error uploading prescription." });
    }
});

app.delete("/api/user/:id/prescriptions/:prescriptionId", authenticateToken, async (req, res) => {
    try {
        if (String(req.user.id) !== String(req.params.id) && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }
        const [result] = await pool.query('DELETE FROM prescriptions WHERE id = ? AND user_id = ?', [req.params.prescriptionId, req.params.id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Prescription not found.' });
        }
        res.json({ success: true, message: 'Prescription deleted.' });
    } catch (err) {
        console.error('Delete prescription failed:', err);
        res.status(500).json({ success: false, message: 'Server error deleting prescription.' });
    }
});

// Book Doctor Consultation
app.post("/api/consultations", authenticateToken, async (req, res) => {
    try {
        const { userId, doctorName, date, time, subject } = req.body;
        if (req.user.id != userId) return res.status(403).json({ success: false, message: "Unauthorized" });
        if (!doctorName || !date || !time) return res.status(400).json({ success: false, message: "Missing required fields" });

        await pool.query(
            "INSERT INTO consultations (user_id, doctor_name, subject, date, time) VALUES (?, ?, ?, ?, ?)",
            [userId, doctorName, subject || 'General Checkup', date, time]
        );

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
        const [currentOrders] = await pool.query("SELECT COUNT(*) as total FROM orders WHERE status NOT IN ('Delivered', 'Cancelled')");
        const [deliveredOrders] = await pool.query("SELECT COUNT(*) as total FROM orders WHERE status = 'Delivered'");
        const [revenue] = await pool.query("SELECT COALESCE(SUM(total_amount), 0) as total FROM orders WHERE status IN ('Delivered', 'Completed')");
        const [inventory] = await pool.query("SELECT COUNT(*) as low_stock FROM products WHERE stock <= min_stock OR stock < 20");

        res.json({
            success: true,
            stats: {
                totalUsers: users[0].total || 0,
                currentOrders: currentOrders[0].total || 0,
                deliveredOrders: deliveredOrders[0].total || 0,
                totalOrders: Number(currentOrders[0].total || 0) + Number(deliveredOrders[0].total || 0),
                totalRevenue: Number(revenue[0].total || 0),
                lowStockItems: inventory[0].low_stock || 0
            }
        });
    } catch (err) {
        console.error('Admin stats failed:', err);
        res.status(500).json({ success: false, message: 'Server error fetching dashboard statistics.' });
    }
});

// Get All Users — Includes fallback
app.get("/api/admin/users", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: "Admin access required" });
        const [rows] = await pool.query(`
            SELECT u.id, u.username, u.email, u.contact, u.full_name, u.role, u.created_at, 
                   COUNT(DISTINCT o.id) AS order_count,
                   COALESCE(SUM(o.total_amount), 0) AS total_spent
            FROM users u
            LEFT JOIN orders o ON o.user_id = u.id
            WHERE u.role = 'user' OR u.role = 'delivery'
            GROUP BY u.id
            ORDER BY u.id DESC
        `);
        res.json({ success: true, users: rows });
    } catch (err) {
        console.error("Fetch users failed:", err.message);
        res.status(500).json({ success: false, message: "Server error fetching users." });
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
            SELECT o.*, u.username as customer_name, u.contact as customer_phone, a.full_address,
                   p.file_name as prescription_file
            FROM orders o 
            LEFT JOIN users u ON o.user_id = u.id 
            LEFT JOIN addresses a ON o.address_id = a.id
            LEFT JOIN prescriptions p ON o.prescription_id = p.id
            WHERE o.id = ?
        `, [req.params.id]);

        if (order.length === 0) return res.status(404).json({ success: false, message: "Order not found" });

        const [items] = await pool.query(`
            SELECT oi.*, p.name as product_name, p.image_url 
            FROM order_items oi 
            JOIN products p ON oi.product_id = p.id 
            WHERE oi.order_id = ?
        `, [req.params.id]);

        const [payments] = await pool.query(`
            SELECT * FROM payments WHERE order_id = ? ORDER BY created_at DESC
        `, [req.params.id]);

        res.json({ 
            success: true, 
            order: order[0], 
            items,
            payments,
            prescription: order[0]?.prescription_file || null
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
        const orderScope = req.user.role === 'admin' ? '' : ' AND user_id = ?';
        const orderParams = req.user.role === 'admin' ? [req.params.id] : [req.params.id, req.user.id];
        const [orders] = await pool.query(`SELECT * FROM orders WHERE id = ?${orderScope}`, orderParams);
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

// Pool of unassigned orders — Includes fallback
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
        res.json({ success: true, orders: orders });
    } catch (err) {
        console.error("Fetch pool orders failed:", err.message);
        res.status(500).json({ success: false, message: "Server error fetching delivery orders." });
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
        const [updateResult] = await pool.query("UPDATE orders SET status = ? WHERE id = ? AND agent_id = ?", [status, req.params.id, req.user.id]);
        if (updateResult.affectedRows === 0) {
            return res.status(404).json({ success: false, message: "Assigned delivery order not found." });
        }
        
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

app.get("/api/user/:id/payments", authenticateToken, async (req, res) => {
    try {
        if (String(req.user.id) !== String(req.params.id) && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }
        const [payments] = await pool.query(`
            SELECT id, order_id, amount, payment_method, payment_status, transaction_reference, created_at
            FROM payments
            WHERE user_id = ?
            ORDER BY created_at DESC
        `, [req.params.id]);
        res.json({ success: true, payments });
    } catch (err) {
        console.error('Fetch payment history failed:', err);
        res.status(500).json({ success: false, message: 'Error fetching payment history' });
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

// Order Tracking — Includes fallback for demo
app.get("/api/orders/:id/track", authenticateToken, async (req, res) => {
    const orderId = req.params.id;
    try {
        const [rows] = await pool.query(`
            SELECT o.id, o.status, o.lat, o.lng, u.username as agent_name, u.contact as agent_phone 
            FROM orders o 
            LEFT JOIN users u ON o.agent_id = u.id 
            WHERE o.id = ? AND (o.user_id = ? OR o.agent_id = ? OR ?='admin')
        `, [orderId, req.user.id, req.user.id, req.user.role]);
        
        if (rows.length > 0) return res.json({ success: true, tracking: rows[0] });
        return res.status(404).json({ success: false, message: "Tracking info not found for this order." });
    } catch (err) {
        console.error("Tracking failed:", err.message);
        res.status(500).json({ success: false, message: "Server error fetching tracking information." });
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
            const cart = rows[0].cart_data ? JSON.parse(rows[0].cart_data) : [];
            res.json({ success: true, cart: Array.isArray(cart) ? cart : [] });
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