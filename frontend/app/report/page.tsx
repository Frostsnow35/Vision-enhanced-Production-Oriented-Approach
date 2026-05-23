import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Download, Clock, Image, MessageSquare, Lightbulb, BookOpen, BarChart3, CheckCircle2, ArrowRight, Home } from 'lucide-react'

interface TimelineItem {
  id: number
  icon: typeof Clock
  title: string
  subtitle: string
  description: string
  time: string
}

const timelineItems: TimelineItem[] = [
  {
    id: 1,
    icon: Image,
    title: '实景情境',
    subtitle: '选择场景照片',
    description: '上传咖啡店实景照片，系统分析场景要素并生成POA学习任务',
    time: '14:30'
  },
  {
    id: 2,
    icon: MessageSquare,
    title: '产出尝试',
    subtitle: '第一次对话练习',
    description: '与AI服务员进行英文对话，系统记录对话内容和学习证据',
    time: '14:35'
  },
  {
    id: 3,
    icon: Lightbulb,
    title: '问题诊断',
    subtitle: '核心不足识别',
    description: '系统分析对话，识别出3个核心不足：语用得体性、词汇多样性、话轮适配',
    time: '14:40'
  },
  {
    id: 4,
    icon: BookOpen,
    title: '输入促成',
    subtitle: '精准学习材料',
    description: '根据诊断结果，提供定制化输入材料包和3个针对性练习',
    time: '14:45'
  },
  {
    id: 5,
    icon: MessageSquare,
    title: '产出验证',
    subtitle: '第二次对话练习',
    description: '在相同场景下完成新情节对话，验证学习成果',
    time: '14:52'
  },
  {
    id: 6,
    icon: BarChart3,
    title: '双轨评价',
    subtitle: '学习进步对比',
    description: '对比两轮对话表现，生成七维能力雷达图和靶向评估报告',
    time: '14:58'
  }
]

export default function ReportPage() {
  const [isExporting, setIsExporting] = useState(false)
  const [photo, setPhoto] = useState('')

  useEffect(() => {
    const storedPhoto = localStorage.getItem('selectedPhoto')
    if (storedPhoto) {
      setPhoto(storedPhoto)
    }
  }, [])

  const handleExport = () => {
    setIsExporting(true)
    setTimeout(() => {
      alert('报告已导出为PDF！')
      setIsExporting(false)
    }, 1500)
  }

  const handleRestart = () => {
    localStorage.clear()
    window.location.href = '/'
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-green-100 text-green-700 px-4 py-2 rounded-full text-sm font-medium mb-4">
            <CheckCircle2 className="w-4 h-4" />
            POA学习闭环完成
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">学习证据链报告</h1>
          <p className="text-gray-600">完整记录你的POA学习过程和成果</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">学习概览</h2>
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleExport}
              disabled={isExporting}
            >
              <Download className="w-4 h-4 mr-2" />
              {isExporting ? '导出中...' : '导出报告'}
            </Button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-indigo-50 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-indigo-600">72</p>
              <p className="text-sm text-indigo-700">综合得分</p>
            </div>
            <div className="bg-green-50 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-green-600">3</p>
              <p className="text-sm text-green-700">核心不足改善</p>
            </div>
            <div className="bg-amber-50 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-amber-600">2</p>
              <p className="text-sm text-amber-700">对话练习</p>
            </div>
            <div className="bg-purple-50 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-purple-600">30%</p>
              <p className="text-sm text-purple-700">平均进步</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">学习证据链时间线</h2>
          <div className="relative">
            <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-200" />
            <div className="space-y-6">
              {timelineItems.map((item, index) => (
                <div key={item.id} className="relative flex gap-4">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 z-10 ${
                    index === timelineItems.length - 1 
                      ? 'bg-green-500 text-white' 
                      : 'bg-indigo-100 text-indigo-600'
                  }`}>
                    <item.icon className="w-6 h-6" />
                  </div>
                  <div className="flex-1 bg-gray-50 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-gray-900">{item.title}</h3>
                      <span className="text-sm text-gray-500">{item.time}</span>
                    </div>
                    <p className="text-sm text-gray-500 mb-1">{item.subtitle}</p>
                    <p className="text-gray-700">{item.description}</p>
                  </div>
                  {index < timelineItems.length - 1 && (
                    <ArrowRight className="w-5 h-5 text-gray-400 mt-4 flex-shrink-0" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">场景回顾</h2>
          <div className="aspect-video bg-gray-100 rounded-xl overflow-hidden">
            {photo ? (
              <img src={photo} alt="Scenario" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400">
                <Image className="w-12 h-12" />
              </div>
            )}
          </div>
          <div className="mt-4 p-4 bg-indigo-50 rounded-xl">
            <p className="text-indigo-800">
              <strong>任务目标：</strong>在咖啡店场景中，作为顾客与服务员进行英文对话，练习点餐交际能力。
            </p>
          </div>
        </div>

        <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl p-6 mb-8">
          <h3 className="text-lg font-semibold text-white mb-2">学习成果总结</h3>
          <p className="text-white/90 mb-4">
            恭喜你完成了本次POA学习闭环！通过实景情境学习，你成功提升了英语交际能力，特别是在语用得体性方面取得了显著进步。
          </p>
          <ul className="space-y-2 text-white/80">
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>掌握了礼貌请求的表达方式</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>扩展了咖啡相关词汇</span>
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              <span>学会了自然延续对话的技巧</span>
            </li>
          </ul>
        </div>

        <div className="flex justify-center gap-4">
          <Button 
            variant="outline"
            size="lg"
            onClick={handleRestart}
          >
            <Home className="w-5 h-5 mr-2" />
            返回首页
          </Button>
          <Button 
            size="lg" 
            className="bg-indigo-600 hover:bg-indigo-700 text-white"
            onClick={() => window.location.href = '/scenario'}
          >
            开始新的学习
            <ArrowRight className="ml-2 w-5 h-5" />
          </Button>
        </div>
      </div>
    </div>
  )
}