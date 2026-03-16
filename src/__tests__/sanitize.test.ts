import { describe, it, expect, vi } from 'vitest'
import { sanitizeBody } from '../middleware/sanitize.js'
import { Request, Response, NextFunction } from 'express'

function createMockReqRes(body: any) {
  const req = { body } as Request
  const res = {} as Response
  const next = vi.fn() as NextFunction
  return { req, res, next }
}

describe('sanitizeBody middleware', () => {
  it('strips script tags and their content', () => {
    const { req, res, next } = createMockReqRes({
      name: '<script>alert("xss")</script>John',
      email: 'test@example.com',
    })
    sanitizeBody()(req, res, next)
    expect(req.body.name).toBe('John')
    expect(req.body.email).toBe('test@example.com')
    expect(next).toHaveBeenCalled()
  })

  it('strips HTML from nested objects', () => {
    const { req, res, next } = createMockReqRes({
      profile: { bio: '<b>bold</b> text' },
    })
    sanitizeBody()(req, res, next)
    expect(req.body.profile.bio).toBe('bold text')
  })

  it('strips HTML from arrays', () => {
    const { req, res, next } = createMockReqRes({
      tags: ['<em>tag1</em>', 'tag2'],
    })
    sanitizeBody()(req, res, next)
    expect(req.body.tags).toEqual(['tag1', 'tag2'])
  })

  it('sanitizes rich text fields to allow safe tags only', () => {
    const { req, res, next } = createMockReqRes({
      story: '<p>Rich <b>text</b> content</p><script>alert(1)</script>',
      title: '<b>Title</b>',
    })
    sanitizeBody(new Set(['story']))(req, res, next)
    expect(req.body.story).toBe('<p>Rich <b>text</b> content</p>')
    expect(req.body.title).toBe('Title')
  })

  it('strips event handlers from rich text fields', () => {
    const { req, res, next } = createMockReqRes({
      content: '<p onmouseover="alert(1)">Hello</p><img src=x onerror="steal()">',
    })
    sanitizeBody(new Set(['content']))(req, res, next)
    expect(req.body.content).not.toContain('onmouseover')
    expect(req.body.content).not.toContain('onerror')
    expect(req.body.content).toContain('<p>Hello</p>')
  })

  it('handles non-object body gracefully', () => {
    const req = { body: null } as Request
    const res = {} as Response
    const next = vi.fn() as NextFunction
    sanitizeBody()(req, res, next)
    expect(next).toHaveBeenCalled()
  })

  it('preserves non-string values', () => {
    const { req, res, next } = createMockReqRes({
      count: 42,
      active: true,
      data: null,
    })
    sanitizeBody()(req, res, next)
    expect(req.body.count).toBe(42)
    expect(req.body.active).toBe(true)
    expect(req.body.data).toBeNull()
  })
})
