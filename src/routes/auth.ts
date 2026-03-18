import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { prisma } from '../db.js'
import { Resend } from 'resend'
import { authMiddleware, invalidateUserCache } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'

const router = Router()

function generateCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

function codeExpiry(): Date {
  return new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
}

function signToken(userId: string): string {
  return jwt.sign({ userId }, process.env.JWT_SECRET!, { expiresIn: '7d' })
}

function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters'
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter'
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter'
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number'
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one special character'
  return null
}

async function sendVerificationEmail(email: string, name: string, code: string) {
  if (!process.env.RESEND_API_KEY) { console.log(`[dev] Verification code for ${email}: ${code}`); return }
  const resend = new Resend(process.env.RESEND_API_KEY)
  resend.emails.send({
    from: 'My Inner Circle <noreply@jagadeeshsura.in>',
    to: email,
    subject: 'Verify your email – My Inner Circle',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#fffaf6;border-radius:16px;">
        <h2 style="font-family:Georgia,serif;color:#3d2c1e;margin-bottom:8px;">Welcome${name ? `, ${name}` : ''}! 🌸</h2>
        <p style="color:#6b5744;font-size:15px;line-height:1.6;">
          Enter this code to verify your email address:
        </p>
        <div style="background:#fff;border-radius:12px;padding:20px;margin:24px 0;text-align:center;border:1px solid #e8ddd6;">
          <p style="font-family:monospace;font-size:36px;letter-spacing:8px;color:#3d2c1e;margin:0;font-weight:bold;">${code}</p>
          <p style="color:#9b8579;font-size:12px;margin:8px 0 0;">Expires in 15 minutes</p>
        </div>
        <p style="color:#9b8579;font-size:13px;">If you didn't create an account, you can safely ignore this email.</p>
      </div>
    `,
  }).catch((e) => console.error('Verification email failed:', e))
}

async function sendResetEmail(email: string, code: string) {
  if (!process.env.RESEND_API_KEY) { console.log(`[dev] Reset code for ${email}: ${code}`); return }
  const resend = new Resend(process.env.RESEND_API_KEY)
  resend.emails.send({
    from: 'My Inner Circle <noreply@jagadeeshsura.in>',
    to: email,
    subject: 'Reset your password – My Inner Circle',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#fffaf6;border-radius:16px;">
        <h2 style="font-family:Georgia,serif;color:#3d2c1e;margin-bottom:8px;">Password Reset 🔑</h2>
        <p style="color:#6b5744;font-size:15px;line-height:1.6;">
          Use this code to reset your password:
        </p>
        <div style="background:#fff;border-radius:12px;padding:20px;margin:24px 0;text-align:center;border:1px solid #e8ddd6;">
          <p style="font-family:monospace;font-size:36px;letter-spacing:8px;color:#3d2c1e;margin:0;font-weight:bold;">${code}</p>
          <p style="color:#9b8579;font-size:12px;margin:8px 0 0;">Expires in 15 minutes</p>
        </div>
        <p style="color:#9b8579;font-size:13px;">If you didn't request a password reset, you can safely ignore this email.</p>
      </div>
    `,
  }).catch((e) => console.error('Reset email failed:', e))
}


async function sendVaultResetEmail(email: string, name: string, code: string) {
  if (!process.env.RESEND_API_KEY) { console.log(`[dev] Vault reset code for ${email}: ${code}`); return }
  const resend = new Resend(process.env.RESEND_API_KEY)
  resend.emails.send({
    from: 'My Inner Circle <noreply@jagadeeshsura.in>',
    to: email,
    subject: 'Reset your secret vault code – My Inner Circle',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#fffaf6;border-radius:16px;">
        <h2 style="font-family:Georgia,serif;color:#3d2c1e;margin-bottom:8px;">Vault Code Reset 🔐</h2>
        <p style="color:#6b5744;font-size:15px;line-height:1.6;">Hi${name ? ` ${name}` : ''},</p>
        <p style="color:#6b5744;font-size:15px;line-height:1.6;">Use this code to reset your secret vault PIN:</p>
        <div style="background:#fff;border-radius:12px;padding:20px;margin:24px 0;text-align:center;border:1px solid #e8ddd6;">
          <p style="font-family:monospace;font-size:36px;letter-spacing:8px;color:#3d2c1e;margin:0;font-weight:bold;">${code}</p>
          <p style="color:#9b8579;font-size:12px;margin:8px 0 0;">Expires in 15 minutes</p>
        </div>
        <p style="color:#9b8579;font-size:13px;">If you didn't request this, you can safely ignore this email. Your vault is still secure.</p>
      </div>
    `,
  }).catch((e) => console.error('Vault reset email failed:', e))
}

const preSignupSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
})

const completeSignupSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  name: z.string().trim().min(1, 'Name is required'),
  password: z.string().min(1, 'Password is required'),
})

const loginSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
  password: z.string().optional(),
}).refine(data => data.email || data.phone, { message: 'Email or phone required' })

const sendVerificationSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
})

const verifyEmailSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  code: z.string().min(1, 'Code is required'),
})

const forgotPasswordSchema = z.object({
  email: z.string().trim().min(1, 'Email is required'),
})

const resetPasswordSchema = z.object({
  email: z.string().trim().min(1, 'Email is required'),
  code: z.string().trim().min(1, 'Code is required'),
  newPassword: z.string().min(6, 'Password must be at least 6 characters'),
})

const changePasswordSchema = z.object({
  oldPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(1, 'New password is required'),
})

const profileSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters'),
})

const sendLoginCodeSchema = z.object({
  email: z.string().trim().min(1, 'Email required'),
})

const loginWithCodeSchema = z.object({
  email: z.string().trim().min(1, 'Email required'),
  code: z.string().trim().min(1, 'Code required'),
})

const vaultCodeSchema = z.object({
  code: z.string().regex(/^\d{4}$/, 'Code must be exactly 4 digits'),
})

const changeVaultCodeSchema = z.object({
  currentCode: z.string().min(1, 'Current code is required'),
  newCode: z.string().regex(/^\d{4}$/, 'New code must be exactly 4 digits'),
})

const verifyVaultCodeSchema = z.object({
  code: z.string().min(1, 'Code is required'),
})

const resetVaultCodeSchema = z.object({
  otpCode: z.string().min(1, 'OTP code is required'),
  newCode: z.string().regex(/^\d{4}$/, 'New code must be exactly 4 digits'),
})

const hiddenSpacesSchema = z.object({
  spaceIds: z.array(z.string()),
})

// POST /api/auth/pre-signup — step 1: send verification code to email
router.post('/pre-signup', validate(preSignupSchema), async (req, res) => {
  const { email } = req.body
  const emailLower = email.trim().toLowerCase()
  const existing = await prisma.user.findUnique({ where: { email: emailLower } })

  if (existing) {
    // Already a complete account (has password) — reject
    if (existing.password) {
      res.status(409).json({ error: 'An account with this email already exists' }); return
    }
    // Incomplete signup — resend code so they can continue
    const code = generateCode()
    await prisma.user.update({
      where: { id: existing.id },
      data: { verificationCode: code, verificationCodeExpiry: codeExpiry() },
    })
    await sendVerificationEmail(emailLower, '', code)
    res.json({ userId: existing.id }); return
  }

  const code = generateCode()
  const user = await prisma.user.create({
    data: {
      id: `u-${Date.now()}`,
      name: '',
      email: emailLower,
      emailVerified: false,
      verificationCode: code,
      verificationCodeExpiry: codeExpiry(),
    },
  })
  await sendVerificationEmail(user.email, '', code)
  res.json({ userId: user.id })
})

// POST /api/auth/complete-signup — step 3: set name + password after email verified
router.post('/complete-signup', validate(completeSignupSchema), async (req, res) => {
  const { userId, name, password } = req.body
  const pwErr = validatePassword(password)
  if (pwErr) { res.status(400).json({ error: pwErr }); return }
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) { res.status(404).json({ error: 'User not found' }); return }
  if (!user.emailVerified) { res.status(403).json({ error: 'Please verify your email first' }); return }
  if (user.password) { res.status(409).json({ error: 'Account already set up. Please sign in.' }); return }

  const hashed = await bcrypt.hash(password, 10)
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { name: name.trim(), password: hashed },
  })
  res.json({
    user: { id: updated.id, name: updated.name, email: updated.email, avatar: updated.avatar, emailVerified: true },
    token: signToken(updated.id),
  })
})

// POST /api/auth/login
router.post('/login', validate(loginSchema), async (req, res) => {
  const { email, phone, password } = req.body

  // Email + password login
  if (email) {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
    if (!user) {
      res.status(404).json({ error: 'No account found with this email. Sign up instead.', noAccount: true }); return
    }
    if (user.password) {
      const valid = await bcrypt.compare(password || '', user.password)
      if (!valid) {
        res.status(401).json({ error: 'Invalid email or password' }); return
      }
    }
    // Email not verified — send fresh code
    if (!user.emailVerified) {
      const code = generateCode()
      await prisma.user.update({
        where: { id: user.id },
        data: { verificationCode: code, verificationCodeExpiry: codeExpiry() },
      })
      await sendVerificationEmail(user.email, user.name, code)
      res.status(403).json({ error: 'Email not verified', emailNotVerified: true, userId: user.id, token: signToken(user.id) })
      return
    }
    // Verified but no password — incomplete signup, send to profile step
    if (!user.password) {
      res.status(403).json({ error: 'Please complete your account setup', incompleteSignup: true, userId: user.id })
      return
    }
    res.json({ user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar, phone: user.phone, emailVerified: true, hasVaultCode: !!user.vaultCode, hiddenSpaceIds: (user.hiddenSpaceIds as string[]) || [] }, token: signToken(user.id) })
    return
  }

  // Phone login
  if (phone) {
    const user = await prisma.user.findFirst({ where: { phone } })
    if (!user) { res.status(401).json({ error: 'No account found with this phone number' }); return }
    res.json({ user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar, phone: user.phone, emailVerified: user.emailVerified, hasVaultCode: !!user.vaultCode, hiddenSpaceIds: (user.hiddenSpaceIds as string[]) || [] }, token: signToken(user.id) })
    return
  }

})

// GET /api/auth/me — session restore
router.get('/me', authMiddleware, async (req, res) => {
  const user = (req as any).user
  res.json({
    user: {
      id: user.id, name: user.name, email: user.email,
      avatar: user.avatar, phone: user.phone, emailVerified: user.emailVerified,
      hasVaultCode: !!user.vaultCode,
      hiddenSpaceIds: (user.hiddenSpaceIds as string[]) || [],
    },
  })
})

// POST /api/auth/send-verification
router.post('/send-verification', validate(sendVerificationSchema), async (req, res) => {
  const { userId } = req.body
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) { res.status(404).json({ error: 'User not found' }); return }
  if (user.emailVerified) { res.json({ success: true, message: 'Email already verified' }); return }
  const code = generateCode()
  await prisma.user.update({
    where: { id: userId },
    data: { verificationCode: code, verificationCodeExpiry: codeExpiry() },
  })
  await sendVerificationEmail(user.email, user.name, code)
  res.json({ success: true })
})

// POST /api/auth/verify-email
router.post('/verify-email', validate(verifyEmailSchema), async (req, res) => {
  const { userId, code } = req.body
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) { res.status(404).json({ error: 'User not found' }); return }
  if (user.emailVerified) { res.json({ user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar, emailVerified: true }, token: signToken(user.id) }); return }
  if (user.verificationCode !== code.trim()) {
    res.status(400).json({ error: 'Invalid verification code' }); return
  }
  if (user.verificationCodeExpiry && new Date() > user.verificationCodeExpiry) {
    res.status(400).json({ error: 'Verification code has expired. Please request a new one.' }); return
  }
  await prisma.user.update({
    where: { id: userId },
    data: { emailVerified: true, verificationCode: null, verificationCodeExpiry: null },
  })
  res.json({ user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar, emailVerified: true }, token: signToken(user.id) })
})

// POST /api/auth/forgot-password
router.post('/forgot-password', validate(forgotPasswordSchema), async (req, res) => {
  const { email } = req.body
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
  // Always respond success to avoid email enumeration
  if (!user) { res.json({ success: true }); return }
  const code = generateCode()
  await prisma.user.update({
    where: { id: user.id },
    data: { resetCode: code, resetCodeExpiry: codeExpiry() },
  })
  await sendResetEmail(user.email, code)
  res.json({ success: true })
})

// POST /api/auth/reset-password
router.post('/reset-password', validate(resetPasswordSchema), async (req, res) => {
  const { email, code, newPassword } = req.body
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
  if (!user || user.resetCode !== code.trim()) {
    res.status(400).json({ error: 'Invalid or expired reset code' }); return
  }
  if (user.resetCodeExpiry && new Date() > user.resetCodeExpiry) {
    res.status(400).json({ error: 'Reset code has expired. Please request a new one.' }); return
  }
  const hashed = await bcrypt.hash(newPassword, 10)
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashed, resetCode: null, resetCodeExpiry: null },
  })
  res.json({ success: true })
})

// POST /api/auth/change-password (requires auth)
router.post('/change-password', authMiddleware, validate(changePasswordSchema), async (req, res) => {
  const user = (req as any).user
  if (!user) { res.status(401).json({ error: 'Unauthorized' }); return }
  const { oldPassword, newPassword } = req.body
  const pwErr = validatePassword(newPassword)
  if (pwErr) { res.status(400).json({ error: pwErr }); return }
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } })
  if (!dbUser?.password) { res.status(400).json({ error: 'No password set' }); return }
  const valid = await bcrypt.compare(oldPassword, dbUser.password)
  if (!valid) { res.status(401).json({ error: 'Current password is incorrect' }); return }
  const hashed = await bcrypt.hash(newPassword, 10)
  await prisma.user.update({ where: { id: user.id }, data: { password: hashed } })
  invalidateUserCache(user.id)
  res.json({ success: true })
})

// PATCH /api/auth/profile — update username
router.patch('/profile', authMiddleware, validate(profileSchema), async (req, res) => {
  const user = (req as any).user
  if (!user) { res.status(401).json({ error: 'Unauthorized' }); return }
  const { name } = req.body
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { name: name.trim() },
  })
  invalidateUserCache(user.id)
  res.json({ success: true, user: { id: updated.id, name: updated.name, email: updated.email, avatar: updated.avatar, phone: updated.phone, emailVerified: updated.emailVerified } })
})

// POST /api/auth/send-login-code — send a 6-digit code for passwordless login
router.post('/send-login-code', validate(sendLoginCodeSchema), async (req, res) => {
  const { email } = req.body
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })
  if (!user) { res.status(404).json({ error: 'No account found with this email', noAccount: true }); return }
  if (!user.emailVerified) { res.status(403).json({ error: 'Email not verified' }); return }
  const code = generateCode()
  await prisma.user.update({
    where: { id: user.id },
    data: { verificationCode: code, verificationCodeExpiry: codeExpiry() },
  })
  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY)
    resend.emails.send({
      from: 'My Inner Circle <noreply@jagadeeshsura.in>',
      to: user.email,
      subject: 'Your login code – My Inner Circle',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;background:#fffaf6;border-radius:16px;">
          <h2 style="font-family:Georgia,serif;color:#3d2c1e;margin-bottom:8px;">Welcome back${user.name ? `, ${user.name}` : ''}! 🌸</h2>
          <p style="color:#6b5744;font-size:15px;line-height:1.6;">Here's your login code:</p>
          <div style="background:#fff;border-radius:12px;padding:20px;margin:24px 0;text-align:center;border:1px solid #e8ddd6;">
            <p style="font-family:monospace;font-size:36px;letter-spacing:8px;color:#3d2c1e;margin:0;font-weight:bold;">${code}</p>
            <p style="color:#9b8579;font-size:12px;margin:8px 0 0;">Expires in 15 minutes</p>
          </div>
        </div>
      `,
    }).catch((e) => console.error('Login code email failed:', e))
  }
  res.json({ success: true })
})

// POST /api/auth/login-with-code — verify login code
router.post('/login-with-code', validate(loginWithCodeSchema), async (req, res) => {
  const { email, code } = req.body
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } })
  if (!user) { res.status(404).json({ error: 'No account found' }); return }
  if (!user.verificationCode || user.verificationCode !== code.trim()) {
    res.status(401).json({ error: 'Invalid code' }); return
  }
  if (user.verificationCodeExpiry && new Date() > user.verificationCodeExpiry) {
    res.status(401).json({ error: 'Code has expired. Please request a new one.' }); return
  }
  // Clear used code
  await prisma.user.update({ where: { id: user.id }, data: { verificationCode: null, verificationCodeExpiry: null } })
  res.json({ user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar, phone: user.phone, emailVerified: true, hasVaultCode: !!user.vaultCode, hiddenSpaceIds: (user.hiddenSpaceIds as string[]) || [] }, token: signToken(user.id) })
})

// POST /api/auth/vault-code — set vault PIN for the first time
router.post('/vault-code', authMiddleware, validate(vaultCodeSchema), async (req, res) => {
  const user = (req as any).user
  const { code } = req.body
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } })
  if (dbUser?.vaultCode) { res.status(409).json({ error: 'Vault code already set. Use PATCH to change it.' }); return }
  const hashed = await bcrypt.hash(code, 10)
  await prisma.user.update({ where: { id: user.id }, data: { vaultCode: hashed } })
  invalidateUserCache(user.id)
  res.json({ success: true })
})

// PATCH /api/auth/vault-code — change vault PIN (requires current PIN)
router.patch('/vault-code', authMiddleware, validate(changeVaultCodeSchema), async (req, res) => {
  const user = (req as any).user
  const { currentCode, newCode } = req.body
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } })
  if (!dbUser?.vaultCode) { res.status(400).json({ error: 'No vault code set' }); return }
  const valid = await bcrypt.compare(currentCode, dbUser.vaultCode)
  if (!valid) { res.status(401).json({ error: 'Current code is incorrect' }); return }
  const hashed = await bcrypt.hash(newCode, 10)
  await prisma.user.update({ where: { id: user.id }, data: { vaultCode: hashed } })
  invalidateUserCache(user.id)
  res.json({ success: true })
})

// POST /api/auth/vault-code/verify — verify entered PIN to unlock vault
router.post('/vault-code/verify', authMiddleware, validate(verifyVaultCodeSchema), async (req, res) => {
  const user = (req as any).user
  const { code } = req.body
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } })
  if (!dbUser?.vaultCode) { res.status(400).json({ error: 'No vault code set' }); return }
  const valid = await bcrypt.compare(code, dbUser.vaultCode)
  if (!valid) { res.status(401).json({ error: 'Incorrect code' }); return }
  res.json({ success: true })
})

// POST /api/auth/vault-code/forgot — send OTP to reset vault PIN
router.post('/vault-code/forgot', authMiddleware, async (req, res) => {
  const user = (req as any).user
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } })
  if (!dbUser?.vaultCode) { res.status(400).json({ error: 'No vault code set' }); return }
  const code = generateCode()
  await prisma.user.update({
    where: { id: user.id },
    data: { vaultResetCode: code, vaultResetCodeExpiry: codeExpiry() },
  })
  invalidateUserCache(user.id)
  await sendVaultResetEmail(dbUser.email, dbUser.name, code)
  res.json({ success: true })
})

// POST /api/auth/vault-code/verify-otp — validate OTP without resetting (used in step 2 of forgot flow)
router.post('/vault-code/verify-otp', authMiddleware, async (req, res) => {
  const user = (req as any).user
  const { otpCode } = req.body
  if (!otpCode) { res.status(400).json({ error: 'OTP code is required' }); return }
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } })
  if (!dbUser?.vaultResetCode) { res.status(400).json({ error: 'No reset code requested' }); return }
  if (dbUser.vaultResetCode !== otpCode.trim()) { res.status(401).json({ error: 'Invalid code. Please check your email.' }); return }
  if (dbUser.vaultResetCodeExpiry && new Date() > dbUser.vaultResetCodeExpiry) {
    res.status(401).json({ error: 'Code expired. Request a new one.' }); return
  }
  res.json({ success: true })
})

// POST /api/auth/vault-code/reset — verify OTP and set new vault PIN
router.post('/vault-code/reset', authMiddleware, validate(resetVaultCodeSchema), async (req, res) => {
  const user = (req as any).user
  const { otpCode, newCode } = req.body
  const dbUser = await prisma.user.findUnique({ where: { id: user.id } })
  if (!dbUser?.vaultResetCode) { res.status(400).json({ error: 'No reset code requested' }); return }
  if (dbUser.vaultResetCode !== otpCode.trim()) { res.status(401).json({ error: 'Invalid code. Please check your email.' }); return }
  if (dbUser.vaultResetCodeExpiry && new Date() > dbUser.vaultResetCodeExpiry) {
    res.status(401).json({ error: 'Code expired. Request a new one.' }); return
  }
  const hashed = await bcrypt.hash(newCode, 10)
  await prisma.user.update({
    where: { id: user.id },
    data: { vaultCode: hashed, vaultResetCode: null, vaultResetCodeExpiry: null },
  })
  invalidateUserCache(user.id)
  res.json({ success: true })
})

// PATCH /api/auth/hidden-spaces — update the list of hidden space IDs
router.patch('/hidden-spaces', authMiddleware, validate(hiddenSpacesSchema), async (req, res) => {
  const user = (req as any).user
  const { spaceIds } = req.body
  await prisma.user.update({ where: { id: user.id }, data: { hiddenSpaceIds: spaceIds } })
  invalidateUserCache(user.id)
  res.json({ success: true, hiddenSpaceIds: spaceIds })
})

// POST /api/auth/refresh — issue a fresh token if the current one is still valid
router.post('/refresh', authMiddleware, async (req: any, res) => {
  res.json({ token: signToken(req.user.id) })
})

// GET /api/auth/users (requires auth)
router.get('/users', authMiddleware, async (_req, res) => {
  const users = await prisma.user.findMany({
    orderBy: { id: 'asc' },
    select: { id: true, name: true, email: true, avatar: true },
  })
  res.json(users)
})

export default router
