import { atom, type Getter } from 'jotai'

// Apply visibility rules on every read, including after background updates.
export function configuredAtom<T>(initial: T, resolve: (get: Getter, value: T) => T) {
  const valueAtom = atom(initial)
  return atom(
    (get) => resolve(get, get(valueAtom)),
    (get, set, update: T | ((previous: T) => T)) => {
      const previous = resolve(get, get(valueAtom))
      const next = typeof update === 'function' ? (update as (previous: T) => T)(previous) : update
      set(valueAtom, resolve(get, next))
    }
  )
}
