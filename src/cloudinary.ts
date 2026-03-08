import { v2 as cloudinary } from 'cloudinary'

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

function extractPublicId(url: string): string | null {
  try {
    const uploadIndex = url.indexOf('/upload/')
    if (uploadIndex === -1) return null
    let path = url.slice(uploadIndex + 8) // after '/upload/'
    path = path.replace(/^v\d+\//, '')    // remove version prefix e.g. v1234567890/
    path = path.replace(/\.[^/.]+$/, '')  // remove file extension
    return path
  } catch {
    return null
  }
}

export async function deleteCloudinaryImages(urls: string[]): Promise<void> {
  if (!urls || urls.length === 0) return
  const publicIds = urls.map(extractPublicId).filter(Boolean) as string[]
  if (publicIds.length === 0) return
  await Promise.all(publicIds.map((id) => cloudinary.uploader.destroy(id)))
}

// Returns URLs that were removed (present in oldUrls but not in newUrls)
export function getRemovedUrls(oldUrls: string[], newUrls: string[]): string[] {
  const newSet = new Set(newUrls)
  return oldUrls.filter((url) => !newSet.has(url))
}
