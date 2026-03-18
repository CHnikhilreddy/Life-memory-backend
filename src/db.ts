import 'dotenv/config'
import pg from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from './generated/prisma/client.js'

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '10'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
})
const adapter = new PrismaPg(pool)
export const prisma = new PrismaClient({ adapter })

// Helper to format a space from DB into the API response shape
export function formatSpace(space: any) {
  return {
    id: space.id,
    title: space.title,
    coverImage: space.coverImage,
    coverImageOffsetX: space.coverImageOffsetX ?? 50,
    coverImageOffsetY: space.coverImageOffsetY ?? 50,
    coverImageScale: space.coverImageScale ?? 1,
    coverEmoji: space.coverEmoji,
    coverIcon: space.coverIcon || '',
    coverColor: space.coverColor || '',
    memoryCount: space._count?.memories ?? space.memories?.length ?? 0,
    type: space.type,
    createdBy: space.createdById,
    inviteCode: space.inviteCode,
    description: space.description,
    membersList: (space.members || []).map((m: any) => ({
      userId: m.userId,
      name: m.user?.name || m.name || '',
      role: m.role,
      status: m.status,
      permission: m.permission ?? 'edit',
      joinedAt: m.joinedAt,
    })),
    joinRequests: (space.joinRequests || []).map((r: any) => ({
      userId: r.userId,
      userName: r.user?.name || '',
      requestedAt: r.requestedAt,
    })),
  }
}

export function formatSpaceWithMemories(space: any) {
  const base = formatSpace(space)
  return {
    ...base,
    memories: (space.memories || []).map(formatMemory),
  }
}

export function formatMemory(m: any) {
  return {
    id: m.id,
    title: m.title,
    date: m.date,
    endDate: m.endDate,
    photos: parseJson(m.photos, []),
    story: m.story,
    location: m.location,
    tags: parseJson(m.tags, undefined),
    reactions: parseJson(m.reactions, {}),
    visibleTo: parseJson(m.visibleTo, undefined),
    createdBy: m.createdById,
    substoryCount: m._count?.substories ?? undefined,
    substories: m.substories ? m.substories.map((s: any) => ({
      id: s.id,
      date: s.date,
      type: s.type,
      title: s.title,
      content: s.content,
      photos: parseJson(s.photos, undefined),
      caption: s.caption,
      textStyle: parseJson(s.textStyle, undefined),
      titleStyle: parseJson(s.titleStyle, undefined),
      canvasData: parseJson(s.canvasData, undefined),
    })) : undefined,
  }
}

function parseJson(value: any, fallback: any) {
  if (value === null || value === undefined) return fallback
  if (typeof value === 'string') {
    try { return JSON.parse(value) } catch { return fallback }
  }
  return value
}
