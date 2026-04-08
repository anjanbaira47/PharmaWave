// Pharma Wave Frontend Configuration
const config = {
    // Dynamically determine the API base URL
    // If running on localhost, use the local backend
    // Otherwise, it assumes the backend is on the same host or a dedicated production URL
    API_BASE: window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost' 
        ? 'http://localhost:3000' 
        : window.location.origin, // Fallback to current origin (useful for monoliths)
    
    // You can override this for a specific production backend:
    // API_BASE: 'https://pharma-wave-backend.herokuapp.com',
    
    SOCKET_URL: window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost'
        ? 'http://localhost:3000'
        : window.location.origin
};

// Make it available globally
window.APP_CONFIG = config;
