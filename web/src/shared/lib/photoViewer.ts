let closeActiveViewer: (() => void) | null = null
let isClosing = false

export const registerPhotoViewerClose = (close: () => void) => {
  closeActiveViewer = close
}

export const clearPhotoViewerClose = () => {
  closeActiveViewer = null
  isClosing = false
}

export const closePhotoViewer = () => {
  if (!closeActiveViewer || isClosing) return
  const close = closeActiveViewer
  closeActiveViewer = null
  isClosing = true
  try {
    close()
  } finally {
    isClosing = false
  }
}
