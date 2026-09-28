import { useCallback, useEffect, useState } from 'react'

// 載入資料的小工具：回傳 { data, error, loading, reload }
export function useAsync(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps)
  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await run()
      setState({ data, error: null, loading: false })
    } catch (e) {
      setState({ data: null, error: e.message || String(e), loading: false })
    }
  }, [run])
  useEffect(() => { reload() }, [reload])
  return { ...state, reload }
}

// Supabase 查詢結果：有錯就丟出
export function unwrap({ data, error }) {
  if (error) throw new Error(error.message)
  return data
}
