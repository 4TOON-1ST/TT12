'use client'

import { useEffect, useState } from 'react'
import { useVoiceRoom } from '@/hooks/use-voice-room'
import { Landing } from '@/components/landing'
import { RoomView } from '@/components/room-view'

export default function Home() {
  const voice = useVoiceRoom()
  const [micStatus, setMicStatus] = useState<
    'idle' | 'checking' | 'granted' | 'denied' | 'no-mic' | 'error'
  >('idle')

  // Connect socket on mount
  useEffect(() => {
    voice.connect()
  }, [])

  // When mic is ready (from MicPermissionCard on Landing), set status
  const handleMicReady = (stream: MediaStream) => {
    setMicStatus('granted')
    // Inform the hook about the externally-provided stream
    voice.setExternalStream(stream)
  }

  // When joining a room, request mic again if not already granted
  const handleMicRequest = () => {
    setMicStatus('checking')
    voice
      .getLocalStream()
      .then(() => setMicStatus('granted'))
      .catch((e: any) => {
        if (e?.name === 'NotAllowedError' || e?.message?.includes('رد شد')) setMicStatus('denied')
        else if (e?.name === 'NotFoundError' || e?.message?.includes('پیدا نشد')) setMicStatus('no-mic')
        else setMicStatus('error')
      })
  }

  // When we leave the room, reset mic status (so user is prompted again on landing)
  useEffect(() => {
    if (!voice.roomCode && micStatus !== 'granted') {
      // Could re-check perm here, but keeping state as-is is fine
    }
  }, [voice.roomCode, micStatus])

  if (voice.roomCode) {
    return (
      <RoomView
        roomCode={voice.roomCode}
        users={voice.users}
        isHost={voice.isHost}
        muted={voice.muted}
        speaking={voice.speaking}
        chat={voice.chat}
        currentUserId={voice.myId}
        micStatus={micStatus}
        onToggleMute={voice.toggleMute}
        onLeave={voice.leaveRoom}
        onSendChat={voice.sendChat}
        onRequestMic={handleMicRequest}
      />
    )
  }

  return (
    <Landing
      onJoin={voice.joinRoom}
      onCreate={voice.createRoom}
      onMicReady={handleMicReady}
    />
  )
}
