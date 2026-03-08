import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { prisma } from './db.js'
import authRoutes from './routes/auth.js'
import spaceRoutes from './routes/spaces.js'
import memoryRoutes from './routes/memories.js'

const app = express()
const PORT = process.env.PORT || 3001

const allowedOrigins = [
  'http://localhost:5173',
  ...(process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',').map(o => o.trim()) : []),
]
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) callback(null, true)
    else callback(new Error('Not allowed by CORS'))
  },
  credentials: true,
}))
app.use(express.json())

// Routes
app.use('/api/auth', authRoutes)
app.use('/api/spaces', spaceRoutes)
app.use('/api/spaces', memoryRoutes)

// Health check
app.get('/api/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ok', db: 'connected', timestamp: new Date().toISOString() })
  } catch {
    res.json({ status: 'ok', db: 'disconnected', timestamp: new Date().toISOString() })
  }
})

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log('Database: PostgreSQL (Neon)')
})
