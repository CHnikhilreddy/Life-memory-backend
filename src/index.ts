import 'dotenv/config'
import express, { NextFunction, Request, Response } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import rateLimit from 'express-rate-limit'
import { prisma } from './db.js'
import { logger, generateRequestId } from './logger.js'
import authRoutes from './routes/auth.js'
import spaceRoutes from './routes/spaces.js'
import memoryRoutes from './routes/memories.js'
import { sanitizeBody } from './middleware/sanitize.js'
import { responseHelpers } from './middleware/response.js'
import { trackError, getErrors, getErrorStats } from './errorTracker.js'

// Validate required environment variables
const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET'] as const
const missing = requiredEnvVars.filter(v => !process.env[v])
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
}

const optionalEnvVars = ['RESEND_API_KEY', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'] as const
const missingOptional = optionalEnvVars.filter(v => !process.env[v])
if (missingOptional.length > 0) {
  console.warn(`Warning: Missing optional environment variables: ${missingOptional.join(', ')}`)
}

const app = express()
const PORT = process.env.PORT || 3001

// Prevent process crashes from unhandled errors
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message })
  trackError(err, 'uncaught')
})
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) })
  trackError(reason instanceof Error ? reason : new Error(String(reason)), 'unhandled-rejection')
})

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'capacitor://localhost',   // iOS Capacitor WebView
  'http://localhost',        // Android Capacitor WebView
  ...(process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',').map(o => o.trim()) : []),
]
// CORS must come before helmet so preflight requests are handled correctly
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true)
    else callback(new Error('Not allowed by CORS'))
  },
  credentials: true,
}))
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
app.use(compression())
app.use(express.json({ limit: '2mb' }))

// Sanitize request bodies — skip rich text fields that contain intentional HTML
app.use(sanitizeBody(new Set(['story', 'content', 'caption'])))

// Attach consistent response helpers (res.apiSuccess / res.apiError)
app.use(responseHelpers)

// Request ID + logging
app.use((req, res, next) => {
  const requestId = (req.headers['x-request-id'] as string) || generateRequestId()
  ;(req as any).requestId = requestId
  res.setHeader('x-request-id', requestId)

  const start = Date.now()
  res.on('finish', () => {
    logger.info('request', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration: Date.now() - start,
    })
  })
  next()
})

// Rate limiting
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
})
const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many verification attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
})
const actionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: { error: 'Too many requests, please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
})
const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Too many signup attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
})

app.use('/api/auth/login', loginLimiter)
app.use('/api/auth/pre-signup', signupLimiter)
app.use('/api/auth/complete-signup', loginLimiter)
app.use('/api/auth/forgot-password', loginLimiter)
app.use('/api/auth/verify-email', verifyLimiter)
app.use('/api/spaces/:id/invite', actionLimiter)
app.use('/api/spaces/:spaceId/memories/:memoryId/react', actionLimiter)

// Wrap all async route handlers to catch unhandled rejections
function wrapRouter(router: any) {
  const methods = ['get', 'post', 'put', 'patch', 'delete'] as const
  for (const layer of router.stack || []) {
    if (layer.route) {
      for (const routeLayer of layer.route.stack) {
        const original = routeLayer.handle
        if (original.length <= 3) { // not error handler
          routeLayer.handle = (req: Request, res: Response, next: NextFunction) => {
            const result = original(req, res, next)
            if (result && typeof result.catch === 'function') {
              result.catch((err: Error) => {
                logger.error('Route error', { method: req.method, path: req.originalUrl, error: err.message, stack: err.stack })
                trackError(err, 'route', { method: req.method, path: req.originalUrl, requestId: (req as any).requestId })
                if (!res.headersSent) {
                  res.status(500).json({ error: 'Internal server error' })
                }
              })
            }
          }
        }
      }
    }
  }
  return router
}

// Routes
app.use('/api/auth', wrapRouter(authRoutes))
app.use('/api/spaces', wrapRouter(spaceRoutes))
app.use('/api/spaces', wrapRouter(memoryRoutes))

// Admin error dashboard — protected by ADMIN_SECRET
app.get('/api/admin/errors', (req, res) => {
  const secret = req.headers['x-admin-secret'] || req.query.secret
  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }
  const { source, limit, since } = req.query as Record<string, string>
  res.json({
    stats: getErrorStats(),
    errors: getErrors({
      source,
      limit: limit ? parseInt(limit) : 50,
      since,
    }),
  })
})

// Health check
app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() })
  } catch {
    res.json({ status: 'ok', db: 'disconnected', timestamp: new Date().toISOString() })
  }
})

// Global error handler — must be last middleware
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack })
  trackError(err, 'middleware', { method: req.method, path: req.originalUrl, requestId: (req as any).requestId })
  res.status(500).json({ error: 'Internal server error' })
})

app.listen(PORT, () => {
  logger.info('Server started', { port: PORT })
  logger.info('Database: PostgreSQL (Neon)')
})
