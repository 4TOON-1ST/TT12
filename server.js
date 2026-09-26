// Production server: integrates Next.js + Socket.io on a single port
// Used by Railway (and other PaaS providers) - no Caddy needed.
// In dev mode, the mini-services/voice-service runs separately on port 3003
// and Caddy proxies XTransformPort requests. In production, this server.js
// runs everything on a single port (process.env.PORT).

const http = require('http')
const { parse } = require('url')
const { Server: SocketIOServer } = require('socket.io')

// ====== In-memory state ======
const rooms = new Map()
const MAX_USERS_PER_ROOM = 10
const MAX_IMAGE_SIZE = 2 * 1024 * 1024 // 2 MB

// ====== Helpers ======
const genId = () => Math.random().toString(36).slice(2, 10)

const genRoomCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  if (rooms.has(code)) return genRoomCode()
  return code
}

const publicUsers = (room) =>
  Array.from(room.users.values()).map((u) => ({
    id: u.id,
    name: u.name,
    muted: u.muted,
  }))

const systemMessage = (room, content) => ({
  id: genId(),
  room,
  userId: 'system',
  name: 'سیستم',
  type: 'system',
  content,
  timestamp: Date.now(),
})

function leaveRoom(socket, code) {
  const room = rooms.get(code)
  if (!room) return
  const user = room.users.get(socket.id)
  if (!user) return

  room.users.delete(socket.id)
  socket.leave(code)

  socket.to(code).emit('user:left', { userId: socket.id })
  const sys = systemMessage(code, `${user.name} اتاق را ترک کرد`)
  io.to(code).emit('chat:message', sys)

  if (room.users.size === 0) {
    rooms.delete(code)
    console.log(`[room] ${code} deleted (empty)`)
  } else {
    if (room.hostId === socket.id) {
      const newHost = room.users.values().next().value
      if (newHost) {
        room.hostId = newHost.id
        io.to(code).emit('host:changed', { hostId: newHost.id })
      }
    }
  }
}

// ====== Setup ======
let io

async function setupServer() {
  console.log('[server] starting setup...')
  console.log('[server] cwd:', process.cwd())
  console.log('[server] __dirname:', __dirname)

  // Load Next.js
  let app, handle
  try {
    const next = require('next')
    console.log('[server] next required, version:', next.version || 'unknown')
    app = next({ dev: false, dir: __dirname })
    handle = app.getRequestHandler()
    console.log('[server] next app created, preparing...')
    await app.prepare()
    console.log('[server] next app prepared')
  } catch (e) {
    console.error('[server] FAILED to start Next.js:', e)
    throw e
  }

  const httpServer = http.createServer((req, res) => {
    const parsedUrl = parse(req.url, true)
    handle(req, res, parsedUrl)
  })

  // Attach Socket.io to the same HTTP server
  io = new SocketIOServer(httpServer, {
    path: '/socket.io',
    cors: { origin: '*', methods: ['GET', 'POST'] },
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 5 * 1024 * 1024,
  })

  io.on('connection', (socket) => {
    let currentRoom = null
    let currentName = null

    console.log(`[+] ${socket.id} connected`)

    socket.on('room:create', (data, ack) => {
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
        const room = {
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

    socket.on('room:join', (data, ack) => {
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

        if (currentRoom && currentRoom !== code) {
          leaveRoom(socket, currentRoom)
        }

        currentRoom = code
        currentName = name

        const user = {
          id: socket.id,
          name,
          muted: false,
          joinedAt: Date.now(),
        }
        room.users.set(socket.id, user)
        socket.join(code)

        ack?.({
          ok: true,
          code,
          users: publicUsers(room),
          isHost: room.hostId === socket.id,
        })

        socket.to(code).emit('user:joined', {
          user: { id: socket.id, name, muted: false },
        })

        const sys = systemMessage(code, `${name} وارد اتاق شد`)
        io.to(code).emit('chat:message', sys)

        console.log(`[room] ${name} joined ${code} (${room.users.size}/${MAX_USERS_PER_ROOM})`)
      } catch (e) {
        console.error('[err] room:join', e)
        ack?.({ ok: false, error: 'خطای سرور' })
      }
    })

    socket.on('signal:offer', (data) => {
      io.to(data.to).emit('signal:offer', { from: socket.id, sdp: data.sdp })
    })

    socket.on('signal:answer', (data) => {
      io.to(data.to).emit('signal:answer', { from: socket.id, sdp: data.sdp })
    })

    socket.on('signal:ice', (data) => {
      io.to(data.to).emit('signal:ice', { from: socket.id, candidate: data.candidate })
    })

    socket.on('voice:mute-state', (data) => {
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

    socket.on('voice:speaking', (data) => {
      if (!currentRoom) return
      socket.to(currentRoom).emit('voice:speaking', {
        userId: socket.id,
        speaking: !!data.speaking,
      })
    })

    socket.on('chat:message', (data, ack) => {
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
          ack?.({ ok: false, error: 'تصویر خیلی بزرگ است' })
          return
        }
        if (data.type === 'text' && content.length > 2000) {
          ack?.({ ok: false, error: 'پیام خیلی طولانی است' })
          return
        }

        const msg = {
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
      } catch (e) {
        console.error('[err] chat:message', e)
        ack?.({ ok: false, error: 'خطای سرور' })
      }
    })

    socket.on('room:leave', () => {
      if (currentRoom) {
        leaveRoom(socket, currentRoom)
        currentRoom = null
        currentName = null
      }
    })

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

  const port = process.env.PORT || 3000
  // Listen on all interfaces (IPv4 + IPv6) for max compatibility
  httpServer.on('error', (err) => {
    console.error('[server] HTTP server error:', err)
  })
  httpServer.listen(port, '::', () => {
    console.log(`> TT12 ready on [::]:${port} (all interfaces)`)
    console.log(`> Socket.io path: /socket.io`)
  })

  // Catch unhandled errors
  process.on('uncaughtException', (err) => {
    console.error('[server] uncaughtException:', err)
  })
  process.on('unhandledRejection', (err) => {
    console.error('[server] unhandledRejection:', err)
  })
}

setupServer().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
