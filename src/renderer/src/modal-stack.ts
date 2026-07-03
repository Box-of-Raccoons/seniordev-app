// Tracks mounted ModalShell instances so only the TOPMOST one reacts to
// Escape. Without this, a ConfirmDialog stacked over another modal would see
// a single Escape close BOTH shells in the same tick.
const stack: symbol[] = []

export function pushModal(): symbol {
  const token = Symbol('modal')
  stack.push(token)
  return token
}

export function popModal(token: symbol): void {
  const i = stack.indexOf(token)
  if (i !== -1) stack.splice(i, 1)
}

export function isTopModal(token: symbol): boolean {
  return stack[stack.length - 1] === token
}
