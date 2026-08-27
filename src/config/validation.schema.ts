import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  API_PREFIX: Joi.string().default('api'),
  CORS_ORIGIN: Joi.string().default('http://localhost:3001'),
  DATABASE_URL: Joi.string().required(),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
  SEED_MANAGER_EMAIL: Joi.string().email().default('manager@horizonpm.com'),
  SEED_MANAGER_PASSWORD: Joi.string().min(8).default('ChangeMe123!'),
  SEED_SECRETARY_EMAIL: Joi.string().email().default('secretary@horizonpm.com'),
  SEED_SECRETARY_PASSWORD: Joi.string().min(8).default('ChangeMe123!'),
  THROTTLE_TTL: Joi.number().default(60),
  THROTTLE_LIMIT: Joi.number().default(100),
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
  // STORAGE_ENDPOINT: Joi.string().required(),
  // STORAGE_BUCKET: Joi.string().required(),
  // STORAGE_ACCESS_KEY_ID: Joi.string().required(),
  // STORAGE_SECRET_ACCESS_KEY: Joi.string().required(),
  // STORAGE_REGION: Joi.string().required(),
  // Optional (not required) so the app can boot before the key is configured —
  // PdfExtractionService throws a clear error only when actually invoked without one.
  ANTHROPIC_API_KEY: Joi.string().allow('').optional(),
  // DMT/Tawtheeq extraction. Deliberately separate from the Green Contract keys
  // below so the two ingestion paths can be tuned — or rolled back — independently.
  ANTHROPIC_MODEL: Joi.string().default('claude-sonnet-5'),
  // Green Contract extraction. These are short, single-page landlord contracts,
  // so the cheapest capable model is used with a small output budget.
  ANTHROPIC_MODEL_GREEN_CONTRACT: Joi.string().default('claude-haiku-4-5-20251001'),
  ANTHROPIC_MAX_TOKENS_GREEN_CONTRACT: Joi.number().integer().min(256).max(8192).default(1500),
  // Zero: extraction must be reproducible. The same contract re-uploaded should
  // yield the same JSON, otherwise a re-import silently produces different rows.
  ANTHROPIC_TEMPERATURE_GREEN_CONTRACT: Joi.number().min(0).max(1).default(0),
});
