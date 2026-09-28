import { createContext, useContext } from 'react'

// 櫃檯系統共用資料：目前員工、分館、今天是否假日
export const CounterCtx = createContext(null)
export const useCounter = () => useContext(CounterCtx)
