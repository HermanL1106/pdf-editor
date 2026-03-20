import { useState, useRef, useEffect } from 'react'
import * as pdfjs from 'pdfjs-dist'
import { PDFDocument as PDFLibDocument, rgb } from 'pdf-lib'

// Use bundled worker (works reliably on GitHub Pages)
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

interface PDFDocument {
  numPages: number
  getPage: (num: number) => Promise<any>
}

type Tool = 'select' | 'highlight' | 'rectangle' | 'text' | 'pen' | 'image' | 'erase'

type AnnotationBase = {
  id: string
  page: number
}



interface DragState {
  id: string
  kind: 'text' | 'image'
  offsetX: number
  offsetY: number
}

interface DragPreview {
  id: string
  x: number
  y: number
}

interface ImageResizeState {
  id: string
  startX: number
  startY: number
  startWidth: number
  startHeight: number
}

type Annotation = (AnnotationBase & {
  type: 'highlight' | 'rectangle'
  x: number
  y: number
  width: number
  height: number
}) | (AnnotationBase & {
  type: 'text'
  x: number
  y: number
  text: string
  color: string
  fontSize: number
}) | (AnnotationBase & {
  type: 'pen'
  points: Array<{ x: number; y: number }>
  color: string
  strokeWidth: number
}) | (AnnotationBase & {
  type: 'image'
  x: number
  y: number
  width: number
  height: number
  dataUrl: string
})

function App() {
  const [pdfDoc, setPdfDoc] = useState<PDFDocument | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [fileName, setFileName] = useState<string>('')
  const [originalPdfBytes, setOriginalPdfBytes] = useState<Uint8Array | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [scale, setScale] = useState(1.5)
  const [isLoading, setIsLoading] = useState(false)

  // Annotation state
  const [tool, setTool] = useState<Tool>('select')
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [isDrawing, setIsDrawing] = useState(false)
  const [startPos, setStartPos] = useState({ x: 0, y: 0 })
  const [currentPenPoints, setCurrentPenPoints] = useState<Array<{ x: number; y: number }>>([])
  const [textColor, setTextColor] = useState('#1d4ed8')
  const [textSize, setTextSize] = useState(20)
  const [penColor, setPenColor] = useState('#16a34a')
  const [penSize, setPenSize] = useState(3)
  const [pendingImageDataUrl, setPendingImageDataUrl] = useState<string | null>(null)
  const [pendingImageName, setPendingImageName] = useState('')
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)
  const [imageResizeState, setImageResizeState] = useState<ImageResizeState | null>(null)
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null)
  const dragPreviewRef = useRef<DragPreview | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFileName(file.name)
    setIsLoading(true)

    try {
      const arrayBuffer = await file.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)
      // Keep a dedicated copy for export (pdf.js may transfer/consume the buffer internally)
      setOriginalPdfBytes(bytes.slice())
      const pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise
      setPdfDoc(pdf)
      setCurrentPage(1)
      setAnnotations([])
      setSelectedAnnotationId(null)
    } catch (err) {
      console.error('Error loading PDF:', err)
      alert('Failed to load PDF')
    } finally {
      setIsLoading(false)
    }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const reader = new FileReader()
      reader.onload = () => {
        const result = typeof reader.result === 'string' ? reader.result : null
        if (!result) return
        setPendingImageDataUrl(result)
        setPendingImageName(file.name)
        setTool('image')
      }
      reader.readAsDataURL(file)
    } catch (err) {
      console.error('Error loading image:', err)
      alert('圖片載入失敗')
    } finally {
      e.target.value = ''
    }
  }

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return

    const renderPage = async () => {
      const page = await pdfDoc.getPage(currentPage)
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current!
      const context = canvas.getContext('2d')!

      canvas.height = viewport.height
      canvas.width = viewport.width

      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise
    }

    renderPage()
  }, [pdfDoc, currentPage, scale])

  useEffect(() => {
    if (!dragState && !imageResizeState) return

    const handleWindowMove = (e: MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return

      if (dragState) {
        const x = e.clientX - rect.left - dragState.offsetX
        const y = e.clientY - rect.top - dragState.offsetY
        const preview = { id: dragState.id, x, y }
        dragPreviewRef.current = preview
        setDragPreview(preview)
        return
      }

      if (imageResizeState) {
        const dx = e.clientX - imageResizeState.startX
        const dy = e.clientY - imageResizeState.startY
        const nextWidth = Math.max(30, imageResizeState.startWidth + dx)
        const nextHeight = Math.max(30, imageResizeState.startHeight + dy)
        setAnnotations(prev => prev.map(a => (
          a.id === imageResizeState.id && a.type === 'image'
            ? { ...a, width: nextWidth, height: nextHeight }
            : a
        )))
      }
    }

    const handleWindowUp = () => {
      if (dragState) {
        const preview = dragPreviewRef.current
        setAnnotations(prev => prev.map(a => (
          a.id === dragState.id && (a.type === 'text' || a.type === 'image') && preview?.id === dragState.id
            ? { ...a, x: preview.x, y: preview.y }
            : a
        )))
        setDragState(null)
        setDragPreview(null)
        dragPreviewRef.current = null
      }

      if (imageResizeState) {
        setImageResizeState(null)
      }
    }

    window.addEventListener('mousemove', handleWindowMove)
    window.addEventListener('mouseup', handleWindowUp)

    return () => {
      window.removeEventListener('mousemove', handleWindowMove)
      window.removeEventListener('mouseup', handleWindowUp)
    }
  }, [dragState, imageResizeState])

  const handlePrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1)
      setSelectedAnnotationId(null)
    }
  }

  const handleNextPage = () => {
    if (pdfDoc && currentPage < pdfDoc.numPages) {
      setCurrentPage(currentPage + 1)
      setSelectedAnnotationId(null)
    }
  }

  const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const handleDeleteAnnotation = (id: string) => {
    setAnnotations(prev => prev.filter(a => a.id !== id))
    if (selectedAnnotationId === id) setSelectedAnnotationId(null)
  }

  const handleEditAnnotation = (id: string) => {
    setAnnotations(prev => prev.map(a => {
      if (a.id !== id) return a

      if (a.type === 'text') {
        const text = window.prompt('編輯文字內容：', a.text)
        if (text === null) return a
        const color = normalizeHexColor(window.prompt('文字顏色（hex）', a.color) || a.color)
        const size = Number(window.prompt('字體大小(px)', String(a.fontSize)) || a.fontSize)
        return { ...a, text: text.trim() || a.text, color, fontSize: Number.isFinite(size) ? size : a.fontSize }
      }

      if (a.type === 'highlight' || a.type === 'rectangle') {
        const x = Number(window.prompt('X 座標', String(Math.round(a.x))) || a.x)
        const y = Number(window.prompt('Y 座標', String(Math.round(a.y))) || a.y)
        const width = Number(window.prompt('寬度', String(Math.round(a.width))) || a.width)
        const height = Number(window.prompt('高度', String(Math.round(a.height))) || a.height)
        return {
          ...a,
          x: Number.isFinite(x) ? x : a.x,
          y: Number.isFinite(y) ? y : a.y,
          width: Number.isFinite(width) ? Math.max(1, width) : a.width,
          height: Number.isFinite(height) ? Math.max(1, height) : a.height
        }
      }

      if (a.type === 'pen') {
        const color = normalizeHexColor(window.prompt('筆色（hex）', a.color) || a.color)
        const strokeWidth = Number(window.prompt('粗細(px)', String(a.strokeWidth)) || a.strokeWidth)
        return { ...a, color, strokeWidth: Number.isFinite(strokeWidth) ? Math.max(1, strokeWidth) : a.strokeWidth }
      }

      return a
    }))
  }

  const startTextDrag = (e: React.MouseEvent, id: string, x: number, y: number) => {
    if (tool !== 'select') return
    e.stopPropagation()
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    setDragState({
      id,
      kind: 'text',
      offsetX: e.clientX - rect.left - x,
      offsetY: e.clientY - rect.top - y
    })
    const preview = { id, x, y }
    dragPreviewRef.current = preview
    setDragPreview(preview)
  }

  const startImageDrag = (e: React.MouseEvent, id: string, x: number, y: number) => {
    if (tool !== 'select') return
    e.stopPropagation()
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    setDragState({
      id,
      kind: 'image',
      offsetX: e.clientX - rect.left - x,
      offsetY: e.clientY - rect.top - y
    })
    const preview = { id, x, y }
    dragPreviewRef.current = preview
    setDragPreview(preview)
  }

  const startImageResize = (e: React.MouseEvent, ann: Extract<Annotation, { type: 'image' }>) => {
    if (tool !== 'select') return
    e.stopPropagation()
    setImageResizeState({
      id: ann.id,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: ann.width,
      startHeight: ann.height
    })
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (tool === 'select' || tool === 'erase') return

    const rect = canvasRef.current!.getBoundingClientRect()
    const point = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    }

    if (tool === 'text') {
      const text = window.prompt('輸入要新增的文字：')
      if (!text || !text.trim()) return

      setAnnotations(prev => [...prev, {
        id: makeId(),
        type: 'text',
        page: currentPage,
        x: point.x,
        y: point.y,
        text: text.trim(),
        color: textColor,
        fontSize: textSize
      }])
      return
    }

    if (tool === 'image') {
      if (!pendingImageDataUrl) {
        alert('請先在工具列上傳一張圖片')
        return
      }
      const image = new Image()
      image.onload = () => {
        const maxWidth = canvasRef.current ? canvasRef.current.width * 0.35 : 260
        const ratio = image.width / image.height || 1
        const width = Math.min(maxWidth, image.width)
        const height = width / ratio
        setAnnotations(prev => [...prev, {
          id: makeId(),
          type: 'image',
          page: currentPage,
          x: point.x,
          y: point.y,
          width,
          height,
          dataUrl: pendingImageDataUrl
        }])
      }
      image.src = pendingImageDataUrl
      return
    }

    if (tool === 'pen') {
      setCurrentPenPoints([point])
      setIsDrawing(true)
      return
    }

    setStartPos(point)
    setIsDrawing(true)
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()

    if (!isDrawing || tool !== 'pen') return
    const point = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    }
    setCurrentPenPoints(prev => [...prev, point])
  }

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isDrawing || tool === 'select' || tool === 'text') return

    const rect = canvasRef.current!.getBoundingClientRect()
    const endPos = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    }

    if (tool === 'highlight') {
      setAnnotations(prev => [...prev, {
        id: makeId(),
        type: 'highlight',
        page: currentPage,
        x: Math.min(startPos.x, endPos.x),
        y: Math.min(startPos.y, endPos.y),
        width: Math.abs(endPos.x - startPos.x),
        height: Math.abs(endPos.y - startPos.y)
      }])
    } else if (tool === 'rectangle') {
      setAnnotations(prev => [...prev, {
        id: makeId(),
        type: 'rectangle',
        page: currentPage,
        x: Math.min(startPos.x, endPos.x),
        y: Math.min(startPos.y, endPos.y),
        width: Math.abs(endPos.x - startPos.x),
        height: Math.abs(endPos.y - startPos.y)
      }])
    } else if (tool === 'pen') {
      if (currentPenPoints.length > 1) {
        setAnnotations(prev => [...prev, {
          id: makeId(),
          type: 'pen',
          page: currentPage,
          points: currentPenPoints,
          color: penColor,
          strokeWidth: penSize
        }])
      }
      setCurrentPenPoints([])
    }

    setIsDrawing(false)
  }

  const clearAnnotations = () => {
    setAnnotations(annotations.filter(a => a.page !== currentPage))
    setSelectedAnnotationId(null)
  }

  const normalizeHexColor = (input: string) => {
    const raw = (input || '').trim().replace('#', '')
    const expanded = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw
    const valid = /^[0-9a-fA-F]{6}$/.test(expanded)
    return `#${valid ? expanded : '000000'}`
  }

  const hexToRgb = (hex: string) => {
    const full = normalizeHexColor(hex).replace('#', '')
    const num = Number.parseInt(full, 16)
    return {
      r: ((num >> 16) & 255) / 255,
      g: ((num >> 8) & 255) / 255,
      b: (num & 255) / 255
    }
  }

  const dataUrlToUint8Array = (dataUrl: string) => {
    const base64 = dataUrl.split(',')[1] || ''
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes
  }

  type TextAnnotation = Extract<Annotation, { type: 'text' }>

  const selectedTextAnnotation = annotations.find(
    (a): a is TextAnnotation => a.id === selectedAnnotationId && a.type === 'text' && a.page === currentPage
  )

  const updateSelectedTextAnnotation = (patch: Partial<TextAnnotation>) => {
    if (!selectedAnnotationId) return
    setAnnotations(prev => prev.map(a =>
      (a.id === selectedAnnotationId && a.type === 'text') ? { ...a, ...patch } : a
    ))
  }

  const handleDownload = async () => {
    if (!pdfDoc || !originalPdfBytes || !canvasRef.current) return

    try {
      const pdf = await PDFLibDocument.load(originalPdfBytes, { ignoreEncryption: true })
      const pages = pdf.getPages()
      const canvas = canvasRef.current

      for (const ann of annotations) {
        const page = pages[ann.page - 1]
        if (!page) continue

        const pageWidth = page.getWidth()
        const pageHeight = page.getHeight()
        const scaleX = pageWidth / canvas.width
        const scaleY = pageHeight / canvas.height

        if (ann.type === 'highlight') {
          const x = ann.x * scaleX
          const y = pageHeight - (ann.y + ann.height) * scaleY
          page.drawRectangle({
            x,
            y,
            width: ann.width * scaleX,
            height: ann.height * scaleY,
            color: rgb(1, 0.92, 0.23),
            opacity: 0.35,
            borderWidth: 0
          })
        }

        if (ann.type === 'rectangle') {
          const x = ann.x * scaleX
          const y = pageHeight - (ann.y + ann.height) * scaleY
          page.drawRectangle({
            x,
            y,
            width: ann.width * scaleX,
            height: ann.height * scaleY,
            borderColor: rgb(0.86, 0.11, 0.11),
            borderWidth: 2,
            opacity: 1
          })
        }

        if (ann.type === 'text') {
          const x = ann.x * scaleX
          const yTop = ann.y * scaleY

          // Render text as image to support all languages (e.g. Chinese)
          const textCanvas = document.createElement('canvas')
          const textCtx = textCanvas.getContext('2d')
          if (textCtx) {
            const fontPx = Math.max(8, ann.fontSize * scaleY)
            textCtx.font = `${fontPx}px sans-serif`
            const metrics = textCtx.measureText(ann.text)
            const width = Math.max(1, Math.ceil(metrics.width + 8))
            const height = Math.max(1, Math.ceil(fontPx * 1.4))
            textCanvas.width = width
            textCanvas.height = height

            const drawCtx = textCanvas.getContext('2d')
            if (drawCtx) {
              drawCtx.clearRect(0, 0, width, height)
              drawCtx.font = `${fontPx}px sans-serif`
              drawCtx.fillStyle = normalizeHexColor(ann.color)
              drawCtx.textBaseline = 'top'
              drawCtx.fillText(ann.text, 0, 0)

              const pngDataUrl = textCanvas.toDataURL('image/png')
              const pngBytes = dataUrlToUint8Array(pngDataUrl)
              const image = await pdf.embedPng(pngBytes)
              page.drawImage(image, {
                x,
                y: pageHeight - yTop - height,
                width,
                height
              })
            }
          }
        }

        if (ann.type === 'image') {
          const x = ann.x * scaleX
          const y = pageHeight - (ann.y + ann.height) * scaleY
          const width = ann.width * scaleX
          const height = ann.height * scaleY
          try {
            const bytes = dataUrlToUint8Array(ann.dataUrl)
            const image = ann.dataUrl.includes('image/jpeg') || ann.dataUrl.includes('image/jpg')
              ? await pdf.embedJpg(bytes)
              : await pdf.embedPng(bytes)
            page.drawImage(image, { x, y, width, height })
          } catch (imageErr) {
            console.error('Image embed failed:', imageErr)
          }
        }

        if (ann.type === 'pen') {
          const c = hexToRgb(ann.color)
          for (let i = 1; i < ann.points.length; i++) {
            const p1 = ann.points[i - 1]
            const p2 = ann.points[i]
            page.drawLine({
              start: {
                x: p1.x * scaleX,
                y: pageHeight - p1.y * scaleY
              },
              end: {
                x: p2.x * scaleX,
                y: pageHeight - p2.y * scaleY
              },
              thickness: ann.strokeWidth,
              color: rgb(c.r, c.g, c.b),
              opacity: 1
            })
          }
        }
      }

      const modifiedBytes = await pdf.save({ useObjectStreams: false })
      const outBuffer = modifiedBytes.buffer.slice(
        modifiedBytes.byteOffset,
        modifiedBytes.byteOffset + modifiedBytes.byteLength
      ) as ArrayBuffer
      const blob = new Blob([outBuffer], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const baseName = fileName.toLowerCase().endsWith('.pdf') ? fileName.slice(0, -4) : (fileName || 'document')
      a.href = url
      a.download = `${baseName}-edited.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Error exporting PDF:', err)
      const message = err instanceof Error ? err.message : String(err)
      alert(`匯出 PDF 失敗：${message}`)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white shadow-sm p-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-800">📄 PDF Editor {fileName && <span className="text-sm font-normal text-gray-500 ml-2">- {fileName}</span>}</h1>
          
          <div className="flex items-center gap-4">
            <label className="cursor-pointer bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition">
              <input type="file" accept=".pdf" onChange={handleFileUpload} className="hidden" />
              📂 Open PDF
            </label>
            
            {pdfDoc && (
              <button 
                onClick={handleDownload}
                className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition"
              >
                💾 Download
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Toolbar */}
      {pdfDoc && (
        <div className="bg-white border-b p-3">
          <div className="max-w-6xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTool('select')}
                className={`px-3 py-1.5 rounded ${tool === 'select' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100'}`}
              >
                👆 Select
              </button>
              <button
                onClick={() => setTool('highlight')}
                className={`px-3 py-1.5 rounded ${tool === 'highlight' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100'}`}
              >
                🖍️ Highlight
              </button>
              <button
                onClick={() => setTool('rectangle')}
                className={`px-3 py-1.5 rounded ${tool === 'rectangle' ? 'bg-red-100 text-red-700' : 'bg-gray-100'}`}
              >
                🔲 Rectangle
              </button>
              <button
                onClick={() => setTool('text')}
                className={`px-3 py-1.5 rounded ${tool === 'text' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100'}`}
              >
                🔤 Text
              </button>
              <button
                onClick={() => setTool('pen')}
                className={`px-3 py-1.5 rounded ${tool === 'pen' ? 'bg-green-100 text-green-700' : 'bg-gray-100'}`}
              >
                ✍️ Handwrite
              </button>
              <button
                onClick={() => setTool('image')}
                className={`px-3 py-1.5 rounded ${tool === 'image' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100'}`}
              >
                🖼️ Image
              </button>
              <button
                onClick={() => setTool('erase')}
                className={`px-3 py-1.5 rounded ${tool === 'erase' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100'}`}
              >
                🩹 Eraser
              </button>

              {tool === 'text' && (
                <div className="ml-2 flex items-center gap-2 text-sm">
                  <span className="text-gray-500">Text</span>
                  <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} className="w-8 h-8 p-0 border rounded" />
                  <input type="range" min={12} max={48} value={textSize} onChange={(e) => setTextSize(Number(e.target.value))} />
                  <span className="w-10 text-gray-600">{textSize}px</span>
                </div>
              )}

              {tool === 'pen' && (
                <div className="ml-2 flex items-center gap-2 text-sm">
                  <span className="text-gray-500">Pen</span>
                  <input type="color" value={penColor} onChange={(e) => setPenColor(e.target.value)} className="w-8 h-8 p-0 border rounded" />
                  <input type="range" min={1} max={12} value={penSize} onChange={(e) => setPenSize(Number(e.target.value))} />
                  <span className="w-10 text-gray-600">{penSize}px</span>
                </div>
              )}

              {tool === 'image' && (
                <div className="ml-2 flex items-center gap-2 text-sm">
                  <label className="cursor-pointer bg-purple-600 text-white px-3 py-1.5 rounded hover:bg-purple-700">
                    <input type="file" accept="image/png,image/jpeg,image/jpg" onChange={handleImageUpload} className="hidden" />
                    上傳圖片
                  </label>
                  <span className="text-gray-500 max-w-36 truncate">{pendingImageName || '尚未選擇圖片'}</span>
                </div>
              )}
              
              <button
                onClick={clearAnnotations}
                className="ml-4 px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200"
              >
                🗑️ Clear
              </button>
              {tool === 'erase' && <span className="text-sm text-orange-600">點選標註即可刪除</span>}
              {tool === 'select' && <span className="text-sm text-blue-600">文字可拖曳，點選文字可在右側面板編輯</span>}
              {tool === 'image' && <span className="text-sm text-purple-600">先上傳圖片，再點 PDF 放置</span>}
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={handlePrevPage}
                disabled={currentPage === 1}
                className="px-3 py-1.5 rounded bg-gray-100 disabled:opacity-50"
              >
                ◀ Prev
              </button>
              <span className="text-gray-600">
                Page {currentPage} of {pdfDoc.numPages}
              </span>
              <button
                onClick={handleNextPage}
                disabled={currentPage === pdfDoc.numPages}
                className="px-3 py-1.5 rounded bg-gray-100 disabled:opacity-50"
              >
                Next ▶
              </button>
              
              <div className="flex items-center gap-2 ml-4">
                <span className="text-gray-500 text-sm">Zoom:</span>
                <button 
                  onClick={() => setScale(Math.max(0.5, scale - 0.25))}
                  className="px-2 py-1 rounded bg-gray-100"
                >-</button>
                <span className="w-16 text-center">{Math.round(scale * 100)}%</span>
                <button 
                  onClick={() => setScale(Math.min(3, scale + 0.25))}
                  className="px-2 py-1 rounded bg-gray-100"
                >+</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PDF Canvas */}
      <main className="p-8">
        {isLoading ? (
          <div className="text-center py-20">
            <div className="text-2xl">⏳ Loading PDF...</div>
          </div>
        ) : pdfDoc ? (
          <div className="max-w-6xl mx-auto flex items-start gap-6">
            <div 
              ref={containerRef}
              className="relative inline-block bg-white shadow-lg"
              style={{ cursor: tool === 'select' ? 'default' : tool === 'erase' ? 'pointer' : 'crosshair' }}
            >
              <canvas
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                className="block"
              />

              {/* Render annotations */}
              {annotations
                .filter(a => a.page === currentPage)
                .map((ann) => {
                  if (ann.type === 'highlight') {
                    return (
                      <div
                        key={ann.id}
                        className="absolute bg-yellow-300 opacity-30"
                        onClick={() => tool === 'erase' && handleDeleteAnnotation(ann.id)}
                        onDoubleClick={() => tool === 'select' && handleEditAnnotation(ann.id)}
                        style={{
                          left: ann.x,
                          top: ann.y,
                          width: ann.width,
                          height: ann.height,
                          pointerEvents: tool === 'erase' ? 'auto' : 'none'
                        }}
                      />
                    )
                  }

                  if (ann.type === 'rectangle') {
                    return (
                      <div
                        key={ann.id}
                        className="absolute border-2 border-red-500"
                        onClick={() => tool === 'erase' && handleDeleteAnnotation(ann.id)}
                        onDoubleClick={() => tool === 'select' && handleEditAnnotation(ann.id)}
                        style={{
                          left: ann.x,
                          top: ann.y,
                          width: ann.width,
                          height: ann.height,
                          pointerEvents: tool === 'erase' ? 'auto' : 'none'
                        }}
                      />
                    )
                  }

                  if (ann.type === 'text') {
                    const previewing = dragPreview?.id === ann.id
                    const drawX = previewing ? dragPreview.x : ann.x
                    const drawY = previewing ? dragPreview.y : ann.y

                    return (
                      <div
                        key={ann.id}
                        className="absolute font-semibold whitespace-pre-wrap select-none"
                        onMouseDown={(e) => startTextDrag(e, ann.id, drawX, drawY)}
                        onClick={() => {
                          if (tool === 'erase') handleDeleteAnnotation(ann.id)
                          if (tool === 'select') setSelectedAnnotationId(ann.id)
                        }}
                        style={{
                          left: drawX,
                          top: drawY,
                          maxWidth: '280px',
                          color: ann.color,
                          fontSize: `${ann.fontSize}px`,
                          lineHeight: 1.25,
                          cursor: tool === 'select' ? 'move' : (tool === 'erase' ? 'pointer' : 'default'),
                          pointerEvents: (tool === 'erase' || tool === 'select') ? 'auto' : 'none',
                          outline: selectedAnnotationId === ann.id ? '2px dashed #3b82f6' : 'none',
                          outlineOffset: '2px'
                        }}
                      >
                        {ann.text}
                      </div>
                    )
                  }

                  if (ann.type === 'image') {
                    const previewing = dragPreview?.id === ann.id
                    const drawX = previewing ? dragPreview.x : ann.x
                    const drawY = previewing ? dragPreview.y : ann.y
                    const selected = selectedAnnotationId === ann.id

                    return (
                      <div
                        key={ann.id}
                        style={{
                          position: 'absolute',
                          left: drawX,
                          top: drawY,
                          width: ann.width,
                          height: ann.height,
                          pointerEvents: (tool === 'erase' || tool === 'select') ? 'auto' : 'none',
                          outline: selected ? '2px dashed #8b5cf6' : 'none',
                          outlineOffset: '2px'
                        }}
                        onMouseDown={(e) => startImageDrag(e, ann.id, drawX, drawY)}
                        onClick={() => {
                          if (tool === 'erase') handleDeleteAnnotation(ann.id)
                          if (tool === 'select') setSelectedAnnotationId(ann.id)
                        }}
                      >
                        <img
                          src={ann.dataUrl}
                          alt="annotation"
                          style={{ width: '100%', height: '100%', objectFit: 'contain', userSelect: 'none' }}
                          draggable={false}
                        />
                        {tool === 'select' && selected && (
                          <div
                            onMouseDown={(e) => startImageResize(e, ann)}
                            style={{
                              position: 'absolute',
                              right: -6,
                              bottom: -6,
                              width: 14,
                              height: 14,
                              background: '#8b5cf6',
                              borderRadius: 999,
                              border: '2px solid white',
                              cursor: 'nwse-resize'
                            }}
                          />
                        )}
                      </div>
                    )
                  }

                  if (ann.type === 'pen') {
                    const points = ann.points.map((p: { x: number; y: number }) => `${p.x},${p.y}`).join(' ')
                    return (
                      <svg
                        key={ann.id}
                        className="absolute inset-0"
                        width="100%"
                        height="100%"
                        style={{ pointerEvents: (tool === 'erase' || tool === 'select') ? 'auto' : 'none' }}
                        onClick={() => tool === 'erase' && handleDeleteAnnotation(ann.id)}
                        onDoubleClick={() => tool === 'select' && handleEditAnnotation(ann.id)}
                      >
                        <polyline
                          points={points}
                          fill="none"
                          stroke={ann.color}
                          strokeWidth={ann.strokeWidth}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )
                  }

                  return null
                })}

              {/* Preview current handwriting stroke */}
              {tool === 'pen' && currentPenPoints.length > 1 && (
                <svg className="absolute inset-0 pointer-events-none" width="100%" height="100%">
                  <polyline
                    points={currentPenPoints.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={penColor}
                    strokeWidth={penSize}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>

            <aside className="w-72 bg-white rounded-lg shadow p-4 sticky top-4">
              <h3 className="font-semibold text-gray-800 mb-3">文字編輯面板</h3>
              {tool !== 'select' && <p className="text-sm text-gray-500">切換到 Select 後，點選文字即可編輯。</p>}
              {tool === 'select' && !selectedTextAnnotation && (
                <p className="text-sm text-gray-500">請先點選一段文字標註。</p>
              )}
              {tool === 'select' && selectedTextAnnotation && (
                <div className="space-y-4">
                  <div>
                    <label className="text-sm text-gray-600 block mb-1">文字顏色</label>
                    <input
                      type="color"
                      value={normalizeHexColor(selectedTextAnnotation.color)}
                      onChange={(e) => updateSelectedTextAnnotation({ color: normalizeHexColor(e.target.value) })}
                      className="w-14 h-10 p-1 border rounded"
                    />
                  </div>

                  <div>
                    <label className="text-sm text-gray-600 block mb-1">文字大小：{selectedTextAnnotation.fontSize}px</label>
                    <input
                      type="range"
                      min={12}
                      max={72}
                      value={selectedTextAnnotation.fontSize}
                      onChange={(e) => updateSelectedTextAnnotation({ fontSize: Number(e.target.value) })}
                      className="w-full"
                    />
                  </div>
                </div>
              )}
            </aside>
          </div>
        ) : (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">📄</div>
            <h2 className="text-2xl text-gray-600 mb-2">No PDF Open</h2>
            <p className="text-gray-500">Click "Open PDF" to get started</p>
          </div>
        )}
      </main>
    </div>
  )
}

export default App
