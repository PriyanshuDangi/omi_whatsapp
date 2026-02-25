module.exports = {
  apps: [{
    name: 'omi-whatsapp',
    script: 'dist/index.js',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    max_memory_restart: '512M',
  }]
};
