import { useState, useRef, useEffect } from 'react'
import * as pdfjs from 'pdfjs-dist'

// Use bundled worker (works reliably on GitHub Pages)
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

interface PDFDocument {
  numPages: number
  getPage: (num: number) => Promise<any>
}

function App() {
  const [pdfDoc, setPdfDoc] = useState<PDFDocument | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [fileName, setFileName] = useState<string>('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [scale, setScale] = useState(1.5)
  const [isLoading, setIsLoading] = useState(false)

  // Annotation state
  const [tool, setTool] = useState<'select' | 'highlight' | 'rectangle'>('select')
  const [annotations, setAnnotations] = useState<any[]>([])
  const [isDrawing, setIsDrawing] = useState(false)
  const [startPos, setStartPos] = useState({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFileName(file.name)
    setIsLoading(true)

    try {
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise
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

  const handleMouseDown = (e: React.MouseEvent) => {
    if (tool === 'select') return
    
    const rect = canvasRef.current!.getBoundingClientRect()
    setStartPos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    })
    setIsDrawing(true)
  }

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!isDrawing || tool === 'select') return

    const rect = canvasRef.current!.getBoundingClientRect()
    const endPos = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    }

    if (tool === 'highlight') {
      setAnnotations([...annotations, {
        type: 'highlight',
        page: currentPage,
        x: Math.min(startPos.x, endPos.x),
        y: Math.min(startPos.y, endPos.y),
        width: Math.abs(endPos.x - startPos.x),
        height: Math.abs(endPos.y - startPos.y)
      }])
    } else if (tool === 'rectangle') {
      setAnnotations([...annotations, {
        type: 'rectangle',
        page: currentPage,
        x: Math.min(startPos.x, endPos.x),
        y: Math.min(startPos.y, endPos.y),
        width: Math.abs(endPos.x - startPos.x),
        height: Math.abs(endPos.y - startPos.y)
      }])
    }

    setIsDrawing(false)
  }

  const clearAnnotations = () => {
    setAnnotations(annotations.filter(a => a.page !== currentPage))
  }

  const handleDownload = async () => {
    if (!pdfDoc) return
    
    // For now, just download the original PDF
    // Full implementation would merge annotations using pdf-lib
    alert('Full PDF export coming soon!')
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
                onClick={clearAnnotations}
                className="ml-4 px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200"
              >
                🗑️ Clear
              </button>
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
              style={{ cursor: tool === 'select' ? 'default' : 'crosshair' }}
            >
              <canvas
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                className="block"
              />
              
              {/* Render annotations */}
              {annotations
                .filter(a => a.page === currentPage)
                .map((ann, i) => (
                  ann.type === 'highlight' ? (
                    <div
                      key={i}
                      className="absolute bg-yellow-300 opacity-30"
                      style={{
                        left: ann.x,
                        top: ann.y,
                        width: ann.width,
                        height: ann.height
                      }}
                    />
                  ) : (
                    <div
                      key={i}
                      className="absolute border-2 border-red-500"
                      style={{
                        left: ann.x,
                        top: ann.y,
                        width: ann.width,
                        height: ann.height
                      }}
                    />
                  )
                ))}
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
