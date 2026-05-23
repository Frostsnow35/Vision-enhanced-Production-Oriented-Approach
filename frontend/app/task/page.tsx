import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { User, Target, AlertTriangle, CheckCircle2, ChevronRight, Loader2, Sparkles } from 'lucide-react'

interface POATask {
  your_role: string
  ai_role: string
  goal: string
  constraints: string[]
  evaluation_criteria: string[]
}

const mockTask: POATask = {
  your_role: '顾客',
  ai_role: '咖啡店服务员',
  goal: '点一杯咖啡并询问今日推荐',
  constraints: [
    '使用礼貌用语',
    '对话时间约30-60秒',
    '需要询问价格和制作时间',
    '英语交流'
  ],
  evaluation_criteria: [
    '语用得体性：使用适当的礼貌用语',
    '功能达成：成功点单并获取所需信息',
    '话轮适配：自然衔接对话',
    '词汇多样性：使用丰富的表达方式',
    '语法准确性：句子结构正确'
  ]
}

export default function TaskPage() {
  const [photo, setPhoto] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [task, setTask] = useState<POATask | null>(null)

  useEffect(() => {
    const storedPhoto = localStorage.getItem('selectedPhoto')
    if (storedPhoto) {
      setPhoto(storedPhoto)
    }

    setTimeout(() => {
      setTask(mockTask)
      setIsLoading(false)
    }, 1500)
  }, [])

  const handleStart = () => {
    localStorage.setItem('poaTask', JSON.stringify(task))
    window.location.href = '/attempt1'
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">POA学习任务</h1>
          <p className="text-gray-600">基于实景照片生成的个性化学习任务</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-500" />
            场景照片
          </h2>
          <div className="aspect-video bg-gray-100 rounded-xl overflow-hidden">
            {photo ? (
              <img src={photo} alt="Scenario" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-400">
                <Loader2 className="w-8 h-8 animate-spin" />
              </div>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
            <Loader2 className="w-12 h-12 text-indigo-600 mx-auto mb-4 animate-spin" />
            <p className="text-gray-600">正在分析场景并生成任务...</p>
          </div>
        ) : task ? (
          <>
            <div className="grid md:grid-cols-2 gap-6 mb-6">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <User className="w-5 h-5 text-indigo-600" />
                  角色设定
                </h2>
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
                      <span className="text-xl font-bold text-indigo-600">你</span>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">你的角色</p>
                      <p className="font-medium text-gray-900">{task.your_role}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                      <span className="text-xl font-bold text-green-600">AI</span>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">AI角色</p>
                      <p className="font-medium text-gray-900">{task.ai_role}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Target className="w-5 h-5 text-amber-600" />
                  交际目标
                </h2>
                <p className="text-gray-700 leading-relaxed">{task.goal}</p>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6 mb-8">
              <div className="bg-amber-50 rounded-2xl border border-amber-100 p-6">
                <h2 className="text-lg font-semibold text-amber-900 mb-4 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-600" />
                  语境限制
                </h2>
                <ul className="space-y-2">
                  {task.constraints.map((constraint, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 bg-amber-500 rounded-full mt-2 flex-shrink-0" />
                      <span className="text-amber-800">{constraint}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="bg-green-50 rounded-2xl border border-green-100 p-6">
                <h2 className="text-lg font-semibold text-green-900 mb-4 flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  评价标准
                </h2>
                <ul className="space-y-2">
                  {task.evaluation_criteria.map((criterion, index) => (
                    <li key={index} className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full mt-2 flex-shrink-0" />
                      <span className="text-green-800 text-sm">{criterion}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="flex justify-center">
              <Button 
                size="lg" 
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-8"
                onClick={handleStart}
              >
                开始对话练习
                <ChevronRight className="ml-2 w-5 h-5" />
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}