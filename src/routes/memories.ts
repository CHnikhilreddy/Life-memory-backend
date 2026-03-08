import { Router } from 'express'
import { prisma, formatMemory } from '../db.js'
import { authMiddleware } from '../middleware/auth.js'
import { User } from '../types.js'
import { deleteCloudinaryImages, getRemovedUrls } from '../cloudinary.js'

const router = Router()
router.use(authMiddleware)

async function validateMembership(spaceId: string, userId: string) {
  const member = await prisma.spaceMember.findUnique({
    where: { userId_spaceId: { userId, spaceId } },
  })
  if (!member || member.status !== 'active') return false
  return true
}

// POST /api/spaces/:spaceId/memories
router.post('/:spaceId/memories', async (req, res) => {
  const user = (req as any).user as User
  if (!(await validateMembership(req.params.spaceId, user.id))) {
    res.status(403).json({ error: 'Not a member of this space' }); return
  }

  const { title, date, story, location, tags, photos, endDate, visibleTo } = req.body
  if (!title?.trim() || !story?.trim()) {
    res.status(400).json({ error: 'Title and story are required' }); return
  }

  const memory = await prisma.memory.create({
    data: {
      id: `m-${Date.now()}`,
      title: title.trim(),
      date,
      endDate,
      photos: JSON.stringify(photos || []),
      story: story.trim(),
      location: location?.trim() || null,
      tags: tags ? JSON.stringify(tags) : undefined,
      reactions: JSON.stringify({}),
      visibleTo: visibleTo?.length > 0 ? JSON.stringify(visibleTo) : undefined,
      createdById: user.id,
      spaceId: req.params.spaceId,
    },
    include: { substories: true },
  })

  res.status(201).json(formatMemory(memory))
})

// PUT /api/spaces/:spaceId/memories/:memoryId
router.put('/:spaceId/memories/:memoryId', async (req, res) => {
  const user = (req as any).user as User
  if (!(await validateMembership(req.params.spaceId, user.id))) {
    res.status(403).json({ error: 'Not a member of this space' }); return
  }

  const { title, date, story, location, tags, photos, endDate, visibleTo } = req.body
  const data: any = {}
  if (title !== undefined) data.title = title.trim()
  if (date !== undefined) data.date = date
  if (endDate !== undefined) data.endDate = endDate
  if (story !== undefined) data.story = story.trim()
  if (location !== undefined) data.location = location?.trim() || null
  if (tags !== undefined) data.tags = tags ? JSON.stringify(tags) : null
  if (photos !== undefined) data.photos = JSON.stringify(photos || [])
  if (visibleTo !== undefined) data.visibleTo = visibleTo?.length > 0 ? JSON.stringify(visibleTo) : null

  // Delete removed photos from Cloudinary
  if (photos !== undefined) {
    const existing = await prisma.memory.findUnique({ where: { id: req.params.memoryId } })
    if (existing) {
      const oldPhotos: string[] = typeof existing.photos === 'string' ? JSON.parse(existing.photos) : (existing.photos as any) || []
      const removed = getRemovedUrls(oldPhotos, photos || [])
      if (removed.length > 0) deleteCloudinaryImages(removed).catch(() => {})
    }
  }

  const memory = await prisma.memory.update({
    where: { id: req.params.memoryId },
    data,
    include: { substories: true },
  })

  res.json(formatMemory(memory))
})

// DELETE /api/spaces/:spaceId/memories/:memoryId
router.delete('/:spaceId/memories/:memoryId', async (req, res) => {
  const user = (req as any).user as User
  if (!(await validateMembership(req.params.spaceId, user.id))) {
    res.status(403).json({ error: 'Not a member of this space' }); return
  }

  // Collect all photos before deleting
  const memory = await prisma.memory.findUnique({
    where: { id: req.params.memoryId },
    include: { substories: true },
  })
  if (memory) {
    const allUrls: string[] = []
    const memPhotos: string[] = typeof memory.photos === 'string' ? JSON.parse(memory.photos) : (memory.photos as any) || []
    allUrls.push(...memPhotos)
    for (const sub of memory.substories) {
      if (sub.photos) {
        const subPhotos: string[] = typeof sub.photos === 'string' ? JSON.parse(sub.photos) : (sub.photos as any) || []
        allUrls.push(...subPhotos)
      }
    }
    if (allUrls.length > 0) deleteCloudinaryImages(allUrls).catch(() => {})
  }

  await prisma.memory.delete({ where: { id: req.params.memoryId } })
  res.json({ success: true })
})

// POST /api/spaces/:spaceId/memories/:memoryId/react
router.post('/:spaceId/memories/:memoryId/react', async (req, res) => {
  const user = (req as any).user as User
  if (!(await validateMembership(req.params.spaceId, user.id))) {
    res.status(403).json({ error: 'Not a member of this space' }); return
  }

  const { emoji } = req.body
  if (!emoji) { res.status(400).json({ error: 'Emoji is required' }); return }

  const memory = await prisma.memory.findUnique({ where: { id: req.params.memoryId } })
  if (!memory) { res.status(404).json({ error: 'Memory not found' }); return }

  const reactions: Record<string, number> = typeof memory.reactions === 'string'
    ? JSON.parse(memory.reactions)
    : (memory.reactions as any) || {}
  reactions[emoji] = (reactions[emoji] || 0) + 1

  await prisma.memory.update({
    where: { id: req.params.memoryId },
    data: { reactions: JSON.stringify(reactions) },
  })

  res.json({ reactions })
})

// POST /api/spaces/:spaceId/memories/:memoryId/substories
router.post('/:spaceId/memories/:memoryId/substories', async (req, res) => {
  const user = (req as any).user as User
  if (!(await validateMembership(req.params.spaceId, user.id))) {
    res.status(403).json({ error: 'Not a member of this space' }); return
  }

  const { date, type, title, content, caption, photos } = req.body

  const substory = await prisma.subStory.create({
    data: {
      id: `sub-${Date.now()}`,
      date: date || new Date().toISOString().split('T')[0],
      type: type || 'text',
      title: title?.trim() || null,
      content: type === 'text' ? content?.trim() : null,
      caption: type !== 'text' ? caption?.trim() : null,
      photos: type !== 'text' ? JSON.stringify(photos || []) : undefined,
      memoryId: req.params.memoryId,
    },
  })

  res.status(201).json({
    id: substory.id,
    date: substory.date,
    type: substory.type,
    title: substory.title,
    content: substory.content,
    photos: substory.photos ? JSON.parse(substory.photos as string) : undefined,
    caption: substory.caption,
  })
})

// PUT /api/spaces/:spaceId/memories/:memoryId/substories/:substoryId
router.put('/:spaceId/memories/:memoryId/substories/:substoryId', async (req, res) => {
  const user = (req as any).user as User
  if (!(await validateMembership(req.params.spaceId, user.id))) {
    res.status(403).json({ error: 'Not a member of this space' }); return
  }

  const { type, title, content, caption, photos } = req.body
  const data: any = {}
  if (type !== undefined) data.type = type
  if (title !== undefined) data.title = title?.trim() || null
  if (type === 'text') {
    if (content !== undefined) data.content = content?.trim() || null
    data.caption = null; data.photos = null
  } else if (type !== undefined) {
    if (caption !== undefined) data.caption = caption?.trim() || null
    data.content = null
    if (photos !== undefined) data.photos = JSON.stringify(photos || [])
  } else {
    if (content !== undefined) data.content = content?.trim() || null
    if (caption !== undefined) data.caption = caption?.trim() || null
    if (photos !== undefined) data.photos = JSON.stringify(photos || [])
  }

  // Delete removed photos from Cloudinary
  if (photos !== undefined) {
    const existing = await prisma.subStory.findUnique({ where: { id: req.params.substoryId } })
    if (existing?.photos) {
      const oldPhotos: string[] = typeof existing.photos === 'string' ? JSON.parse(existing.photos) : (existing.photos as any) || []
      const removed = getRemovedUrls(oldPhotos, photos || [])
      if (removed.length > 0) deleteCloudinaryImages(removed).catch(() => {})
    }
  }

  const substory = await prisma.subStory.update({ where: { id: req.params.substoryId }, data })
  res.json({
    id: substory.id, date: substory.date, type: substory.type,
    title: substory.title, content: substory.content,
    photos: substory.photos ? JSON.parse(substory.photos as string) : undefined,
    caption: substory.caption,
  })
})

// DELETE /api/spaces/:spaceId/memories/:memoryId/substories/:substoryId
router.delete('/:spaceId/memories/:memoryId/substories/:substoryId', async (req, res) => {
  const user = (req as any).user as User
  if (!(await validateMembership(req.params.spaceId, user.id))) {
    res.status(403).json({ error: 'Not a member of this space' }); return
  }
  const substory = await prisma.subStory.findUnique({ where: { id: req.params.substoryId } })
  if (substory?.photos) {
    const photos: string[] = typeof substory.photos === 'string' ? JSON.parse(substory.photos) : (substory.photos as any) || []
    if (photos.length > 0) deleteCloudinaryImages(photos).catch(() => {})
  }

  await prisma.subStory.delete({ where: { id: req.params.substoryId } })
  res.json({ success: true })
})

export default router
