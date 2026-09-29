import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router'
import { configured } from '../lib/supabase'
import MemberApp from './MemberApp'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      {configured ? (
        <Routes><Route path="/app/*" element={<MemberApp />} /></Routes>
      ) : <div style={{ padding: 24 }}>系統尚未設定完成，請稍後再試。</div>}
    </BrowserRouter>
  </StrictMode>,
)

// 可加到手機主畫面、沒網路也能開（正式網站才啟用）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/app-sw.js', { scope: '/app' }).catch(() => {}))
}
