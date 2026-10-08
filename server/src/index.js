const config = require('./config');
const { createApp } = require('./app');

createApp({ port: config.port }).then(({ port, store, engine }) => {
  console.log(`[zeroasphyx] server listening on http://localhost:${port}`);
  console.log(`[zeroasphyx] storage: ${store.kind} (${store.backend.file})`);
  console.log(`[zeroasphyx] data source: ${engine.mode}; QR links use ${config.publicUrl || 'the address the dashboard is opened from'}`);
});
