import { useCallback, useEffect, useRef, useState } from 'react'

// Two-tap confirm for destructive buttons: the first tap arms the row, the
// second does the deed, and the arming lapses after a few seconds so a
// forgotten click can't be finished by accident later.
//
// This was pasted identically into five pages (Accounts, Benefits, Goals,
// Insurance, Properties), each with a setTimeout nobody cancelled — leaving a
// timer running against an unmounted page every time you armed a row and
// navigated away. One copy, one timer, cleared on unmount and on re-arm.
//
//   const { isArmed, arm } = useArmedAction()
//   <button onClick={() => arm(row.id, () => dispatch(del(row.id)))}>
//     {isArmed(row.id) ? 'Confirm?' : 'Delete'}
//   </button>
export function useArmedAction(timeoutMs = 3000) {
  const [armedId, setArmedId] = useState(null)
  const timer = useRef(null)

  const clear = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
  }, [])
  useEffect(() => clear, [clear])

  // arm(id, confirmed): first call arms, second runs `confirmed`.
  const arm = useCallback((id, confirmed) => {
    if (armedId !== id) {
      clear()
      setArmedId(id)
      timer.current = setTimeout(() => { timer.current = null; setArmedId(null) }, timeoutMs)
      return false
    }
    clear()
    setArmedId(null)
    confirmed?.()
    return true
  }, [armedId, clear, timeoutMs])

  const isArmed = useCallback(id => armedId === id, [armedId])
  return { armedId, isArmed, arm, disarm: useCallback(() => { clear(); setArmedId(null) }, [clear]) }
}
