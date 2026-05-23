import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Upload, Image, X, ChevronRight } from 'lucide-react'

const samplePhotos = [
  { id: 1, url: 'https://neeko-copilot.bytedance.net/api/text_to_image?prompt=coffee%20shop%20interior%20with%20people%20ordering%20drinks%20realistic%20photo&image_size=landscape_4_3', title: '咖啡店场景' },
  { id: 2, url: 'https://neeko-copilot.bytedance.net/api/text_to_image?prompt=airport%20check-in%20counter%20with%20travelers%20realistic%20photo&image_size=landscape_4_3', title: '机场值机场景' },
  { id: 3, url: 'https://neeko-copilot.bytedance.net/api/text_to_image?prompt=restaurant%20table%20with%20waiter%20taking%20order%20realistic%20photo&image_size=landscape_4_3', title: '餐厅点餐场景' },
  { id: 4, url: 'https://neeko-copilot.bytedance.net/api/text_to_image?prompt=classroom%20with%20students%20and%20teacher%20realistic%20photo&image_size=landscape_4_3', title: '教室场景' },
  { id: 5, url: 'https://neeko-copilot.bytedance.net/api/text_to_image?prompt=supermarket%20aisle%20with%20shopping%20cart%20realistic%20photo&image_size=landscape_4_3', title: '超市购物场景' },
  { id: 6, url: 'https://neeko-copilot.bytedance.net/api/text_to_image?prompt=train%20station%20platform%20with%20passengers%20realistic%20photo&image_size=landscape_4_3', title: '火车站台场景' },
]

export default function ScenarioPage() {
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleSampleSelect = (url: string) => {
    setSelectedPhoto(url)
    setUploadedFile(null)
    setPreview(url)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setUploadedFile(file)
      setSelectedPhoto(null)
      const reader = new FileReader()
      reader.onload = (event) => {
        setPreview(event.target?.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleSubmit = () => {
    if (preview) {
      localStorage.setItem('selectedPhoto', preview)
      window.location.href = '/task'
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">选择实景情境</h1>
          <p className="text-gray-600">上传一张实景照片，或从样例中选择，系统将生成POA学习任务</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Upload className="w-5 h-5 text-indigo-600" />
            上传照片
          </h2>
          <div 
            className="border-2 border-dashed rounded-xl p-12 text-center hover:border-indigo-400 transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
            <Image className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 mb-2">点击或拖拽上传照片</p>
            <p className="text-sm text-gray-400">支持 JPG、PNG 格式</p>
          </div>
        </div>

        {preview && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">预览</h2>
              <button 
                onClick={() => {
                  setPreview(null)
                  setSelectedPhoto(null)
                  setUploadedFile(null)
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="aspect-video bg-gray-100 rounded-xl overflow-hidden">
              <img src={preview} alt="Preview" className="w-full h-full object-cover" />
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">选择样例照片</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {samplePhotos.map((photo) => (
              <div 
                key={photo.id}
                className={`relative rounded-xl overflow-hidden cursor-pointer transition-transform hover:scale-105 ${
                  selectedPhoto === photo.url ? 'ring-2 ring-indigo-500 ring-offset-2' : ''
                }`}
                onClick={() => handleSampleSelect(photo.url)}
              >
                <img src={photo.url} alt={photo.title} className="w-full h-32 object-cover" />
                <div className="absolute inset-0 bg-black/30 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="text-white text-sm font-medium">{photo.title}</span>
                </div>
                {selectedPhoto === photo.url && (
                  <div className="absolute top-2 right-2 w-6 h-6 bg-indigo-600 rounded-full flex items-center justify-center">
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 flex justify-center">
          <Button 
            size="lg" 
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-8"
            onClick={handleSubmit}
            disabled={!preview}
          >
            生成学习任务
            <ChevronRight className="ml-2 w-5 h-5" />
          </Button>
        </div>
      </div>
    </div>
  )
}