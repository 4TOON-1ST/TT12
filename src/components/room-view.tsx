'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Mic,
  MicOff,
  Copy,
  Check,
  LogOut,
  Send,
  Image as ImageIcon,
  Users,
  Crown,
  Phone,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import type { RoomUser, ChatMessage } from '@/hooks/use-voice-room'
import { ThemeToggle } from '@/components/theme-toggle'

interface RoomViewProps {
  roomCode: string
  users: RoomUser[]
  isHost: boolean
  muted: boolean
  speaking: boolean
  chat: ChatMessage[]
  currentUserId?: string
  micStatus?: 'idle' | 'checking' | 'granted' | 'denied' | 'no-mic' | 'error'
  onToggleMute: () => void
  onLeave: () => void
  onSendChat: (type: 'text' | 'image', content: string) => Promise<{ ok: boolean; error?: string }>
  onRequestMic?: () => void
}

const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024 // 1.5 MB client-side safety

export function RoomView({
  roomCode,
  users,
  isHost,
  muted,
  speaking,
  chat,
  currentUserId,
  micStatus = 'idle',
  onToggleMute,
  onLeave,
  onSendChat,
  onRequestMic,
}: RoomViewProps) {
  const [copied, setCopied] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [sendingImage, setSendingImage] = useState(false)
  const [showChat, setShowChat] = useState(true)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll chat
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
    }
  }, [chat])

  // Copy room code
  const copyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(roomCode)
      setCopied(true)
      toast.success('کد اتاق کپی شد')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('کپی ممکن نشد')
    }
  }, [roomCode])

  // Share link
  const shareLink = useCallback(async () => {
    const url = `${window.location.origin}/?room=${roomCode}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'TT12', text: `به اتاق TT12 من بپیوند: ${roomCode}`, url })
      } else {
        await navigator.clipboard.writeText(url)
        toast.success('لینک دعوت کپی شد')
      }
    } catch (e) {
      // user cancelled share, ignore
    }
  }, [roomCode])

  // Leave handler
  const handleLeave = useCallback(() => {
    if (confirm('از اتاق خارج می‌شوی؟')) {
      onLeave()
    }
  }, [onLeave])

  // Send text
  const sendText = useCallback(async () => {
    const txt = chatInput.trim()
    if (!txt) return
    setChatInput('')
    const res = await onSendChat('text', txt)
    if (!res.ok) toast.error(res.error || 'ارسال ناموفق')
  }, [chatInput, onSendChat])

  // Send image
  const handleImagePick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      e.target.value = '' // reset for same-file re-pick

      if (!file.type.startsWith('image/')) {
        toast.error('فقط تصویر بفرست')
        return
      }
      if (file.size > MAX_IMAGE_BYTES) {
        toast.error('حداکثر حجم تصویر ۱.۵ مگابایت')
        return
      }

      setSendingImage(true)
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(file)
        })
        const res = await onSendChat('image', dataUrl)
        if (!res.ok) toast.error(res.error || 'ارسال تصویر ناموفق')
      } catch (e) {
        toast.error('خواندن تصویر ناموفق')
      } finally {
        setSendingImage(false)
      }
    },
    [onSendChat],
  )

  // My user entry
  const myUser = users.find((u) => u.id === currentUserId)
  const others = users.filter((u) => u.id !== currentUserId)

  // Total count
  const totalCount = users.length

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top bar */}
      <header className="border-b border-border bg-card/80 backdrop-blur sticky top-0 z-30">
        <div className="px-3 sm:px-5 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="size-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shrink-0 shadow-md shadow-primary/30">
              <Mic className="size-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-base truncate">اتاق TT12</span>
                {isHost && (
                  <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 font-medium shrink-0">
                    <Crown className="size-3" />
                    میزبان
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="font-mono tracking-wider font-semibold text-primary">{roomCode}</span>
                <button
                  onClick={copyCode}
                  className="p-1 rounded hover:bg-muted transition-colors"
                  title="کپی کد"
                >
                  {copied ? <Check className="size-3 text-primary" /> : <Copy className="size-3" />}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Mic status badge */}
            <MicStatusBadge status={micStatus} onClick={onRequestMic} />
            <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground px-2.5 py-1.5 rounded-lg bg-muted">
              <Users className="size-3.5" />
              <span className="font-semibold">{totalCount}</span>
              <span>/ ۱۰</span>
            </div>
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={shareLink} className="text-xs h-9 px-3">
              <Phone className="size-3.5 ml-1.5" />
              دعوت
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleLeave}
              className="text-xs h-9 px-3"
            >
              <LogOut className="size-3.5 ml-1.5" />
              خروج
            </Button>
          </div>
        </div>
      </header>

      {/* Mobile tab: show/hide chat */}
      <div className="lg:hidden flex border-b border-border bg-card/50">
        <button
          onClick={() => setShowChat(false)}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            !showChat ? 'bg-primary/10 text-primary border-b-2 border-primary' : 'text-muted-foreground'
          }`}
        >
          صدا ({totalCount})
        </button>
        <button
          onClick={() => setShowChat(true)}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            showChat ? 'bg-primary/10 text-primary border-b-2 border-primary' : 'text-muted-foreground'
          }`}
        >
          چت ({chat.filter((m) => m.type !== 'system').length})
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Voice panel */}
        <section
          className={`flex-1 flex flex-col p-4 sm:p-6 min-h-0 ${
            showChat ? 'hidden lg:flex' : 'flex'
          }`}
        >
          <div className="flex-1 overflow-auto">
            <div className="max-w-4xl mx-auto">
              {/* My card - prominent */}
              {myUser && (
                <VoiceCard
                  user={myUser}
                  isMe
                  speaking={speaking}
                  muted={muted}
                  isHost={isHost}
                />
              )}
              {/* Others */}
              <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
                {others.map((u) => (
                  <VoiceCard key={u.id} user={u} speaking={!!u.speaking} muted={u.muted} />
                ))}
                {others.length === 0 && (
                  <div className="col-span-full text-center py-10 text-muted-foreground">
                    <Users className="size-10 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">در انتظار ورود دوستان...</p>
                    <p className="text-xs mt-1">کد <span className="font-mono font-bold text-primary">{roomCode}</span> رو براشون بفرست</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Control bar */}
          <div className="mt-4 flex items-center justify-center gap-3 pb-2 pt-4 border-t border-border">
            <Button
              onClick={onToggleMute}
              size="lg"
              variant={muted ? 'destructive' : 'default'}
              className="h-14 w-14 rounded-full shadow-lg"
              title={muted ? 'قطع صدا' : 'فعال‌سازی صدا'}
            >
              {muted ? <MicOff className="size-6" /> : <Mic className="size-6" />}
            </Button>
            <div className="text-sm text-muted-foreground">
              {muted ? 'میکروفون قطع شده' : 'در حال صحبت'}
            </div>
          </div>
        </section>

        {/* Chat panel */}
        <aside
          className={`lg:w-80 xl:w-96 border-r border-border bg-card flex flex-col min-h-0 ${
            showChat ? 'flex' : 'hidden lg:flex'
          }`}
        >
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">گفتگو</h3>
              <span className="text-xs text-muted-foreground">
                {chat.filter((m) => m.type !== 'system').length} پیام
              </span>
            </div>
          </div>

          <div ref={chatScrollRef} className="flex-1 overflow-y-auto p-3 space-y-2.5">
            {chat.length === 0 ? (
              <div className="h-full flex items-center justify-center text-center text-muted-foreground py-10">
                <div>
                  <Send className="size-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">پیامی هنوز ارسال نشده</p>
                </div>
              </div>
            ) : (
              chat.map((msg) => <ChatBubble key={msg.id} msg={msg} isMe={msg.userId === currentUserId} />)
            )}
          </div>

          <div className="p-3 border-t border-border bg-background">
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleImagePick}
                disabled={sendingImage}
                className="h-10 w-10 shrink-0"
                title="ارسال تصویر"
              >
                {sendingImage ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ImageIcon className="size-4" />
                )}
              </Button>
              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    sendText()
                  }
                }}
                placeholder="پیام بنویس..."
                maxLength={2000}
                className="h-10"
              />
              <Button
                onClick={sendText}
                disabled={!chatInput.trim()}
                size="icon"
                className="h-10 w-10 shrink-0"
                title="ارسال"
              >
                <Send className="size-4" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 text-center">
              Enter برای ارسال - تصاویر تا ۱.۵ مگابایت
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}

// ====== Voice card ======
function VoiceCard({
  user,
  isMe,
  speaking,
  muted,
  isHost,
}: {
  user: RoomUser
  isMe?: boolean
  speaking: boolean
  muted: boolean
  isHost?: boolean
}) {
  // Generate stable gradient based on user id
  const colors = ['from-emerald-500 to-teal-600', 'from-violet-500 to-purple-600', 'from-amber-500 to-orange-600', 'from-rose-500 to-pink-600', 'from-sky-500 to-blue-600', 'from-lime-500 to-green-600']
  const colorIdx = user.id.split('').reduce((s, c) => s + c.charCodeAt(0), 0) % colors.length

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2 }}
      className={`relative rounded-2xl overflow-hidden bg-card border border-border shadow-sm ${
        isMe ? 'p-6 ring-2 ring-primary/30' : 'p-4'
      } ${speaking && !muted ? 'speaking-ring' : ''}`}
    >
      <div className={`flex flex-col items-center ${isMe ? 'gap-3' : 'gap-2'}`}>
        {/* Avatar */}
        <div
          className={`relative rounded-full bg-gradient-to-br ${colors[colorIdx]} flex items-center justify-center text-white font-bold ${
            isMe ? 'size-20 text-2xl' : 'size-14 text-lg'
          }`}
        >
          {user.name.slice(0, 2)}
          {/* Status badges */}
          {muted ? (
            <div className="absolute -bottom-1 -left-1 size-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow-md border-2 border-card">
              <MicOff className="size-3" />
            </div>
          ) : speaking ? (
            <div className="absolute -bottom-1 -left-1 size-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md border-2 border-card">
              <Mic className="size-3" />
            </div>
          ) : null}
        </div>

        {/* Name */}
        <div className="text-center">
          <div className="flex items-center gap-1 justify-center">
            <span className={`font-semibold ${isMe ? 'text-base' : 'text-sm'}`}>
              {user.name}
              {isMe && <span className="text-muted-foreground font-normal text-xs mr-1">(شما)</span>}
            </span>
            {isHost && (
              <Crown className="size-3.5 text-amber-500" />
            )}
          </div>
          <div className={`text-xs ${muted ? 'text-destructive' : speaking ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
            {muted ? 'میکروفون قطع' : speaking ? 'در حال صحبت' : 'متصل'}
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// ====== Chat bubble ======
function ChatBubble({ msg, isMe }: { msg: ChatMessage; isMe: boolean }) {
  if (msg.type === 'system') {
    return (
      <div className="text-center my-2">
        <span className="text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-full">
          {msg.content}
        </span>
      </div>
    )
  }
  return (
    <div className={`flex flex-col ${isMe ? 'items-start' : 'items-end'} animate-fade-in-up`}>
      <div className={`text-[10px] text-muted-foreground mb-1 px-1`}>
        {isMe ? 'شما' : msg.name} • {new Date(msg.timestamp).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}
      </div>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 ${
          isMe
            ? 'bg-primary text-primary-foreground rounded-bl-md'
            : 'bg-muted text-foreground rounded-br-md'
        }`}
      >
        {msg.type === 'image' ? (
          <img
            src={msg.content}
            alt="تصویر ارسالی"
            className="rounded-lg max-w-full max-h-60 object-contain"
          />
        ) : (
          <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.content}</p>
        )}
      </div>
    </div>
  )
}

// ===== Mic status badge (compact indicator for header) =====
function MicStatusBadge({
  status,
  onClick,
}: {
  status: 'idle' | 'checking' | 'granted' | 'denied' | 'no-mic' | 'error'
  onClick?: () => void
}) {
  let color = 'bg-muted text-muted-foreground'
  let label = 'دسترسی نداده'
  let pulse = false
  if (status === 'granted') {
    color = 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
    label = 'میکروفون آماده'
  } else if (status === 'denied') {
    color = 'bg-destructive/15 text-destructive'
    label = 'دسترسی رد شده'
    pulse = true
  } else if (status === 'no-mic') {
    color = 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
    label = 'میکروفون نیست'
  } else if (status === 'checking') {
    color = 'bg-muted text-muted-foreground'
    label = 'در حال بررسی...'
  } else if (status === 'error') {
    color = 'bg-destructive/15 text-destructive'
    label = 'خطا'
  }

  return (
    <button
      onClick={onClick}
      className={`hidden sm:inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg ${color} transition-colors hover:opacity-80 ${pulse ? 'animate-pulse' : ''}`}
      title={label}
    >
      <span className="size-1.5 rounded-full bg-current" />
      <span>{label}</span>
    </button>
  )
}

