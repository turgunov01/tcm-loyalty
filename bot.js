import fs from 'fs'
import { randomUUID } from 'crypto'
import QRCode from 'qrcode'
import { Telegraf, Markup, session } from 'telegraf'
import { config as loadEnv } from 'dotenv'

loadEnv()

const BOT_TOKEN = process.env.BOT_TOKEN
const PUBLIC_HOST = process.env.PUBLIC_HOST || 'http://localhost:3000'
const POINTS_PER_SCAN = 10
const DAILY_POINTS = 10

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is required')
  process.exit(1)
}

// ----- Storage helpers -----
function ensureFile(file) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, '[]', 'utf8')
}

function readJson(file) {
  ensureFile(file)
  const raw = fs.readFileSync(file, 'utf8') || '[]'
  try {
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

const FILES = {
  employees: './employees.json',
  loyalty: './loyalty.json',
  scans: './scans.json'
}

// ----- Domain helpers -----
const normalizeId = (id = '') => id.trim().toLowerCase()

function getEmployees() {
  return readJson(FILES.employees)
}

function getLoyalty() {
  return readJson(FILES.loyalty)
}

function saveLoyalty(data) {
  writeJson(FILES.loyalty, data)
}

function getScans() {
  return readJson(FILES.scans)
}

function saveScans(data) {
  writeJson(FILES.scans, data)
}

function findEmployee(employeeId) {
  const employees = getEmployees()
  const target = normalizeId(employeeId)
  return employees.find((e) => normalizeId(e.employeeId) === target) || null
}

function getOrCreateProfile(employeeId, telegramId) {
  const loyalty = getLoyalty()
  const existing = loyalty.find((p) => p.telegramId === telegramId)
  if (existing) return existing

  const profile = {
    loyaltyId: randomUUID(),
    employeeId,
    telegramId,
    points: 100,
    scanCount: 0,
    lastDailyRewardAt: null
  }
  loyalty.push(profile)
  saveLoyalty(loyalty)
  return profile
}

function applyDailyRewards() {
  const loyalty = getLoyalty()
  const now = new Date()
  let changed = false
  const updated = loyalty.map((p) => {
    const last = p.lastDailyRewardAt ? new Date(p.lastDailyRewardAt) : null
    const sameDay =
      last &&
      now.getUTCFullYear() === last.getUTCFullYear() &&
      now.getUTCMonth() === last.getUTCMonth() &&
      now.getUTCDate() === last.getUTCDate()
    if (sameDay) return p
    changed = true
    return { ...p, points: p.points + DAILY_POINTS, lastDailyRewardAt: now.toISOString() }
  })
  if (changed) saveLoyalty(updated)
  return updated
}

function buildQrUrl(host, employee, profile) {
  const params = new URLSearchParams({
    firstName: employee.firstName,
    lastName: employee.lastName,
    role: employee.role,
    employeeId: employee.employeeId,
    telegramId: profile.telegramId,
    loyaltyId: profile.loyaltyId,
    points: '100',
    scanType: 'iphone'
  })
  return `${host.replace(/\/$/, '')}/scan?${params.toString()}`
}

function recordScan(loyaltyId, scanType = 'bot') {
  const loyalty = getLoyalty()
  const idx = loyalty.findIndex((p) => p.loyaltyId === loyaltyId)
  if (idx === -1) throw new Error('Loyalty profile not found')

  const profile = loyalty[idx]
  const updated = {
    ...profile,
    scanCount: profile.scanCount + 1,
    points: profile.points + POINTS_PER_SCAN
  }
  loyalty[idx] = updated
  saveLoyalty(loyalty)

  const scans = getScans()
  scans.push({
    id: randomUUID(),
    loyaltyId,
    timestamp: new Date().toISOString(),
    scanType
  })
  saveScans(scans)

  return updated
}

// ----- Bot setup -----
const bot = new Telegraf(BOT_TOKEN)
bot.use(session())

const COMMANDS = [
  { command: 'start', description: 'Register or get help' },
  { command: 'me', description: 'Show your loyalty profile' },
  { command: 'scan', description: 'Simulate a scan (+10 points)' }
]
bot.telegram.setMyCommands(COMMANDS).catch(() => {})

const KEYBOARD = Markup.keyboard([['Register', 'My QR', 'Scan']]).resize()

async function sendProfile(ctx, profile, employee, label = 'Your loyalty profile') {
  const qrUrl = buildQrUrl(PUBLIC_HOST, employee, profile)
  const qrBuffer = await QRCode.toBuffer(qrUrl, { type: 'png' })
  await ctx.replyWithPhoto(
    { source: qrBuffer },
    {
      caption: `${label}
Employee: ${employee.firstName} ${employee.lastName}
Role: ${employee.role}
Points: ${profile.points}
Scans: ${profile.scanCount}
QR embedded in image.`,
      reply_markup: KEYBOARD.reply_markup
    }
  )
}

async function handleRegistration(ctx, employeeIdRaw) {
  const employeeId = employeeIdRaw?.trim()
  if (!employeeId) {
    await ctx.reply('Send your employee ID to register.', KEYBOARD)
    return
  }
  const employee = findEmployee(employeeId)
  if (!employee) {
    await ctx.reply('Employee not found. Check your ID.', KEYBOARD)
    return
  }
  const profile = getOrCreateProfile(employee.employeeId, String(ctx.from.id))
  await sendProfile(ctx, profile, employee, 'Registered successfully')
  ctx.session.awaitingEmployeeId = false
}

async function handleShow(ctx) {
  applyDailyRewards()
  const loyalty = getLoyalty()
  const profile = loyalty.find((p) => p.telegramId === String(ctx.from.id))
  if (!profile) {
    await ctx.reply('No loyalty profile. Use Register.', KEYBOARD)
    return
  }
  const employee = findEmployee(profile.employeeId)
  if (!employee) {
    await ctx.reply('Employee data missing.', KEYBOARD)
    return
  }
  await sendProfile(ctx, profile, employee, 'Your loyalty profile')
}

async function handleScan(ctx) {
  applyDailyRewards()
  const loyalty = getLoyalty()
  const profile = loyalty.find((p) => p.telegramId === String(ctx.from.id))
  if (!profile) {
    await ctx.reply('No loyalty profile. Use Register.', KEYBOARD)
    return
  }
  const employee = findEmployee(profile.employeeId)
  if (!employee) {
    await ctx.reply('Employee data missing.', KEYBOARD)
    return
  }
  const updated = recordScan(profile.loyaltyId, 'bot')
  await sendProfile(ctx, updated, employee, 'Scan recorded (+10 points)')
}

// ----- Handlers -----
bot.start(async (ctx) => {
  ctx.session ??= {}
  ctx.session.awaitingEmployeeId = true
  await ctx.reply('Welcome! Press Register and send your employee ID.', KEYBOARD)
})

bot.command('me', handleShow)
bot.command('scan', handleScan)

bot.hears(/register/i, async (ctx) => {
  ctx.session ??= {}
  ctx.session.awaitingEmployeeId = true
  await ctx.reply('Send your employee ID to register.', KEYBOARD)
})

bot.hears(/my qr/i, handleShow)
bot.hears(/scan/i, handleScan)

bot.on('text', async (ctx) => {
  ctx.session ??= {}
  if (ctx.session.awaitingEmployeeId) {
    await handleRegistration(ctx, ctx.message.text)
    return
  }
  await ctx.reply('Use the buttons: Register, My QR, Scan.', KEYBOARD)
})

bot.launch().then(() => {
  console.log('Bot started')
})

process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))

export { applyDailyRewards }
