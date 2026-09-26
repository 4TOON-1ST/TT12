'use client'

import { io, Socket } from 'socket.io-client'
import { useCallback, useEffect, useRef, useState } from 'react'

// ====== Types ======
export interface RoomUser {
  id: string
  name: string
  muted: boolean
  speaking?: boolean
}

export interface ChatMessage {
  id: string
  userId: string
  name: string
  type: 'text' | 'image' | 'system'
  content: string
  timestamp: number
}

type ConnState = 'idle' | 'connecting' | 'connected' | 'error'

// ====== WebRTC peer connection wrapper ======
class PeerConnection {
  pc: RTCPeerConnection
  remoteId: string
  stream: MediaStream | null = null
  onTrack?: (stream: MediaStream) => void
  onClose?: () => void

  constructor(remoteId: string, localStream: MediaStream | null, onSignal: (type: 'offer' | 'answer' | 'ice', payload: any) => void) {
    this.remoteId = remoteId
    this.pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
      ],
      iceTransportPolicy: 'all',
    })

    // Add local tracks
    if (localStream) {
      localStream.getTracks().forEach((track) => {
        this.pc.addTrack(track, localStream)
      })
    }

    // Negotiation needed - we are the initiator
    this.pc.onnegotiationneeded = async () => {
      try {
        const offer = await this.pc.createOffer()
        await this.pc.setLocalDescription(offer)
        onSignal('offer', { sdp: this.pc.localDescription })
      } catch (e) {
        console.error('[webrtc] negotiation error', e)
      }
    }

    // ICE candidate
    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        onSignal('ice', { candidate: e.candidate })
      }
    }

    // Remote track
    this.pc.ontrack = (e) => {
      this.stream = e.streams[0]
      this.onTrack?.(this.stream)
    }

    this.pc.onconnectionstatechange = () => {
      if (this.pc.connectionState === 'failed' || this.pc.connectionState === 'closed') {
        this.onClose?.()
      }
    }
  }

  async handleOffer(sdp: any) {
    try {
      await this.pc.setRemoteDescription(sdp)
      const answer = await this.pc.createAnswer()
      await this.pc.setLocalDescription(answer)
      return this.pc.localDescription
    } catch (e) {
      console.error('[webrtc] handleOffer error', e)
      return null
    }
  }

  async handleAnswer(sdp: any) {
    try {
      await this.pc.setRemoteDescription(sdp)
    } catch (e) {
      console.error('[webrtc] handleAnswer error', e)
    }
  }

  async handleIce(candidate: any) {
    try {
      await this.pc.addIceCandidate(candidate)
    } catch (e) {
      // ignoring duplicate/old candidates is fine
    }
  }

  replaceTrack(track: MediaStreamTrack) {
    this.pc.getSenders().forEach((sender) => {
      if (sender.track?.kind === track.kind) {
        sender.replaceTrack(track)
      }
    })
  }

  close() {
    try {
      this.pc.getSenders().forEach((s) => s.track?.stop())
      this.pc.close()
    } catch (e) {
      // ignore
    }
  }
}

// ====== Hook ======
export function useVoiceRoom() {
  const [connState, setConnState] = useState<ConnState>('idle')
  const [roomCode, setRoomCode] = useState<string>('')
  const [users, setUsers] = useState<RoomUser[]>([])
  const [isHost, setIsHost] = useState(false)
  const [muted, setMuted] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [error, setError] = useState<string>('')
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [myId, setMyId] = useState<string>('')

  // Refs to break circular dependencies between createRoom <-> joinRoom
  const joinRoomRef = useRef<(name: string, code: string) => Promise<{ ok: boolean; code?: string; error?: string }>>(
    async () => ({ ok: false, error: 'init' }),
  )

  const socketRef = useRef<Socket | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const peersRef = useRef<Map<string, PeerConnection>>(new Map())
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map())
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map())
  const mutedRef = useRef(false)
  const speakingRef = useRef(false)
  const speakingTimeoutRef = useRef<any>(null)

  // ====== Audio element management for remote streams ======
  const ensureAudioEl = useCallback((userId: string): HTMLAudioElement => {
    let el = audioElementsRef.current.get(userId)
    if (!el) {
      el = new Audio()
      el.autoplay = true
      el.setAttribute('playsinline', 'true')
      // Set audio output to low volume for safety
      el.volume = 1.0
      audioElementsRef.current.set(userId, el)
    }
    return el
  }, [])

  const attachStream = useCallback(
    (userId: string, stream: MediaStream) => {
      const el = ensureAudioEl(userId)
      el.srcObject = stream
      el.play().catch((e) => {
        console.warn('[audio] autoplay blocked for', userId, e)
      })
    },
    [ensureAudioEl],
  )

  // ====== Speaking detection (client-side analyser) ======
  const setupSpeakingDetector = useCallback((stream: MediaStream) => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.6
      source.connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)

      const check = () => {
        if (!localStreamRef.current) return
        analyser.getByteFrequencyData(data)
        // Average of low/mid frequencies (voice range)
        let sum = 0
        for (let i = 4; i < 64; i++) sum += data[i]
        const avg = sum / 60
        const isSpeaking = avg > 18 // threshold

        if (isSpeaking !== speakingRef.current) {
          speakingRef.current = isSpeaking
          setSpeaking(isSpeaking)
          socketRef.current?.emit('voice:speaking', { speaking: isSpeaking })
        }
        requestAnimationFrame(check)
      }
      requestAnimationFrame(check)
    } catch (e) {
      console.warn('[speaking] analyser failed', e)
    }
  }, [])

  // ====== Local mic ======
  const getLocalStream = useCallback(async (deviceId?: string) => {
    // If a specific device requested, ignore cached stream and create a fresh one
    if (localStreamRef.current && !deviceId) return localStreamRef.current

    // If switching devices, stop existing tracks
    if (deviceId && localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
    }
    try {
      const constraints: MediaStreamConstraints = {
        audio: deviceId
          ? {
              deviceId: { exact: deviceId },
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            }
          : {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
        video: false,
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      localStreamRef.current = stream
      setupSpeakingDetector(stream)
      // If we have existing peers, replace their tracks
      peersRef.current.forEach((peer) => {
        stream.getAudioTracks().forEach((track) => peer.replaceTrack(track))
      })
      return stream
    } catch (e: any) {
      console.error('[mic] getUserMedia failed', e)
      if (e?.name === 'NotAllowedError') {
        throw new Error('دسترسی به میکروفون رد شد. لطفاً دسترسی بدهید.')
      }
      if (e?.name === 'NotFoundError') {
        throw new Error('میکروفون پیدا نشد.')
      }
      throw new Error('خطا در دسترسی به میکروفون')
    }
  }, [setupSpeakingDetector])

  // ====== Externally set local stream (used by MicPermissionCard) ======
  const setExternalStream = useCallback(
    (stream: MediaStream) => {
      // Replace existing stream
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop())
      }
      localStreamRef.current = stream
      setupSpeakingDetector(stream)
      // If we have peers, replace tracks on them
      peersRef.current.forEach((peer) => {
        stream.getAudioTracks().forEach((track) => peer.replaceTrack(track))
      })
    },
    [setupSpeakingDetector],
  )

  // ====== Signal sending ======
  const sendSignal = useCallback((type: 'offer' | 'answer' | 'ice', payload: any, to: string) => {
    if (!socketRef.current) return
    const evt = `signal:${type}`
    socketRef.current.emit(evt, { to, ...payload })
  }, [])

  // ====== Create peer (we are the initiator for new joiners) ======
  const createPeer = useCallback(
    (remoteId: string, localStream: MediaStream | null) => {
      const peer = new PeerConnection(remoteId, localStream, (type, payload) => {
        sendSignal(type, payload, remoteId)
      })
      peer.onTrack = (stream) => {
        remoteStreamsRef.current.set(remoteId, stream)
        attachStream(remoteId, stream)
      }
      peersRef.current.set(remoteId, peer)
      return peer
    },
    [attachStream, sendSignal],
  )

  // ====== Update local track (mute/unmute) ======
  const updateMuted = useCallback(async (newMuted: boolean) => {
    mutedRef.current = newMuted
    setMuted(newMuted)
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach((track) => {
        track.enabled = !newMuted
      })
    }
    socketRef.current?.emit('voice:mute-state', { muted: newMuted })
  }, [])

  // ====== Connect socket ======
  const connect = useCallback(() => {
    if (socketRef.current?.connected) return
    setConnState('connecting')

    // Determine connection strategy based on environment:
    // 1. If NEXT_PUBLIC_VOICE_SERVICE_URL is set, use that (explicit override)
    // 2. If we're on localhost with port 81 (Caddy dev), use XTransformPort=3003
    // 3. Otherwise (production, Railway, etc.) use /socket.io on same host
    const isBrowser = typeof window !== 'undefined'
    const envUrl = isBrowser
      ? (window as any).VOICE_SERVICE_URL ||
        process.env.NEXT_PUBLIC_VOICE_SERVICE_URL
      : null

    let url: string
    let path: string
    if (envUrl) {
      // Explicit URL provided (e.g. separate Socket.io service)
      url = envUrl
      path = '/socket.io'
    } else if (isBrowser && window.location.hostname.includes('localhost') && window.location.port === '81') {
      // Dev sandbox with Caddy on port 81 - use XTransformPort to route to port 3003
      url = '/?XTransformPort=3003'
      path = '/'
    } else {
      // Production: single server (server.js) on same host
      url = undefined as any
      path = '/socket.io'
    }

    const sock = io(url, {
      path,
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 1500,
      timeout: 10000,
    })
    socketRef.current = sock

    sock.on('connect', () => {
      setConnState('connected')
      setMyId(sock.id || '')
      setError('')
    })
    sock.on('disconnect', () => {
      setConnState('connecting')
    })
    sock.on('connect_error', (err: any) => {
      console.error('[socket] connect_error', err)
      setError('اتصال به سرور ناموفق بود')
      setConnState('error')
    })

    // ====== WebRTC signaling handlers =====
    sock.on('signal:offer', async (data: { from: string; sdp: any }) => {
      const localStream = localStreamRef.current
      let peer = peersRef.current.get(data.from)
      if (!peer) {
        peer = new PeerConnection(data.from, localStream, (type, payload) => {
          sendSignal(type, payload, data.from)
        })
        peer.onTrack = (stream) => {
          remoteStreamsRef.current.set(data.from, stream)
          attachStream(data.from, stream)
        }
        peersRef.current.set(data.from, peer)
      }
      const answer = await peer.handleOffer(data.sdp)
      if (answer) {
        sendSignal('answer', { sdp: answer }, data.from)
      }
    })

    sock.on('signal:answer', (data: { from: string; sdp: any }) => {
      const peer = peersRef.current.get(data.from)
      if (peer) peer.handleAnswer(data.sdp)
    })

    sock.on('signal:ice', (data: { from: string; candidate: any }) => {
      const peer = peersRef.current.get(data.from)
      if (peer) peer.handleIce(data.candidate)
    })

    // ====== Room events =====
    sock.on('user:joined', (data: { user: RoomUser }) => {
      setUsers((prev) => {
        if (prev.find((u) => u.id === data.user.id)) return prev
        return [...prev, data.user]
      })
      // We create a peer for the new user (we are initiator)
      if (data.user.id !== sock.id) {
        const localStream = localStreamRef.current
        createPeer(data.user.id, localStream)
      }
    })

    sock.on('user:left', (data: { userId: string }) => {
      setUsers((prev) => prev.filter((u) => u.id !== data.userId))
      // Close peer connection
      const peer = peersRef.current.get(data.userId)
      if (peer) {
        peer.close()
        peersRef.current.delete(data.userId)
      }
      // Remove audio element
      const el = audioElementsRef.current.get(data.userId)
      if (el) {
        el.srcObject = null
        el.remove()
        audioElementsRef.current.delete(data.userId)
      }
      remoteStreamsRef.current.delete(data.userId)
    })

    sock.on('voice:mute-state', (data: { userId: string; muted: boolean }) => {
      setUsers((prev) =>
        prev.map((u) => (u.id === data.userId ? { ...u, muted: data.muted } : u)),
      )
    })

    sock.on('voice:speaking', (data: { userId: string; speaking: boolean }) => {
      setUsers((prev) =>
        prev.map((u) => (u.id === data.userId ? { ...u, speaking: data.speaking } : u)),
      )
    })

    sock.on('host:changed', (data: { hostId: string }) => {
      setIsHost(data.hostId === sock.id)
    })

    // ====== Chat =====
    sock.on('chat:message', (msg: ChatMessage) => {
      setChat((prev) => [...prev, msg])
    })
  }, [attachStream, createPeer, sendSignal])

  // ====== Create room ======
  const createRoom = useCallback(
    async (name: string): Promise<{ ok: boolean; code?: string; error?: string }> => {
      return new Promise((resolve) => {
        if (!socketRef.current) {
          resolve({ ok: false, error: 'اتصال برقرار نیست' })
          return
        }
        socketRef.current.emit('room:create', { name }, async (res: any) => {
          if (!res?.ok) {
            resolve({ ok: false, error: res?.error || 'خطا' })
            return
          }
          // Now join the room we just created (via ref to avoid cycle)
          const joinRes = await joinRoomRef.current(name, res.code)
          resolve(joinRes)
        })
      })
    },
    [],
  )

  // ====== Join room ======
  const joinRoom = useCallback(
    async (name: string, code: string): Promise<{ ok: boolean; code?: string; error?: string }> => {
      return new Promise(async (resolve) => {
        if (!socketRef.current) {
          resolve({ ok: false, error: 'اتصال برقرار نیست' })
          return
        }
        // Try to get mic - if fails, still join (user can retry mic later)
        let micWarning = ''
        try {
          await getLocalStream()
        } catch (e: any) {
          micWarning = e?.message || 'دسترسی به میکروفون ممکن نیست - می‌تونی بدون صدا هم وارد بشی'
          console.warn('[voice] mic failed, joining without mic:', micWarning)
        }
        socketRef.current.emit(
          'room:join',
          { name, code },
          (res: any) => {
            if (!res?.ok) {
              resolve({ ok: false, error: res?.error || 'خطا' })
              return
            }
            setRoomCode(res.code)
            setIsHost(res.isHost)
            setUsers(res.users || [])
            setChat([])
            // If mic failed, show a warning in chat
            if (micWarning) {
              setChat((prev) => [
                {
                  id: 'mic-warn-' + Date.now(),
                  userId: 'system',
                  name: 'سیستم',
                  type: 'system' as const,
                  content: '⚠️ ' + micWarning,
                  timestamp: Date.now(),
                },
                ...prev,
              ])
              // Set muted=true since we don't have a mic
              setMuted(true)
            }
            resolve({ ok: true, code: res.code })
          },
        )
      })
    },
    [getLocalStream],
  )

  // ====== Send chat message ======
  const sendChat = useCallback(
    (type: 'text' | 'image', content: string): Promise<{ ok: boolean; error?: string }> => {
      return new Promise((resolve) => {
        if (!socketRef.current) {
          resolve({ ok: false, error: 'اتصال برقرار نیست' })
          return
        }
        socketRef.current.emit('chat:message', { type, content }, (res: any) => {
          resolve({ ok: !!res?.ok, error: res?.error })
        })
      })
    },
    [],
  )

  // ====== Leave room ======
  const leaveRoom = useCallback(() => {
    // Close all peer connections
    peersRef.current.forEach((peer) => peer.close())
    peersRef.current.clear()
    remoteStreamsRef.current.clear()
    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null
    }
    // Remove audio elements
    audioElementsRef.current.forEach((el) => {
      el.srcObject = null
      el.remove()
    })
    audioElementsRef.current.clear()
    // Notify server
    socketRef.current?.emit('room:leave')
    setRoomCode('')
    setUsers([])
    setChat([])
    setIsHost(false)
    setMuted(false)
    setSpeaking(false)
  }, [])

  // ====== Disconnect socket ======
  const disconnect = useCallback(() => {
    leaveRoom()
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
    }
    setConnState('idle')
  }, [leaveRoom])

  // ====== Cleanup on unmount ======
  useEffect(() => {
    return () => {
      leaveRoom()
      if (socketRef.current) {
        socketRef.current.disconnect()
        socketRef.current = null
      }
    }
  }, [leaveRoom])

  // Keep joinRoomRef in sync (so createRoom can call it without a circular dep)
  useEffect(() => {
    joinRoomRef.current = joinRoom
  }, [joinRoom])

  return {
    connState,
    roomCode,
    users,
    isHost,
    muted,
    speaking,
    error,
    chat,
    myId,
    connect,
    createRoom,
    joinRoom,
    leaveRoom,
    disconnect,
    toggleMute: () => updateMuted(!mutedRef.current),
    sendChat,
    setExternalStream,
    switchMic: (deviceId: string) => getLocalStream(deviceId),
    getLocalStream,
  }
}
