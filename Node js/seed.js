const mysql = require("mysql2/promise");

async function seed() {
    try {
        const pool = mysql.createPool({
            host: "localhost",
            user: "root",
            password: "anjanbaira09@db",
            database: "pharma"
        });

        console.log("Dropping existing products and items to re-seed...");
        await pool.query("SET FOREIGN_KEY_CHECKS = 0;");
        await pool.query("TRUNCATE TABLE order_items;"); // Have to clear this to avoid foreign key issues
        await pool.query("TRUNCATE TABLE products;");
        await pool.query("SET FOREIGN_KEY_CHECKS = 1;");

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

        const insertQuery = "INSERT INTO products (name, category, price, image_url, description) VALUES ?";
        await pool.query(insertQuery, [mockProducts]);
        console.log("Seeds inserted successfully.");
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
seed();
