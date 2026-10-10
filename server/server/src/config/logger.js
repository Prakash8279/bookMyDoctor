/**
 * winston logger instance (structured JSON logs) + morgan HTTP request-log stream adapter.
 * Responsibility: one logger for the whole app; console transport in dev, JSON file/stdout in prod.
 */
const winston = require('winston');
const env = require('./env');

const { combine, timestamp, errors, json, colorize, printf } = winston.format;

const devFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, stack, ...meta }) => {
    const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${ts} ${level}: ${stack || message}${extra}`;
  })
);

const prodFormat = combine(timestamp(), errors({ stack: true }), json());

// Optional dependency: local log-file rotation only makes sense on a plain VM deploy (a
// managed host like Render/Railway/Heroku has its own log drain and doesn't need this, and
// most of them don't let you write persistent files to disk anyway). winston-daily-rotate-file
// is NOT in package.json — `npm install winston-daily-rotate-file` on a VM deploy that wants
// rotating log files on disk. require() is wrapped in try/catch so a plain `npm install`
// without that optional package still boots the app fine; it just logs to stdout only, same as
// before this change.
let rotateTransport = null;
if (env.isProduction) {
  try {
    const DailyRotateFile = require('winston-daily-rotate-file');
    rotateTransport = new DailyRotateFile({
      dirname: 'logs',
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      format: prodFormat,
    });
  } catch (err) {
    // Optional dep not installed — fall through with stdout-only logging.
    rotateTransport = null;
  }
}

const transports = [new winston.transports.Console()];
if (rotateTransport) transports.push(rotateTransport);

const logger = winston.createLogger({
  // Env-driven so an operator can dial verbosity (e.g. temporarily to 'debug' in production
  // while chasing an incident) without a code change or redeploy. Falls back to the previous
  // hardcoded info/debug split when LOG_LEVEL isn't set — see config/env.js.
  level: env.logLevel,
  levels: winston.config.npm.levels, // includes 'http'
  format: env.isProduction ? prodFormat : devFormat,
  transports,
  exitOnError: false,
});

// Adapter so morgan can stream request lines through winston at the 'http' level.
logger.stream = {
  write: (message) => logger.http(message.trim()),
};

module.exports = logger;
