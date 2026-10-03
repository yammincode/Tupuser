// 保留訂單：存在這台平板（瀏覽器）上，依分館分開；關帳時提醒還有沒結的
export const heldKey = (branchId) => `origin.counter.held.${branchId}`

export function loadHeld(branchId) {
  try { return JSON.parse(localStorage.getItem(heldKey(branchId)) || '[]') } catch { return [] }
}

export function saveHeld(branchId, list) {
  try { localStorage.setItem(heldKey(branchId), JSON.stringify(list)) } catch { /* 無法使用瀏覽器儲存時略過 */ }
}
