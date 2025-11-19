// api/index.js
const serverless = require('serverless-http');
const app = require('../server'); // require the server.js which exports the app
module.exports = serverless(app);
