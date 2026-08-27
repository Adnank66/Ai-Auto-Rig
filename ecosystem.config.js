module.exports = {
  apps: [
    {
      name: "pc-builder",
      script: "backend/server.js",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      env: {
        NODE_ENV: "production"
      },
      out_file: "logs/out.log",
      error_file: "logs/error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z"
    }
  ]
};
