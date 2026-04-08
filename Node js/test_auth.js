const fetch = require('node-fetch'); // we'll use node's native fetch if available or install it

async function test() {
    let nativeFetch = typeof fetch === "undefined" ? (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args)) : fetch;
    console.log("=== Testing Without Token ===");
    let res = await nativeFetch('http://127.0.0.1:3000/api/admin/stats');
    console.log("Status:", res.status);
    console.log("Body:", await res.json());

    console.log("\n=== Testing Registration (to get token) ===");
    res = await nativeFetch('http://127.0.0.1:3000/register', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: 'testadmin', email: 'admin@test.com', password: 'password123', contact: '1234567890', role: 'admin'})
    });
    let data = await res.json();
    console.log("Status:", res.status);
    console.log("Body:", data);
    
    if (data.token) {
        console.log("\n=== Testing With Token ===");
        res = await nativeFetch('http://127.0.0.1:3000/api/admin/stats', {
            headers: {'Authorization': 'Bearer ' + data.token}
        });
        console.log("Status:", res.status);
        console.log("Body:", await res.json());
    }
}
test();
