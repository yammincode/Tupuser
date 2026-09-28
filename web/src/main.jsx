import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { configured } from './lib/supabase'
import { ToastProvider } from './components/Toast'
import CounterApp from './counter/CounterApp'
import './styles.css'

function NotConfigured() {
  return (
    <div className="center">
      <h2>尚未設定 Supabase 連線</h2>
      <p className="muted">請在 web 資料夾建立 .env 檔案（參考 .env.example），填入網址與公開金鑰後重新啟動。</p>
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
            <Route path="*" element={<Navigate to="/counter" replace />} />
          </Routes>
        ) : <NotConfigured />}
      </BrowserRouter>
    </ToastProvider>
  </StrictMode>,
)
