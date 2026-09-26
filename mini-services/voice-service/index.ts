// Add uncaught exception handlers to see what's killing the process
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err)
})
process.on('unhandledRejection', (err) => {
  console.error('[FATAL] unhandledRejection:', err)
})
process.on('SIGTERM', () => {
  console.log('[SIGNAL] SIGTERM received')
  process.exit(0)
})
process.on('SIGINT', () => {
  console.log('[SIGNAL] SIGINT received')
  process.exit(0)
})
process.on('SIGHUP', () => {
  console.log('[SIGNAL] SIGHUP received')
  // don't exit - we want to survive
})
process.on('SIGUSR1', () => console.log('[SIGNAL] SIGUSR1'))
process.on('SIGUSR2', () => console.log('[SIGNAL] SIGUSR2'))

import { createServer } from 'http'
import { Server } from 'socket.io'

const httpServer = createServer()

const io = new Server(httpServer, {
  // DO NOT change the path - Caddy uses it for forwarding
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 5 * 1024 * 1024, // 5 MB for image messages
})

// ===== Types =====
interface RoomUser {
  id: string // socket id
  name: string
  muted: boolean
  joinedAt: number
}

interface Room {
  code: string
  hostId: string
  users: Map<string, RoomUser>
  createdAt: number
}

interface ChatMessage {
  id: string
  room: string
  userId: string
  name: string
  type: 'text' | 'image' | 'system'
  content: string // text or data URL or system text
  timestamp: number
}

// ===== In-memory state =====
const rooms = new Map<string, Room>()

const MAX_USERS_PER_ROOM = 10
const MAX_IMAGE_SIZE = 2 * 1024 * 1024 // 2 MB

// ===== Helpers =====
const genId = () => Math.random().toString(36).slice(2, 10)

const genRoomCode = (): string => {
  // 6-char alphanumeric, easy to share verbally (no ambiguous chars)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  // Ensure uniqueness
  if (rooms.has(code)) return genRoomCode()
  return code
}

const publicUsers = (room: Room) =>
  Array.from(room.users.values()).map((u) => ({
    id: u.id,
    name: u.name,
    muted: u.muted,
  }))

const systemMessage = (room: string, content: string): ChatMessage => ({
  id: genId(),
  room,
  userId: 'system',
  name: 'سیستم',
  type: 'system',
  content,
  timestamp: Date.now(),
})

// ===== Socket handlers =====
io.on('connection', (socket) => {
  let currentRoom: string | null = null
  let currentName: string | null = null

  console.log(`[+] ${socket.id} connected`)

  // ---- Create a new room ----
  socket.on('room:create', (data: { name: string }, ack?: (res: any) => void) => {
    try {
      const name = (data?.name || '').trim()
      if (!name) {
        ack?.({ ok: false, error: 'نام را وارد کنید' })
        return
      }
      if (rooms.size >= 1000) {
        ack?.({ ok: false, error: 'سرور پر است، بعداً تلاش کنید' })
        return
      }
      const code = genRoomCode()
      const room: Room = {
        code,
        hostId: socket.id,
        users: new Map(),
        createdAt: Date.now(),
      }
      rooms.set(code, room)
      console.log(`[room] created ${code} by ${name}`)
      ack?.({ ok: true, code })
    } catch (e) {
      console.error('[err] room:create', e)
      ack?.({ ok: false, error: 'خطای سرور' })
    }
  })

  // ---- Join an existing room ----
  socket.on('room:join', (data: { name: string; code: string }, ack?: (res: any) => void) => {
    try {
      const name = (data?.name || '').trim()
      const code = (data?.code || '').trim().toUpperCase()
      if (!name || !code) {
        ack?.({ ok: false, error: 'نام و کد اتاق را وارد کنید' })
        return
      }
      const room = rooms.get(code)
      if (!room) {
        ack?.({ ok: false, error: 'اتاقی با این کد پیدا نشد' })
        return
      }
      if (room.users.size >= MAX_USERS_PER_ROOM) {
        ack?.({ ok: false, error: `اتاق پر است (حداکثر ${MAX_USERS_PER_ROOM} نفر)` })
        return
      }

      // If user was in another room, leave it first
      if (currentRoom && currentRoom !== code) {
        leaveRoom(socket, currentRoom)
      }

      currentRoom = code
      currentName = name

      const user: RoomUser = {
        id: socket.id,
        name,
        muted: false,
        joinedAt: Date.now(),
      }
      room.users.set(socket.id, user)
      socket.join(code)

      // Send current room state to the joining user
      ack?.({
        ok: true,
        code,
        users: publicUsers(room),
        isHost: room.hostId === socket.id,
      })

      // Notify others in the room
      socket.to(code).emit('user:joined', {
        user: { id: socket.id, name, muted: false },
      })

      // Broadcast system message
      const sys = systemMessage(code, `${name} وارد اتاق شد`)
      io.to(code).emit('chat:message', sys)

      console.log(`[room] ${name} joined ${code} (${room.users.size}/${MAX_USERS_PER_ROOM})`)
    } catch (e) {
      console.error('[err] room:join', e)
      ack?.({ ok: false, error: 'خطای سرور' })
    }
  })

  // ---- WebRTC signaling: offer ----
  socket.on('signal:offer', (data: { to: string; sdp: any }) => {
    io.to(data.to).emit('signal:offer', {
      from: socket.id,
      sdp: data.sdp,
    })
  })

  // ---- WebRTC signaling: answer ----
  socket.on('signal:answer', (data: { to: string; sdp: any }) => {
    io.to(data.to).emit('signal:answer', {
      from: socket.id,
      sdp: data.sdp,
    })
  })

  // ---- WebRTC signaling: ICE candidate ----
  socket.on('signal:ice', (data: { to: string; candidate: any }) => {
    io.to(data.to).emit('signal:ice', {
      from: socket.id,
      candidate: data.candidate,
    })
  })

  // ---- Mute/unmute state ----
  socket.on('voice:mute-state', (data: { muted: boolean }) => {
    if (!currentRoom) return
    const room = rooms.get(currentRoom)
    if (!room) return
    const user = room.users.get(socket.id)
    if (!user) return
    user.muted = !!data.muted
    socket.to(currentRoom).emit('voice:mute-state', {
      userId: socket.id,
      muted: user.muted,
    })
  })

  // ---- Speaking indicator ----
  socket.on('voice:speaking', (data: { speaking: boolean }) => {
    if (!currentRoom) return
    socket.to(currentRoom).emit('voice:speaking', {
      userId: socket.id,
      speaking: !!data.speaking,
    })
  })

  // ---- Chat messages (text or image) ----
  socket.on('chat:message', (data: { type: 'text' | 'image'; content: string }, ack?: (res: any) => void) => {
    try {
      if (!currentRoom || !currentName) {
        ack?.({ ok: false, error: 'در اتاق نیستید' })
        return
      }
      const content = (data?.content || '').trim()
      if (!content) {
        ack?.({ ok: false, error: 'پیام خالی' })
        return
      }
      if (data.type === 'image' && content.length > MAX_IMAGE_SIZE) {
        ack?.({ ok: false, error: 'تصویر خیلی بزرگ است (حداکثر ۲ مگابایت)' })
        return
      }
      if (data.type === 'text' && content.length > 2000) {
        ack?.({ ok: false, error: 'پیام خیلی طولانی است' })
        return
      }

      const msg: ChatMessage = {
        id: genId(),
        room: currentRoom,
        userId: socket.id,
        name: currentName,
        type: data.type,
        content,
        timestamp: Date.now(),
      }
      io.to(currentRoom).emit('chat:message', msg)
      ack?.({ ok: true, id: msg.id })
      console.log(`[chat] ${currentName} @ ${currentRoom}: ${data.type}`)
    } catch (e) {
      console.error('[err] chat:message', e)
      ack?.({ ok: false, error: 'خطای سرور' })
    }
  })

  // ---- Leave room explicitly ----
  socket.on('room:leave', () => {
    if (currentRoom) {
      leaveRoom(socket, currentRoom)
      currentRoom = null
      currentName = null
    }
  })

  // ---- Disconnect ----
  socket.on('disconnect', () => {
    if (currentRoom) {
      leaveRoom(socket, currentRoom)
    }
    console.log(`[-] ${socket.id} disconnected`)
  })

  socket.on('error', (err) => {
    console.error(`[err] ${socket.id}:`, err)
  })
})

function leaveRoom(socket: any, code: string) {
  const room = rooms.get(code)
  if (!room) return
  const user = room.users.get(socket.id)
  if (!user) return

  room.users.delete(socket.id)
  socket.leave(code)

  // Notify others
  socket.to(code).emit('user:left', { userId: socket.id })
  const sys = systemMessage(code, `${user.name} اتاق را ترک کرد`)
  io.to(code).emit('chat:message', sys)

  // If room empty, delete after short delay
  if (room.users.size === 0) {
    rooms.delete(code)
    console.log(`[room] ${code} deleted (empty)`)
  } else {
    // If host left, assign new host
    if (room.hostId === socket.id) {
      const newHost = room.users.values().next().value
      if (newHost) {
        room.hostId = newHost.id
        io.to(code).emit('host:changed', { hostId: newHost.id })
      }
    }
  }
}

// ===== Start =====
const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`🎙️  Voice service running on port ${PORT}`)
})

// Keep alive - log every 5 seconds
setInterval(() => {
  console.log(`[heartbeat] rooms=${rooms.size} ts=${new Date().toISOString()}`)
}, 5000)
