// server.js — simple static server that forces correct MIME for .mjs and .wasm
const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';

// Log requests for ONNX runtime files so we can inspect failing requests/headers
app.use((req, res, next) => {
  if (req.path.startsWith('/assets/onnx/')) {
    console.log(`[ONNX REQUEST] ${req.method} ${req.path} - Accept: ${req.headers.accept}`);
    // Log response details when the response finishes so we can see status and headers
    res.on('finish', () => {
      console.log(`[ONNX RESPONSE] ${req.method} ${req.path} - Status: ${res.statusCode} - Content-Type: ${res.getHeader('Content-Type')}`);
    });
  }
  next();
});

app.use(express.static(path.join(__dirname, 'www'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.mjs')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
    if (filePath.endsWith('.wasm')) {
      res.setHeader('Content-Type', 'application/wasm');
    }
    // Ensure ONNX model files are served with a binary content type
    if (filePath.endsWith('.onnx')) {
      res.setHeader('Content-Type', 'application/octet-stream');
    }
  }
}));

// SPA fallback
// SPA fallback for GET requests that accept HTML. Avoid registering a route pattern
// like '*' with path-to-regexp to prevent parameter parsing errors in some
// dependency versions. This middleware only responds to navigation requests.
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const accept = req.headers.accept || '';
  if (accept.indexOf('text/html') === -1) return next();
  res.sendFile(path.join(__dirname, 'www', 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`Serving www on http://${HOST}:${PORT}`);
});
