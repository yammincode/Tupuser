import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { configured, secretKeyMisused } from './lib/supabase'
import { ToastProvider } from './components/Toast'
import CounterApp from './counter/CounterApp'
import KioskApp from './kiosk/KioskApp'
import AdminApp from './admin/AdminApp'
import './styles.css'

function NotConfigured() {
  if (secretKeyMisused) {
    return (
      <div className="center">
        <h2>金鑰填錯了</h2>
        <p className="muted">VITE_SUPABASE_ANON_KEY 填成了「秘密金鑰」（service_role / secret），這把金鑰不能放在網頁上。請改填 anon / publishable（公開）金鑰。</p>
      </div>
    )
  }
  return (
    <div className="center">
      <h2>尚未設定 Supabase 連線</h2>
      <p className="muted">在自己電腦：請在 web 資料夾建立 .env.local（參考 .env.example）。在 Netlify：請到 Site configuration → Environment variables 填入 VITE_SUPABASE_URL 與 VITE_SUPABASE_ANON_KEY，再重新部署。</p>
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ToastProvider>
      <BrowserRouter>
        {configured ? (
          <Routes>
            <Route path="/counter/*" element={<CounterApp />} />
            <Route path="/kiosk" element={<KioskApp />} />
            <Route path="/admin/*" element={<AdminApp />} />
            <Route path="*" element={<Navigate to="/counter" replace />} />
          </Routes>
        ) : <NotConfigured />}
      </BrowserRouter>
    </ToastProvider>
  </StrictMode>,
)
