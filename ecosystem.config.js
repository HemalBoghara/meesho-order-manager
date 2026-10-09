module.exports = {
  apps: [
    {
      name: 'meesho-order-manager',
      script: './server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        PORT: 8000,
        HEADLESS: 'false'
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 8000,
        HEADLESS: 'true'
      }
    }
  ]
};
