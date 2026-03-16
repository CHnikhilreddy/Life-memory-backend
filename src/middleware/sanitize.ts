import { Request, Response, NextFunction } from 'express'
import DOMPurify from 'isomorphic-dompurify'

/**
 * Allowed HTML tags for rich text fields (story, content, caption).
 * Only safe formatting tags — no scripts, iframes, forms, event handlers, etc.
 */
const RICH_TEXT_CONFIG = {
  ALLOWED_TAGS: [
    'b', 'i', 'u', 'em', 'strong', 'p', 'br', 'span',
    'div', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3',
    'sub', 'sup', 'strike', 's', 'del',
  ],
  ALLOWED_ATTR: ['style', 'class'],
}

/** Strip ALL HTML tags from a string — used for plain text fields */
function stripAllHtml(str: string): string {
  return DOMPurify.sanitize(str, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] })
}

/** Sanitize rich text HTML — allows safe formatting tags only */
function sanitizeRichText(str: string): string {
  return DOMPurify.sanitize(str, RICH_TEXT_CONFIG)
}

/** Recursively sanitize string values in an object */
function sanitizeValue(value: any): any {
  if (typeof value === 'string') return stripAllHtml(value)
  if (Array.isArray(value)) return value.map(sanitizeValue)
  if (value && typeof value === 'object') {
    const result: any = {}
    for (const key of Object.keys(value)) {
      result[key] = sanitizeValue(value[key])
    }
    return result
  }
  return value
}

/**
 * Middleware to sanitize request body strings.
 * - Plain text fields: ALL HTML stripped via DOMPurify
 * - Rich text fields (in `richTextFields`): sanitized to allow only safe formatting tags
 */
export function sanitizeBody(richTextFields: Set<string> = new Set()) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (req.body && typeof req.body === 'object') {
      for (const key of Object.keys(req.body)) {
        if (richTextFields.has(key)) {
          // Rich text: allow safe formatting tags, strip dangerous ones
          if (typeof req.body[key] === 'string') {
            req.body[key] = sanitizeRichText(req.body[key])
          }
        } else {
          // Plain text: strip ALL HTML
          req.body[key] = sanitizeValue(req.body[key])
        }
      }
    }
    next()
  }
}
