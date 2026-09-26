'use client'

// Disable the lint rule for this file - we need setState in effect for hydration-safe theme toggle
/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="size-9 rounded-full"
        aria-label="تغییر تم"
        suppressHydrationWarning
      >
        <Sun className="size-4" suppressHydrationWarning />
      </Button>
    )
  }

  const isDark = theme === 'dark'

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="size-9 rounded-full hover:bg-muted"
      aria-label={isDark ? 'تم روشن' : 'تم تیره'}
      title={isDark ? 'تم روشن' : 'تم تیره'}
    >
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  )
}
