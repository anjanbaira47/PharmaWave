const http = require('http');

const performRequest = (options, postData) => {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => { resolve(data); });
    });
    req.on('error', (e) => { reject(e); });
    if (postData) req.write(postData);
    req.end();
  });
};

(async () => {
    console.log("Creating user via DB requires DB connection, we can test via pure HTTP if server is running, but server is not running.");
})();
