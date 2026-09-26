'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Mic,
  MicOff,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Volume2,
  Settings2,
  ChevronDown,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'

type MicStatus = 'idle' | 'checking' | 'granted' | 'denied' | 'no-mic' | 'error'

interface MicDevice {
  deviceId: string
  label: string
}

interface MicPermissionCardProps {
  // When user grants access successfully, notify parent with the stream
  onMicReady?: (stream: MediaStream) => void
  // Optional external ref so parent can request at any time
  initialStatus?: MicStatus
  // Compact mode = smaller card (for in-room display)
  compact?: boolean
}

export function MicPermissionCard({ onMicReady, initialStatus = 'idle', compact = false }: MicPermissionCardProps) {
  const [status, setStatus] = useState<MicStatus>(initialStatus)
  const [devices, setDevices] = useState<MicDevice[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')
  const [showDevices, setShowDevices] = useState(false)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [volume, setVolume] = useState(0)
  const [testing, setTesting] = useState(false)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Cleanup
  const cleanupStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect()
      } catch {}
      sourceRef.current = null
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setStream(null)
  }, [])

  // Setup volume meter
  const startVolumeMeter = useCallback((s: MediaStream) => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)()
      }
      const ctx = audioCtxRef.current
      if (ctx.state === 'suspended') ctx.resume()

      const source = ctx.createMediaStreamSource(s)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.6
      source.connect(analyser)
      sourceRef.current = source
      analyserRef.current = analyser

      const data = new Uint8Array(analyser.frequencyBinCount)
      const check = () => {
        if (!analyserRef.current) return
        analyserRef.current.getByteFrequencyData(data)
        // Average of voice frequencies (low-mid range)
        let sum = 0
        for (let i = 2; i < 32; i++) sum += data[i]
        const avg = sum / 30
        // Normalize to 0-100
        const level = Math.min(100, Math.round((avg / 50) * 100))
        setVolume(level)
        rafRef.current = requestAnimationFrame(check)
      }
      check()
    } catch (e) {
      console.error('[volume] analyser failed', e)
    }
  }, [])

  // Request mic access
  const requestMic = useCallback(
    async (deviceId?: string) => {
      setStatus('checking')
      cleanupStream()

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

      try {
        const s = await navigator.mediaDevices.getUserMedia(constraints)
        streamRef.current = s
        setStream(s)
        setStatus('granted')

        // Set selected device id from actual track
        const trackSettings = s.getAudioTracks()[0]?.getSettings()
        const usedId = trackSettings?.deviceId
        if (usedId) setSelectedDeviceId(usedId)

        // Enumerate devices (now labels are available)
        try {
          const all = await navigator.mediaDevices.enumerateDevices()
          const audioInputs = all
            .filter((d) => d.kind === 'audioinput')
            .map((d) => ({
              deviceId: d.deviceId,
              label: d.label || `میکروفون ${d.deviceId.slice(0, 4)}`,
            }))
          setDevices(audioInputs)
          if (audioInputs.length === 0) {
            setStatus('no-mic')
            toast.error('هیچ میکروفونی روی دستگاه پیدا نشد')
            return
          }
        } catch (e) {
          console.error('enumerate failed', e)
        }

        // Start volume meter for visual feedback
        startVolumeMeter(s)
        onMicReady?.(s)
        toast.success('دسترسی به میکروفون داده شد ✓')
      } catch (e: any) {
        console.error('[mic] getUserMedia failed', e)
        if (e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError') {
          setStatus('denied')
          toast.error('دسترسی به میکروفون رد شد. از تنظیمات مرورگر اجازه بدهید.')
        } else if (e?.name === 'NotFoundError' || e?.name === 'DevicesNotFoundError') {
          setStatus('no-mic')
          toast.error('میکروفونی روی دستگاه پیدا نشد')
        } else if (e?.name === 'NotReadableError') {
          setStatus('error')
          toast.error('میکروفون در حال استفاده توسط برنامه دیگر است')
        } else {
          setStatus('error')
          toast.error('خطا در دسترسی به میکروفون: ' + (e?.message || 'نامشخص'))
        }
      }
    },
    [cleanupStream, onMicReady, startVolumeMeter],
  )

  // Switch device
  const switchDevice = useCallback(
    async (deviceId: string) => {
      setSelectedDeviceId(deviceId)
      setShowDevices(false)
      await requestMic(deviceId)
    },
    [requestMic],
  )

  // Start test
  const startTest = useCallback(async () => {
    if (status !== 'granted' || !streamRef.current) {
      await requestMic()
      return
    }
    setTesting(true)
    setTimeout(() => setTesting(false), 8000)
  }, [requestMic, status])

  // Check initial permission state on mount
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        if (!navigator.permissions) {
          // No Permissions API - just leave idle
          return
        }
        const result = await navigator.permissions.query({ name: 'microphone' as PermissionName })
        if (cancelled) return
        if (result.state === 'granted') {
          // Auto-request mic since it's already granted
          requestMic()
        } else if (result.state === 'denied') {
          setStatus('denied')
        }
        // 'prompt' = leave as idle

        result.onchange = () => {
          if (cancelled) return
          if (result.state === 'granted') {
            requestMic()
          } else if (result.state === 'denied') {
            setStatus('denied')
            cleanupStream()
          }
        }
      } catch (e) {
        // Permissions API not available
      }
    })()
    return () => {
      cancelled = true
      cleanupStream()
    }
  }, [requestMic, cleanupStream])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupStream()
      if (audioCtxRef.current) {
        try {
          audioCtxRef.current.close()
        } catch {}
        audioCtxRef.current = null
      }
    }
  }, [cleanupStream])

  // Listen for device changes
  useEffect(() => {
    if (!navigator.mediaDevices) return
    const handle = async () => {
      try {
        const all = await navigator.mediaDevices.enumerateDevices()
        const audioInputs = all
          .filter((d) => d.kind === 'audioinput')
          .map((d) => ({
            deviceId: d.deviceId,
            label: d.label || `میکروفون ${d.deviceId.slice(0, 4)}`,
          }))
        setDevices(audioInputs)
      } catch {}
    }
    navigator.mediaDevices.addEventListener('devicechange', handle)
    return () => navigator.mediaDevices.removeEventListener('devicechange', handle)
  }, [])

  // ===== Render =====

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <button
          onClick={() => status === 'granted' ? setShowDevices(!showDevices) : requestMic()}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-card border border-border text-xs hover:bg-muted transition-colors"
          title={statusLabel(status)}
        >
          {statusIcon(status)}
          <span className={statusColor(status)}>{statusLabel(status)}</span>
        </button>
        {showDevices && status === 'granted' && (
          <div className="absolute top-full mt-1 bg-popover border border-border rounded-lg shadow-lg p-1 z-50 min-w-48">
            {devices.map((d) => (
              <button
                key={d.deviceId}
                onClick={() => switchDevice(d.deviceId)}
                className={`w-full text-right px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors ${
                  d.deviceId === selectedDeviceId ? 'bg-primary/10 text-primary' : ''
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-2xl p-4 sm:p-5 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div
            className={`size-9 rounded-xl flex items-center justify-center ${statusBg(status)}`}
          >
            {statusIcon(status)}
          </div>
          <div>
            <div className="font-semibold text-sm">وضعیت میکروفون</div>
            <div className={`text-xs ${statusColor(status)}`}>{statusLabel(status)}</div>
          </div>
        </div>
        {status === 'granted' && (
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => requestMic(selectedDeviceId)}
              className="h-8 px-2 text-xs"
              title="به‌روزرسانی"
            >
              <RefreshCw className="size-3.5" />
            </Button>
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDevices(!showDevices)}
                className="h-8 px-2 text-xs"
                title="انتخاب میکروفون"
              >
                <Settings2 className="size-3.5 ml-1" />
                <ChevronDown className="size-3" />
              </Button>
              {showDevices && (
                <div className="absolute left-0 top-full mt-1 bg-popover border border-border rounded-lg shadow-lg p-1 z-50 min-w-56 max-h-64 overflow-y-auto">
                  <div className="text-[10px] text-muted-foreground px-2 py-1 border-b border-border mb-1">
                    انتخاب دستگاه:
                  </div>
                  {devices.map((d) => (
                    <button
                      key={d.deviceId}
                      onClick={() => switchDevice(d.deviceId)}
                      className={`w-full text-right px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors flex items-center gap-2 ${
                        d.deviceId === selectedDeviceId ? 'bg-primary/10 text-primary' : ''
                      }`}
                    >
                      {d.deviceId === selectedDeviceId && <CheckCircle2 className="size-3 shrink-0" />}
                      <span className="truncate">{d.label}</span>
                    </button>
                  ))}
                  {devices.length === 0 && (
                    <div className="text-xs text-muted-foreground px-2 py-2">میکروفونی پیدا نشد</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Volume meter (only when granted) */}
      {status === 'granted' && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Volume2 className="size-3" />
              {testing ? 'در حال تست... صحبت کنید' : 'سطح صدا'}
            </span>
            {!testing && (
              <button
                onClick={startTest}
                className="text-xs text-primary hover:underline"
              >
                تست ۸ ثانیه‌ای
              </button>
            )}
          </div>
          {/* Volume bar */}
          <div className="h-3 bg-muted rounded-full overflow-hidden relative">
            <div
              className="h-full transition-all duration-75 rounded-full bg-gradient-to-l from-emerald-500 via-emerald-400 to-yellow-400"
              style={{ width: `${volume}%` }}
            />
            {/* Markers */}
            <div className="absolute inset-0 flex justify-between px-1 pointer-events-none">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="w-px h-full bg-background/40" />
              ))}
            </div>
          </div>
          {testing && (
            <div className="flex items-center justify-between mt-1.5 text-[10px] text-muted-foreground">
              <span>دستگاه فعال: {devices.find((d) => d.deviceId === selectedDeviceId)?.label || 'پیش‌فرض'}</span>
              <button
                onClick={() => setTesting(false)}
                className="text-destructive hover:underline"
              >
                توقف
              </button>
            </div>
          )}
        </div>
      )}

      {/* Action button */}
      <div className="space-y-2">
        {status === 'idle' && (
          <Button onClick={() => requestMic()} className="w-full h-10" size="default">
            <Mic className="size-4 ml-2" />
            دسترسی به میکروفون
          </Button>
        )}
        {status === 'checking' && (
          <Button disabled className="w-full h-10">
            <Loader2 className="size-4 ml-2 animate-spin" />
            در حال بررسی...
          </Button>
        )}
        {status === 'granted' && (
          <Button onClick={startTest} variant="outline" className="w-full h-10">
            <Volume2 className="size-4 ml-2" />
            تست میکروفون
          </Button>
        )}
        {status === 'denied' && (
          <>
            <Button onClick={() => requestMic()} variant="destructive" className="w-full h-10">
              <RefreshCw className="size-4 ml-2" />
              درخواست دوباره دسترسی
            </Button>
            <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-2.5 leading-relaxed">
              <AlertTriangle className="size-3.5 inline ml-1 text-destructive" />
              دسترسی به میکروفون رد شده. برای رفع این مشکل:
              <br />
              ۱. روی آیکون قفل کنار آدرس سایت کلیک کن
              <br />
              ۲. دسترسی میکروفون را روی «اجازه» تنظیم کن
              <br />
              ۳. صفحه را رفرش کن
            </div>
          </>
        )}
        {status === 'no-mic' && (
          <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-2.5">
            <AlertTriangle className="size-3.5 inline ml-1 text-destructive" />
            هیچ میکروفونی روی دستگاه شما پیدا نشد. یک میکروفون یا هدفون وصل کنید.
          </div>
        )}
        {status === 'error' && (
          <Button onClick={() => requestMic()} variant="outline" className="w-full h-10">
            <RefreshCw className="size-4 ml-2" />
            تلاش دوباره
          </Button>
        )}
      </div>
    </div>
  )
}

// ===== Helpers =====

function statusIcon(status: MicStatus) {
  switch (status) {
    case 'granted':
      return <CheckCircle2 className="size-5 text-emerald-500" />
    case 'denied':
      return <MicOff className="size-5 text-destructive" />
    case 'no-mic':
      return <AlertTriangle className="size-5 text-amber-500" />
    case 'checking':
      return <Loader2 className="size-5 text-muted-foreground animate-spin" />
    case 'error':
      return <AlertTriangle className="size-5 text-destructive" />
    case 'idle':
    default:
      return <Mic className="size-5 text-muted-foreground" />
  }
}

function statusBg(status: MicStatus) {
  switch (status) {
    case 'granted':
      return 'bg-emerald-500/10'
    case 'denied':
      return 'bg-destructive/10'
    case 'no-mic':
      return 'bg-amber-500/10'
    case 'checking':
      return 'bg-muted'
    case 'error':
      return 'bg-destructive/10'
    case 'idle':
    default:
      return 'bg-muted'
  }
}

function statusLabel(status: MicStatus) {
  switch (status) {
    case 'granted':
      return 'آماده و متصل'
    case 'denied':
      return 'دسترسی رد شده'
    case 'no-mic':
      return 'میکروفون پیدا نشد'
    case 'checking':
      return 'در حال بررسی...'
    case 'error':
      return 'خطا در اتصال'
    case 'idle':
    default:
      return 'دسترسی داده نشده'
  }
}

function statusColor(status: MicStatus) {
  switch (status) {
    case 'granted':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'denied':
      return 'text-destructive'
    case 'no-mic':
      return 'text-amber-600 dark:text-amber-400'
    case 'checking':
      return 'text-muted-foreground'
    case 'error':
      return 'text-destructive'
    case 'idle':
    default:
      return 'text-muted-foreground'
  }
}
