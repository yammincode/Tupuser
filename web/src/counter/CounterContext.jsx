import { createContext, useContext } from 'react'

// 櫃檯系統共用資料：目前員工、目前分館
export const CounterCtx = createContext(null)
export const useCounter = () => useContext(CounterCtx)
