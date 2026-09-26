'use client'

/* eslint-disable react-hooks/set-state-in-effect */

import { useState, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Mic, ArrowLeft, Users, Sparkles, Zap, ShieldCheck, Copy, Hash } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'
import { ThemeToggle } from '@/components/theme-toggle'
import { MicPermissionCard } from '@/components/mic-permission-card'

interface LandingProps {
  onJoin: (name: string, code: string) => Promise<{ ok: boolean; error?: string }>
  onCreate: (name: string) => Promise<{ ok: boolean; code?: string; error?: string }>
  onMicReady?: (stream: MediaStream) => void
}

export function Landing({ onJoin, onCreate, onMicReady }: LandingProps) {
  // SSR-safe: render with empty name, then sync with localStorage after mount
  const [name, setName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [loading, setLoading] = useState<'create' | 'join' | null>(null)
  const [hydrated, setHydrated] = useState(false)

  // After mount: load saved name and mark as hydrated (input becomes editable)
  useEffect(() => {
    const saved = localStorage.getItem('tt12:name')
    if (saved) setName(saved)
    setHydrated(true)
  }, [])

  const handleCreate = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('نام خود را وارد کنید')
      return
    }
    localStorage.setItem('tt12:name', trimmed)
    setLoading('create')
    const res = await onCreate(trimmed)
    setLoading(null)
    if (!res.ok) {
      toast.error(res.error || 'خطا در ساخت اتاق')
    }
  }, [name, onCreate])

  const handleJoin = useCallback(async () => {
    const trimmedName = name.trim()
    const trimmedCode = joinCode.trim().toUpperCase()
    if (!trimmedName) {
      toast.error('نام خود را وارد کنید')
      return
    }
    if (!trimmedCode) {
      toast.error('کد اتاق را وارد کنید')
      return
    }
    localStorage.setItem('tt12:name', trimmedName)
    setLoading('join')
    const res = await onJoin(trimmedName, trimmedCode)
    setLoading(null)
    if (!res.ok) {
      toast.error(res.error || 'خطا در ورود به اتاق')
    }
  }, [name, joinCode, onJoin])

  const handlePasteCode = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        setJoinCode(text.trim().toUpperCase().slice(0, 6))
        toast.success('کد از کلیپ‌بورد خوانده شد')
      }
    } catch {
      toast.error('دسترسی به کلیپ‌بورد ممکن نیست')
    }
  }, [])

  return (
    <div className="landing-gradient min-h-screen flex flex-col">
      {/* Header */}
      <header className="px-4 sm:px-8 py-5 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="size-10 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/30">
            <Mic className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">TT12</h1>
            <p className="text-xs text-muted-foreground">ویسکال آنلاین، سبک و سریع</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground mr-2">
            <ShieldCheck className="size-4 text-primary" />
            <span>اتصال P2P رمزنگاری‌شده</span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex items-center justify-center px-4 py-6 sm:py-10">
        <div className="w-full max-w-md">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-center mb-6 sm:mb-8"
          >
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-medium mb-4">
              <Sparkles className="size-3.5" />
              رایگان، بدون نصب، بدون ثبت‌نام
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
              یک اتاق بساز
              <br />
              کد رو بده به دوستت
            </h2>
            <p className="text-muted-foreground text-sm leading-relaxed">
              ویسکال آنلاین با کیفیت بالا، چت متنی و تصویری - همه چی با یک کد ۶ رقمی
            </p>
          </motion.div>

          {/* Microphone permission card */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.05 }}
            className="mb-5"
          >
            <MicPermissionCard onMicReady={onMicReady} />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
          >
            <Tabs defaultValue="create" className="w-full">
              <TabsList className="grid grid-cols-2 mb-5 w-full">
                <TabsTrigger value="create">ساخت اتاق</TabsTrigger>
                <TabsTrigger value="join">ورود به اتاق</TabsTrigger>
              </TabsList>

              {/* Create tab */}
              <TabsContent value="create" className="space-y-4">
                <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
                  <label className="text-sm font-medium mb-2 block">اسم شما</label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="مثلاً: علی"
                    maxLength={20}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                    className="text-base h-12"
                    dir="rtl"
                  />
                  <Button
                    onClick={handleCreate}
                    disabled={loading === 'create' || !name.trim()}
                    className="w-full h-12 text-base mt-4"
                    size="lg"
                  >
                    {loading === 'create' ? (
                      <>
                        <div className="size-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin ml-2" />
                        در حال ساخت...
                      </>
                    ) : (
                      <>
                        <Zap className="size-4 ml-2" />
                        ساخت اتاق
                      </>
                    )}
                  </Button>
                </div>
                <div className="flex items-start gap-2.5 text-xs text-muted-foreground px-2">
                  <Sparkles className="size-3.5 text-primary mt-0.5 shrink-0" />
                  <p className="leading-relaxed">
                    بعد از ساخت، یک کد ۶ رقمی می‌گیری - این کد رو بده به دوستت تا وارد بشه.
                    حداکثر ۱۰ نفر می‌تونن هم‌زمان در یک اتاق صحبت کنن.
                  </p>
                </div>
              </TabsContent>

              {/* Join tab */}
              <TabsContent value="join" className="space-y-4">
                <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
                  <label className="text-sm font-medium mb-2 block">اسم شما</label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="مثلاً: سارا"
                    maxLength={20}
                    className="text-base h-12"
                    dir="rtl"
                  />
                  <label className="text-sm font-medium mb-2 mt-4 block">کد اتاق</label>
                  <div className="flex gap-2">
                    <Input
                      value={joinCode}
                      onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                      placeholder="ABC123"
                      className="text-base h-12 font-mono tracking-widest text-center uppercase"
                      dir="ltr"
                      onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handlePasteCode}
                      className="h-12 w-12 shrink-0"
                      title="خواندن از کلیپ‌بورد"
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                  <Button
                    onClick={handleJoin}
                    disabled={loading === 'join' || !name.trim() || !joinCode.trim()}
                    className="w-full h-12 text-base mt-4"
                    size="lg"
                  >
                    {loading === 'join' ? (
                      <>
                        <div className="size-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin ml-2" />
                        در حال ورود...
                      </>
                    ) : (
                      <>
                        <ArrowLeft className="size-4 ml-2" />
                        ورود به اتاق
                      </>
                    )}
                  </Button>
                </div>
                <div className="flex items-start gap-2.5 text-xs text-muted-foreground px-2">
                  <Hash className="size-3.5 text-primary mt-0.5 shrink-0" />
                  <p className="leading-relaxed">
                    کد ۶ رقمی رو از دوستت بگیر و وارد کن. می‌تونی کد رو از کلیپ‌بورد هم بخونی.
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          </motion.div>

          {/* Features */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="grid grid-cols-3 gap-3 mt-10"
          >
            <Feature icon={<Mic className="size-4" />} title="کیفیت صوت" desc="HD Audio" />
            <Feature icon={<Users className="size-4" />} title="گروهی" desc="تا ۱۰ نفر" />
            <Feature icon={<ShieldCheck className="size-4" />} title="امن" desc="P2P رمزنگاری" />
          </motion.div>
        </div>
      </main>

      {/* Footer */}
      <footer className="px-4 py-5 text-center text-xs text-muted-foreground">
        ساخته‌شده با ❤️ - TT12 v1.0
      </footer>
    </div>
  )
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="bg-card/50 border border-border/50 rounded-xl p-3 text-center">
      <div className="size-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center mx-auto mb-2">
        {icon}
      </div>
      <div className="text-xs font-semibold">{title}</div>
      <div className="text-[10px] text-muted-foreground">{desc}</div>
    </div>
  )
}
