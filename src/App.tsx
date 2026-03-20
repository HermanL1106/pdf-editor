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

type Tool = 'select' | 'highlight' | 'rectangle' | 'text' | 'pen' | 'erase'

type AnnotationBase = {
  id: string
  page: number
}



interface DragState {
  id: string
  offsetX: number
  offsetY: number
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
  const [dragState, setDragState] = useState<DragState | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFileName(file.name)
    setIsLoading(true)

    try {
      const arrayBuffer = await file.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)
      setOriginalPdfBytes(bytes)
      const pdf = await pdfjs.getDocument({ data: bytes }).promise
      setPdfDoc(pdf)
      setCurrentPage(1)
      setAnnotations([])
    } catch (err) {
      console.error('Error loading PDF:', err)
      alert('Failed to load PDF')
    } finally {
      setIsLoading(false)
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

  const handlePrevPage = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1)
  }

  const handleNextPage = () => {
    if (pdfDoc && currentPage < pdfDoc.numPages) {
      setCurrentPage(currentPage + 1)
    }
  }

  const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const handleDeleteAnnotation = (id: string) => {
    setAnnotations(prev => prev.filter(a => a.id !== id))
  }

  const handleEditAnnotation = (id: string) => {
    setAnnotations(prev => prev.map(a => {
      if (a.id !== id) return a

      if (a.type === 'text') {
        const text = window.prompt('編輯文字內容：', a.text)
        if (text === null) return a
        const color = window.prompt('文字顏色（hex）', a.color) || a.color
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
        const color = window.prompt('筆色（hex）', a.color) || a.color
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
      offsetX: e.clientX - rect.left - x,
      offsetY: e.clientY - rect.top - y
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

    if (dragState) {
      const x = e.clientX - rect.left - dragState.offsetX
      const y = e.clientY - rect.top - dragState.offsetY
      setAnnotations(prev => prev.map(a => (a.id === dragState.id && a.type === 'text') ? { ...a, x, y } : a))
      return
    }

    if (!isDrawing || tool !== 'pen') return
    const point = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    }
    setCurrentPenPoints(prev => [...prev, point])
  }

  const handleMouseUp = (e: React.MouseEvent) => {
    if (dragState) {
      setDragState(null)
      return
    }

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
  }

  const hexToRgb = (hex: string) => {
    const clean = hex.replace('#', '')
    const full = clean.length === 3
      ? clean.split('').map(c => c + c).join('')
      : clean
    const num = Number.parseInt(full, 16)
    return {
      r: ((num >> 16) & 255) / 255,
      g: ((num >> 8) & 255) / 255,
      b: (num & 255) / 255
    }
  }

  const handleDownload = async () => {
    if (!pdfDoc || !originalPdfBytes || !canvasRef.current) return

    try {
      const pdf = await PDFLibDocument.load(originalPdfBytes)
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
          const y = pageHeight - ann.y * scaleY - ann.fontSize
          const c = hexToRgb(ann.color)
          page.drawText(ann.text, {
            x,
            y,
            size: ann.fontSize,
            color: rgb(c.r, c.g, c.b)
          })
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

      const modifiedBytes = await pdf.save()
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
      alert('匯出 PDF 失敗，請再試一次')
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
              
              <button
                onClick={clearAnnotations}
                className="ml-4 px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200"
              >
                🗑️ Clear
              </button>
              {tool === 'erase' && <span className="text-sm text-orange-600">點選標註即可刪除</span>}
              {tool === 'select' && <span className="text-sm text-blue-600">文字可拖曳，雙擊標註可編輯</span>}
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
          <div className="max-w-6xl mx-auto">
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
                    return (
                      <div
                        key={ann.id}
                        className="absolute font-semibold whitespace-pre-wrap select-none"
                        onMouseDown={(e) => startTextDrag(e, ann.id, ann.x, ann.y)}
                        onDoubleClick={() => tool === 'select' && handleEditAnnotation(ann.id)}
                        onClick={() => tool === 'erase' && handleDeleteAnnotation(ann.id)}
                        style={{
                          left: ann.x,
                          top: ann.y,
                          maxWidth: '280px',
                          color: ann.color,
                          fontSize: `${ann.fontSize}px`,
                          lineHeight: 1.25,
                          cursor: tool === 'select' ? 'move' : (tool === 'erase' ? 'pointer' : 'default'),
                          pointerEvents: (tool === 'erase' || tool === 'select') ? 'auto' : 'none'
                        }}
                      >
                        {ann.text}
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
